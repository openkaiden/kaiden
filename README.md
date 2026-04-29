# Kaiden

<img src="https://raw.githubusercontent.com/openkaiden/artwork/refs/heads/main/icon-1024.png" alt="A stylized bear wearing virtual reality goggles and a collared shirt with a letter K on it." width="256">

## Demonstration video

https://github.com/user-attachments/assets/2cbe186a-d7b8-4a31-8ac0-4f0964d72448

## Prerequisites: Prepare your environment

You can develop on either: `Windows`, `macOS` or `Linux`.

Requirements:

- [Node.js 22+](https://nodejs.org/en/)
- [pnpm v10.x](https://pnpm.io/installation) (`corepack enable pnpm`)
- [Gemini](https://gemini.google.com) An API token for Gemini is required
- [Goose](https://github.com/block/goose) Can be installed through the CLI panel

### Step 1. Fork and clone Kaiden

Clone and fork the project.

Clone the repo using GitHub site:

```sh
git clone https://github.com/openkaiden/kaiden && cd kaiden
```

### Step 2. Install dependencies

Fetch all dependencies using the command `pnpm`:

```sh
pnpm install
```

### Step 3. Start in watch mode

Run the application in watch mode:

```sh
pnpm watch
```

## Using Kaiden

### Configure your Gemini API Key

Go to `Settings > Resources`, the Gemini provider should be listed. Click on `Grab a key` if you don't have an existing
Gemini API key. If you already have one, enter it and click the `Create` button. If you go the Chat
window, you should see a list of Gemini models being listed.

### Configure the GitHub MCP server

Click the `MCP` icon on the left toolbar. The `Install` tab should be selected and the GitHub MCP server should be
listed. Click the `Install Remote Server` button on the left. Enter your GitHub Personal Access Token (PAT) if
you have one or go to https://github.com/settings/personal-access-tokens/new to create a new one. Then click
the `Create` button. If you go the Chat window, you should see the server listed.

### Configure the Goose flow runtime

Kaiden uses the Goose as a flow provider. So there are two options here:

- use Goose for the local PATH if you have already installed Goose on your workstation.
- install Goose locally though the Goose extension. Go to the `Settings > CLI` tab and search for `goose`. If no Goose
  executable is found, you can click the `Install` button to install it locally.
