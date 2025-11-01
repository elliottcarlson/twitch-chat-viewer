# Marketplace Publishing Setup

This guide explains how to set up automatic publishing to both the VS Code Marketplace and Open VSX Registry via GitHub Actions.

## Prerequisites

1. A publisher account on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/)
2. An account on [Open VSX Registry](https://open-vsx.org/)
3. Access to your GitHub repository settings

---

## Part A: VS Code Marketplace Setup

### Step 1: Create a Visual Studio Marketplace Publisher

If you don't have a publisher yet:

1. Go to [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Sign in with your Microsoft account
3. Click "Create publisher"
4. Fill in the required information:
   - **Publisher Name**: A unique identifier (e.g., `sublimnl`)
   - **Display Name**: Your display name
   - **Email**: Contact email
5. Click "Create"

### Step 2: Generate a Personal Access Token (PAT)

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Click on your profile icon (top right) → "Personal access tokens"
3. Click "New Token"
4. Configure the token:
   - **Name**: `vscode-marketplace-publish` (or any name you prefer)
   - **Organization**: All accessible organizations
   - **Expiration**: Custom defined (recommend 90 days or more)
   - **Scopes**: Click "Show all scopes" and select:
     - ✅ **Marketplace** → **Manage** (this is critical!)
5. Click "Create"
6. **IMPORTANT**: Copy the token immediately - you won't be able to see it again!

### Step 3: Add Token to GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click "New repository secret"
4. Set:
   - **Name**: `VSCODE_MARKETPLACE_TOKEN`
   - **Secret**: Paste your PAT from Step 2
5. Click "Add secret"

---

## Part B: Open VSX Registry Setup

### Step 1: Create an Open VSX Account

1. Go to [Open VSX Registry](https://open-vsx.org/)
2. Click "Sign In" (top right)
3. Sign in with GitHub (recommended) or create an account
4. Once signed in, you'll have access to the registry

### Step 2: Generate an Access Token

1. Go to your [Open VSX User Settings](https://open-vsx.org/user-settings/tokens)
2. Click "New Access Token"
3. Configure the token:
   - **Name**: `GitHub Actions Publisher` (or any name you prefer)
   - Click "Create"
4. **IMPORTANT**: Copy the token immediately - you won't be able to see it again!

### Step 3: Add Token to GitHub Secrets

1. Go to your GitHub repository (same as VS Code Marketplace setup)
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click "New repository secret"
4. Set:
   - **Name**: `OPEN_VSX_TOKEN`
   - **Secret**: Paste your token from Step 2
5. Click "Add secret"

---

## Part C: Final Configuration

### Step 1: Update package.json

Make sure your `package.json` has the correct publisher name:

```json
{
  "publisher": "your-publisher-id",
  ...
}
```

Replace `your-publisher-id` with the Publisher ID you created in Part A, Step 1.

### Step 2: Test Publishing

1. Update the version in `package.json` if needed
2. Go to **Actions** tab in your GitHub repository
3. Click "Build VSIX" workflow
4. Click "Run workflow"
5. Enter the version number (e.g., `0.0.2`)
6. Click "Run workflow"

The workflow will:
- Build the extension
- Publish it to VS Code Marketplace
- Publish it to Open VSX Registry
- Create a GitHub release
- Upload the VSIX as an artifact

## Troubleshooting

### VS Code Marketplace Issues

#### Error: "Failed request: (401) Unauthorized"
- Your PAT has expired or is invalid
- Generate a new token and update the `VSCODE_MARKETPLACE_TOKEN` GitHub secret

#### Error: "Extension publisher is not registered"
- You need to create a publisher account first (Part A, Step 1)
- Ensure the `publisher` field in `package.json` matches your publisher ID

#### Error: "Permission denied"
- Your PAT doesn't have the "Marketplace: Manage" scope
- Create a new token with the correct scope

#### Extension doesn't appear in VS Code Marketplace
- First-time publishing can take 5-10 minutes to appear
- Check the [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage) page

### Open VSX Registry Issues

#### Error: "Invalid access token"
- Your token has expired or is invalid
- Generate a new token and update the `OPEN_VSX_TOKEN` GitHub secret
- Visit [Open VSX User Settings](https://open-vsx.org/user-settings/tokens)

#### Error: "Extension namespace does not match"
- The `publisher` field in `package.json` must match your Open VSX username
- Open VSX uses your GitHub username or account name as the namespace

#### Extension doesn't appear in Open VSX
- Check [Open VSX Registry](https://open-vsx.org/) and search for your extension
- You can view your published extensions at `https://open-vsx.org/user/{your-username}`

## Updating Your Extension

To release a new version:

1. Make your code changes
2. Update version: `npm version patch` (or `minor`/`major`)
3. Commit and push changes
4. Run the GitHub Action workflow with the new version number
5. The extension will be automatically updated in both marketplaces

## Token Security

- **Never commit tokens to the repository**
- Tokens are stored securely in GitHub Secrets
- Rotate tokens periodically (every 90 days recommended)
- If a token is compromised:
  - **VS Code Marketplace**: Revoke it immediately in [Azure DevOps](https://dev.azure.com/)
  - **Open VSX**: Revoke it in [User Settings](https://open-vsx.org/user-settings/tokens)

## Links

### VS Code Marketplace
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Azure DevOps PAT Documentation](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
- [VS Code Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)

### Open VSX Registry
- [Open VSX Registry](https://open-vsx.org/)
- [Open VSX Publishing Guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
- [Open VSX User Settings](https://open-vsx.org/user-settings/tokens)

