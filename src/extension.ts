import * as vscode from 'vscode';
import { TwitchChatViewProvider } from './twitchChatViewProvider';

let outputChannel: vscode.OutputChannel;
let provider: TwitchChatViewProvider | undefined;

/**
 * Activates the Twitch Chat Viewer extension
 * @param context The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
    // Create output channel for debugging
    outputChannel = vscode.window.createOutputChannel('Twitch Chat');
    outputChannel.appendLine('Twitch Chat Viewer extension activated');

    provider = new TwitchChatViewProvider(context.extensionUri, outputChannel);

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
