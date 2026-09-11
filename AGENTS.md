# AGENTS.md

This file provides guidance to AI code assistants when working with code in this repository.

## Project Overview

Kaiden is an Electron-based desktop application built with Svelte that provides AI-powered container and Kubernetes management capabilities. It integrates with multiple AI providers (Gemini, OpenAI-compatible services, OpenShift AI) and supports flow execution through providers like Goose. The application also implements the Model Context Protocol (MCP) for AI agent integration.

## Core Architecture

### Multi-Process Electron Application

Kaiden follows the standard Electron architecture with three main processes:

- **Main Process** (`packages/main`): Node.js backend handling system integration, extension loading, container/Kubernetes operations, and business logic
- **Renderer Process** (`packages/renderer`): Svelte-based UI running in the browser context
- **Preload Scripts** (`packages/preload` and `packages/preload-webview`): Bridge layer for secure IPC communication between main and renderer

### Plugin System and Dependency Injection

The core plugin system is implemented in `packages/main/src/plugin/index.ts` using Inversify for dependency injection. Key components include:

- **PluginSystem class**: Orchestrates extension loading, configuration registry, and all core services
- **Extension Loader** (`ExtensionLoader`): Manages extension lifecycle (loading, starting, stopping, uninstalling)
- **Container**: Inversify DI container binding all major registries and managers as singletons

All major services are registered as singletons in the DI container during initialization:

- `ProviderRegistry`: Manages inference, container, and Kubernetes providers
- `ContainerProviderRegistry`: Handles Docker/Podman container operations
- `KubernetesClient`: Kubernetes cluster management
- `MCPManager` and `MCPRegistry`: Model Context Protocol integration
- `FlowManager`: Manages flow execution with providers like Goose
- `ChatManager`: AI chat functionality
- `ConfigurationRegistry`: Settings and configuration management

### Extensions

Extensions are located in the `extensions/` directory and follow a standard structure:

- Each extension has a `package.json` with `main` pointing to `./dist/extension.js`
- Extensions must declare `engines.kaiden` version compatibility
- Extensions can contribute:
  - Inference providers (Gemini, OpenAI-compatible, OpenShift AI)
  - Flow providers (Goose)
  - MCP registries
  - Configuration properties
- Extensions are built using Vite and export a standard activation API

Available built-in extensions:

- `gemini`: Google Gemini AI provider integration
- `goose`: Goose flow execution provider
- `mcp-registries`: MCP server registries
- `openai-compatible`: OpenAI-compatible API support
- `openshift-ai`: OpenShift AI platform integration

### Extension API

Extensions interact with Kaiden through `@openkaiden/api` (`packages/extension-api`), which provides TypeScript definitions for:

- Provider registration (inference, container, Kubernetes, VM, flow)
- Configuration management
- Command and menu contributions
- UI components (webviews, views, status bar items)
- Authentication providers
- MCP server integration

## Development Commands

### Setup and Installation

```bash
pnpm install

# Start in watch/development mode
pnpm watch
```

### Building

```bash
# Build entire application
pnpm run build

# Build individual packages
pnpm run build:main        # Main process
pnpm run build:renderer    # UI/renderer
pnpm run build:preload     # Preload scripts
pnpm run build:extensions  # All extensions

# Build specific extension
cd extensions/gemini && pnpm run build
```

### Testing

```bash
# Run all tests (unit + e2e)
pnpm test

# Unit tests only
pnpm run test:unit

# Unit tests with coverage
pnpm run test:unit:coverage

# Run tests for specific packages
pnpm run test:main           # Main process tests
pnpm run test:renderer       # Renderer tests
pnpm run test:preload        # Preload tests
pnpm run test:extensions     # Extension tests

# E2E tests with Playwright
pnpm run test:e2e            # Build and run e2e tests
pnpm run test:e2e:run        # Run e2e tests only (must build first)
pnpm run test:e2e:report     # Show Playwright test report

# Watch mode for development
pnpm run test:watch
```

For detailed Playwright E2E testing guidance (Page Object Model, fixtures, locator conventions, examples), see `.agents/skills/playwright-testing/`.

For UI component development guidelines (color-registry usage, Icon component, reusable components), see `.agents/skills/ui-components/` and `CODE-GUIDELINES.md`.

### Code Quality

```bash
# Format code
pnpm run format:check        # Check formatting
pnpm run format:fix          # Fix formatting issues

# Linting
pnpm run lint:check          # Check for linting issues
pnpm run lint:fix            # Fix linting issues

# Type checking
pnpm run typecheck           # Check all packages
pnpm run typecheck:main      # Main process only
pnpm run typecheck:renderer  # Renderer only
pnpm run svelte:check        # Svelte component type checking
```

#### Mandatory pre-commit checks

Before committing, always run the following commands and fix any failures:

1. `pnpm run format:fix` — auto-fix formatting
2. `pnpm run lint:fix` — auto-fix linting
3. `pnpm run typecheck` — type-check all packages
4. `pnpm run svelte:check` — check Svelte components
5. Run unit tests for affected packages (e.g., `pnpm run test:main` or `pnpm run test:renderer`)

Re-stage any files modified by the fix commands before committing. Do not skip these checks — commit hooks are not always available.

### Building Distributables

```bash
# Development build (directory output, no packaging)
pnpm run compile

# Production build for release
pnpm run compile:next        # With auto-publishing
pnpm run compile:current     # Current version
pnpm run compile:pull-request # Without publishing
```

## Key Technical Details

### Workspace Structure

