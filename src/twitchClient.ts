import * as tmi from 'tmi.js';
import * as vscode from 'vscode';
import * as https from 'https';
import { EmoteService } from './emoteService';
import { config } from './config';

export interface TwitchMessage {
    username: string;
    displayName: string;
    message: string;
    color: string;
    badges: string[];
    emotes: { [emoteid: string]: string[] };
    thirdPartyEmotes: { [emoteName: string]: string };
    timestamp: number;
    messageId?: string;
    isFirstMessage?: boolean;
    messageType?: 'chat' | 'subscription' | 'resub' | 'subgift' | 'bits' | 'system';
    bits?: number;
    subMonths?: number;
    subTier?: string;
    gifterName?: string;
    recipientName?: string;
}

export class TwitchClient {
    private static readonly CLIENT_ID = config.twitch.clientId;
    private static readonly BROADCASTER_BADGE_URL = 'https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1';

    private client: tmi.Client | null = null;
    private currentChannel: string = '';
    private currentUsername: string | undefined;
    private currentUserId: string | undefined;
    private currentUserColor: string | undefined;
    private messageCallback: ((message: TwitchMessage) => void) | null = null;
    private outputChannel: vscode.OutputChannel;
    private emoteService: EmoteService;
    private thirdPartyEmotes: Map<string, string> = new Map();
    private shieldModePollingInterval: NodeJS.Timeout | undefined;
    private authToken: string | undefined;

    constructor(private onMessage: (message: TwitchMessage) => void, outputChannel: vscode.OutputChannel) {
        this.messageCallback = onMessage;
        this.outputChannel = outputChannel;
        this.emoteService = new EmoteService(outputChannel);
        this.outputChannel.appendLine('TwitchClient constructor called');
    }

