# Podman AI Lab Extension

Integrates Podman AI Lab inference servers with Kaiden. Automatically discovers and registers running models via the AI Lab daemon on localhost:10434.

## Requirements

- [Podman Desktop](https://podman-desktop.io/) with the [AI Lab](https://developers.redhat.com/products/podman-desktop/podman-ai-lab) extension installed
- A Podman AI Lab version that serves the OpenAI-compatible `/v1` API with an older version models are listed but agents cannot use them
- At least one model service running in AI Lab

## Usage

1. Open Podman Desktop and start a model service in AI Lab
2. Running models will automatically appear in Kaiden's Podman AI Lab provider
3. Select any model to start chatting

## Notes

- The extension polls the AI Lab daemon (`/api/ps`) every 30 seconds
- The daemon speaks Ollama protocol — only running inference servers are listed
- Models are registered with the daemon's OpenAI-compatible endpoint (`/v1`), so agents can use them
- Default API port is 10434. If you changed it in AI Lab (`ai-lab.apiPort`), set the same value in Kaiden in the Podman AI Lab settings (`podman-ai-lab.apiPort`). AI Lab's random port mode (`0`) is not supported, as Kaiden cannot discover the port