This is a pnpm monorepo with workspaces defined in `pnpm-workspace.yaml`:

- `packages/*`: Core application packages (main, renderer, preload, extension-api, api, webview-api)
- `extensions/*`: Extension packages
- `scripts`: Build and utility scripts
- `tests/playwright`: E2E test suite

### Import Aliases

Use `/@/` path aliases (e.g., `'/@/plugin/provider-registry.js'`) instead of relative paths (e.g., `'../plugin/provider-registry.js'`) for imports outside the current directory's module group. Relative imports are only used for sibling modules within the same directory (e.g., `'./chat-manager.js'`).

### IPC Communication Pattern

The main/renderer communication follows a structured pattern:

- Main process exposes handlers via `ipcHandle()` in `packages/main/src/plugin/index.ts`
- Handlers follow naming convention: `<registry-name>:<action>` (e.g., `container-provider-registry:listContainers`)
- Renderer invokes via exposed preload APIs
- Events are sent to renderer via `apiSender.send()` for real-time updates

### Test File Organization

Tests are co-located with source files:

- Unit tests: `*.spec.ts` files alongside source code
- E2E tests: Located in `tests/playwright/src/`
- Test configuration: `vitest.config.js` at root defines workspace test projects
- 627 total test files across the codebase

### Unit Test Conventions

Unit tests use Vitest and follow these conventions:

- **Test function**: Use `test()` instead of `it()` for test cases
- **Mocking**: Use `vi.mock(import('...'))` for auto-mocking modules. Avoid manual mock factories (`vi.mock('...', () => ({...}))`) when possible
- **Resetting mocks**: Use `vi.resetAllMocks()` in `beforeEach`, not `vi.clearAllMocks()`
- **Customizing auto-mocks**: When an auto-mocked function or class method needs a real implementation, use `vi.mocked(...)`. For class methods, use the prototype pattern: `vi.mocked(MyClass.prototype.myMethod).mockImplementation(...)`

### Extension Lifecycle

1. **Discovery**: `ExtensionLoader` scans `extensions/` directory
2. **Initialization**: Extensions are loaded via `ExtensionLoader.init()`
3. **Activation**: Extensions start when `ExtensionLoader.start()` is called after system ready
4. **Runtime**: Extensions can be started/stopped/removed dynamically through registry
5. **Development**: Use `extension-development-folders` API to load extensions from custom paths

### Configuration System

Configuration is managed through `ConfigurationRegistry`:

- Properties defined in extension's `package.json` under `contributes.configuration.properties`
- Scopes: `DEFAULT`, `ContainerProviderConnection`, `KubernetesProviderConnection`, `InferenceProviderConnection`, `InferenceProviderConnectionFactory`
- Configuration can be experimental and requires explicit enablement
- Values stored and retrieved with dot notation (e.g., `gemini.factory.apiKey`)

### Flow Execution

Flows are AI-powered automation workflows:

- Providers register flow capabilities through `ProviderRegistry`
- `FlowManager` coordinates flow generation, execution, and lifecycle
- Flows can be deployed to Kubernetes (YAML generation)
- Goose extension provides flow runtime capabilities
- MCP servers can be connected to flows for tool access

### MCP (Model Context Protocol) Integration

- `MCPRegistry`: Manages MCP registry sources (like mcp-get.com)
- `MCPManager`: Handles remote MCP server connections and lifecycle
- `MCPIPCHandler`: IPC bridge for MCP operations
- MCP servers provide tools that can be accessed by AI models
- Credentials and setup stored securely via `SafeStorageRegistry`

## Important Patterns

### Working with Containers and Pods

Container operations go through `ContainerProviderRegistry`:

- List containers: `container-provider-registry:listContainers`
- Container lifecycle: `startContainer`, `stopContainer`, `deleteContainer`
- Image operations: `pullImage`, `buildImage`, `deleteImage`
- Pod operations: `createPod`, `startPod`, `stopPod`, `removePod`
- All operations require `engineId` parameter identifying the container engine

### Kubernetes Operations

Kubernetes operations use `KubernetesClient`:

- Context management: `getContexts()`, `setContext()`, `deleteContext()`
- Resource operations: CRUD operations for pods, deployments, services, etc.
- Port forwarding: `createPortForward()`, `deletePortForward()`
- Exec into containers: `execIntoContainer()` with stdin/stdout callbacks
- Apply YAML: `applyResourcesFromFile()`, `applyResourcesFromYAML()`

### Task Management

Long-running operations should use `TaskManager`:

```typescript
const task = taskManager.createTask({
  title: 'Operation description',
  action: {
    name: 'Navigate to result',
    execute: () => navigationManager.navigateToResource(),
  },
});
// Set task.status = 'success' or task.error on completion
```

### Creating New Extensions

1. Create directory in `extensions/<extension-name>`
2. Add `package.json` with required fields:
   - `engines.kaiden`: Version compatibility
   - `main`: Entry point (`./dist/extension.js`)
   - `contributes`: Configuration, commands, etc.
3. Create `src/extension.ts` with `activate()` function
4. Add extension to build in root `package.json` scripts
5. Build using Vite: `vite build`

### Security Considerations

- External URLs require user confirmation (handled in `setupSecurityRestrictionsOnLinks`)
- Safe storage for credentials via `SafeStorageRegistry`
- Configuration scopes limit exposure of sensitive data
- Preload scripts enforce security boundaries between processes
- Extension configuration properties for API keys, tokens, or secrets must use `"format": "password"` to ensure input masking in the UI
