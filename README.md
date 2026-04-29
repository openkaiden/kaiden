# Kaiden

<img src="https://raw.githubusercontent.com/openkaiden/artwork/refs/heads/main/icon-1024.png" alt="A stylized bear wearing virtual reality goggles and a collared shirt with a letter K on it." width="256">

Kaiden is a desktop application for working with AI model providers, MCP (Model Context Protocol) servers, agent flow runtimes, and container/Kubernetes environments from one workspace. It is built on the [Podman Desktop](https://github.com/containers/podman-desktop) extension architecture and adds AI-specific registries, a chat UI, flow execution, and RAG tooling on top of it.

## What you can do with Kaiden

- **Chat with multiple model providers** — Anthropic Claude, Google Gemini, Mistral, any OpenAI-compatible endpoint, OpenShift AI, and local models served through Ollama or RamaLama.
- **Connect MCP servers** — install servers from registries and expose their tools to chats and agents.
- **Run agent flows** — Goose is integrated as a flow runtime; flows can also be exported as Kubernetes manifests.
- **Manage containers** — list, start, stop, build, and inspect containers, images, pods, volumes, and networks against Podman or Docker engines.
- **Manage Kubernetes** — switch contexts, view and edit deployments, services, ingresses, cron jobs, port-forward, and exec into pods.
- **Build RAG pipelines** — chunk documents with Docling and store embeddings in Milvus.
- **Store credentials locally** — provider API keys and tokens are kept in a local secret vault.

## Who it is for

Kaiden is aimed at developers and platform engineers who are building AI-assisted tooling and want one application that covers model access, agent execution, and the container or Kubernetes environment the work runs in. It is also useful for evaluating multiple inference providers, including local ones, side by side.

## How it relates to other tools

- **Podman Desktop** — Kaiden reuses Podman Desktop's main/renderer/preload architecture and extension system. The container and Kubernetes features come from that base; AI providers, MCP, flows, and chat are added on top.
- **LM Studio, Open WebUI, and other chat front-ends** — those focus on local model inference and chat. Kaiden includes chat but also covers MCP, agent flows, and container/Kubernetes operations.
- **Goose** — Goose is a flow runtime; Kaiden embeds it as one provider and adds a UI for configuring flows, attaching MCP servers, managing model providers, and deploying flows to Kubernetes.

## Architecture

Kaiden is an Electron application written in TypeScript with a Svelte renderer. The codebase is a pnpm monorepo:

- `packages/main` — Node.js main process, plugin system, and registries (`ProviderRegistry`, `ContainerProviderRegistry`, `KubernetesClient`, `MCPManager`, `FlowManager`, `ChatManager`).
- `packages/renderer` — Svelte UI.
- `packages/preload`, `packages/preload-webview` — IPC bridge between main and renderer.
- `packages/extension-api` — TypeScript API surface for extensions.
- `extensions/` — built-in extensions: `claude`, `gemini`, `mistral`, `openai-compatible`, `openshift-ai`, `ollama`, `ramalama`, `goose`, `mcp-registries`, `milvus`, `docling`, `container`, `kdn`.

See [`AGENTS.md`](./AGENTS.md) for a deeper walkthrough of the plugin system, IPC patterns, and extension lifecycle.

## Status

Kaiden is at version `0.1.0-next`. APIs, configuration formats, and the extension surface may change between releases.

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

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for issue reporting, development workflow, and how to contribute extensions.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
