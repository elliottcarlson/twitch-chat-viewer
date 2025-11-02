/**
 * Configuration constants for the Twitch Chat Viewer extension
 */
export const config = {
    /**
     * Twitch OAuth config
     */
    twitch: {
        // cspell:disable-next-line
        clientId: 'hijf2gf2x1p7qtugiqow7vx0pyonkr',
        redirectUri: 'http://localhost:3000',
        scopes: [
            'chat:read',
            'chat:edit',
            'user:read:email',
            'channel:moderate',
            'moderator:manage:banned_users',
            'moderator:manage:chat_messages',
            'moderator:manage:shield_mode',
            'moderator:manage:chat_settings'
        ]
    },

    /**
     * Extension storage keys
     */
    storage: {
        authSessionKey: 'twitch_auth_session'
    }
};

