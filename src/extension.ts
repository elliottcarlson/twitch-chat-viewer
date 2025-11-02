import * as vscode from 'vscode';
import { TwitchChatViewProvider } from './twitchChatViewProvider';
import { TwitchAuthProvider } from './authProvider';

let outputChannel: vscode.OutputChannel;
let provider: TwitchChatViewProvider | undefined;
let authProvider: TwitchAuthProvider | undefined;

/**
 * Activates the Twitch Chat Viewer extension
 * @param context The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
    // Create output channel for debugging
    outputChannel = vscode.window.createOutputChannel('Twitch Chat');
    outputChannel.appendLine('Twitch Chat Viewer extension activated');

    // Create auth provider
    authProvider = new TwitchAuthProvider(context, outputChannel);

    provider = new TwitchChatViewProvider(context.extensionUri, outputChannel, authProvider);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'twitchChatView',
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Register command to focus Twitch Chat view
    context.subscriptions.push(
        vscode.commands.registerCommand('twitchChat.focus', () => {
            outputChannel.appendLine('Focus command triggered');
            vscode.commands.executeCommand('twitchChatView.focus');
        })
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('twitchChat.channel')) {
                outputChannel.appendLine('Configuration changed, updating channel...');
                provider?.updateChannel();
            }
        })
    );

    context.subscriptions.push(outputChannel);

    // Focus the Twitch Chat panel on activation
    outputChannel.appendLine('Auto-focusing Twitch Chat panel...');
    vscode.commands.executeCommand('twitchChatView.focus');
}

/**
 * Deactivates the extension
 * Disconnects from Twitch and cleans up resources
 */
export function deactivate() {
    if (provider) {
        provider.dispose();
        provider = undefined;
    }
    if (outputChannel) {
        outputChannel.appendLine('Twitch Chat Viewer extension deactivated');
    }
}