    /**
     * Fetch username and user ID from Twitch API using OAuth token
     * @param token OAuth token (with or without 'oauth:' prefix)
     * @returns Promise resolving to username or undefined if failed
     */
    private async fetchUsername(token: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            const cleanToken = token.replace('oauth:', '');
            const options = {
                hostname: 'api.twitch.tv',
                path: '/helix/users',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', async () => {
                    try {
                        if (res.statusCode === 200) {
                            const json = JSON.parse(data);
                            if (json.data && json.data.length > 0) {
                                const username = json.data[0].login;
                                const userId = json.data[0].id;
                                this.currentUserId = userId;
                                this.outputChannel.appendLine(`Fetched username: ${username}, ID: ${userId}`);
                                resolve(username);
                            } else {
                                this.outputChannel.appendLine('No user data in response');
                                resolve(undefined);
                            }
                        } else {
                            this.outputChannel.appendLine(`Failed to fetch username: HTTP ${res.statusCode}`);
                            this.outputChannel.appendLine(`Response: ${data}`);
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
     * Connect to a Twitch channel's IRC chat
     * @param channel The Twitch channel name to connect to
     * @param token Optional OAuth token for authenticated connection
     */
    async connect(channel: string, token?: string): Promise<void> {
        this.outputChannel.appendLine(`TwitchClient.connect() called with channel: "${channel}"`);

        // Disconnect if already connected
        if (this.client) {
            this.outputChannel.appendLine('Already connected, disconnecting first...');
            await this.disconnect();
        }

        if (!channel || channel.trim() === '') {
            this.outputChannel.appendLine('Channel is empty, aborting connection');
            return;
        }

        channel = channel.replace('#', '').toLowerCase().trim();
        this.currentChannel = channel;
        this.outputChannel.appendLine(`Normalized channel name: "${channel}"`);

        // Fetch username if token is provided
        let username: string | undefined;
        if (token) {
            username = await this.fetchUsername(token);
            if (username) {
                this.currentUsername = username;
            } else {
                this.currentUsername = undefined;
                this.outputChannel.appendLine('WARNING: Could not fetch username from token. Authentication will fail.');
                this.outputChannel.appendLine('Please check that your token is valid and has not expired.');
            }
        } else {
            this.currentUsername = undefined;
        }

        // Create client with optional authentication
        this.outputChannel.appendLine(`Creating tmi.js client${token && username ? ' (authenticated)' : ' (anonymous)'}...`);
        this.client = new tmi.Client({
            connection: {
                reconnect: true,
                secure: true
            },
            channels: [channel],
            options: {
                debug: false
            },
            identity: token && username ? {
                username: username,
                password: `oauth:${token.replace('oauth:', '')}`
            } : undefined
        });

        // Set up message handler
        this.client.on('message', (channel, tags, message, self) => {
            if (self || !this.messageCallback) return;

            const tagData = tags as any;

            const username = tags.username || 'anonymous';
            const twitchMessage: TwitchMessage = {
                username: username,
                displayName: tags['display-name'] || tags.username || 'Anonymous',
                message: message,
                color: tags.color || this.getDeterministicColor(username),
                badges: this.parseBadges(tags.badges),
                emotes: tags.emotes || {},
                thirdPartyEmotes: Object.fromEntries(this.thirdPartyEmotes),
                timestamp: Date.now(),
                messageId: tags.id,
                isFirstMessage: tagData['first-msg'] === true || tagData['first-msg'] === '1',
                messageType: tags.bits ? 'bits' : 'chat',
                bits: tags.bits ? parseInt(tags.bits) : undefined
            };

            this.messageCallback(twitchMessage);
        });

        // Handle subscription events
        this.client.on('subscription', (channel, username, method, message, userstate) => {
            if (!this.messageCallback) return;
            this.outputChannel.appendLine(`New subscription from ${username}`);

            const subMessage: TwitchMessage = {
                username: username,
                displayName: userstate['display-name'] || username,
                message: message || 'just subscribed!',
                color: userstate.color || this.getDeterministicColor(username),
                badges: this.parseBadges(userstate.badges),
                emotes: userstate.emotes || {},
                thirdPartyEmotes: Object.fromEntries(this.thirdPartyEmotes),
                timestamp: Date.now(),
                messageType: 'subscription',
                subTier: method?.plan || 'Prime'
            };

            this.messageCallback(subMessage);
        });

        // Handle resubscription events
        this.client.on('resub', (channel, username, months, message, userstate, methods) => {
            if (!this.messageCallback) return;

            const cumulativeMonths = parseInt(userstate['msg-param-cumulative-months'] || '0') || months;
            this.outputChannel.appendLine(`Resub from ${username}: ${cumulativeMonths} months`);

            const resubMessage: TwitchMessage = {
                username: username,
                displayName: userstate['display-name'] || username,
                message: message || `resubscribed for ${cumulativeMonths} months!`,
                color: userstate.color || this.getDeterministicColor(username),
                badges: this.parseBadges(userstate.badges),
                emotes: userstate.emotes || {},
                thirdPartyEmotes: Object.fromEntries(this.thirdPartyEmotes),
                timestamp: Date.now(),
                messageType: 'resub',
                subMonths: cumulativeMonths,
                subTier: methods?.plan || 'Prime'
            };

            this.messageCallback(resubMessage);
        });

        // Handle gift sub events
        this.client.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
            if (!this.messageCallback) return;
            this.outputChannel.appendLine(`${username} gifted a sub to ${recipient}`);

            const giftMessage: TwitchMessage = {
                username: username,
                displayName: userstate['display-name'] || username,
                message: `gifted a subscription to ${recipient}!`,
                color: userstate.color || this.getDeterministicColor(username),
                badges: this.parseBadges(userstate.badges),
                emotes: {},
                thirdPartyEmotes: Object.fromEntries(this.thirdPartyEmotes),
                timestamp: Date.now(),
                messageType: 'subgift',
                gifterName: username,
                recipientName: recipient,
                subTier: methods?.plan || '1000'
            };

            this.messageCallback(giftMessage);
        });

        // Handle mystery gift subs
        this.client.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
            if (!this.messageCallback) return;
            this.outputChannel.appendLine(`${username} gifted ${numbOfSubs} subs`);

            const mysteryGiftMessage: TwitchMessage = {
                username: username,
                displayName: userstate['display-name'] || username,
                message: `gifted ${numbOfSubs} subscriptions to the community!`,
                color: userstate.color || this.getDeterministicColor(username),
                badges: this.parseBadges(userstate.badges),
                emotes: {},
                thirdPartyEmotes: Object.fromEntries(this.thirdPartyEmotes),
                timestamp: Date.now(),
                messageType: 'subgift',
                gifterName: username,
                subTier: methods?.plan || '1000'
            };

            this.messageCallback(mysteryGiftMessage);
        });

        // Handle raw IRC messages for various events
        this.client.on('raw_message', (messageCloned: any) => {
            // Handle ROOMSTATE to track chat modes
            if (messageCloned.command === 'ROOMSTATE') {
                const tags = messageCloned.tags;
                if (tags && this.messageCallback) {
                    const followersOnlyValue = tags['followers-only'] ? parseInt(tags['followers-only']) : -1;
                    const roomState: any = {
                        subsOnly: tags['subs-only'] === '1' || tags['subs-only'] === true,
                        emotesOnly: tags['emote-only'] === '1' || tags['emote-only'] === true,
                        followersOnly: followersOnlyValue !== -1 ? followersOnlyValue : false,
                        slowMode: tags['slow'] ? parseInt(tags['slow']) : 0
                    };

                    this.messageCallback({
                        username: '',
                        displayName: '',
                        message: '',
                        color: '',
                        badges: [],
                        emotes: {},
                        thirdPartyEmotes: {},
                        timestamp: Date.now(),
                        messageType: 'chat' as any,
                        roomStateUpdate: roomState
                    } as any);
                }
            }
            // Handle GLOBALUSERSTATE to get our own color from IRC
            else if (messageCloned.command === 'GLOBALUSERSTATE') {
                const tags = messageCloned.tags;
                if (tags && tags.color) {
                    this.currentUserColor = tags.color;
                    this.outputChannel.appendLine(`Got color from IRC GLOBALUSERSTATE: ${tags.color}`);
                } else if (!this.currentUserColor) {
                    // Fallback to Twitch purple if no color set
                    this.currentUserColor = '#9147ff';
                    this.outputChannel.appendLine('No color in GLOBALUSERSTATE, using Twitch purple');
                }
            }
            // Handle message deletion (CLEARMSG)
            else if (messageCloned.command === 'CLEARMSG') {
                const tags = messageCloned.tags;
                if (tags && tags['target-msg-id'] && this.messageCallback) {
                    this.outputChannel.appendLine(`Message deleted: ${tags['target-msg-id']}`);

                    this.messageCallback({
                        username: '',
                        displayName: '',
                        message: '',
                        color: '',
                        badges: [],
                        emotes: {},
                        thirdPartyEmotes: {},
                        timestamp: Date.now(),
                        messageId: tags['target-msg-id'],
                        messageType: 'chat' as any,
                        deletedMessageId: tags['target-msg-id'] // Special flag
                    } as any);
                }
            }
            // Handle user timeout/ban (CLEARCHAT)
            else if (messageCloned.command === 'CLEARCHAT') {
                const tags = messageCloned.tags;

                if (messageCloned.params && messageCloned.params.length > 1) {
                    const username = messageCloned.params[1];
                    const duration = tags && tags['ban-duration'];
                    this.outputChannel.appendLine(`User messages cleared: ${username} (${duration ? duration + 's timeout' : 'ban'})`);

                    if (this.messageCallback) {
                        this.messageCallback({
                            username: username,
                            displayName: '',
                            message: '',
                            color: '',
                            badges: [],
                            emotes: {},
                            thirdPartyEmotes: {},
                            timestamp: Date.now(),
                            messageType: 'chat' as any,
                            deletedUsername: username
                        } as any);
                    }
                } else {
                    // No username = clear all chat
                    this.outputChannel.appendLine('All chat cleared');
                    if (this.messageCallback) {
                        this.messageCallback({
                            username: '',
                            displayName: '',
                            message: '',
                            color: '',
                            badges: [],
                            emotes: {},
                            thirdPartyEmotes: {},
                            timestamp: Date.now(),
                            messageType: 'chat' as any,
                            clearAllMessages: true
                        } as any);
                    }
                }
            }
        });

        // Handle connection events
        this.client.on('connected', (address, port) => {
            this.outputChannel.appendLine(`Connected to ${address}:${port}`);
        });

        this.client.on('disconnected', (reason) => {
            this.outputChannel.appendLine(`Disconnected from Twitch: ${reason}`);
        });

        this.client.on('reconnect', () => {
            this.outputChannel.appendLine('Reconnecting to Twitch...');
        });

        // Connect to Twitch
        try {
            this.outputChannel.appendLine('Calling client.connect()...');
            await this.client.connect();
            this.outputChannel.appendLine('client.connect() completed successfully');

            // Fetch all third-party emotes for the channel
            this.outputChannel.appendLine('Fetching third-party emotes (FFZ, BTTV, 7TV)...');
            const channelUserId = await this.fetchChannelUserId(channel, token);
            this.thirdPartyEmotes = await this.emoteService.fetchAllEmotes(channel, channelUserId);
            this.outputChannel.appendLine(`Total third-party emotes loaded: ${this.thirdPartyEmotes.size}`);

            // Store auth token and start shield mode polling if authenticated
            if (token) {
                this.authToken = token;
                this.startShieldModePolling();
            }
        } catch (error) {
            this.outputChannel.appendLine(`ERROR in client.connect(): ${error}`);
            throw error;
        }
    }

