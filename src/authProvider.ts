import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import * as https from 'https';

/**
 * Authentication session data
 */
interface AuthSession {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    username?: string;
}

/**
 * Twitch user data from Helix API
 */
interface TwitchUser {
    id: string;
    login: string;
    display_name: string;
    email?: string;
}

/**
 * Token response from Twitch
 */
interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string[];
    token_type: string;
}

/**
 * Authentication provider for Twitch OAuth using Implicit Grant Flow
 * Perfect for client-side applications like VS Code extensions
 * No client secret required - token returned directly in URL fragment
 * @see https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#implicit-grant-flow
 */
export class TwitchAuthProvider {
    // Use your actual Twitch Client ID here
    private static readonly CLIENT_ID = 'hijf2gf2x1p7qtugiqow7vx0pyonkr';
    private static readonly REDIRECT_URI = 'http://localhost:3000';
    private static readonly SCOPES = [
        'chat:read',
        'chat:edit',
        'user:read:email',
        'channel:moderate',
        'moderator:manage:banned_users', // Required for ban/timeout API
        'moderator:manage:chat_messages', // Required for deleting messages
        'moderator:manage:shield_mode', // Required for Shield Mode
        'moderator:manage:chat_settings' // Required for chat settings (subs-only, slow mode, etc.)
    ];
    private static readonly STORAGE_KEY = 'twitch_auth_session';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) { }

    /**
     * Sign in to Twitch using Implicit Grant Flow
     * Opens browser for OAuth and starts local server for callback
     * Token is returned directly in the URL fragment (no exchange needed!)
     */
    async signIn(): Promise<AuthSession | undefined> {
        try {
            // Generate state for CSRF protection
            const state = this.generateState();

            this.outputChannel.appendLine('Starting Implicit Grant OAuth flow...');
            this.outputChannel.appendLine(`State: ${state.substring(0, 20)}...`);

            // Build authorization URL (response_type=token for implicit flow)
            const authUrl = this.buildAuthUrl(state);

            // Start local server to receive callback with token in fragment
            const tokenData = await this.startCallbackServer(state, authUrl);

            if (!tokenData) {
                throw new Error('Failed to receive access token');
            }

            this.outputChannel.appendLine('✅ Successfully received access token!');

            // Fetch username
            const username = await this.fetchUsername(tokenData.access_token);

            const session: AuthSession = {
                accessToken: tokenData.access_token,
                refreshToken: '', // Implicit flow doesn't provide refresh tokens
                expiresIn: tokenData.expires_in || 0,
                username: username
            };

            // Store session securely
            await this.storeSession(session);

            this.outputChannel.appendLine(`Successfully authenticated as: ${username}`);
            vscode.window.showInformationMessage(`Signed in to Twitch as ${username}`);

            return session;

        } catch (error) {
            this.outputChannel.appendLine(`Authentication error: ${error}`);
            vscode.window.showErrorMessage(`Failed to sign in: ${error}`);
            return undefined;
        }
    }

    /**
     * Sign out from Twitch
     * Clears stored session
     */
    async signOut(): Promise<void> {
        try {
            await this.context.secrets.delete(TwitchAuthProvider.STORAGE_KEY);
            this.outputChannel.appendLine('Signed out successfully');
            vscode.window.showInformationMessage('Signed out from Twitch');
        } catch (error) {
            this.outputChannel.appendLine(`Sign out error: ${error}`);
        }
    }

    /**
     * Get current authentication session
     */
    async getSession(): Promise<AuthSession | undefined> {
        try {
            const sessionJson = await this.context.secrets.get(TwitchAuthProvider.STORAGE_KEY);
            if (!sessionJson) {
                return undefined;
            }

            const session: AuthSession = JSON.parse(sessionJson);

            // TODO: Add token refresh logic if expired

            return session;
        } catch (error) {
            this.outputChannel.appendLine(`Error retrieving session: ${error}`);
            return undefined;
        }
    }

    /**
     * Generate random state parameter for CSRF protection
     */
    private generateState(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Build Twitch authorization URL using Implicit Grant Flow
     * Uses response_type=token to get token directly (no code exchange)
     */
    private buildAuthUrl(state: string): string {
        const params = new URLSearchParams({
            client_id: TwitchAuthProvider.CLIENT_ID,
            redirect_uri: TwitchAuthProvider.REDIRECT_URI,
            response_type: 'token', // Implicit flow - token returned directly!
            scope: TwitchAuthProvider.SCOPES.join(' '),
            state: state,
            force_verify: 'false' // Set to 'true' to always show authorization
        });

        return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
    }

    /**
     * Start local HTTP server to receive OAuth callback
     * For Implicit Flow, token is in URL fragment (after #)
     * We use JavaScript to extract it and send it to the server
     */
    private async startCallbackServer(expectedState: string, authUrl: string): Promise<TokenResponse | undefined> {
        return new Promise((resolve) => {
            const server = http.createServer((req, res) => {
                const url = new URL(req.url || '', `http://localhost:3000`);

                // Check for error in query params (errors are in query, not fragment)
                const error = url.searchParams.get('error');
                if (error) {
                    this.outputChannel.appendLine(`OAuth error: ${error}`);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head><title>Authentication Failed</title></head>
                        <body style="font-family: Arial; text-align: center; padding: 50px;">
                            <h1>Authentication Failed</h1>
                            <p>Error: ${error}</p>
                            <p>You can close this window and try again.</p>
                        </body>
                        </html>
                    `);
                    server.close();
                    resolve(undefined);
                    return;
                }

                // Handle token callback (JavaScript will extract from fragment and POST here)
                if (req.method === 'POST' && url.pathname === '/callback') {
                    let body = '';
                    req.on('data', chunk => { body += chunk.toString(); });
                    req.on('end', () => {
                        try {
                            const data = JSON.parse(body);

                            if (data.state !== expectedState) {
                                this.outputChannel.appendLine('Invalid state parameter');
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: 'Invalid state' }));
                                server.close();
                                resolve(undefined);
                                return;
                            }

                            this.outputChannel.appendLine('✅ Received valid access token from callback');
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                            server.close();

                            resolve({
                                access_token: data.access_token,
                                refresh_token: '', // Implicit flow doesn't provide refresh token
                                expires_in: parseInt(data.expires_in || '0'),
                                scope: (data.scope || '').split(' '),
                                token_type: data.token_type || 'bearer'
                            });
                        } catch (error) {
                            this.outputChannel.appendLine(`Error parsing callback data: ${error}`);
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid data' }));
                            server.close();
                            resolve(undefined);
                        }
                    });
                    return;
                }

                // Initial redirect from Twitch - serve HTML that extracts token from fragment
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Twitch Authentication</title>
                        <style>
                            body {
                                font-family: Arial, sans-serif;
                                text-align: center;
                                padding: 50px;
                                background: #0e0e10;
                                color: #efeff1;
                            }
                            h1 { color: #9147ff; }
                            .spinner {
                                border: 4px solid #f3f3f3;
                                border-top: 4px solid #9147ff;
                                border-radius: 50%;
                                width: 40px;
                                height: 40px;
                                animation: spin 1s linear infinite;
                                margin: 20px auto;
                            }
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                        </style>
                    </head>
                    <body>
                        <h1>✅ Authentication Successful!</h1>
                        <div class="spinner"></div>
                        <p>Processing... You can close this window in a moment.</p>
                        <script>
                            // Extract token from URL fragment (after #)
                            const fragment = window.location.hash.substring(1);
                            const params = new URLSearchParams(fragment);
                            
                            const tokenData = {
                                access_token: params.get('access_token'),
                                token_type: params.get('token_type'),
                                expires_in: params.get('expires_in'),
                                scope: params.get('scope'),
                                state: params.get('state')
                            };

                            // Send token data to server
                            fetch('http://localhost:3000/callback', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(tokenData)
                            }).then(response => {
                                if (response.ok) {
                                    document.body.innerHTML = '<h1>Success!</h1><p>You can now close this window and return to VS Code.</p>';
                                    setTimeout(() => window.close(), 2000);
                                } else {
                                    document.body.innerHTML = '<h1>Error</h1><p>Failed to complete authentication. Please try again.</p>';
                                }
                            }).catch(error => {
                                console.error('Error:', error);
                                document.body.innerHTML = '<h1>Error</h1><p>Network error. Please try again.</p>';
                            });
                        </script>
                    </body>
                    </html>
                `);
            });

            server.listen(3000, () => {
                this.outputChannel.appendLine('Local callback server started on port 3000');
                this.outputChannel.appendLine('Using Implicit Grant Flow - token will be in URL fragment');

                // Open browser to Twitch authorization
                vscode.env.openExternal(vscode.Uri.parse(authUrl));
                this.outputChannel.appendLine('Opened browser for authentication');
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                if (server.listening) {
                    this.outputChannel.appendLine('Authentication timed out');
                    server.close();
                    resolve(undefined);
                }
            }, 300000);
        });
    }


    /**
     * Fetch Twitch username from Helix API
     */
    private async fetchUsername(accessToken: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            const options = {
                hostname: 'api.twitch.tv',
                path: '/helix/users',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': TwitchAuthProvider.CLIENT_ID
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const json = JSON.parse(data);
                            if (json.data && json.data.length > 0) {
                                const user: TwitchUser = json.data[0];
                                this.outputChannel.appendLine(`Fetched username: ${user.login}`);
                                resolve(user.login);
                            } else {
                                this.outputChannel.appendLine('No user data in response');
                                resolve(undefined);
                            }
                        } else {
                            this.outputChannel.appendLine(`Failed to fetch username: HTTP ${res.statusCode}`);
                            resolve(undefined);
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`Error parsing user data: ${error}`);
                        resolve(undefined);
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Error fetching username: ${error}`);
                resolve(undefined);
            });

            req.end();
        });
    }

    /**
     * Store authentication session securely
     */
    private async storeSession(session: AuthSession): Promise<void> {
        const sessionJson = JSON.stringify(session);
        await this.context.secrets.store(TwitchAuthProvider.STORAGE_KEY, sessionJson);
    }
}
