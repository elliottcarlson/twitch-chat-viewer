# Twitch Chat Viewer

A VSCode/Cursor extension that displays Twitch chat in your IDE's bottom panel. Watch your favorite streamer's chat without leaving your editor!

## Features

- **Bottom Panel Integration**: Chat appears in the panel area alongside Terminal and Debug Console
- **Read-Only Chat Display**: View chat messages as they come in (no authentication required)
- **User Colors**: Messages display with each user's chosen Twitch color
- **Emote Support**: Twitch and FrankerFaceZ (FFZ) emotes are automatically rendered inline
- **Badge Display**: Shows broadcaster, moderator, VIP, and subscriber badges
- **Subscription & Bit Notifications**: Special styling for subscriptions, resubs, gift subs, and bit cheers
- **Unread Counter**: A badge shows the number of unread messages when the panel is not visible
- **Auto-Connect**: Automatically connects when you configure a channel
- **Keyboard Shortcut**: Quickly focus the chat panel with `Ctrl+Alt+T` (Windows/Linux) or `Cmd+Alt+T` (Mac)
- **Clear Button**: Clear chat history with a single click

## Installation

### From VSIX File

1. Download the `.vsix` file from the releases page
2. Open VSCode/Cursor
3. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
4. Type "Extensions: Install from VSIX..."
5. Select the command and choose the downloaded `.vsix` file

### From Marketplace

Search for "Twitch Chat Viewer" in the VSCode/Cursor extensions marketplace and click Install.

## Usage

1. Open settings:
   - VSCode: `Ctrl+,` / `Cmd+,` 
   - Cursor: Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for "Preferences: Open Settings"
2. Search for "Twitch Chat"
3. Enter the Twitch channel/username you want to watch in the `Twitch Chat: Channel` setting
4. Open the bottom panel (where Terminal is located)
5. Look for the "Twitch Chat" tab
6. Enjoy watching chat!

### Keyboard Shortcut

Quickly open or focus the Twitch Chat panel:
- Windows/Linux: `Ctrl+Alt+T`
- Mac: `Cmd+Alt+T`

You can also find the "View: Focus Twitch Chat" command in the Command Palette.

### Configuration

- `twitchChat.channel`: The Twitch channel/username to view chat from (without the # symbol)

## Features in Detail

### Unread Message Counter

When you're viewing a different panel (like Terminal), an unread badge will appear on the Twitch Chat tab showing how many new messages have arrived. The counter resets when you switch back to the chat view.

### Emote Support

- **Twitch Emotes**: All native Twitch emotes are automatically detected and displayed
- **FrankerFaceZ (FFZ)**: Global and channel-specific FFZ emotes are supported
- Emotes are fetched when connecting to a channel and rendered inline with chat messages

### User Colors and Badges

- Each user's message appears in their chosen Twitch color
- Broadcaster, moderator, VIP, and subscriber badges are shown next to usernames
- Timestamps are displayed for each message

### Chat History

The extension maintains a rolling history of the last 200 messages to keep memory usage reasonable.

## Anonymous Connection

This extension uses an anonymous WebSocket connection to Twitch, meaning:
- No authentication required
- Read-only access
- Works immediately after configuration
- No OAuth tokens needed

## Requirements

- VSCode or Cursor version 1.85.0 or higher
- Internet connection to connect to Twitch chat via WebSocket

## Known Issues

- BTTV and 7TV emotes are not currently supported (requires Twitch API authentication)
- Very high message volume channels may experience slight delays

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This extension is licensed under the MIT License. See the LICENSE file for details.

## Credits

- Built with [tmi.js](https://github.com/tmijs/tmi.js) for Twitch IRC WebSocket connectivity
- Twitch badge images courtesy of Twitch

## Disclaimer

This is an unofficial extension and is not affiliated with Twitch Interactive, Inc.
