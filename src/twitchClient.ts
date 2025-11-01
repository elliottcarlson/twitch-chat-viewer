import * as tmi from 'tmi.js';
import * as vscode from 'vscode';
import { EmoteService } from './emoteService';

export interface TwitchMessage {
    username: string;
    displayName: string;
    message: string;
    color: string;
    badges: string[];
    emotes: { [emoteid: string]: string[] };
    thirdPartyEmotes: { [emoteName: string]: string };
    timestamp: number;
    messageType?: 'chat' | 'subscription' | 'resub' | 'subgift' | 'bits';
    bits?: number;
    subMonths?: number;
    subTier?: string;
    gifterName?: string;
    recipientName?: string;
}

export class TwitchClient {
    private client: tmi.Client | null = null;
    private currentChannel: string = '';
    private messageCallback: ((message: TwitchMessage) => void) | null = null;
    private outputChannel: vscode.OutputChannel;
    private emoteService: EmoteService;
    private thirdPartyEmotes: Map<string, string> = new Map();

    constructor(private onMessage: (message: TwitchMessage) => void, outputChannel: vscode.OutputChannel) {
        this.messageCallback = onMessage;
        this.outputChannel = outputChannel;
        this.emoteService = new EmoteService(outputChannel);
        this.outputChannel.appendLine('TwitchClient constructor called');
    }

    /**
     * Connect to a Twitch channel's IRC chat
     * @param channel The Twitch channel name to connect to
     */
    async connect(channel: string): Promise<void> {
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

        // Remove # if present and convert to lowercase
        channel = channel.replace('#', '').toLowerCase().trim();
        this.currentChannel = channel;
        this.outputChannel.appendLine(`Normalized channel name: "${channel}"`);

        // Create anonymous client with required capabilities
        this.outputChannel.appendLine('Creating tmi.js client...');
        this.client = new tmi.Client({
            connection: {
                reconnect: true,
                secure: true
            },
            channels: [channel],
            options: {
                debug: false
            },
            // Request tags capability to get user colors and emotes
            identity: undefined // Anonymous connection
        });

        // Set up message handler
        this.client.on('message', (channel, tags, message, self) => {
            if (self || !this.messageCallback) return;

            const twitchMessage: TwitchMessage = {
                username: tags.username || 'anonymous',
                displayName: tags['display-name'] || tags.username || 'Anonymous',
                message: message,
                color: tags.color || this.getRandomColor(),
                badges: this.parseBadges(tags.badges),
                emotes: tags.emotes || {},
                thirdPartyEmotes: Object.fromEntries(this.thirdPartyEmotes),
                timestamp: Date.now(),
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
                color: userstate.color || this.getRandomColor(),
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
            
            // Use cumulative months if available, fallback to months parameter
            const cumulativeMonths = parseInt(userstate['msg-param-cumulative-months'] || '0') || months;
            this.outputChannel.appendLine(`Resub from ${username}: ${cumulativeMonths} months`);

            const resubMessage: TwitchMessage = {
                username: username,
                displayName: userstate['display-name'] || username,
                message: message || `resubscribed for ${cumulativeMonths} months!`,
                color: userstate.color || this.getRandomColor(),
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
                color: userstate.color || this.getRandomColor(),
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
                color: userstate.color || this.getRandomColor(),
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

            // Fetch FFZ emotes for the channel
            this.outputChannel.appendLine('Fetching FFZ emotes...');
            this.thirdPartyEmotes = await this.emoteService.fetchFFZEmotes(channel);
            this.outputChannel.appendLine(`FFZ emotes loaded: ${this.thirdPartyEmotes.size}`);
        } catch (error) {
            this.outputChannel.appendLine(`ERROR in client.connect(): ${error}`);
            throw error;
        }
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
     * Generate a random color for users without a color set
     * @returns Hex color code
     */
    private getRandomColor(): string {
        const colors = [
            '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50',
            '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
            '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    /**
     * Get the currently connected channel name
     * @returns The channel name or empty string if not connected
     */
    getCurrentChannel(): string {
        return this.currentChannel;
    }
}
