# Podman AI Lab Extension

Integrates Podman AI Lab inference servers with Kaiden. Automatically discovers and registers running models via the AI Lab daemon on localhost (port 10434 by default).

## Requirements

- [Podman Desktop](https://podman-desktop.io/) with the [AI Lab](https://developers.redhat.com/products/podman-desktop/podman-ai-lab) extension installed
- A Podman AI Lab version that serves the OpenAI-compatible `/v1` API. With an older version, models are listed but agents cannot use them
- At least one model service running in AI Lab

## Usage

1. Open Podman Desktop and start a model service in AI Lab
2. Running models will automatically appear in Kaiden's Podman AI Lab provider
3. Select any model to start chatting

## Notes

- The extension polls the AI Lab daemon (`/api/ps`) every 30 seconds
- The daemon speaks Ollama protocol — only running inference servers are listed
- Models are registered with the daemon's OpenAI-compatible endpoint (`/v1`), so agents can use them
- The daemon port is read from the Podman Desktop settings (`ai-lab.apiPort` in Podman Desktop's `settings.json`) on every poll, so a port changed in AI Lab is picked up without any Kaiden setting. It defaults to 10434 when the preference is not set
- AI Lab's random port mode (`0`) is not supported, as the port is not published anywhere Kaiden can read. A Podman Desktop installed as a Flatpak or a custom Podman Desktop home outside `PODMAN_DESKTOP_HOME_DIR` is not detected either, and the default port is used