    /**
     * Fetch channel user ID from Twitch API
     * @param channel The channel name
     * @param token Optional OAuth token
     * @returns Promise resolving to channel user ID or undefined
     */
    private async fetchChannelUserId(channel: string, token?: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/users?login=${channel}`,
                method: 'GET',
                headers: {
                    'Client-Id': TwitchClient.CLIENT_ID,
                    ...(token ? { 'Authorization': `Bearer ${token.replace('oauth:', '')}` } : {})
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
                                const userId = json.data[0].id;
                                this.outputChannel.appendLine(`Fetched channel user ID for ${channel}: ${userId}`);
                                resolve(userId);
                            } else {
                                this.outputChannel.appendLine(`No user data for channel ${channel}`);
                                resolve(undefined);
                            }
                        } else {
                            this.outputChannel.appendLine(`Failed to fetch channel user ID: HTTP ${res.statusCode}`);
                            resolve(undefined);
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`Error parsing channel user data: ${error}`);
                        resolve(undefined);
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Error fetching channel user ID: ${error}`);
                resolve(undefined);
            });

            req.end();
        });
    }

    /**
     * Disconnect from the current Twitch channel
     */
    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                this.outputChannel.appendLine('Disconnecting from Twitch...');
                await this.client.disconnect();
                this.outputChannel.appendLine('Disconnected successfully');
            } catch (error) {
                this.outputChannel.appendLine(`Error disconnecting: ${error}`);
            }
            this.client = null;
            this.thirdPartyEmotes.clear();

            this.stopShieldModePolling();
            this.authToken = undefined;
        }
    }

    /**
     * Parse user badges from TMI tags
     * @param badges Badge data from Twitch IRC tags
     * @returns Array of badge names
     */
    private parseBadges(badges: { [key: string]: string } | undefined): string[] {
        if (!badges) return [];
        return Object.keys(badges);
    }

    /**
     * Generate a deterministic color based on username
     * @param username The username to generate a color for
     * @returns Hex color code
     */
    private getDeterministicColor(username: string): string {
        const colors = [
            '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50',
            '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
            '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'
        ];

        // Simple hash function to convert username to number
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash; // Convert to 32-bit integer
        }

        // Use absolute value and modulo to get color index
        const index = Math.abs(hash) % colors.length;
        return colors[index];
    }

    /**
     * Get the currently connected channel name
     * @returns The channel name or empty string if not connected
     */
    getCurrentChannel(): string {
        return this.currentChannel;
    }

    /**
     * Get the authenticated username
     * @returns The authenticated username or undefined if not authenticated
     */
    getUsername(): string | undefined {
        return this.currentUsername;
    }

    /**
     * Send a message to the current channel
     * Requires authenticated connection
     * @param message The message to send
     * @returns Promise that resolves when message is sent
     */
    async sendMessage(message: string): Promise<void> {
        if (!this.client) {
            throw new Error('Not connected to a channel');
        }

        if (!this.currentChannel) {
            throw new Error('No active channel');
        }

        if (!this.currentUsername) {
            throw new Error('Not authenticated');
        }

        try {
            await this.client.say(this.currentChannel, message);
            this.outputChannel.appendLine(`Message sent: ${message}`);

            // Manually add our own message to the chat (tmi.js doesn't echo it back)
            if (this.messageCallback) {
                const isBroadcaster = this.currentUsername === this.currentChannel;
                const badges: string[] = [];

                if (isBroadcaster) {
                    badges.push(TwitchClient.BROADCASTER_BADGE_URL);
                }

                const selfMessage: TwitchMessage = {
                    username: this.currentUsername,
                    displayName: this.currentUsername,
                    message: message,
                    color: this.currentUserColor || '#9147ff', // Use fetched color or Twitch purple as fallback
                    badges: badges,
                    emotes: {},
                    thirdPartyEmotes: Object.fromEntries(this.thirdPartyEmotes),
                    timestamp: Date.now(),
                    messageType: 'chat'
                };

                this.messageCallback(selfMessage);
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error sending message: ${error}`);
            throw error;
        }
    }

    /**
     * Check if the client is currently connected
     * @returns True if connected, false otherwise
     */
    isConnected(): boolean {
        return this.client !== null && this.currentChannel !== '';
    }

    /**
     * Perform moderation action on a user using Twitch Helix API
     * @param action The moderation action to perform
     * @param username The username to moderate
     * @param token The OAuth token for authentication
     * @param messageId Optional message ID for deletion
     * @returns Promise that resolves when moderation action is sent
     */
    async moderate(action: string, username: string, token: string, messageId?: string): Promise<void> {
        if (!this.currentChannel) {
            throw new Error('No active channel');
        }

        if (!this.currentUserId) {
            throw new Error('Not authenticated - moderation requires authentication');
        }

        try {
            // Get broadcaster ID (the channel we're in)
            const broadcasterUserId = await this.fetchChannelUserId(this.currentChannel, token);
            if (!broadcasterUserId) {
                throw new Error(`Could not get broadcaster ID for channel ${this.currentChannel}`);
            }

            // Get target user ID
            const targetUserId = await this.fetchUserIdByUsername(username, token);
            if (!targetUserId) {
                throw new Error(`Could not find user: ${username}`);
            }

            this.outputChannel.appendLine(`Moderation: action=${action}, broadcaster=${broadcasterUserId}, moderator=${this.currentUserId}, target=${targetUserId}`);

            // Perform the moderation action via Helix API
            if (action === 'delete') {
                // Delete Chat Messages
                await this.apiDeleteMessage(broadcasterUserId, this.currentUserId, messageId!, token);
            } else if (action === 'untimeout') {
                // Remove timeout/ban
                await this.apiUnbanUser(broadcasterUserId, this.currentUserId, targetUserId, token);
            } else {
                // Ban/Timeout User
                const duration = this.getModerationDuration(action);
                await this.apiBanUser(broadcasterUserId, this.currentUserId, targetUserId, duration, token);
            }

            this.outputChannel.appendLine(`Moderation action completed successfully`);
        } catch (error) {
            this.outputChannel.appendLine(`Error performing moderation: ${error}`);
            throw error;
        }
    }

    /**
     * Get user ID by username
     */
    private async fetchUserIdByUsername(username: string, token: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            const cleanToken = token.replace('oauth:', '');
            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/users?login=${encodeURIComponent(username)}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const json = JSON.parse(data);
                            if (json.data && json.data.length > 0) {
                                resolve(json.data[0].id);
                            } else {
                                resolve(undefined);
                            }
                        } else {
                            this.outputChannel.appendLine(`Failed to fetch user ID: HTTP ${res.statusCode} - ${data}`);
                            resolve(undefined);
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`Error parsing user ID: ${error}`);
                        resolve(undefined);
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Error fetching user ID: ${error}`);
                resolve(undefined);
            });

            req.end();
        });
    }

    /**
     * Get moderation duration in seconds (undefined = permanent ban)
     */
    private getModerationDuration(action: string): number | undefined {
        if (action === 'ban') {
            return undefined; // No duration = permanent ban
        } else if (action.startsWith('timeout-')) {
            const duration = parseInt(action.split('-')[1]);
            return isNaN(duration) ? 600 : duration; // Default to 10 minutes if parsing fails
        } else {
            throw new Error(`Unknown action: ${action}`);
        }
    }

    /**
     * Ban or timeout a user via Helix API
     */
    private async apiBanUser(broadcasterId: string, moderatorId: string, userId: string, duration: number | undefined, token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const cleanToken = token.replace('oauth:', '');
            const body = JSON.stringify({
                data: {
                    user_id: userId,
                    ...(duration !== undefined && { duration: duration }),
                    reason: 'Moderated via VS Code extension'
                }
            });

            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 204) {
                        this.outputChannel.appendLine(`Ban/timeout successful (HTTP ${res.statusCode})`);
                        resolve();
                    } else {
                        this.outputChannel.appendLine(`Ban/timeout failed: HTTP ${res.statusCode} - ${data}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Ban/timeout request error: ${error}`);
                reject(error);
            });

            req.write(body);
            req.end();
        });
    }

    /**
     * Unban/untimeout a user via Helix API
     */
    private async apiUnbanUser(broadcasterId: string, moderatorId: string, userId: string, token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const cleanToken = token.replace('oauth:', '');
            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&user_id=${userId}`,
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 204) {
                        this.outputChannel.appendLine(`Unban/untimeout successful (HTTP ${res.statusCode})`);
                        resolve();
                    } else {
                        this.outputChannel.appendLine(`Unban/untimeout failed: HTTP ${res.statusCode} - ${data}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Unban/untimeout request error: ${error}`);
                reject(error);
            });

            req.end();
        });
    }

    /**
     * Delete a chat message via Helix API
     */
    private async apiDeleteMessage(broadcasterId: string, moderatorId: string, messageId: string, token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!messageId) {
                reject(new Error('Message ID is required for deletion'));
                return;
            }

            const cleanToken = token.replace('oauth:', '');
            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&message_id=${messageId}`,
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 204) {
                        this.outputChannel.appendLine(`Message deleted successfully`);
                        resolve();
                    } else {
                        this.outputChannel.appendLine(`Message deletion failed: HTTP ${res.statusCode} - ${data}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Delete message request error: ${error}`);
                reject(error);
            });

            req.end();
        });
    }

    /**
     * Toggle chat mode (Shield, Subs-Only, Emotes-Only, Followers-Only, Slow Mode)
     * @param mode The mode to toggle
     * @param token OAuth token
     * @param enabled Whether to enable/disable
     * @param value Optional value (for slow mode)
     */
    async toggleChatMode(mode: string, token: string, enabled?: boolean, value?: number): Promise<void> {
        if (!this.currentChannel) {
            throw new Error('No active channel');
        }

        if (!this.currentUserId) {
            throw new Error('Not authenticated');
        }

        try {
            const broadcasterUserId = await this.fetchChannelUserId(this.currentChannel, token);
            if (!broadcasterUserId) {
                throw new Error(`Could not get broadcaster ID for channel ${this.currentChannel}`);
            }

            this.outputChannel.appendLine(`Toggle chat mode: ${mode}, enabled=${enabled}, value=${value}`);

            if (mode === 'shield') {
                // Shield Mode uses separate API
                await this.apiUpdateShieldMode(broadcasterUserId, this.currentUserId, enabled!, token);

                // Immediately update UI with new shield mode state
                if (this.messageCallback) {
                    this.messageCallback({
                        username: '',
                        displayName: '',
                        message: '',
                        color: '',
                        badges: [],
                        emotes: {},
                        thirdPartyEmotes: {},
                        timestamp: Date.now(),
                        messageType: 'chat' as any,
                        roomStateUpdate: {
                            shieldMode: enabled
                        }
                    } as any);
                }
            } else {
                // All other modes use Chat Settings API
                await this.apiUpdateChatSettings(broadcasterUserId, this.currentUserId, mode, enabled, value, token);
            }

            this.outputChannel.appendLine(`Chat mode updated successfully`);
        } catch (error) {
            this.outputChannel.appendLine(`Error toggling chat mode: ${error}`);
            throw error;
        }
    }

    /**
     * Update Shield Mode via Helix API
     */
    private async apiUpdateShieldMode(broadcasterId: string, moderatorId: string, isActive: boolean, token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const cleanToken = token.replace('oauth:', '');
            const body = JSON.stringify({
                is_active: isActive
            });

            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/moderation/shield_mode?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        this.outputChannel.appendLine(`Shield mode updated successfully`);
                        resolve();
                    } else {
                        this.outputChannel.appendLine(`Shield mode update failed: HTTP ${res.statusCode} - ${data}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Shield mode request error: ${error}`);
                reject(error);
            });

            req.write(body);
            req.end();
        });
    }

    /**
     * Update chat settings via Helix API
     */
    private async apiUpdateChatSettings(broadcasterId: string, moderatorId: string, mode: string, enabled?: boolean, value?: number, token?: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const cleanToken = token!.replace('oauth:', '');
            const body: any = {};

            switch (mode) {
                case 'subsOnly':
                    body.subscriber_mode = enabled;
                    break;
                case 'emotesOnly':
                    body.emote_mode = enabled;
                    break;
                case 'followersOnly':
                    body.follower_mode = enabled;
                    body.follower_mode_duration = enabled ? 0 : undefined;
                    break;
                case 'slowMode':
                    body.slow_mode = value !== undefined && value > 0;
                    body.slow_mode_wait_time = value || 0;
                    break;
                default:
                    reject(new Error(`Unknown chat mode: ${mode}`));
                    return;
            }

            const bodyStr = JSON.stringify(body);
            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        this.outputChannel.appendLine(`Chat settings updated successfully`);
                        resolve();
                    } else {
                        this.outputChannel.appendLine(`Chat settings update failed: HTTP ${res.statusCode} - ${data}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Chat settings request error: ${error}`);
                reject(error);
            });

            req.write(bodyStr);
            req.end();
        });
    }

    /**
     * Fetch shield mode status from Twitch API
     * @param broadcasterId Broadcaster's user ID
     * @param moderatorId Moderator's user ID
     * @param token OAuth token
     * @returns Promise resolving to shield mode status
     */
    private async fetchShieldModeStatus(broadcasterId: string, moderatorId: string, token: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const cleanToken = token.replace('oauth:', '');
            const options = {
                hostname: 'api.twitch.tv',
                path: `/helix/moderation/shield_mode?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Client-Id': TwitchClient.CLIENT_ID
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const json = JSON.parse(data);
                            const isActive = json.data && json.data.length > 0 && json.data[0].is_active === true;
                            resolve(isActive);
                        } catch (error) {
                            this.outputChannel.appendLine(`Error parsing shield mode status: ${error}`);
                            reject(error);
                        }
                    } else {
                        this.outputChannel.appendLine(`Shield mode status fetch failed: ${res.statusCode} - ${data}`);
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.outputChannel.appendLine(`Shield mode status fetch error: ${error}`);
                reject(error);
            });

            req.end();
        });
    }

    /**
     * Start polling shield mode status every 30 seconds
     */
    private startShieldModePolling() {
        // Clear any existing interval
        this.stopShieldModePolling();

        // Only poll if we have auth and user ID
        if (!this.authToken || !this.currentUserId) {
            return;
        }

        this.outputChannel.appendLine('Starting shield mode polling (every 30 seconds)');

        // Poll immediately
        this.pollShieldMode();

        // Then poll every 30 seconds
        this.shieldModePollingInterval = setInterval(() => {
            this.pollShieldMode();
        }, 30000);
    }

    /**
     * Poll shield mode status once
     */
    private async pollShieldMode() {
        if (!this.authToken || !this.currentUserId) {
            return;
        }

        try {
            const isActive = await this.fetchShieldModeStatus(this.currentUserId, this.currentUserId, this.authToken);

            // Send update to UI
            if (this.messageCallback) {
                this.messageCallback({
                    username: '',
                    displayName: '',
                    message: '',
                    color: '',
                    badges: [],
                    emotes: {},
                    thirdPartyEmotes: {},
                    timestamp: Date.now(),
                    messageType: 'chat' as any,
                    roomStateUpdate: {
                        shieldMode: isActive
                    }
                } as any);
            }
        } catch (error) {
            // Silently fail - shield mode polling is best-effort
            this.outputChannel.appendLine(`Shield mode poll failed: ${error}`);
        }
    }

    /**
     * Stop polling shield mode status
     */
    private stopShieldModePolling() {
        if (this.shieldModePollingInterval) {
            clearInterval(this.shieldModePollingInterval);
            this.shieldModePollingInterval = undefined;
            this.outputChannel.appendLine('Stopped shield mode polling');
        }
    }
}
