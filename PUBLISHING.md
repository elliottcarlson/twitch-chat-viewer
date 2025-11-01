# Publishing Guide

This guide explains how to publish the Twitch Chat Viewer extension to the VSCode Marketplace.

## Prerequisites

1. A Microsoft account
2. An Azure DevOps organization
3. A Personal Access Token (PAT) from Azure DevOps

## Setup Instructions

### 1. Create an Azure DevOps Organization

1. Go to https://dev.azure.com
2. Sign in with your Microsoft account
3. Create a new organization (or use an existing one)

### 2. Create a Personal Access Token (PAT)

1. In Azure DevOps, click on your profile icon (top right)
2. Select "Personal access tokens"
3. Click "New Token"
4. Configure the token:
   - Name: "VSCode Marketplace Publishing"
   - Organization: Select "All accessible organizations"
   - Expiration: Choose your preferred duration (90 days recommended)
   - Scopes: Select "Custom defined"
   - Click "Show all scopes" and check:
     - **Marketplace**: Check "Acquire" and "Manage"
5. Click "Create"
6. **IMPORTANT**: Copy the token immediately - you won't be able to see it again!

### 3. Create a Publisher

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with the same Microsoft account
3. Click "Create publisher"
4. Fill in the details:
   - **Publisher ID**: A unique identifier (lowercase, no spaces)
   - **Publisher Name**: Display name for your publisher
   - **Email**: Contact email
5. Click "Create"

### 4. Update package.json

Update the `publisher` field in `package.json` with your Publisher ID:

```json
{
  "publisher": "your-publisher-id",
  ...
}
```

### 5. Login with vsce

```bash
npx vsce login your-publisher-id
```

Enter your Personal Access Token when prompted.

### 6. Publish the Extension

```bash
npm run package  # Create the VSIX file
npx vsce publish # Publish to marketplace
```

Or publish a specific version:

```bash
npx vsce publish minor  # Increment minor version
npx vsce publish major  # Increment major version
npx vsce publish patch  # Increment patch version
```

## Publishing Updates

When you want to publish an update:

1. Update the version in `package.json`
2. Update `CHANGELOG.md` with the changes
3. Compile and test the extension
4. Run `npx vsce publish`

## Publishing from VSIX Only

If you only want to create a VSIX file (for manual distribution):

```bash
npm run package
```

The `.vsix` file will be created in the root directory.

## Important Notes

- Before first publish, update the `publisher` field in `package.json`
- The marketplace review process can take a few hours to a few days
- Make sure your README.md is well-formatted - it becomes your extension's marketplace page
- Add screenshots to make your extension page more attractive
- Consider adding an icon (128x128 PNG) by setting the `icon` field in `package.json`

## Resources

- [VSCode Publishing Documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)

## Troubleshooting

### "Publisher not found" error
- Make sure you've created a publisher at https://marketplace.visualstudio.com/manage
- Ensure the publisher ID in package.json matches your created publisher

### "Authentication failed" error
- Your PAT may have expired - create a new one
- Ensure your PAT has the correct scopes (Marketplace: Acquire and Manage)

### Extension validation errors
- Run `npx vsce package` to see detailed validation errors
- Check that all required fields in package.json are filled
- Ensure your extension icon (if provided) is the correct size
