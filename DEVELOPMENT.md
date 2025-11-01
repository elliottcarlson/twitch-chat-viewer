# Development Guide

This guide helps you set up the development environment and work on the Twitch Chat Viewer extension.

## Prerequisites

- Node.js (v20 or higher)
- npm
- VSCode or Cursor

## Setup

1. Clone/navigate to the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run compile
   ```

## Development Workflow

### Building

To build the extension (webpack production mode):

```bash
npm run compile
```

### Testing the Extension

1. Open the project in VSCode/Cursor
2. Press `F5` or go to Run > Start Debugging
3. This opens a new "Extension Development Host" window with the extension loaded
4. Configure a Twitch channel in settings:
   - Open Settings (Ctrl+, or Cmd+,)
   - Search for "Twitch Chat"
   - Enter a channel name (e.g., "shroud", "pokimane")
5. Open the bottom panel and look for the "Twitch Chat" tab

### Project Structure

```
cursor-twitch-chat/
├── src/
│   ├── extension.ts              # Main extension entry point
│   ├── twitchClient.ts           # Twitch IRC WebSocket client wrapper
│   ├── twitchChatViewProvider.ts # Webview provider for chat display
│   ├── emoteService.ts           # FFZ emote fetching service
│   └── tmi.d.ts                  # Type definitions for tmi.js
├── resources/
│   └── icon.png                  # Extension icon (128x128)
├── dist/                         # Webpack bundled output
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript configuration
├── webpack.config.js             # Webpack bundling configuration
└── README.md                     # User documentation
```

## Key Files

### src/extension.ts
The main activation function that registers the webview view provider.

### src/twitchClient.ts
Handles connection to Twitch IRC via WebSocket using tmi.js. Features:
- Anonymous connection (no auth required)
- Message parsing with colors, emotes, and badges
- Third-party emote integration
- Auto-reconnect on disconnection

### src/twitchChatViewProvider.ts
Manages the webview panel that displays chat:
- Renders HTML/CSS/JS for the chat interface
- Handles message forwarding from WebSocket to webview
- Implements smart unread message counter badge
- Clear chat button
- Listens for configuration changes

### src/emoteService.ts
Fetches and caches FrankerFaceZ emotes:
- Global FFZ emotes
- Channel-specific FFZ emotes
- No authentication required

## Building

### Compile Extension (Production Build)
```bash
npm run compile
```
This runs webpack in production mode with minification and creates the bundled extension in `dist/extension.js`.

### Create VSIX Package
```bash
npm run package
```
This creates a `.vsix` file (e.g., `twitch-chat-viewer-0.0.1.vsix`) that can be installed in VSCode/Cursor.

The VSIX includes:
- Bundled extension code (~411 KB uncompressed → ~145 KB in VSIX)
- Extension icon
- README and documentation
- Excludes source files, node_modules, and dev dependencies

## Debugging

### Extension Host Debugging

1. Set breakpoints in TypeScript files
2. Press `F5` to start debugging
3. Breakpoints will be hit in the Extension Development Host

### Webview Debugging

The webview (chat display) runs in a separate context:

1. In the Extension Development Host, open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run "Developer: Open Webview Developer Tools"
3. This opens Chrome DevTools for the webview
4. You can inspect HTML, debug JavaScript, and view console logs

## Making Changes

### Adding New Features

1. Make your changes in the `src/` directory
2. Compile with `npm run compile`
3. Reload the Extension Development Host (Ctrl+R / Cmd+R in the dev host window)
4. Test your changes

**Note:** After making changes, you must recompile. There's no watch mode currently configured.

### Modifying the Webview UI

The webview HTML, CSS, and JavaScript are all in `src/twitchChatViewProvider.ts` in the `_getHtmlForWebview()` method.

After changes:
1. Save the file
2. Run `npm run compile` to rebuild with webpack
3. Reload the Extension Development Host (Ctrl+R / Cmd+R)
4. The webview automatically reloads

### Updating Configuration

Extension settings are defined in `package.json` under `contributes.configuration`.

### Updating Dependencies

To update all dependencies to their latest versions:
```bash
npx npm-check-updates -u && npm install
```

## Testing Tips

### Testing with Different Channels

Try channels with different activity levels:
- High activity: `xqc`, `summit1g`, `pokimane`
- Medium activity: `cohhcarnage`, `timthetatman`
- Low activity: Smaller streamers

### Testing Edge Cases

- Test with empty channel name
- Test with invalid channel names
- Test disconnection/reconnection
- Test with very long messages
- Test with lots of emotes

## Common Issues

### "Cannot find module 'tmi.js'" error
Run `npm install` to ensure all dependencies are installed.

### Webpack compilation errors
- Ensure all dev dependencies are installed: `npm install`
- Check for TypeScript errors in your code
- Look at the webpack output for specific error messages

### Extension not loading
- Check the Debug Console in VSCode for error messages
- Ensure the extension compiled successfully (`npm run compile`)
- Check the Output channel "Twitch Chat" for debug logs

### Webview not showing
- Make sure a channel is configured in settings
- The channel doesn't need to be live - chat is always available
- Check the "Twitch Chat" output channel for connection status

### "webpack not recognized" error
Make sure you're running commands from the project directory and dependencies are installed.

## GitHub Actions CI/CD

The repository includes a GitHub Actions workflow (`.github/workflows/build.yml`) that automatically builds and packages the extension.

### Automatic Builds

The workflow triggers on:
- **Push to main/master**: Builds and uploads VSIX as an artifact
- **Pull requests**: Validates that the build succeeds
- **Version tags** (e.g., `v0.0.2`): Creates a GitHub release with the VSIX attached
- **Manual trigger**: Can be run manually from the Actions tab

### Creating a Release

To create a new release:

1. Update the version in `package.json`:
   ```bash
   npm version patch  # or minor, or major
   ```

2. Push the version commit and tag:
   ```bash
   git push && git push --tags
   ```

3. The GitHub Action will automatically:
   - Build the extension
   - Package the VSIX
   - Create a GitHub release
   - Attach the VSIX file to the release

### Downloading Build Artifacts

After any push to main/master:
1. Go to the repository on GitHub
2. Click the "Actions" tab
3. Click on the latest workflow run
4. Scroll down to "Artifacts"
5. Download the VSIX file

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Technical Details

### Bundling
The extension uses webpack to bundle all code (including dependencies like `tmi.js`) into a single file. This:
- Reduces the VSIX size from ~214 KB to ~145 KB
- Eliminates the need to include node_modules in the package
- Improves load time

### Third-Party Emotes
Currently supports FrankerFaceZ (FFZ) emotes. BTTV and 7TV require Twitch API authentication to get channel IDs, so they're not implemented.

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview)
- [tmi.js Documentation](https://github.com/tmijs/docs)
- [Twitch IRC Guide](https://dev.twitch.tv/docs/irc)
- [Webpack Documentation](https://webpack.js.org/)
- [FrankerFaceZ API](https://api.frankerfacez.com/)
