# Change Log

All notable changes to the "Twitch Chat Viewer" extension will be documented in this file.

## [0.0.5] - 2025-11-02

### Added
- **Twitch OAuth Authentication**: Sign in via OAuth2 Implicit Grant Flow to unlock advanced features
- **Message Sending**: Send messages to chat when authenticated (your messages appear in the chat log)
- **BTTV & 7TV Emote Support**: Full support for BetterTTV and 7TV emotes (global and channel-specific)
- **Moderation Tools**: Click usernames to access moderation menu (timeout, ban, delete message)
  - Ban/unban users permanently
  - Timeout users (customizable duration, default 10 minutes)
  - Delete individual messages
  - Remove timeouts/bans
- **Chat Commands**: Type `/` to see available commands with autocomplete
  - `/ban <username>` - Permanently ban a user
  - `/unban <username>` - Remove ban from a user
  - `/timeout <username> [duration]` - Timeout a user (default: 10 min)
  - `/untimeout <username>` - Remove timeout from a user
  - `/emoteonly` / `/emoteonlyoff` - Toggle emote-only mode
  - `/followers [duration]` / `/followersoff` - Toggle followers-only mode
  - `/shield` / `/shieldoff` - Toggle Shield Mode
  - `/slow [seconds]` / `/slowoff` - Toggle slow mode
  - `/subscribers` / `/subscribersoff` - Toggle subscribers-only mode
- **Command Autocomplete**: Intelligent command suggestions with keyboard navigation (↑/↓, Tab, Enter, Esc)
- **Chat Mode Controls**: Settings menu with toggles for:
  - Shield Mode (with 30-second polling for external changes)
  - Subscribers-Only Mode
  - Emotes-Only Mode
  - Followers-Only Mode
  - Slow Mode
- **First-Time Chatter Highlighting**: Special badge for users chatting in the channel for the first time
- **Message Deletion Support**: Real-time handling of deleted messages and user bans/timeouts
  - Messages fade out with strikethrough animation when deleted
  - All messages from banned/timed-out users are removed
- **Improved Chat Layout**:
  - Fixed header at top (connection status + settings gear)
  - Scrollable chat area in middle
  - Fixed message input at bottom
  - Settings menu with pause scroll, clear chat, sign in/out options
- **Pause Scroll Feature**: Pause auto-scrolling to read chat history without interruption
- **Keyboard Shortcut**: `Ctrl+Alt+T` (Windows/Linux) or `Cmd+Alt+T` (Mac) to focus Twitch Chat panel
- **View Menu Integration**: "Twitch Chat" entry in View menu for easy access
- **Auto-Focus on Activation**: Extension automatically focuses the chat panel when activated
- **System Messages**: Inline chat notifications for moderation actions and mode changes (no more popups)

### Changed
- **Improved Chat Colors**: Users without defined colors get deterministic colors based on username hash
- **Fixed Followers-Only Mode Detection**: Properly handles "any follower" (0 duration) vs disabled (-1)
- **Smart Moderation Menu Positioning**: Menu automatically positions above username if it would go off-screen
- **Enhanced Authentication Flow**: If authenticated, automatically connects to your own channel
- **Broadcaster Badge**: Your own messages show the broadcaster badge when streaming
- **User Chat Color**: Fetches your actual chat color from Twitch API for consistency
- **Removed Clickable Username for Self**: Your own username is no longer clickable (prevents self-moderation)
- **Consolidated Header UI**: Settings gear button replaces separate sign in/out and clear buttons

### Fixed
- BTTV and 7TV emotes now load correctly (requires user ID from authentication)
- FFZ emote URLs no longer have double `https:` prefix
- Badge notification properly clears when chat is focused
- Subscriber notifications show correct month count and styling
- Message input stays at bottom when scrolling chat
- Moderation API calls work correctly via Twitch Helix API (not IRC commands)

### Technical
- Implemented OAuth2 Implicit Grant Flow with local callback server
- Added Twitch Helix API integration for moderation (`/moderation/bans`, `/moderation/chat`, `/moderation/shield_mode`, `/chat/settings`)
- Added ROOMSTATE tracking for chat mode states
- Added CLEARMSG and CLEARCHAT event handlers
- Added GLOBALUSERSTATE handler for user's chat color
- Implemented Shield Mode polling (every 30 seconds)
- Added deterministic color generation for users without colors
- Extended message type system (`chat`, `subscription`, `resub`, `subgift`, `bits`, `system`)
- Improved CSS flexbox layout for proper scrolling behavior
- Added command parsing and execution system with autocomplete UI

## [0.0.2-0.0.4] - 2025-11-01

CI/CD iterations for building and releasing on VSCode Marketplace and Open VSX.

## [0.0.1] - 2025-11-01

### Added
- Initial release
- Bottom panel integration for Twitch chat (appears alongside Terminal/Output)
- Anonymous WebSocket connection to Twitch
- Real-time chat message display
- User color support
- Twitch native emote rendering
- FrankerFaceZ (FFZ) emote support (global and channel-specific)
- Badge display (broadcaster, moderator, VIP, subscriber, premium, turbo)
- Smart unread message counter (only shows when viewing other panels)
- Clear chat button in status bar
- Configuration setting for channel selection
- Auto-reconnect on disconnection
- Message history (rolling window of last 200 messages)
- Timestamps for each message
- Extension icon in marketplace
- Proper cleanup on extension deactivation
- Optimized webpack bundling (145 KB VSIX)
