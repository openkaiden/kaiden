# Contributing to Kaiden

We'd love to have you join the community! Below summarizes the processes
that we follow.

## Topics

- [Reporting Issues](#reporting-issues)
- [Providing Extensions](#providing-extensions)
- [Working On Issues](#working-on-issues)
- [Contributing](#contributing)
- [Continuous Integration](#continuous-integration)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Communication](#communication)
- [Code Architecture](#code-architecture)
- [Maintainer Tasks](#maintainer-tasks)

## Reporting Issues

Before opening an issue, check the backlog of
[open issues](https://github.com/openkaiden/kaiden/issues)
to see if someone else has already reported it.

If so, feel free to add
your scenario, or additional information, to the discussion. Or simply
"subscribe" to it to be notified when it is updated.

If you find a new issue with the project we'd love to hear about it! The most
important aspect of a bug report is that it includes enough information for
us to reproduce it. So, please include as much detail as possible and try
to remove the extra stuff that doesn't really relate to the issue itself.
The easier it is for us to reproduce it, the faster it'll be fixed!

Please don't include any private/sensitive information in your issue!

## Providing Extensions

Some of the best features of Kaiden aren't even in this repository!
Kaiden provides a set of APIs that expand its capabilities through extensions.

Extensions add support for:

- AI providers (Gemini, OpenAI-compatible, OpenShift AI)
- Flow providers (like Goose for AI-powered automation)
- MCP (Model Context Protocol) server registries
- Container engines and Kubernetes providers
- UI elements like actions, badges, or views

You can create your own extension and contribute it to the project.

See the `packages/extension-api` documentation and existing extensions in the `extensions/` directory for more information.

## Working On Issues

Often issues will be assigned to someone, to be worked on at a later time.

If you are a member of the [Kaiden](https://github.com/openkaiden) organization,
self-assign the issue with the `status/in-progress` label.

If you cannot set the label, add a quick comment in the issue asking that
the `status/in-progress` label be set and a maintainer will label it.

## Contributing

This section describes how to start a contribution to Kaiden.

### Prerequisites: Prepare your environment

You can develop on either: `Windows`, `macOS` or `Linux`.

Requirements:

- [Node.js 24+](https://nodejs.org/en/)
- [pnpm v10.x](https://pnpm.io/installation) (`corepack enable pnpm`)

Optional Linux requirements:

- GNU C and C++ compiler
  Fedora/RHEL
  ```sh
  dnf install gcc-c++
  ```
  Ubuntu/Debian
  ```sh
  apt-get install build-essential
  ```

On Windows:

- [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170#visual-studio-2015-2017-2019-and-2022)

### Step 1. Fork and clone Kaiden

Clone and fork the project.

Fork the repo using GitHub site and then clone the directory:

```sh
git clone https://github.com/<you>/kaiden && cd kaiden
```

### Step 2. Install dependencies

```sh
pnpm install
```

### Step 3. Start in watch mode

Run the application in watch mode:

```sh
pnpm watch
```

The dev environment will track all files changes and reload the application respectively.

### Step 4. Write and run tests

Write tests! Please try to write some unit tests when submitting your PR.

Run the unit tests using `pnpm`:

```sh
pnpm test:unit
```

Run unit tests with coverage:

```sh
pnpm test:unit:coverage
```

Depending on which part of the project you contribute to, you can specify to run tests for a specific module:

```sh
pnpm test:main           # Main process tests
pnpm test:renderer       # Renderer tests
pnpm test:preload        # Preload tests
pnpm test:extensions     # Extension tests
```

For development, you can run tests in watch mode:

```sh
pnpm test:watch
```

Check the npm script tasks in our `package.json` for more options.

### Step 5. Run E2E tests

When adding new features, it's important to ensure we don't introduce regressions. For this purpose we use E2E tests built with Playwright:

Build and run all E2E tests:

```sh
pnpm test:e2e
```

Run E2E tests only (after building):

```sh
pnpm test:e2e:run
```

View the test report:

```sh
pnpm test:e2e:report
```

After executing the E2E tests, you can check the results with:

```sh
pnpm exec playwright show-report tests/playwright/output/html-results
```

In case of an error, you can find more information in the `tests/playwright/output` folder:

- Video recordings in `videos/`
- Screenshots of failures in `screenshots/`
- Execution traces in `traces/` (can be opened with `npx playwright show-trace <path/to/trace.zip>`)

### Step 6. Code coverage

Code coverage reports are generated when running tests with coverage enabled:

```sh
pnpm test:unit:coverage
```

Coverage reports can be found in the coverage output directory. When contributing new code, you should strive to maintain or improve overall code coverage.

### Step 7. Code formatter / linter

Check that your code is properly formatted:

```sh
pnpm format:check        # Check formatting
pnpm format:fix          # Fix formatting issues
```

Run linting:

```sh
pnpm lint:check          # Check for linting issues
pnpm lint:fix            # Fix linting issues
```

Run type checking:

```sh
pnpm typecheck           # Check all packages
pnpm typecheck:main      # Main process only
pnpm typecheck:renderer  # Renderer only
pnpm svelte:check        # Svelte component type checking
```

### Step 8. Compile production binaries (optional)

You may want to test the binary against your local system before pushing a PR. You can do so by running:

Development build (directory output, no packaging):

```sh
pnpm compile
```

Production builds:

```sh
pnpm compile:current     # Current version
pnpm compile:next        # With auto-publishing
pnpm compile:pull-request # Without publishing
```

The compiled binaries will be output to the `dist/` folder.

> **_macOS CODE SIGNING:_** When testing the compiled binary on macOS, you must ad-hoc sign the application before launching it. Without signing, macOS will terminate the app with a `Code Signature Invalid` error. Run the following command after compiling:
>
> ```sh
> # Compile
> pnpm compile:current
>
> # Sign the binary
> codesign --force --deep --sign - "dist/mac-arm64/Kaiden.app"
> ```

## Submitting Pull Requests

### Process

Whether it is a large patch or a one-line bug fix, make sure you explain in detail what's changing!

Make sure you include the issue in your PR! For example, say: `Closes #XXX`.

PRs will be approved by a maintainer listed in [`CODEOWNERS`](CODEOWNERS).

We typically require one approval for code as well as documentation-related PR's. If it is a large code-related PR, proof of review / testing (a video / screenshot) is required.

**Avoid enabling auto-merge** until the PR has undergone sufficient reviews and contributors have been given ample time for assessment. A maintainer will review the PR prior to the final merge. It's common for code PRs to require up to a week before merging due to reasons such as ongoing releases or dependencies on other PRs. Additionally, documentation PRs might take a few days for integration.

Some tips for the PR process:

- No PR too small! Feel free to open a PR against tests, bugs, new features, docs, etc.
- Make sure you include as much information as possible in your PR so maintainers can understand.
- Try to break up larger PRs into smaller ones for easier reviewing
- Any additional code changes should be in a new commit so we can see what has changed between reviews.
- Squash your commits into logical pieces of work.

### Use the correct commit message semantics

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

Some examples for correct titles would be:

- `fix: prevent racing of requests`
- `chore: drop support for Node 6`
- `docs: add quickstart guide`

For Kaiden we use the following types:

- `fix:` A bug fix
- `chore:` Very small change / insignificant impact
- `docs:` Documentation only changes (ex. website)
- `build:` Changes that affect the build system
- `ci:` Changes to the CI (ex. GitHub actions)
- `feat:` A new feature
- `perf:` A code change that improves performance
- `refactor:` A code change that neither fixes a bug nor adds a feature
- `style:` Changes that affect the formatting, but not the ability of the code
- `test:` Adding missing tests / new tests

Title formatting:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Sign your PRs

The sign-off is a line at the end of the explanation for the patch. Your
signature certifies that you wrote the patch or otherwise have the right to pass
it on as an open-source patch.

Then you just add a line to every git commit message:

    Signed-off-by: Joe Smith <joe.smith@email.com>

Legal name must be used (no pseudonyms or anonymous contributions)

If you set your `user.name` and `user.email` git configs, you can sign your
commit automatically with `git commit -s`.

### Skipping Jobs for Draft Pull Requests on GitHub

When creating a pull request in **draft mode** on GitHub, all CI/CD jobs are **skipped by default**. This behavior is intentional to avoid triggering unnecessary workflows while the pull request is still in progress.

#### Triggering Jobs in Draft Mode

If you want to run jobs for a pull request in **draft mode**, you need to manually apply the `area/ci` label to the pull request. Applying this label signals the CI system to execute the associated workflows, even though the pull request remains in draft.

#### Steps to Trigger Jobs in Draft Mode

1. Open your pull request in draft mode.
2. Navigate to the **Labels** section in the right-hand sidebar.
3. Apply the `area/ci` label.

This action will trigger the configured CI/CD workflows for your draft pull request.

#### Example Scenario

- **Without the `area/ci` label**: No jobs will run for your draft pull request.
- **With the `area/ci` label**: Jobs will be triggered, allowing you to validate your work in progress.

This ensures that CI resources are used efficiently while still providing flexibility for testing during the draft stage.

### Review process

1. Submit your PR
2. Reviewers are assigned by GitHub
3. PRs require at least 1 approval (2 if it's a large code change)

> **_NOTE:_** Confirm that your PR works on macOS, Windows and Linux if it's a significant change (not just a UI improvement)

> **_NOTE:_** If your PR hasn't been merged in a reasonable amount of time, ping the assigned reviewers with `@`

## Continuous Integration

All pull requests and branch-merges automatically run:

- Format and lint checking
- Cross-platform builds (Windows, macOS, Linux)
- Unit tests
- E2E tests (triggered by PR checks)

You can follow these jobs in GitHub Actions: https://github.com/openkaiden/kaiden/actions

## Communication

For bugs/feature requests please [file issues](https://github.com/openkaiden/kaiden/issues/new/choose)

Discussions are possible using GitHub Discussions: https://github.com/openkaiden/kaiden/discussions/

## Code Architecture

### Frameworks and tooling

Within Kaiden, we use the following frameworks and tools to build the desktop application:

- [Electron](https://www.electronjs.org/): Cross-platform desktop application framework
- [Svelte](https://svelte.dev/): Reactive UI/UX framework for building the interface
- [Tailwind CSS](https://tailwindcss.com/): Utility-first CSS framework for styling
- [Vite](https://vitejs.dev/): Dev tooling for rapid development, debugging and deployment
- [Inversify](https://inversify.io/): Dependency injection container for plugin system

> **_NOTE:_** We use TypeScript throughout the codebase for type safety.

### Testing

Within Kaiden, we use the following for testing:

- [Vitest](https://vitest.dev/): Unit tests - Written as `*.spec.ts` files co-located with source code
- [Testing Library](https://testing-library.com/): Component tests - Utilities and best practices for writing component tests
- [Playwright](https://playwright.dev/): E2E tests located in `tests/playwright/`

### Folders

Below are brief descriptions of Kaiden's folder structure and organization:

This is a pnpm monorepo with workspaces defined in `pnpm-workspace.yaml`:

- `extensions/`: Extension packages that add functionality to Kaiden
  - `gemini/`: Google Gemini AI provider integration
  - `goose/`: Goose flow execution provider
  - `mcp-registries/`: MCP server registries
  - `openai-compatible/`: OpenAI-compatible API support
  - `openshift-ai/`: OpenShift AI platform integration
- `packages/`: Core application packages
  - `packages/main`: Main Electron process - handles system integration, extension loading, container/Kubernetes operations, and business logic
  - `packages/renderer`: Renderer Electron process - Svelte-based UI running in browser context
  - `packages/preload`: Preload scripts - bridge layer for secure IPC communication between main and renderer
  - `packages/preload-webview`: Preload scripts for webview contexts
  - `packages/extension-api` (also `@openkaiden/api`): Extension API providing TypeScript definitions for provider registration, configuration, commands, UI components, etc.
  - `packages/api`: Internal API types and interfaces
  - `packages/webview-api`: API for webview components
- `scripts/`: Build and utility scripts
- `tests/`: E2E test suite
  - `tests/playwright/`: Playwright E2E tests
- `node_modules/`: Node.js packages and dependencies

> **_NOTE:_** Each extension has its own `package.json` with `main` pointing to `./dist/extension.js` and must declare `engines.kaiden` version compatibility.

### UI colors

Colors in Kaiden are managed by a [`color-registry.ts`](packages/main/src/plugin/color-registry.ts) file to easily switch between light and dark mode.

When contributing a UI component to Kaiden that is colorized, you must figure out what color to use and how to reference it:

Steps:

1. Open the `packages/main/src/plugin/color-registry.ts` file
2. Find the appropriate color category from the `initColors()` function
3. Use the referenced color with the format `[var(--pd-<color>)]`

Example:

1. Choose what UI component you want to add (e.g., a new primary button)
2. Look under `initColors()` and find `this.initButton()`, then scroll to `protected initButton()`
3. Pick a color. For a "primary" button: `${button}primary-bg`
4. Note the `const` below `protected initButton()` which is `const button = 'button-';`
5. The color can be referenced with `[var(--pd-button-primary-bg)]`
6. Example:

```ts
<Button class="bg-[var(--pd-button-primary-bg)]"/>
```

## Maintainer tasks

List of maintainer tasks to help the project run smoothly.

### Triage manager

Each sprint a new "Triage manager" may be assigned.

Your responsibilities include:

- Reviewing the [status/need-triage](https://github.com/openkaiden/kaiden/issues?q=is%3Aopen+is%3Aissue+label%3Astatus%2Fneed-triage) label on new issues. As a maintainer, you will need to categorize these issues under the correct [area labels](https://github.com/openkaiden/kaiden/labels?q=area%2F). Once categorized, remove the `status/need-triage` label and apply the appropriate area label.
- Evaluating the severity of new issues. If an issue is classified as "critical" or "high priority" and requires immediate attention, tag a maintainer in the issue and notify them appropriately.
- Identifying issues that are simple to resolve and marking them as "good first issue," thereby encouraging newcomers to contribute to the project.
- Evaluating any stale or lingering pull requests and pinging the respective contributors. If the pull request has been opened for an extensive amount of time, contact the contributor or push any changes required to get it merged. If there is no communication or the pull request is stale, consider closing them.
