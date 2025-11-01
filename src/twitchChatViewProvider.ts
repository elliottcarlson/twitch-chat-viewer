import * as vscode from 'vscode';
import { TwitchClient, TwitchMessage } from './twitchClient';

export class TwitchChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private twitchClient: TwitchClient;
    private unreadCount: number = 0;
    private isViewVisible: boolean = false;
    private isViewActive: boolean = false;
    private outputChannel: vscode.OutputChannel;

    constructor(private readonly _extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
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
        this.outputChannel.appendLine('resolveWebviewView called');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.outputChannel.appendLine('Setting webview HTML...');
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Track visibility and active state
        webviewView.onDidChangeVisibility(() => {
            const wasVisible = this.isViewVisible;
            this.isViewVisible = webviewView.visible;
            this.outputChannel.appendLine(`Webview visibility changed: ${wasVisible} -> ${webviewView.visible}`);

            if (webviewView.visible) {
                // View is visible - always clear unread count
                this.isViewActive = true;
                this.outputChannel.appendLine('View is visible, clearing unread count');
                this.unreadCount = 0;
                // Force badge update multiple times to ensure it clears
                this._view!.badge = undefined;
                setTimeout(() => {
                    if (this._view && this.isViewVisible) {
                        this._view.badge = undefined;
                        this.outputChannel.appendLine('Force cleared badge after timeout');
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

        // Listen for messages from webview to detect focus
        webviewView.webview.onDidReceiveMessage((message) => {
            if (message.type === 'webviewFocused') {
                const wasActive = this.isViewActive;
                this.isViewActive = true;
                this.outputChannel.appendLine(`Webview focused (was active: ${wasActive})`);
                // Always clear when webview reports focus, regardless of previous state
                this.clearUnreadCount();
            }
        });

        // Initial state - if view is visible on creation, mark as active
        if (webviewView.visible) {
            this.isViewVisible = true;
            this.isViewActive = true;
            this.outputChannel.appendLine('View initially visible, setting as active');
        }

        // Handle disposal
        webviewView.onDidDispose(() => {
            this.outputChannel.appendLine('Webview disposed, disconnecting...');
            this.twitchClient.disconnect();
        });

        // Connect to channel if configured
        this.updateChannel();
    }

    /**
     * Update the connection to match the configured Twitch channel
     * Called when the configuration changes or on initial load
     */
    public async updateChannel() {
        const config = vscode.workspace.getConfiguration('twitchChat');
        const channel = config.get<string>('channel', '');

        this.outputChannel.appendLine(`updateChannel called with channel: "${channel}"`);

        if (channel && channel.trim() !== '') {
            try {
                this.outputChannel.appendLine(`Attempting to connect to Twitch channel: ${channel}`);
                await this.twitchClient.connect(channel);
                this.outputChannel.appendLine(`Successfully connected to channel: ${channel}`);
                this.sendMessageToWebview({
                    type: 'connectionStatus',
                    status: 'connected',
                    channel: channel
                });
            } catch (error) {
                this.outputChannel.appendLine(`ERROR connecting to channel: ${error}`);
                vscode.window.showErrorMessage(`Failed to connect to Twitch channel: ${channel}`);
                this.sendMessageToWebview({
                    type: 'connectionStatus',
                    status: 'error',
                    error: 'Failed to connect'
                });
            }
        } else {
            this.outputChannel.appendLine('No channel configured');
            this.sendMessageToWebview({
                type: 'connectionStatus',
                status: 'no-channel'
            });
        }
    }

    private handleMessage(message: TwitchMessage) {
        // Check current visibility state before incrementing
        const shouldIncrement = !this.isViewVisible || !this.isViewActive;

        if (shouldIncrement) {
            this.outputChannel.appendLine(`Incrementing unread (visible: ${this.isViewVisible}, active: ${this.isViewActive})`);
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
            this.outputChannel.appendLine('View not visible, marking as inactive');
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
        if (this.unreadCount > 0) {
            this.outputChannel.appendLine(`Clearing ${this.unreadCount} unread messages`);
        }
        this.unreadCount = 0;
        this.updateBadge();
    }

    private updateBadge() {
        if (this._view) {
            if (this.unreadCount > 0) {
                this.outputChannel.appendLine(`Setting badge to ${this.unreadCount}`);
                this._view.badge = {
                    value: this.unreadCount,
                    tooltip: `${this.unreadCount} unread message${this.unreadCount > 1 ? 's' : ''}`
                };
            } else {
                this.outputChannel.appendLine(`Removing badge (count: ${this.unreadCount})`);
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
        } else {
            this.outputChannel.appendLine(`Cannot update badge - view is not available`);
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
        body {
            margin: 0;
            padding: 10px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-panel-background);
            overflow-x: hidden;
        }

        #status {
            padding: 10px;
            margin-bottom: 10px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 12px;
        }

        #status-text {
            flex: 1;
            text-align: center;
        }

        #clear-btn {
            padding: 4px 10px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--vscode-font-family);
        }

        #clear-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        #clear-btn:active {
            transform: translateY(1px);
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

        #chat-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
            overflow-y: auto;
            max-height: calc(100vh - 100px);
        }

        .chat-message {
            padding: 6px 8px;
            border-radius: 4px;
            background-color: var(--vscode-editor-background);
            word-wrap: break-word;
            animation: slideIn 0.2s ease-out;
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

        .settings-link {
            text-align: center;
            margin-top: 10px;
            font-size: 12px;
        }

        .settings-link a {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div id="status" class="no-channel">
        <div id="status-text">Configure a Twitch channel in settings</div>
        <button id="clear-btn" style="display: none;">Clear</button>
    </div>
    <div id="chat-container"></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chat-container');
        const statusDiv = document.getElementById('status');
        const statusText = document.getElementById('status-text');
        const clearBtn = document.getElementById('clear-btn');

        // Clear button handler
        clearBtn.addEventListener('click', () => {
            while (chatContainer.firstChild) {
                chatContainer.removeChild(chatContainer.firstChild);
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
            }
        });

        function handleConnectionStatus(data) {
            statusDiv.className = data.status;

            if (data.status === 'connected') {
                statusText.textContent = \`Connected to #\${data.channel}\`;
                clearBtn.style.display = 'block';
            } else if (data.status === 'error') {
                statusText.textContent = data.error || 'Connection error';
                clearBtn.style.display = 'none';
            } else if (data.status === 'no-channel') {
                statusText.textContent = 'Configure a Twitch channel in settings';
                clearBtn.style.display = 'none';
            }
        }

        function addChatMessage(msg) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'chat-message';
            
            // Add special styling for different message types
            if (msg.messageType) {
                messageDiv.classList.add(msg.messageType);
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

            // Add badges
            if (msg.badges && msg.badges.length > 0) {
                const badgesDiv = document.createElement('div');
                badgesDiv.className = 'badges';

                msg.badges.forEach(badge => {
                    if (badgeUrls[badge]) {
                        const badgeImg = document.createElement('img');
                        badgeImg.src = badgeUrls[badge];
                        badgeImg.className = 'badge';
                        badgeImg.alt = badge;
                        badgesDiv.appendChild(badgeImg);
                    }
                });

                headerDiv.appendChild(badgesDiv);
            }

            // Add username with color
            const usernameSpan = document.createElement('span');
            usernameSpan.className = 'username';
            usernameSpan.style.color = msg.color;
            usernameSpan.textContent = msg.displayName;
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

            // Auto-scroll to bottom - scroll container to its maximum height
            requestAnimationFrame(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            });
        }

        function parseMessageWithEmotes(text, twitchEmotes, thirdPartyEmotes) {
            let html = '';

            // Debug: Log what we received
            console.log('[FFZ Debug] Parsing message:', text);
            console.log('[FFZ Debug] Third-party emotes:', thirdPartyEmotes);
            console.log('[FFZ Debug] Third-party emote count:', thirdPartyEmotes ? Object.keys(thirdPartyEmotes).length : 0);

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
                console.log('[FFZ Debug] Processing third-party emotes...');
                // Split by word boundaries while preserving spaces
                const words = html.split(/(\\s+)/);
                html = words.map(word => {
                    // Skip if it's whitespace or contains HTML (already an emote)
                    if (/^\\s+$/.test(word) || word.includes('<img')) {
                        return word;
                    }
                    
                    // Check if this word is a third-party emote
                    if (thirdPartyEmotes[word]) {
                        console.log(\`[FFZ Debug] Found emote "\${word}" -> \${thirdPartyEmotes[word]}\`);
                        return \`<img class="emote" src="\${thirdPartyEmotes[word]}" alt="\${word}" title="\${word}" />\`;
                    }
                    
                    return word;
                }).join('');
            } else {
                console.log('[FFZ Debug] No third-party emotes to process');
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
