# Podman AI Lab Extension

Integrates Podman AI Lab inference servers with Kaiden. Automatically discovers and registers running models via the AI Lab daemon on localhost:10434.

## Requirements

- [Podman Desktop](https://podman-desktop.io/) with the [AI Lab](https://developers.redhat.com/products/podman-desktop/podman-ai-lab) extension installed
- At least one model service running in AI Lab

## Usage

1. Open Podman Desktop and start a model service in AI Lab
2. Running models will automatically appear in Kaiden's Podman AI Lab provider
3. Select any model to start chatting

## Notes

- The extension polls the AI Lab daemon (`/api/ps`) every 30 seconds
- The daemon speaks Ollama protocol — only running inference servers are listed
- Default API port is 10434 (configurable in AI Lab preferences under `ai-lab.apiPort`)
