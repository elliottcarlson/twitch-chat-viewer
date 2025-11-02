import * as vscode from 'vscode';
import * as https from 'https';

export interface ThirdPartyEmote {
    name: string;
    url: string;
}

export class EmoteService {
    private outputChannel: vscode.OutputChannel;
    private ffzEmotes: Map<string, string> = new Map();
    private bttvEmotes: Map<string, string> = new Map();
    private sevenTVEmotes: Map<string, string> = new Map();

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Fetch all emotes from FFZ, BTTV, and 7TV
     * @param channelName The Twitch channel name (lowercase)
     * @param channelUserId Optional Twitch user ID for the channel
     * @returns Combined map of all emotes
     */
    async fetchAllEmotes(channelName: string, channelUserId?: string): Promise<Map<string, string>> {
        const allEmotes = new Map<string, string>();

        try {
            // Fetch FFZ emotes
            const ffzEmotes = await this.fetchFFZEmotes(channelName);
            ffzEmotes.forEach((url, name) => allEmotes.set(name, url));

            // Fetch BTTV and 7TV emotes (both require user ID)
            if (channelUserId) {
                const bttvEmotes = await this.fetchBTTVEmotes(channelUserId);
                bttvEmotes.forEach((url, name) => allEmotes.set(name, url));

                const sevenTVEmotes = await this.fetch7TVEmotes(channelUserId);
                sevenTVEmotes.forEach((url, name) => allEmotes.set(name, url));
            }

            this.outputChannel.appendLine(`Total emotes: FFZ=${ffzEmotes.size}, BTTV=${channelUserId ? this.bttvEmotes.size : 0}, 7TV=${channelUserId ? this.sevenTVEmotes.size : 0}`);
        } catch (error) {
            this.outputChannel.appendLine(`Error fetching all emotes: ${error}`);
        }

        return allEmotes;
    }

    /**
     * Fetch FFZ emotes for a channel
     * @param channelName The Twitch channel name (lowercase)
     * @returns Map of emote name -> URL
     */
    async fetchFFZEmotes(channelName: string): Promise<Map<string, string>> {
        this.outputChannel.appendLine(`Fetching FFZ emotes for channel: ${channelName}`);
        const emotes = new Map<string, string>();

        try {
            // Fetch global FFZ emotes
            const globalEmotes = await this.fetchFFZGlobalEmotes();
            globalEmotes.forEach((url, name) => emotes.set(name, url));
            this.outputChannel.appendLine(`Loaded ${globalEmotes.size} global FFZ emotes`);

            // Fetch channel-specific FFZ emotes
            const channelEmotes = await this.fetchFFZChannelEmotes(channelName);
            channelEmotes.forEach((url, name) => emotes.set(name, url));
            this.outputChannel.appendLine(`Loaded ${channelEmotes.size} channel-specific FFZ emotes`);

            this.ffzEmotes = emotes;
            this.outputChannel.appendLine(`Total FFZ emotes loaded: ${emotes.size}`);
        } catch (error) {
            this.outputChannel.appendLine(`Error fetching FFZ emotes: ${error}`);
        }

        return emotes;
    }

