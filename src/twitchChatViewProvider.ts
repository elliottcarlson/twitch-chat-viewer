import * as vscode from 'vscode';
import { TwitchClient, TwitchMessage } from './twitchClient';
import { TwitchAuthProvider } from './authProvider';

export class TwitchChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private twitchClient: TwitchClient;
    private unreadCount: number = 0;
    private isViewVisible: boolean = false;
    private isViewActive: boolean = false;
    private outputChannel: vscode.OutputChannel;
    private authProvider: TwitchAuthProvider;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        outputChannel: vscode.OutputChannel,
        authProvider: TwitchAuthProvider
    ) {
        this.outputChannel = outputChannel;
        this.authProvider = authProvider;
        this.outputChannel.appendLine('TwitchChatViewProvider constructor called');
        this.twitchClient = new TwitchClient((message) => this.handleMessage(message), outputChannel);
    }

    /**
     * Resolve the webview view when it becomes visible
     * @param webviewView The webview view to resolve
     * @param context The context in which the webview view is being resolved
     * @param _token Cancellation token
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.outputChannel.appendLine(`resolveWebviewView called (state: ${context.state ? 'exists' : 'null'})`);
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.outputChannel.appendLine('Setting webview HTML...');
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Track visibility and active state
        webviewView.onDidChangeVisibility(() => {
            this.outputChannel.appendLine(`Visibility changed: ${webviewView.visible ? 'visible' : 'hidden'}`);
            this.isViewVisible = webviewView.visible;

            if (webviewView.visible) {
                // View is visible - always clear unread count
                this.isViewActive = true;
                this.unreadCount = 0;
                // Force badge update multiple times to ensure it clears
                this._view!.badge = undefined;
                setTimeout(() => {
                    if (this._view && this.isViewVisible) {
                        this._view.badge = undefined;
                    }
                }, 50);
            } else {
                this.isViewActive = false;
            }

            // Check if already visible (switching tabs in same panel)
            if (webviewView.visible) {
                this.updateActiveState();
            }
        });

        // Listen for messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'webviewFocused') {
                this.isViewActive = true;
                // Always clear when webview reports focus, regardless of previous state
                this.clearUnreadCount();
            } else if (message.type === 'signIn') {
                await this.signIn();
            } else if (message.type === 'signOut') {
                await this.signOut();
            } else if (message.type === 'sendMessage') {
                await this.sendChatMessage(message.message);
            } else if (message.type === 'moderate') {
                await this.moderateUser(message.action, message.username, message.messageId);
            } else if (message.type === 'toggleChatMode') {
                await this.toggleChatMode(message.mode, message.enabled, message.value);
            } else if (message.type === 'showError') {
                vscode.window.showErrorMessage(message.message);
            }
        });

        // Initial state - if view is visible on creation, mark as active
        if (webviewView.visible) {
            this.isViewVisible = true;
            this.isViewActive = true;
        }

        // Handle disposal
        webviewView.onDidDispose(() => {
            this.outputChannel.appendLine('WebviewView disposed - disconnecting client');
            this.twitchClient.disconnect();
        });

        // Connect to channel if configured
        this.updateChannel();
    }

    /**
     * Update the connection to match the configured Twitch channel
     * Called when the configuration changes or on initial load
     * 
     * Priority:
     * 1. If authenticated via OAuth → use authenticated user's channel
     * 2. Otherwise → use channel from settings (anonymous mode)
     */
    public async updateChannel() {
        const config = vscode.workspace.getConfiguration('twitchChat');
        const settingsChannel = config.get<string>('channel', '');

        this.outputChannel.appendLine(`updateChannel called with settings channel: "${settingsChannel}"`);

        // Check for authentication
        await this.checkAuthentication();
        const session = await this.authProvider.getSession();
        const token = await this.getAuthToken();

        // Determine which channel to connect to
        let channelToConnect: string | undefined;
        let isAuthenticatedMode = false;

        if (session && session.username) {
            // Authenticated: use the authenticated user's own channel
            channelToConnect = session.username;
            isAuthenticatedMode = true;
            this.outputChannel.appendLine(`Authenticated as ${session.username} - connecting to own channel`);
        } else if (settingsChannel && settingsChannel.trim() !== '') {
            // Not authenticated: use channel from settings (anonymous mode)
            channelToConnect = settingsChannel;
            this.outputChannel.appendLine(`Anonymous mode - connecting to configured channel: ${settingsChannel}`);
        } else {
            // No authentication and no channel configured
            this.outputChannel.appendLine('No authentication and no channel configured');
            this.sendMessageToWebview({
                type: 'connectionStatus',
                status: 'no-channel'
            });
            this.sendMessageToWebview({
                type: 'authStatus',
                isAuthenticated: false,
                username: undefined
            });
            return;
        }

        // Connect to the determined channel
        if (channelToConnect) {
            try {
                this.outputChannel.appendLine(`Attempting to connect to Twitch channel: ${channelToConnect}`);
                await this.twitchClient.connect(channelToConnect, token);
                this.outputChannel.appendLine(`Successfully connected to channel: ${channelToConnect}`);

                this.sendMessageToWebview({
                    type: 'connectionStatus',
                    status: 'connected',
                    channel: channelToConnect
                });

                this.sendMessageToWebview({
                    type: 'authStatus',
                    isAuthenticated: isAuthenticatedMode,
                    username: session?.username || this.twitchClient.getUsername()
                });
            } catch (error) {
                this.outputChannel.appendLine(`ERROR connecting to channel: ${error}`);
                vscode.window.showErrorMessage(`Failed to connect to Twitch channel: ${channelToConnect}`);
                this.sendMessageToWebview({
                    type: 'connectionStatus',
                    status: 'error',
                    error: 'Failed to connect'
                });
            }
        }
    }

    private handleMessage(message: TwitchMessage) {
        // Only increment unread counter for actual chat messages (not subscriptions, bits, system messages, etc.)
        const isChatMessage = !message.messageType || message.messageType === 'chat';
        const shouldIncrement = isChatMessage && (!this.isViewVisible || !this.isViewActive);

        if (shouldIncrement) {
            this.incrementUnreadCount();
        }

        this.sendMessageToWebview({
            type: 'chatMessage',
            message: message
        });
    }

    private updateActiveState() {
        if (this.isViewVisible) {
            // When view is visible, ask webview if it has focus
            // The webview will respond if it's actually focused
            this.sendMessageToWebview({ type: 'checkFocus' });
        } else {
            this.isViewActive = false;
        }
    }

    private sendMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private incrementUnreadCount() {
        this.unreadCount++;
        this.updateBadge();
    }

    private clearUnreadCount() {
        this.unreadCount = 0;
        this.updateBadge();
    }

    private updateBadge() {
        if (this._view) {
            if (this.unreadCount > 0) {
                this._view.badge = {
                    value: this.unreadCount,
                    tooltip: `${this.unreadCount} unread message${this.unreadCount > 1 ? 's' : ''}`
                };
            } else {
                // Workaround: Set to null, then use empty object, then undefined
                this._view.badge = null as any;
                setTimeout(() => {
                    if (this._view && this.unreadCount === 0) {
                        // Try setting to an empty-ish badge
                        this._view.badge = { value: 0, tooltip: '' } as any;
                        setTimeout(() => {
                            if (this._view && this.unreadCount === 0) {
                                this._view.badge = undefined;
                            }
                        }, 10);
                    }
                }, 10);
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Twitch Chat</title>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: hidden;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-panel-background);
        }

        body {
            display: flex;
            flex-direction: column;
        }

        /* Fixed header at top */
        #header {
            flex-shrink: 0;
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBar-background);
        }

        #status {
            padding: 8px 10px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 12px;
        }

        #status.no-channel {
            background-color: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
        }

        #status.connected {
            background-color: var(--vscode-inputValidation-infoBackground);
            color: var(--vscode-inputValidation-infoForeground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
        }

        #status.error {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }

        #status-text {
            flex: 1;
        }

        .header-btn {
            padding: 4px 10px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            white-space: nowrap;
        }

        .header-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .header-btn:active {
            transform: translateY(1px);
        }

        /* Scrollable chat area in middle */
        #chat-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .chat-message {
            padding: 6px 8px;
            border-radius: 4px;
            background-color: var(--vscode-editor-background);
            word-wrap: break-word;
            animation: slideIn 0.2s ease-out;
            transition: opacity 0.3s ease, text-decoration 0.3s ease;
        }

        .chat-message.bits {
            background-color: var(--vscode-inputValidation-infoBackground);
            border-left: 3px solid #9147ff;
        }

        .chat-message.subscription,
        .chat-message.resub,
        .chat-message.subgift {
            background-color: var(--vscode-inputValidation-infoBackground);
            border-left: 4px solid #9147ff;
            font-weight: 500;
        }

        .chat-message.system {
            background-color: transparent;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            opacity: 0.8;
            border: none;
            padding: 4px 8px;
            text-align: center;
        }

        .bits-badge {
            display: inline-block;
            background: linear-gradient(135deg, #9147ff 0%, #ff6b9d 100%);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            margin-right: 4px;
        }

        .sub-badge {
            display: inline-block;
            background: linear-gradient(135deg, #9147ff 0%, #b366ff 100%);
            color: #fff;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            margin-right: 4px;
        }

        .first-time-badge {
            display: inline-block;
            background: linear-gradient(135deg, #00c7ac 0%, #00d8c7 100%);
            color: #fff;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            margin-right: 4px;
            text-transform: uppercase;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .chat-message-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
            flex-wrap: wrap;
        }

        .badges {
            display: flex;
            gap: 4px;
        }

        .badge {
            width: 16px;
            height: 16px;
            display: inline-block;
        }

        .username {
            font-weight: bold;
            font-size: 13px;
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 3px;
            transition: background-color 0.1s;
        }

        .username:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .username-self {
            cursor: default !important;
        }

        .username-self:hover {
            background-color: transparent !important;
        }

        /* Moderation menu and Settings menu */
        #mod-menu, #settings-menu {
            position: fixed;
            background-color: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            min-width: 200px;
            display: none;
        }

        .mod-menu-item {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            border-bottom: 1px solid var(--vscode-menu-separatorBackground);
        }

        .mod-menu-item:last-child {
            border-bottom: none;
        }

        .mod-menu-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .mod-menu-header {
            padding: 8px 12px;
            font-weight: bold;
            font-size: 11px;
            border-bottom: 1px solid var(--vscode-menu-border);
            background-color: var(--vscode-titleBar-inactiveBackground);
        }

        .settings-separator {
            height: 1px;
            background-color: var(--vscode-menu-separatorBackground);
            margin: 4px 0;
        }

        /* Command Autocomplete */
        #command-autocomplete {
            position: absolute;
            bottom: 100%;
            left: 10px;
            right: 10px;
            margin-bottom: 5px;
            background-color: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 4px;
            box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.3);
            max-height: 200px;
            overflow-y: auto;
            display: none;
            z-index: 1000;
        }

        .command-item {
            padding: 8px 12px;
            cursor: pointer;
            font-size: 12px;
            border-bottom: 1px solid var(--vscode-menu-separatorBackground);
            font-family: var(--vscode-font-family);
        }

        .command-item:last-child {
            border-bottom: none;
        }

        .command-item:hover,
        .command-item.selected {
            background-color: var(--vscode-list-hoverBackground);
        }

        .command-name {
            color: var(--vscode-textLink-foreground);
            font-weight: bold;
            font-family: var(--vscode-editor-font-family);
        }

        .command-description {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            margin-top: 2px;
        }

        #settings-gear {
            padding: 4px 10px;
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #settings-gear:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-radius: 3px;
        }

        .timestamp {
            font-size: 11px;
            opacity: 0.6;
            margin-left: auto;
        }

        .message-content {
            padding-left: 4px;
            line-height: 1.4;
            font-size: 13px;
        }

        .emote {
            display: inline-block;
            vertical-align: middle;
            margin: 0 2px;
        }

        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        /* Fixed message input at bottom */
        #message-input-container {
            flex-shrink: 0;
            padding: 10px;
            border-top: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBar-background);
            position: relative; /* For autocomplete positioning */
        }

        #message-input-container .input-wrapper {
            display: flex;
            gap: 8px;
        }

        #message-input {
            flex: 1;
            padding: 6px 10px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
        }

        #message-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        #send-btn {
            padding: 6px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-weight: 500;
        }

        #send-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <!-- Fixed Header -->
    <div id="header">
        <div id="status" class="no-channel">
            <div id="status-text">Configure a Twitch channel in settings</div>
            <button id="settings-gear" title="Settings">⚙️</button>
        </div>
    </div>

    <!-- Scrollable Chat Area -->
    <div id="chat-container"></div>

    <!-- Fixed Message Input -->
    <div id="message-input-container" style="display: none;">
        <div class="input-wrapper">
            <input type="text" id="message-input" placeholder="Send a message..." />
            <button id="send-btn">Send</button>
        </div>
        <!-- Command Autocomplete -->
        <div id="command-autocomplete"></div>
    </div>

    <!-- Moderation Menu -->
    <div id="mod-menu">
        <div class="mod-menu-header" id="mod-menu-username"></div>
        <div class="mod-menu-item" data-action="timeout-600">Timeout 10 min</div>
        <div class="mod-menu-item" data-action="ban">Ban</div>
        <div class="mod-menu-item" data-action="delete">Delete Message</div>
    </div>

    <!-- Settings Menu -->
    <div id="settings-menu">
        <div class="mod-menu-item" id="settings-pause-scroll">⏸️ Pause Scroll</div>
        <div class="mod-menu-item" id="settings-clear">🗑️ Clear Chat</div>
        <div class="mod-menu-item" id="settings-auth">🔑 Sign In</div>
        <div class="settings-separator" id="chat-modes-separator" style="display: none;"></div>
        <div id="chat-modes-section" style="display: none;">
            <div class="mod-menu-item" id="settings-shield-mode">🛡️ Shield Mode: <span id="shield-status">OFF</span></div>
            <div class="mod-menu-item" id="settings-subs-only">👑 Subscribers Only: <span id="subs-status">OFF</span></div>
            <div class="mod-menu-item" id="settings-emotes-only">😀 Emotes Only: <span id="emotes-status">OFF</span></div>
            <div class="mod-menu-item" id="settings-followers-only">👥 Followers Only: <span id="followers-status">OFF</span></div>
            <div class="mod-menu-item" id="settings-slow-mode">🐌 Slow Mode: <span id="slow-status">OFF</span></div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chat-container');
        const statusDiv = document.getElementById('status');
        const statusText = document.getElementById('status-text');
        const settingsGear = document.getElementById('settings-gear');
        const settingsMenu = document.getElementById('settings-menu');
        const messageInputContainer = document.getElementById('message-input-container');
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        let isAuthenticated = false;
        let currentUsername = null;
        let scrollPaused = false;
        
        // Room state tracking
        let roomState = {
            shieldMode: false,
            subsOnly: false,
            emotesOnly: false,
            followersOnly: false,
            slowMode: 0
        };
        
        // Moderation menu elements
        const modMenu = document.getElementById('mod-menu');
        const modMenuUsername = document.getElementById('mod-menu-username');
        let currentModTarget = null;
        let currentModMessageId = null;

        // Settings gear button handler
        settingsGear.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = settingsGear.getBoundingClientRect();
            settingsMenu.style.left = (rect.right - 200) + 'px'; // Align right edge
            settingsMenu.style.top = (rect.bottom + 5) + 'px';
            settingsMenu.style.display = 'block';
        });

        // Close menus when clicking outside
        document.addEventListener('click', (e) => {
            // Check if click is on menu, username, gear, or inside menu
            const isUsername = e.target.classList.contains('username') || e.target.closest('.username');
            const isModMenu = modMenu.contains(e.target);
            const isSettingsMenu = settingsMenu.contains(e.target);
            const isGear = e.target === settingsGear || settingsGear.contains(e.target);
            
            if (!isModMenu && !isUsername) {
                modMenu.style.display = 'none';
            }
            if (!isSettingsMenu && !isGear) {
                settingsMenu.style.display = 'none';
            }
        });

        // Handle moderation actions
        document.querySelectorAll('.mod-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.getAttribute('data-action');
                if (currentModTarget) {
                    vscode.postMessage({
                        type: 'moderate',
                        action: action,
                        username: currentModTarget,
                        messageId: currentModMessageId
                    });
                }
                modMenu.style.display = 'none';
            });
        });

        // Settings menu item handlers
        document.getElementById('settings-clear').addEventListener('click', () => {
            while (chatContainer.firstChild) {
                chatContainer.removeChild(chatContainer.firstChild);
            }
            settingsMenu.style.display = 'none';
        });

        document.getElementById('settings-auth').addEventListener('click', () => {
            if (isAuthenticated) {
                vscode.postMessage({ type: 'signOut' });
            } else {
                vscode.postMessage({ type: 'signIn' });
            }
            settingsMenu.style.display = 'none';
        });

        document.getElementById('settings-pause-scroll').addEventListener('click', () => {
            scrollPaused = !scrollPaused;
            const pauseItem = document.getElementById('settings-pause-scroll');
            if (scrollPaused) {
                pauseItem.textContent = '▶️ Resume Scroll';
            } else {
                pauseItem.textContent = '⏸️ Pause Scroll';
            }
        });

        // Chat mode toggle handlers (only visible when authenticated)
        document.getElementById('settings-shield-mode').addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleChatMode', mode: 'shield', enabled: !roomState.shieldMode });
            settingsMenu.style.display = 'none';
        });

        document.getElementById('settings-subs-only').addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleChatMode', mode: 'subsOnly', enabled: !roomState.subsOnly });
            settingsMenu.style.display = 'none';
        });

        document.getElementById('settings-emotes-only').addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleChatMode', mode: 'emotesOnly', enabled: !roomState.emotesOnly });
            settingsMenu.style.display = 'none';
        });

        document.getElementById('settings-followers-only').addEventListener('click', () => {
            // Followers-only: false = OFF, 0 or positive = ON
            const isCurrentlyOn = roomState.followersOnly !== false;
            vscode.postMessage({ type: 'toggleChatMode', mode: 'followersOnly', enabled: !isCurrentlyOn });
            settingsMenu.style.display = 'none';
        });

        document.getElementById('settings-slow-mode').addEventListener('click', () => {
            // Toggle slow mode between 0 (off) and 30 seconds
            const newValue = roomState.slowMode > 0 ? 0 : 30;
            vscode.postMessage({ type: 'toggleChatMode', mode: 'slowMode', value: newValue });
            settingsMenu.style.display = 'none';
        });

        // Command definitions
        const commands = [
            { name: '/ban', args: '<username> [reason]', description: 'Permanently ban a user from the chat' },
            { name: '/unban', args: '<username>', description: 'Remove ban from a user' },
            { name: '/emoteonly', args: '', description: 'Enable emote-only mode' },
            { name: '/emoteonlyoff', args: '', description: 'Disable emote-only mode' },
            { name: '/followers', args: '[duration]', description: 'Enable followers-only mode (default: 10 min)' },
            { name: '/followersoff', args: '', description: 'Disable followers-only mode' },
            { name: '/shield', args: '', description: 'Enable Shield Mode' },
            { name: '/shieldoff', args: '', description: 'Disable Shield Mode' },
            { name: '/slow', args: '[seconds]', description: 'Enable slow mode (default: 30s)' },
            { name: '/slowoff', args: '', description: 'Disable slow mode' },
            { name: '/subscribers', args: '', description: 'Enable subscribers-only mode' },
            { name: '/subscribersoff', args: '', description: 'Disable subscribers-only mode' },
            { name: '/timeout', args: '<username> [duration] [reason]', description: 'Timeout a user (default: 10 min)' },
            { name: '/untimeout', args: '<username>', description: 'Remove timeout from a user' }
        ];

        const commandAutocomplete = document.getElementById('command-autocomplete');
        let selectedCommandIndex = -1;
        let filteredCommands = [];

        // Parse and execute command
        function executeCommand(input) {
            const parts = input.trim().split(/\\s+/);
            const command = parts[0].toLowerCase();
            const args = parts.slice(1);

            switch (command) {
                case '/ban':
                    if (args.length === 0) {
                        vscode.postMessage({ type: 'showError', message: 'Usage: /ban <username> [reason]' });
                        return false;
                    }
                    vscode.postMessage({ type: 'moderate', action: 'ban', username: args[0], messageId: null });
                    return true;

                case '/emoteonly':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'emotesOnly', enabled: true });
                    return true;

                case '/emoteonlyoff':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'emotesOnly', enabled: false });
                    return true;

                case '/followers':
                    const followerDuration = args.length > 0 ? parseInt(args[0]) : 10;
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'followersOnly', enabled: true, value: followerDuration });
                    return true;

                case '/followersoff':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'followersOnly', enabled: false });
                    return true;

                case '/shield':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'shield', enabled: true });
                    return true;

                case '/shieldoff':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'shield', enabled: false });
                    return true;

                case '/slow':
                    const slowDuration = args.length > 0 ? parseInt(args[0]) : 30;
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'slowMode', value: slowDuration });
                    return true;

                case '/slowoff':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'slowMode', value: 0 });
                    return true;

                case '/subscribers':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'subsOnly', enabled: true });
                    return true;

                case '/subscribersoff':
                    vscode.postMessage({ type: 'toggleChatMode', mode: 'subsOnly', enabled: false });
                    return true;

                case '/timeout':
                    if (args.length === 0) {
                        vscode.postMessage({ type: 'showError', message: 'Usage: /timeout <username> [duration] [reason]' });
                        return false;
                    }
                    const timeoutDuration = args.length > 1 && !isNaN(parseInt(args[1])) ? parseInt(args[1]) : 600;
                    vscode.postMessage({ type: 'moderate', action: \`timeout-\${timeoutDuration}\`, username: args[0], messageId: null });
                    return true;

                case '/untimeout':
                case '/unban':
                    if (args.length === 0) {
                        vscode.postMessage({ type: 'showError', message: 'Usage: /untimeout <username>' });
                        return false;
                    }
                    vscode.postMessage({ type: 'moderate', action: 'untimeout', username: args[0], messageId: null });
                    return true;

                default:
                    return false; // Not a command, send as regular message
            }
        }

        // Update command autocomplete
        function updateCommandAutocomplete() {
            const input = messageInput.value;
            
            // Only show autocomplete if input starts with /
            if (!input.startsWith('/')) {
                commandAutocomplete.style.display = 'none';
                return;
            }

            // Get the command part (before first space)
            const commandPart = input.split(/\\s/)[0].toLowerCase();
            
            // Filter commands
            filteredCommands = commands.filter(cmd => cmd.name.startsWith(commandPart));
            
            if (filteredCommands.length === 0) {
                commandAutocomplete.style.display = 'none';
                return;
            }

            // Build autocomplete HTML
            commandAutocomplete.innerHTML = filteredCommands.map((cmd, index) => \`
                <div class="command-item\${index === selectedCommandIndex ? ' selected' : ''}" data-index="\${index}">
                    <div class="command-name">\${cmd.name} \${cmd.args}</div>
                    <div class="command-description">\${cmd.description}</div>
                </div>
            \`).join('');

            // Add click handlers
            commandAutocomplete.querySelectorAll('.command-item').forEach(item => {
                item.addEventListener('click', () => {
                    const index = parseInt(item.getAttribute('data-index'));
                    selectCommand(filteredCommands[index]);
                });
            });

            commandAutocomplete.style.display = 'block';
        }

        // Select a command from autocomplete
        function selectCommand(cmd) {
            messageInput.value = cmd.name + ' ';
            commandAutocomplete.style.display = 'none';
            selectedCommandIndex = -1;
            messageInput.focus();
        }

        // Handle input changes
        messageInput.addEventListener('input', () => {
            selectedCommandIndex = -1;
            updateCommandAutocomplete();
        });

        // Handle keyboard navigation
        messageInput.addEventListener('keydown', (e) => {
            if (commandAutocomplete.style.display === 'block' && filteredCommands.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedCommandIndex = (selectedCommandIndex + 1) % filteredCommands.length;
                    updateCommandAutocomplete();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedCommandIndex = selectedCommandIndex <= 0 ? filteredCommands.length - 1 : selectedCommandIndex - 1;
                    updateCommandAutocomplete();
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    if (selectedCommandIndex >= 0) {
                        selectCommand(filteredCommands[selectedCommandIndex]);
                    } else if (filteredCommands.length > 0) {
                        selectCommand(filteredCommands[0]);
                    }
                } else if (e.key === 'Escape') {
                    commandAutocomplete.style.display = 'none';
                    selectedCommandIndex = -1;
                }
            }
        });

        // Send message button handler
        sendBtn.addEventListener('click', () => {
            const message = messageInput.value.trim();
            if (message) {
                // Check if it's a command
                if (message.startsWith('/')) {
                    const executed = executeCommand(message);
                    if (executed) {
                        messageInput.value = '';
                        commandAutocomplete.style.display = 'none';
                    } else {
                        // Invalid command or want to send as message
                        vscode.postMessage({ type: 'sendMessage', message: message });
                        messageInput.value = '';
                        commandAutocomplete.style.display = 'none';
                    }
                } else {
                    vscode.postMessage({ type: 'sendMessage', message: message });
                    messageInput.value = '';
                }
            }
        });

        // Send message on Enter key
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                // If autocomplete is showing and something is selected, use Tab behavior
                if (commandAutocomplete.style.display === 'block' && selectedCommandIndex >= 0) {
                    e.preventDefault();
                    selectCommand(filteredCommands[selectedCommandIndex]);
                    return;
                }

                const message = messageInput.value.trim();
                if (message) {
                    // Check if it's a command
                    if (message.startsWith('/')) {
                        const executed = executeCommand(message);
                        if (executed) {
                            messageInput.value = '';
                            commandAutocomplete.style.display = 'none';
                        } else {
                            // Invalid command or want to send as message
                            vscode.postMessage({ type: 'sendMessage', message: message });
                            messageInput.value = '';
                            commandAutocomplete.style.display = 'none';
                        }
                    } else {
                        vscode.postMessage({ type: 'sendMessage', message: message });
                        messageInput.value = '';
                    }
                }
            }
        });

        // Notify extension when webview gains focus
        window.addEventListener('focus', () => {
            vscode.postMessage({ type: 'webviewFocused' });
        });

        // Listen for visibility check from extension
        let isActive = false;

        // Badge URLs for common Twitch badges
        const badgeUrls = {
            'broadcaster': 'https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1',
            'moderator': 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1',
            'vip': 'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/1',
            'subscriber': 'https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/1',
            'premium': 'https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/1',
            'turbo': 'https://static-cdn.jtvnw.net/badges/v1/bd444ec6-8f34-4bf9-91f4-af1e3428d80f/1'
        };

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'connectionStatus':
                    handleConnectionStatus(message);
                    break;
                case 'chatMessage':
                    addChatMessage(message.message);
                    break;
                case 'checkFocus':
                    // Check if document is currently focused
                    if (document.hasFocus()) {
                        vscode.postMessage({ type: 'webviewFocused' });
                    }
                    break;
                case 'authStatus':
                    handleAuthStatus(message);
                    break;
                case 'messageSent':
                    handleMessageSent(message);
                    break;
                case 'roomState':
                    handleRoomState(message);
                    break;
            }
        });

        function updateStatusText() {
            let text = '';
            
            if (isAuthenticated && currentUsername) {
                text = \`Signed in as \${currentUsername}\`;
            } else {
                text = 'Not signed in';
            }
            
            // Add connection status
            const statusClass = statusDiv.className;
            if (statusClass === 'connected') {
                const channel = statusText.getAttribute('data-channel');
                if (channel) {
                    text += \` • Connected to #\${channel}\`;
                }
            } else if (statusClass === 'error') {
                const error = statusText.getAttribute('data-error');
                text += \` • \${error || 'Connection error'}\`;
            } else if (statusClass === 'no-channel') {
                if (!isAuthenticated) {
                    text = 'Sign in with Twitch or configure a channel in settings';
                }
            }
            
            statusText.textContent = text;
        }

        function handleConnectionStatus(data) {
            statusDiv.className = data.status;

            if (data.status === 'connected') {
                statusText.setAttribute('data-channel', data.channel);
                clearBtn.style.display = 'block';
            } else if (data.status === 'error') {
                statusText.setAttribute('data-error', data.error || 'Connection error');
                clearBtn.style.display = 'none';
                messageInputContainer.style.display = 'none';
            } else if (data.status === 'no-channel') {
                statusText.removeAttribute('data-channel');
                statusText.removeAttribute('data-error');
                clearBtn.style.display = 'none';
                messageInputContainer.style.display = 'none';
            }
            
            updateStatusText();
        }

        function handleAuthStatus(data) {
            isAuthenticated = data.isAuthenticated;
            currentUsername = data.username;
            
            // Update settings menu auth button text
            const settingsAuthBtn = document.getElementById('settings-auth');
            if (data.isAuthenticated) {
                settingsAuthBtn.textContent = '🔑 Sign Out';
                messageInputContainer.style.display = 'block'; // Show message input
                // Show chat mode toggles
                document.getElementById('chat-modes-separator').style.display = 'block';
                document.getElementById('chat-modes-section').style.display = 'block';
            } else {
                settingsAuthBtn.textContent = '🔑 Sign In';
                messageInputContainer.style.display = 'none'; // Hide message input
                // Hide chat mode toggles
                document.getElementById('chat-modes-separator').style.display = 'none';
                document.getElementById('chat-modes-section').style.display = 'none';
            }
            
            updateStatusText();
        }

        function handleRoomState(data) {
            // Update room state from IRC ROOMSTATE
            if (data.shieldMode !== undefined) roomState.shieldMode = data.shieldMode;
            if (data.subsOnly !== undefined) roomState.subsOnly = data.subsOnly;
            if (data.emotesOnly !== undefined) roomState.emotesOnly = data.emotesOnly;
            if (data.followersOnly !== undefined) roomState.followersOnly = data.followersOnly;
            if (data.slowMode !== undefined) roomState.slowMode = data.slowMode;

            // Update UI
            document.getElementById('shield-status').textContent = roomState.shieldMode ? 'ON' : 'OFF';
            document.getElementById('subs-status').textContent = roomState.subsOnly ? 'ON' : 'OFF';
            document.getElementById('emotes-status').textContent = roomState.emotesOnly ? 'ON' : 'OFF';
            // Followers-only: false = OFF, 0 or positive number = ON
            document.getElementById('followers-status').textContent = roomState.followersOnly !== false ? 'ON' : 'OFF';
            document.getElementById('slow-status').textContent = roomState.slowMode > 0 ? \`\${roomState.slowMode}s\` : 'OFF';
        }

        function handleMessageSent(data) {
            if (data.success) {
                messageInput.value = '';
            } else {
                // Error is already shown via vscode.window.showErrorMessage
            }
        }

        // Message deletion helpers
        function removeMessageById(messageId) {
            const message = chatContainer.querySelector(\`[data-message-id="\${messageId}"]\`);
            if (message) {
                message.style.opacity = '0.3';
                message.style.textDecoration = 'line-through';
                setTimeout(() => {
                    if (message.parentNode) {
                        message.parentNode.removeChild(message);
                    }
                }, 500);
            }
        }

        function removeMessagesByUsername(username) {
            const messages = chatContainer.querySelectorAll(\`[data-username="\${username}"]\`);
            messages.forEach(message => {
                message.style.opacity = '0.3';
                message.style.textDecoration = 'line-through';
            });
            setTimeout(() => {
                messages.forEach(message => {
                    if (message.parentNode) {
                        message.parentNode.removeChild(message);
                    }
                });
            }, 500);
        }

        function clearAllMessages() {
            while (chatContainer.firstChild) {
                chatContainer.removeChild(chatContainer.firstChild);
            }
        }

        function addChatMessage(msg) {
            // Handle room state updates
            if (msg.roomStateUpdate) {
                handleRoomState(msg.roomStateUpdate);
                return;
            }
            // Handle deletion messages
            if (msg.deletedMessageId) {
                removeMessageById(msg.deletedMessageId);
                return;
            }
            if (msg.deletedUsername) {
                removeMessagesByUsername(msg.deletedUsername);
                return;
            }
            if (msg.clearAllMessages) {
                clearAllMessages();
                return;
            }

            const messageDiv = document.createElement('div');
            messageDiv.className = 'chat-message';
            
            // Add data attributes for deletion
            if (msg.messageId) {
                messageDiv.setAttribute('data-message-id', msg.messageId);
            }
            if (msg.username) {
                messageDiv.setAttribute('data-username', msg.username);
            }
            
            // Add special styling for different message types
            if (msg.messageType) {
                messageDiv.classList.add(msg.messageType);
            }

            // Handle system messages differently (no username, just message)
            if (msg.messageType === 'system') {
                const messageContent = document.createElement('div');
                messageContent.className = 'message-content';
                messageContent.textContent = msg.message;
                messageDiv.appendChild(messageContent);
                chatContainer.appendChild(messageDiv);
                
                if (!scrollPaused) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                return;
            }

            // Create header with badges, username, and timestamp
            const headerDiv = document.createElement('div');
            headerDiv.className = 'chat-message-header';

            // Add special badge for bits
            if (msg.messageType === 'bits' && msg.bits) {
                const bitsBadge = document.createElement('span');
                bitsBadge.className = 'bits-badge';
                bitsBadge.textContent = msg.bits + ' bits';
                headerDiv.appendChild(bitsBadge);
            }

            // Add special badge for subscriptions
            if (msg.messageType === 'subscription' || msg.messageType === 'resub' || msg.messageType === 'subgift') {
                const subBadge = document.createElement('span');
                subBadge.className = 'sub-badge';
                if (msg.messageType === 'subscription') {
                    subBadge.textContent = '⭐ NEW SUB';
                } else if (msg.messageType === 'resub' && msg.subMonths) {
                    subBadge.textContent = '⭐ RESUB ' + msg.subMonths + ' MONTHS';
                } else if (msg.messageType === 'subgift') {
                    subBadge.textContent = '🎁 GIFT SUB';
                }
                headerDiv.appendChild(subBadge);
            }

            // Add first-time chatter badge
            if (msg.isFirstMessage) {
                const firstTimeBadge = document.createElement('span');
                firstTimeBadge.className = 'first-time-badge';
                firstTimeBadge.textContent = 'First Time Chat';
                firstTimeBadge.title = 'This is their first message in this channel';
                headerDiv.appendChild(firstTimeBadge);
            }

            // Add badges
            if (msg.badges && msg.badges.length > 0) {
                const badgesDiv = document.createElement('div');
                badgesDiv.className = 'badges';

                msg.badges.forEach(badge => {
                    let badgeUrl = null;
                    let badgeName = '';
                    
                    // Check if badge is already a URL or a badge name
                    if (badge.startsWith('http://') || badge.startsWith('https://')) {
                        badgeUrl = badge;
                        badgeName = 'badge';
                    } else if (badgeUrls[badge]) {
                        badgeUrl = badgeUrls[badge];
                        badgeName = badge;
                    }
                    
                    if (badgeUrl) {
                        const badgeImg = document.createElement('img');
                        badgeImg.src = badgeUrl;
                        badgeImg.className = 'badge';
                        badgeImg.alt = badgeName;
                        badgesDiv.appendChild(badgeImg);
                    }
                });

                if (badgesDiv.children.length > 0) {
                    headerDiv.appendChild(badgesDiv);
                }
            }

            // Add username with color (clickable for moderation)
            const usernameSpan = document.createElement('span');
            usernameSpan.className = 'username';
            usernameSpan.style.color = msg.color;
            usernameSpan.textContent = msg.displayName;
            usernameSpan.setAttribute('data-username', msg.username);
            usernameSpan.setAttribute('data-message-id', msg.messageId || '');
            
            // Only make OTHER users' names clickable (not your own)
            const isOwnMessage = msg.username === currentUsername;
            if (!isOwnMessage) {
                // Add click handler for moderation menu
                usernameSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    
                    currentModTarget = msg.username;
                    currentModMessageId = msg.messageId;
                    modMenuUsername.textContent = msg.displayName;
                    
                    // Smart positioning: check if menu would go off bottom of screen
                    const rect = usernameSpan.getBoundingClientRect();
                    const menuHeight = 200; // Approximate menu height
                    const viewportHeight = window.innerHeight;
                    const spaceBelow = viewportHeight - rect.bottom;
                    const spaceAbove = rect.top;
                    
                    // Position above if not enough space below
                    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
                        modMenu.style.left = rect.left + 'px';
                        modMenu.style.top = (rect.top - menuHeight) + 'px';
                    } else {
                        modMenu.style.left = rect.left + 'px';
                        modMenu.style.top = (rect.bottom + 5) + 'px';
                    }
                    
                    modMenu.style.display = 'block';
                });
            } else {
                // Remove clickable styling for own messages
                usernameSpan.classList.add('username-self');
            }
            
            headerDiv.appendChild(usernameSpan);

            // Add timestamp
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'timestamp';
            const time = new Date(msg.timestamp);
            timestampSpan.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            headerDiv.appendChild(timestampSpan);

            messageDiv.appendChild(headerDiv);

            // Add message content with emotes
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = parseMessageWithEmotes(msg.message, msg.emotes, msg.thirdPartyEmotes);
            messageDiv.appendChild(contentDiv);

            chatContainer.appendChild(messageDiv);

            // Limit message history to 200 messages
            while (chatContainer.children.length > 200) {
                chatContainer.removeChild(chatContainer.firstChild);
            }

            // Auto-scroll to bottom - scroll container to its maximum height (unless paused)
            if (!scrollPaused) {
                requestAnimationFrame(() => {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                });
            }
        }

        function parseMessageWithEmotes(text, twitchEmotes, thirdPartyEmotes) {
            let html = '';

            // First, handle Twitch emotes (position-based)
            if (!twitchEmotes || Object.keys(twitchEmotes).length === 0) {
                html = escapeHtml(text);
            } else {
                const parts = [];
                let lastIndex = 0;

                // Create array of emote positions
                const emotePositions = [];
                for (const [emoteId, positions] of Object.entries(twitchEmotes)) {
                    positions.forEach(pos => {
                        const [start, end] = pos.split('-').map(Number);
                        emotePositions.push({ start, end, emoteId });
                    });
                }

                // Sort by start position
                emotePositions.sort((a, b) => a.start - b.start);

                // Build the message with emotes
                emotePositions.forEach(({ start, end, emoteId }) => {
                    // Add text before emote
                    if (start > lastIndex) {
                        parts.push(escapeHtml(text.substring(lastIndex, start)));
                    }

                    // Add emote image
                    const emoteUrl = \`https://static-cdn.jtvnw.net/emoticons/v2/\${emoteId}/default/dark/1.0\`;
                    parts.push(\`<img class="emote" src="\${emoteUrl}" alt="emote" />\`);

                    lastIndex = end + 1;
                });

                // Add remaining text
                if (lastIndex < text.length) {
                    parts.push(escapeHtml(text.substring(lastIndex)));
                }

                html = parts.join('');
            }

            // Second, handle third-party emotes (word-based)
            if (thirdPartyEmotes && Object.keys(thirdPartyEmotes).length > 0) {
                // Split by word boundaries while preserving spaces
                const words = html.split(/(\\s+)/);
                html = words.map(word => {
                    // Skip if it's whitespace or contains HTML (already an emote)
                    if (/^\\s+$/.test(word) || word.includes('<img')) {
                        return word;
                    }
                    
                    // Check if this word is a third-party emote
                    if (thirdPartyEmotes[word]) {
                        return \`<img class="emote" src="\${thirdPartyEmotes[word]}" alt="\${word}" title="\${word}" />\`;
                    }
                    
                    return word;
                }).join('');
            }

            return html;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }

    /**
     * Get OAuth token from stored session
     * @returns The auth token or undefined
     */
    private async getAuthToken(): Promise<string | undefined> {
        const session = await this.authProvider.getSession();
        return session?.accessToken;
    }

    /**
     * Check if user is authenticated
     * @returns Whether user is authenticated
     */
    private async isAuthenticated(): Promise<boolean> {
        const session = await this.authProvider.getSession();
        return session !== undefined;
    }

    /**
     * Check authentication status and update UI
     */
    private async checkAuthentication() {
        const isAuth = await this.isAuthenticated();
        this.outputChannel.appendLine(isAuth ? 'User authenticated' : 'No authentication (read-only mode)');
    }

    /**
     * Sign in to Twitch via OAuth server
     */
    private async signIn() {
        const session = await this.authProvider.signIn();

        if (session) {
            // Send auth status to webview
            this.sendMessageToWebview({
                type: 'authStatus',
                isAuthenticated: true,
                username: session.username
            });

            // Reconnect with authentication
            await this.updateChannel();
        }
    }

    /**
     * Sign out from Twitch
     */
    private async signOut() {
        await this.authProvider.signOut();

        // Send auth status to webview
        this.sendMessageToWebview({
            type: 'authStatus',
            isAuthenticated: false,
            username: undefined
        });

        // Reconnect without authentication
        await this.updateChannel();
    }

    /**
     * Send a message to the Twitch chat
     * Requires authentication token
     * @param message The message to send
     */
    private async sendChatMessage(message: string) {
        if (!(await this.isAuthenticated())) {
            vscode.window.showWarningMessage('You must sign in to send messages. Click "Sign In" to authenticate.');
            return;
        }

        if (!message || message.trim() === '') {
            return;
        }

        try {
            await this.twitchClient.sendMessage(message);
            this.sendMessageToWebview({
                type: 'messageSent',
                success: true
            });
        } catch (error) {
            this.outputChannel.appendLine(`Error sending message: ${error}`);
            vscode.window.showErrorMessage(`Failed to send message: ${error}`);
            this.sendMessageToWebview({
                type: 'messageSent',
                success: false,
                error: String(error)
            });
        }
    }

    /**
     * Moderate a user (timeout, ban, delete message)
     * Requires authentication with channel:moderate scope
     * @param action The moderation action to perform
     * @param username The username to moderate
     * @param messageId Optional message ID for deletion
     */
    private async moderateUser(action: string, username: string, messageId?: string) {
        if (!(await this.isAuthenticated())) {
            vscode.window.showWarningMessage('You must sign in to use moderation tools.');
            return;
        }

        const token = await this.getAuthToken();
        if (!token) {
            vscode.window.showWarningMessage('Could not get authentication token.');
            return;
        }

        try {
            await this.twitchClient.moderate(action, username, token, messageId);

            // Show success message in chat
            let actionName = '';
            if (action.startsWith('timeout-')) {
                const duration = parseInt(action.split('-')[1]);
                actionName = `User timed out for ${duration}s`;
            } else if (action === 'ban') {
                actionName = 'User banned';
            } else if (action === 'delete') {
                actionName = 'Message deleted';
            } else if (action === 'untimeout') {
                actionName = 'Timeout/ban removed';
            }

            if (actionName) {
                this.sendSystemMessage(`${actionName}: ${username}`);
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error moderating user: ${error}`);
            this.sendSystemMessage(`Failed to moderate ${username}: ${error}`);
        }
    }

    /**
     * Toggle chat mode (Shield Mode, Subs-Only, etc.)
     * @param mode The mode to toggle
     * @param enabled Whether to enable or disable (for chat settings)
     * @param value Optional value for modes like slow mode
     */
    private async toggleChatMode(mode: string, enabled?: boolean, value?: number) {
        if (!(await this.isAuthenticated())) {
            vscode.window.showWarningMessage('You must sign in to change chat settings.');
            return;
        }

        const token = await this.getAuthToken();
        if (!token) {
            vscode.window.showWarningMessage('Could not get authentication token.');
            return;
        }

        try {
            await this.twitchClient.toggleChatMode(mode, token, enabled, value);

            // Show success message in chat
            const modeNames: { [key: string]: string } = {
                'shield': 'Shield Mode',
                'subsOnly': 'Subscribers-Only',
                'emotesOnly': 'Emotes-Only',
                'followersOnly': 'Followers-Only',
                'slowMode': 'Slow Mode'
            };
            const modeName = modeNames[mode] || mode;
            const state = enabled === false ? 'disabled' : 'enabled';
            this.sendSystemMessage(`${modeName} ${state}`);
        } catch (error) {
            this.outputChannel.appendLine(`Error toggling chat mode: ${error}`);
            this.sendSystemMessage(`Failed to update chat mode: ${error}`);
        }
    }

    /**
     * Send a system message to the chat
     * @param message The system message to display
     */
    private sendSystemMessage(message: string) {
        this.sendMessageToWebview({
            type: 'chatMessage',
            message: {
                username: '',
                displayName: '',
                message: message,
                color: '#808080',
                badges: [],
                emotes: {},
                thirdPartyEmotes: {},
                timestamp: Date.now(),
                messageType: 'system'
            }
        });
    }

    /**
     * Dispose of the provider and clean up resources
     * Disconnects from Twitch and clears the view
     */
    public dispose() {
        this.outputChannel.appendLine('TwitchChatViewProvider disposing...');
        this.twitchClient.disconnect();
        this._view = undefined;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
