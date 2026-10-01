# Workspace Provider E2E Tests

End-to-end tests for **Coding Agent Workspaces** under `tests/playwright/src/specs/provider-specs/workspaces/`. These run in the `Workspace-Provider` Playwright project and exercise real OpenShell sandbox creation — not mocked UI-only flows.

## Agent runbook (read this before running)

Use this section when an agent or human needs to **execute** tests. Architecture and coverage details are below.

### Pre-flight checklist

Run from the **repo root** in a **single shell** (exports must persist into the Playwright command).

```bash
# 1. Required env — set in the same terminal session (never paste API keys into commands)
export CI=true
export PODMAN_ENABLED=true          # Required on macOS/Windows
export KAIDEN_BINARY="/path/to/Kaiden.app/Contents/MacOS/Kaiden"
# OPENAI_API_KEY and ANTHROPIC_API_KEY must already be in the environment (user shell / secrets file)

# 2. Verify secrets and gates (all must print "set" / a positive count)
echo "PODMAN: ${PODMAN_ENABLED:+set}" "BINARY: ${KAIDEN_BINARY:+set}"
echo "OPENAI: ${OPENAI_API_KEY:+set}" "ANTHROPIC: ${ANTHROPIC_API_KEY:+set}"

pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider --list | tail -1
# Expected: "Total: N tests in M files" with N > 0. "Total: 0" → fix env vars first.
```

**Kaiden binary:** `test:e2e:workspaces:run` does not build the app. Either point `KAIDEN_BINARY` at an existing packaged build (e.g. after `pnpm run compile`) or use a local dist path you already have. Without `KAIDEN_BINARY`, tests use dev-mode Electron (different from typical OpenShell manual runs).

**Verbose logs:** OpenShell/main-process lines between `✓` test titles are off by default. Set `KAIDEN_E2E_VERBOSE_LOGS=true` when debugging sandbox create/delete or terminal issues.

**Build if needed:**

```bash
pnpm run compile   # produces dist/ output; set KAIDEN_BINARY to the app executable inside
```

### Canonical run command

Prefer `pnpm exec` (not `npx`). Use a long timeout — full suites take 10–20+ minutes.

```bash
pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider \
  --timeout=600000
```

### Minimal smoke run (validate setup first)

One scenario, one agent, five steps (~2–3 min). Confirms env, binary, Podman, and API key before a long matrix run.

```bash
pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider \
  tests/playwright/src/specs/provider-specs/workspaces/workspace-filesystem-network-smoke.spec.ts \
  --grep "FS-NONE-NET-DEVELOPER" \
  --timeout=600000
```

Expect passes (not skips). Then scale up to `--grep @workspace-sandbox` or the full project.

### Troubleshooting

| Symptom                                                 | Likely cause                                                                         | Fix                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `No tests found`                                        | `PODMAN_ENABLED` unset, or `GITHUB_ACTIONS` env var present                          | Export `PODMAN_ENABLED` locally; tests skip in GitHub Actions (run on Azure VMs via workflow)     |
| All tests **skipped**, exit 0                           | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` missing in this shell                         | Use the terminal where keys are loaded, or `test:e2e:pde2e:workspaces:*` on Windows               |
| `40 skipped` for a tag grep                             | Same as above, or intentional `skipReason` (full-system / unrestricted on OpenShell) | Check skip reason in output; see [Expected results](#expected-results-on-openshell-macos--podman) |
| Create fails: `mkdir: cannot create directory '/Users'` | Bad custom mount target (absolute host + empty target)                               | Use `$SOURCES/...` hosts; see [Custom mount conventions](#custom-mount-conventions)               |
| Hang on prompt step                                     | Terminal/agent loading                                                               | Check trace/video in `tests/playwright/output/`                                                   |

**Skips are not always failures.** OpenShell intentionally skips 10 matrix tests (full-system + unrestricted). Agent lifecycle suites skip per missing provider API key.

### Agent limitations

Agents can **invoke** Playwright and interpret results, but often **cannot get real passes** without inference API keys in the same shell.

| Agent can do                                           | Agent often cannot do                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Read this runbook and run `--list` / `--grep` commands | Access `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from the user's 1Password, `.zshrc`, or IDE-only secrets |
| Set `PODMAN_ENABLED`, `KAIDEN_BINARY`                  | Treat `N skipped` + exit 0 as success when keys are missing                                            |
| Diagnose skips using the troubleshooting table         | Run unattended full matrix (~15+ min) without user approval/timeouts                                   |