    /**
     * Make an HTTPS GET request and return parsed JSON
     * @param url The URL to fetch
     * @returns Parsed JSON response
     */
    private async httpsGet(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';

                // Check for non-200 status codes
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    res.resume();
                    return;
                }

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON: ${error}`));
                    }
                });
            }).on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Fetch global FFZ emotes available in all channels
     * @returns Map of emote name -> URL
     */
    private async fetchFFZGlobalEmotes(): Promise<Map<string, string>> {
        const emotes = new Map<string, string>();

        try {
            const data = await this.httpsGet('https://api.frankerfacez.com/v1/set/global');

            // Parse FFZ global emote sets
            if (data.default_sets && data.sets) {
                for (const setId of data.default_sets) {
                    const set = data.sets[setId];
                    if (set && set.emoticons) {
                        for (const emote of set.emoticons) {
                            const url = this.getFFZEmoteUrl(emote);
                            if (url) {
                                emotes.set(emote.name, url);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Failed to fetch FFZ global emotes: ${error}`);
        }

        return emotes;
    }

    /**
     * Fetch channel-specific FFZ emotes
     * @param channelName The Twitch channel name
     * @returns Map of emote name -> URL
     */
    private async fetchFFZChannelEmotes(channelName: string): Promise<Map<string, string>> {
        const emotes = new Map<string, string>();

        try {
            const data = await this.httpsGet(`https://api.frankerfacez.com/v1/room/${channelName}`);

            // Parse FFZ channel emote sets
            if (data.sets) {
                for (const setId in data.sets) {
                    const set = data.sets[setId];
                    if (set && set.emoticons) {
                        for (const emote of set.emoticons) {
                            const url = this.getFFZEmoteUrl(emote);
                            if (url) {
                                emotes.set(emote.name, url);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            // Channel might not have FFZ emotes, that's okay
            if (error instanceof Error && error.message.includes('HTTP 404')) {
                this.outputChannel.appendLine(`No FFZ emotes configured for channel: ${channelName}`);
            } else {
                this.outputChannel.appendLine(`Failed to fetch FFZ channel emotes: ${error}`);
            }
        }

        return emotes;
    }

    /**
     * Extract the best URL from an FFZ emote object
     * FFZ provides multiple sizes (1x, 2x, 4x), prefer 1x for consistency
     * @param emote FFZ emote object from API
     * @returns Emote URL or null if not available
     */
    private getFFZEmoteUrl(emote: any): string | null {
        if (emote.urls) {
            let url = emote.urls['1'] || emote.urls['2'] || emote.urls['4'];
            if (url) {
                if (url.startsWith('//')) {
                    return `https:${url}`;
                } else if (url.startsWith('http')) {
                    return url;
                } else {
                    return `https://${url}`;
                }
            }
        }
        return null;
    }

    /**
     * Fetch BTTV emotes for a channel
     * @param channelUserId The Twitch user ID for the channel
     * @returns Map of emote name -> URL
     */
    private async fetchBTTVEmotes(channelUserId: string): Promise<Map<string, string>> {
        const emotes = new Map<string, string>();

        try {
            // Fetch global BTTV emotes
            const globalData = await this.httpsGet('https://api.betterttv.net/3/cached/emotes/global');
            if (Array.isArray(globalData)) {
                for (const emote of globalData) {
                    if (emote.id && emote.code) {
                        emotes.set(emote.code, `https://cdn.betterttv.net/emote/${emote.id}/1x`);
                    }
                }
            }
            this.outputChannel.appendLine(`Loaded ${emotes.size} global BTTV emotes`);

            // Fetch channel-specific BTTV emotes (using user ID)
            try {
                const channelData = await this.httpsGet(`https://api.betterttv.net/3/cached/users/twitch/${channelUserId}`);
                if (channelData.channelEmotes && Array.isArray(channelData.channelEmotes)) {
                    for (const emote of channelData.channelEmotes) {
                        if (emote.id && emote.code) {
                            emotes.set(emote.code, `https://cdn.betterttv.net/emote/${emote.id}/1x`);
                        }
                    }
                }
                if (channelData.sharedEmotes && Array.isArray(channelData.sharedEmotes)) {
                    for (const emote of channelData.sharedEmotes) {
                        if (emote.id && emote.code) {
                            emotes.set(emote.code, `https://cdn.betterttv.net/emote/${emote.id}/1x`);
                        }
                    }
                }
                this.outputChannel.appendLine(`Loaded ${emotes.size} total BTTV emotes (including channel)`);
            } catch (error) {
                if (error instanceof Error && error.message.includes('HTTP 404')) {
                    this.outputChannel.appendLine(`No BTTV emotes configured for user ID: ${channelUserId}`);
                } else {
                    this.outputChannel.appendLine(`Failed to fetch BTTV channel emotes: ${error}`);
                }
            }

            this.bttvEmotes = emotes;
        } catch (error) {
            this.outputChannel.appendLine(`Error fetching BTTV emotes: ${error}`);
        }

        return emotes;
    }

    /**
     * Fetch 7TV emotes for a channel
     * @param channelUserId The Twitch user ID for the channel
     * @returns Map of emote name -> URL
     */
    private async fetch7TVEmotes(channelUserId: string): Promise<Map<string, string>> {
        const emotes = new Map<string, string>();

        try {
            // Fetch global 7TV emotes
            const globalData = await this.httpsGet('https://7tv.io/v3/emote-sets/global');
            if (globalData.emotes && Array.isArray(globalData.emotes)) {
                for (const emote of globalData.emotes) {
                    if (emote.id && emote.name && emote.data && emote.data.host) {
                        const url = `https:${emote.data.host.url}/1x.webp`;
                        emotes.set(emote.name, url);
                    }
                }
            }
            this.outputChannel.appendLine(`Loaded ${emotes.size} global 7TV emotes`);

            // Fetch channel-specific 7TV emotes
            try {
                const channelData = await this.httpsGet(`https://7tv.io/v3/users/twitch/${channelUserId}`);
                if (channelData.emote_set && channelData.emote_set.emotes && Array.isArray(channelData.emote_set.emotes)) {
                    for (const emote of channelData.emote_set.emotes) {
                        if (emote.id && emote.name && emote.data && emote.data.host) {
                            const url = `https:${emote.data.host.url}/1x.webp`;
                            emotes.set(emote.name, url);
                        }
                    }
                }
                this.outputChannel.appendLine(`Loaded ${emotes.size} total 7TV emotes (including channel)`);
            } catch (error) {
                if (error instanceof Error && error.message.includes('HTTP 404')) {
                    this.outputChannel.appendLine(`No 7TV emotes configured for user ID: ${channelUserId}`);
                } else {
                    this.outputChannel.appendLine(`Failed to fetch 7TV channel emotes: ${error}`);
                }
            }

            this.sevenTVEmotes = emotes;
        } catch (error) {
            this.outputChannel.appendLine(`Error fetching 7TV emotes: ${error}`);
        }

        return emotes;
    }
}

