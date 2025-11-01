import * as vscode from 'vscode';
import * as https from 'https';

export interface ThirdPartyEmote {
    name: string;
    url: string;
}

export class EmoteService {
    private outputChannel: vscode.OutputChannel;
    private ffzEmotes: Map<string, string> = new Map();

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
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
                    res.resume(); // Consume response data to free up memory
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
                                this.outputChannel.appendLine(`  - FFZ global emote: "${emote.name}" -> ${url}`);
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
                                this.outputChannel.appendLine(`  - FFZ channel emote: "${emote.name}" -> ${url}`);
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
                // FFZ URLs are protocol-relative (//cdn.frankerfacez.com/...)
                // Only add https: if it doesn't already have a protocol
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
     * Get the currently loaded emotes
     * @returns Map of emote name -> URL
     */
    getEmotes(): Map<string, string> {
        return this.ffzEmotes;
    }
}

