# vLLM Semantic Router Extension

This extension runs [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) instances in containers and registers each one in Kaiden as an OpenAI-compatible inference connection. A semantic router receives chat requests and routes each one to the backend model that best matches it, based on the routing signals and decisions of its configuration.

## Requirements

- The **Container** extension (`kaiden.container`), which this extension depends on.
- A running container engine (Podman or Docker). Semantic routers can only be created while at least one engine is available.

## Features

- **Semantic router connection factory**: creates vLLM semantic routers from the **Add Semantic Router** page.
- **Container-based**: each router runs as two containers, the vLLM Semantic Router and an Envoy proxy.
- **OpenAI-compatible endpoint**: each router is registered as an inference connection reachable on `http://<listener address>:<listener port>/v1` (`localhost` for `127.0.0.1` or `0.0.0.0`).
- **Lifecycle management**: start, stop and delete routers from Kaiden.
- **Discovery**: routers created earlier are found again when Kaiden starts or when a container engine becomes available.

## Usage

1. Open the **Add Semantic Router** page in Kaiden.
2. Go through the steps: **Basic setup** (name, listener, timeout), **Backend models** and **Signals & decisions**.
3. On creation, the extension:
   - Validates the router name and the generated configuration (see [Configuration rules](#configuration-rules)).
   - Creates a folder named after the router in the extension storage and writes `config.yaml` (router configuration) and `envoy.yaml` (generated Envoy configuration) in it.
   - Pulls the images if they are not already available, reporting progress:
     - `ghcr.io/vllm-project/semantic-router/vllm-sr:v0.3.0`
     - `docker.io/envoyproxy/envoy:v1.40.2`
   - Creates both containers (stopped) and registers the inference connection.
4. Start the connection. It reports **starting** until the router is ready, then **started**.

## How it works

Envoy runs in the network namespace of the router container. It calls the router over gRPC on `127.0.0.1:50051` for each request (Envoy external processing), then forwards the request to the selected backend model.

| Container port | Purpose                                 | Published on the host                 |
| -------------- | --------------------------------------- | ------------------------------------- |
| `8801`         | Envoy listener (OpenAI-compatible API)  | Yes, on the listener address and port |
| `8080`         | Router API, polled on `/ready`          | Yes, on `127.0.0.1`, next free port   |
| `50051`        | Router gRPC (Envoy external processing) | No                                    |
| `9901`         | Envoy admin                             | No                                    |

Ports are published from the router container because Envoy shares its network namespace.

The listener of the **Basic setup** step decides how the router is reached:

- **Address**: the host address Envoy is published on. The default, `127.0.0.1`, keeps the router reachable from this machine only; `0.0.0.0` makes it reachable from the network.
- **Port**: the host port of Envoy. It must be free when the router is created. A port of `0` or less picks a free port.
- **Timeout**: the Envoy request, stream idle and external processing timeouts (`300s` when not set).

The router API port always stays on `127.0.0.1`.

### Starting, stopping and deleting

- **Start**: starts the router, then Envoy, then polls the router API `/ready` endpoint every 10 seconds for up to 2 minutes. The connection becomes **started** once it answers `200`. While waiting, the router startup progress (for example a model download) is reported. If a container fails to start or the router is not ready in time, the containers are stopped again.
- **Stop**: stops Envoy, then the router. Both are always attempted and the connection is always marked stopped; errors are reported afterwards.
- **Delete**: stops and removes both containers and the router folder, and unregisters the connection.

Changes made outside of Kaiden are followed: if a router or Envoy container is stopped, started, removed or crashes, the connection status is updated or the connection is unregistered.

### Backends on the host

A backend endpoint on `localhost` or `127.0.0.1` is reached from the containers through `host.docker.internal`. Podman and Docker Desktop define this name; other engines may need it to be configured.

### Platforms

- **SELinux**: the configuration files are bind-mounted read-only with the `:Z` option, so that an SELinux enforcing host (for example Fedora with Podman) lets the containers read them. The option has no effect elsewhere.

## Configuration rules

A router is rejected before anything is created when:

- **Name**: it is empty, longer than 255 characters, contains `< > : " / \ | ? *` or control characters, ends with a dot or a space, or is a reserved Windows name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`). The name is used as a folder name and as the connection id.
- **Existing router**: a router with the same name already exists.
- **Configuration**: it is not valid YAML or does not match the expected schema.
- **Listener**: there is not exactly one listener, its address is not an IP address, its port is outside `1024`-`65535` (or already in use), or its timeout is not a number of seconds such as `300s`.
- **Models**: two models have the same name, or a model does not have exactly one `backend_refs` entry.
- **Backend endpoint**: it is not `host[:port]` (an optional path is ignored), includes a scheme (use the `protocol` field instead), has a port outside `0`-`65535`, uses an IPv6 address without brackets (`[::1]:8000`), or its `protocol` is not `http` or `https`. The port defaults to `80` for `http` and `443` for `https`, which also enables TLS.

## Logging

Development builds run the router and Envoy with debug logs and print router traces to the container output. Release builds use the `info` level and disable trace export, as debug logs can contain prompt content.

## Known limitations

- If the containers of a router are removed outside of Kaiden, its folder stays in the extension storage and a router with the same name cannot be created until the folder is removed.

## Development

From the extension folder:

```bash
pnpm run build   # build the extension
pnpm test        # run the unit tests with coverage
pnpm run watch   # rebuild on changes
```

## License

Apache-2.0