**If pre-flight shows `OPENAI: ` / `ANTHROPIC: ` empty:** stop and ask the user to run the command in a terminal where keys are already loaded, or trigger CI/MAPT (`test:e2e:pde2e:workspaces:*` on Windows with deferred secrets). Do not paste API keys into chat or commit them.

**Expected workflows:**

1. **Agent prepares command → user runs in local terminal** (most common on macOS).
2. **CI/MAPT pipeline** injects secrets; agent triggers the job or reviews results.
3. **Agent shell inherits keys** only when the user has already exported them in that same Cursor/terminal session.

### Related docs for implementing tests

Running only needs this runbook. **Writing** new tests also requires:

- [SKILL.md](./SKILL.md) — Page Object Model, fixtures, locators
- [reference.md](./reference.md) — page object APIs and env var table

## What These Tests Automate

These tests validate that Kaiden can:

1. Walk through the **Create Coding Agent Workspace** wizard (agent/model, optional filesystem + network policy steps).
2. **Create** an OpenShell sandbox with the chosen policy.
3. Confirm the workspace appears as **Running** in the workspaces table.
4. Open the **terminal**, wait for the coding agent to load, and **send a prompt** with a response.
5. **Remove** the workspace and confirm cleanup.

For the sandbox matrix spec, this repeats across **filesystem × network combinations** aligned with the wizard UI (strict, home, custom mounts, deny-all, developer preset, etc.).

### What Is Not Covered Yet

These are **lifecycle smoke tests**, not full manual regression:

- Overview/settings badge verification after create
- In-sandbox filesystem or network probes (curl, mount visibility)
- Stop/start/restart workspace
- Post-create settings edits
- Project-level policy inheritance

Document intentional `skipReason` scenarios rather than treating skips as failures.

## Two Layers of Workspace E2E

Do not confuse these — they serve different purposes and run in different Playwright projects.

| Layer                  | Spec location                               | Project              | Tags                                                          | PR smoke? |
| ---------------------- | ------------------------------------------- | -------------------- | ------------------------------------------------------------- | --------- |
| **UI / wizard smoke**  | `specs/workspaces-smoke.spec.ts`            | `Kaiden-App-Core`    | `@smoke`                                                      | Yes       |
| **Provider lifecycle** | `specs/provider-specs/workspaces/*.spec.ts` | `Workspace-Provider` | `@workspace-provider`, `@workspace-sandbox`, UI category tags | No        |

Provider workspace tests are **heavy**: they need a built Kaiden binary, Podman (on non-Linux), inference API keys, and real sandbox orchestration. They are run manually or in dedicated CI/MAPT jobs — not in default PR `--grep @smoke`.

## File Structure

```
tests/playwright/src/specs/provider-specs/workspaces/
├── helpers/
│   ├── scenario-lifecycle-engine.ts     # Shared step-runner engine (workspace + session)
│   ├── workspace-lifecycle-helper.ts    # Workspace lifecycle: create → run → terminal → prompt → remove
│   ├── workspace-sandbox-matrix.ts      # Matrix tags, mounts, scenario registration
│   ├── session-lifecycle-helper.ts      # ACP session lifecycle: provision workspace → session steps → cleanup
│   └── session-steps.ts                 # Composable ACP session steps (create/attach/stop/permission/...)
├── workspace-opencode-smoke.spec.ts     # OpenCode × multiple inference providers
├── workspace-claude-smoke.spec.ts       # Claude Code × Anthropic
├── workspace-goose-smoke.spec.ts        # Goose × providers
├── workspace-openclaw-smoke.spec.ts     # OpenClaw × providers
├── workspace-filesystem-network-smoke.spec.ts  # Sandbox FS × network matrix (16 scenarios × 2 agents)
└── agent-sessions-smoke.spec.ts         # ACP session lifecycle on an OpenCode+Ollama sandbox
```

### Page objects

| File                               | Role                                                            |
| ---------------------------------- | --------------------------------------------------------------- |
| `agent-workspaces-page.ts`         | Workspaces list, create entry, status polling, remove           |
| `agent-workspace-create-page.ts`   | Wizard steps, file access, network policy, custom mounts/hosts  |
| `agent-workspace-details-page.ts`  | Workspace details shell                                         |
| `agent-workspace-terminal-page.ts` | xterm interaction, prompt send, Claude API-key prompt dismissal |
| `agent-workspace-overview-page.ts` | Overview tab (exists; not wired into lifecycle tests yet)       |

### Lifecycle helper design

