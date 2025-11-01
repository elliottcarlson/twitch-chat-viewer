declare module 'tmi.js' {
    export interface ChatUserstate {
        'badge-info'?: { [key: string]: string };
        badges?: { [key: string]: string };
        bits?: string;
        color?: string;
        'display-name'?: string;
        emotes?: { [emoteid: string]: string[] };
        id?: string;
        mod?: boolean;
        'room-id'?: string;
        subscriber?: boolean;
        'tmi-sent-ts'?: string;
        turbo?: boolean;
        'user-id'?: string;
        'user-type'?: string;
        username?: string;
        'emotes-raw'?: string;
        'badges-raw'?: string;
        'message-type'?: string;
    }

    export interface ClientOptions {
        options?: {
            debug?: boolean;
            clientId?: string;
        };
        connection?: {
            server?: string;
            port?: number;
            reconnect?: boolean;
            maxReconnectAttempts?: number;
            maxReconnectInterval?: number;
            reconnectDecay?: number;
            reconnectInterval?: number;
            secure?: boolean;
            timeout?: number;
        };
        identity?: {
            username?: string;
            password?: string;
        } | undefined;
        channels?: string[];
    }

    export class Client {
        constructor(options?: ClientOptions);

        connect(): Promise<[string, number]>;
        disconnect(): Promise<[string, number]>;

        on(event: 'message', callback: (channel: string, tags: ChatUserstate, message: string, self: boolean) => void): void;
        on(event: 'subscription', callback: (channel: string, username: string, method: any, message: string, userstate: any) => void): void;
        on(event: 'resub', callback: (channel: string, username: string, months: number, message: string, userstate: any, methods: any) => void): void;
        on(event: 'subgift', callback: (channel: string, username: string, streakMonths: number, recipient: string, methods: any, userstate: any) => void): void;
        on(event: 'submysterygift', callback: (channel: string, username: string, numbOfSubs: number, methods: any, userstate: any) => void): void;
        on(event: 'connected', callback: (address: string, port: number) => void): void;
        on(event: 'disconnected', callback: (reason: string) => void): void;
        on(event: 'reconnect', callback: () => void): void;
        on(event: string, callback: (...args: any[]) => void): void;

        say(channel: string, message: string): Promise<[string]>;
        join(channel: string): Promise<[string]>;
        part(channel: string): Promise<[string]>;
    }
}