`registerWorkspaceLifecycleTests(test, expect, config)` builds an ordered step list and runs it via
the shared `registerScenarioLifecycleTests` engine (also used by ACP session lifecycle tests) — see
[scenario-lifecycle-e2e.md](./scenario-lifecycle-e2e.md) for the engine itself. This helper's own
config shape (below) is unchanged; the caller still wraps it in `test.describe.serial(...)`.

| Step | Sandbox mode                                       | Default mode                  |
| ---- | -------------------------------------------------- | ----------------------------- |
| 01   | Create workspace (with optional FS/network wizard) | Create workspace + stat cards |
| 02   | Running status in table                            | Running status                |
| 03   | Terminal agent loaded                              | Stat cards after create       |
| 04   | Prompt + response                                  | Terminal agent loaded         |
| 05   | Remove workspace                                   | Prompt + response             |
| 06   | —                                                  | Remove workspace              |
| 07   | —                                                  | Stat cards after remove       |

**Sandbox mode** (`config.sandbox` set): configures filesystem and networking wizard steps, skips stat-card assertions (flaky with OpenShell), uses `expectWorkspaceCreated()` to catch create error dialogs.

**Test IDs:** Scenario in describe title (`FS-NONE-NET-DEVELOPER`); steps as `[01] creation` … `[05] removal`. Skips: `[SKIP] FS-FULL-NET-DEVELOPER — …`. Filter: `--grep FS-NONE-NET-DEVELOPER` or `--grep "\\[01\\] creation"`.

`workspace-filesystem-network-smoke.spec.ts` defines scenarios × agents (OpenCode + Claude Code). Skipped scenarios emit 1 skip-marker test instead of 5 steps — use `--list | tail -1` for the current count.

Inference resources (e.g. OpenAI, Claude) are created **once per agent** in `registerSandboxMatrixTests` (`beforeAll` / `afterAll` on the agent describe). Scenario lifecycle hooks pass `manageResource: false` so they do not recreate/delete the connection between scenarios.

Scenarios use a single `SANDBOX_SCENARIOS` array grouped by comments (core matrix, extended combos, edge cases, known skips).

### UI-aligned tags

Every scenario gets tags derived from wizard categories via `buildScenarioTags()`:

| Tag                  | Wizard UI                           |
| -------------------- | ----------------------------------- |
| `@workspace-sandbox` | Parent tag for the full matrix spec |
| `@fs-none`           | No host filesystem access           |
| `@fs-home`           | Home Directory                      |
| `@fs-custom`         | Custom Paths                        |
| `@fs-full`           | Full System Access                  |
| `@net-deny`          | Deny All                            |
| `@net-developer`     | Developer Preset                    |
| `@net-unrestricted`  | Unrestricted                        |

**Modifiers** (edge cases):

| Tag                         | When                                           |
| --------------------------- | ---------------------------------------------- |
| `@fs-custom-ro`             | Read-only custom mount                         |
| `@fs-custom-multi`          | Multiple custom mounts                         |
| `@fs-custom-default-target` | Empty target defaults to host (`$SOURCES/...`) |
| `@net-custom-host`          | Deny-all + allowed host                        |
| `@net-additional-host`      | Developer preset + extra host                  |

Agent lifecycle specs use `@workspace-provider` only.

### Expected results on OpenShell (macOS + Podman)

Most scenarios pass; full-system and unrestricted scenarios are skipped (see [Skip Conditions](#skip-conditions)). Use `--list | tail -1` for the current total.

**Report hierarchy (HTML):** `OpenCode` → `FS-NONE-NET-DEVELOPER` → `[01] creation` … `[05] removal` (no duplicated scenario ID in step titles).

**Terminal output:** When running in GitHub Actions workspace e2e workflow, the compact list reporter prints only `test.title` — no truncation:

```
✓ 1 WKS-OPENAI [FS-NONE-NET-DEVELOPER] creation (5.6s)
✓ 2 WKS-OPENAI [FS-NONE-NET-DEVELOPER] running status check (43ms)
✓ 3 WKS-OPENAI [FS-NONE-NET-DEVELOPER] terminal navigation (2.0s)
✓ 4 WKS-OPENAI [FS-NONE-NET-DEVELOPER] terminal prompt response (5.1s)
✓ 5 WKS-OPENAI [FS-NONE-NET-DEVELOPER] removal (11.1s)
- 57 WKS-OPENAI [FS-FULL-NET-DEVELOPER] skip — OpenShell tar fails on / mount
```

Disable with `KAIDEN_E2E_COMPACT_REPORTER=false` to restore the stock Playwright list reporter (full path + tags; may ellipsize on narrow terminals).

```bash
pnpm exec playwright show-report tests/playwright/output/html-report
```

## Running Tests

See [Agent runbook](#agent-runbook-read-this-before-running) for pre-flight checks, env exports, troubleshooting, and the canonical run command.

### Run subsets

```bash
# Agent lifecycle only (opencode, claude, goose, openclaw)
pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider --grep @workspace-provider

# Sandbox matrix only
pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider \
  workspaces/workspace-filesystem-network-smoke.spec.ts

# UI category filters
pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider --grep @fs-home

pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider --grep @net-deny

# Combined (regex lookahead)
pnpm exec playwright test -c tests/playwright/playwright.config.ts \
  --project=Workspace-Provider --grep "(?=.*@fs-none)(?=.*@net-deny)"
```

### Per-spec npm scripts

| Script                                            | Spec                             |
| ------------------------------------------------- | -------------------------------- |
| `pnpm run test:e2e:workspaces:run`                | All `provider-specs/workspaces/` |
| `pnpm run test:e2e:workspaces:opencode`           | OpenCode agent                   |
| `pnpm run test:e2e:workspaces:claude`             | Claude agent                     |
| `pnpm run test:e2e:workspaces:goose`              | Goose agent                      |
| `pnpm run test:e2e:workspaces:openclaw`           | OpenClaw agent                   |
| `pnpm run test:e2e:workspaces:filesystem-network` | Sandbox matrix                   |

PDE2E variants (`test:e2e:pde2e:workspaces:*`) restore deferred API keys from `~/.pde2e-deferred-secrets`.

## Playwright Project Config

The `Workspace-Provider` project is defined in `tests/playwright/playwright.config.ts`. It matches `**/provider-specs/workspaces/*.spec.ts` and is gated by `PODMAN_ENABLED` and skips when `GITHUB_ACTIONS` is set (GitHub Actions runners). Workspace tests run locally or on Azure VMs via workspace-e2e workflow. If the gate is unmet, Playwright reports "No tests found."

## Skip Conditions

| Condition                                        | Message / behavior                                               |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Non-Linux without `PODMAN_ENABLED`               | Workspace tests require Podman                                   |
| Missing `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`   | Per-agent skip in lifecycle helper                               |
| `home` / `full` filesystem options               | Removed — OpenShell upload not suited for broad trees (#2539)    |
| `NETWORK_ACCESS_LEVEL.UNRESTRICTED` on OpenShell | Unrestricted disabled in create wizard when runtime is openshell |
| Goose + Ollama                                   | Skipped until issue #1780 fixed                                  |

## Adding a New Sandbox Scenario

1. Add a `SandboxScenario` entry in `workspace-filesystem-network-smoke.spec.ts`:
   - `id`: uppercase tag-aligned ID (e.g. `FS-NONE-NET-DENY`); describe title is derived in `helpers/workspace-sandbox-matrix.ts`
   - `workspaceSlug`: required readable kebab slug (e.g. `none-dev`, `cust-multi`); final name is `{agentPrefix}-{slug}` and must be ≤ 19 chars (OpenShell limit)
   - `fileAccess`, `network`, and optional `customMounts` / `denyHosts` / `additionalHosts`
   - Reuse mount presets from `helpers/workspace-sandbox-matrix.ts` (`CUSTOM_RW_MOUNT`, etc.) when applicable
2. Tags are auto-derived from `fileAccess` / `network` — modifier tags apply when mounts/hosts need them.
3. Use `host: ''` in `customMounts` to get a temp dir from the lifecycle helper; use `$SOURCES/...` hosts for sandbox-safe paths.
4. Set `skipReason` if the combo is known broken on OpenShell until upstream fixes land.
5. Workspace names are `{agentPrefix}-{workspaceSlug}` and must be ≤ 19 characters (OpenShell limit). `buildWorkspaceName` enforces this for matrix tests; hardcode short names in lifecycle smoke specs.
6. Run the single scenario: `--grep "FS-NONE-NET-DENY"`.

## Custom Mount Conventions

| Pattern                                      | Use                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `host: ''` + `target: '$SOURCES/e2e-custom'` | Temp host dir mapped to workspace-relative sandbox path              |
| `host: '$SOURCES/e2e-default'` (no target)   | Tests empty target → defaults to host; subdir created in working dir |
| Absolute temp host + empty target            | **Avoid** — OpenShell resolves remote to `/Users/...` and fails      |
