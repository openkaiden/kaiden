# Scenario Lifecycle Engine (Workspace + Session E2E)

`helpers/scenario-lifecycle-engine.ts` is the shared, domain-agnostic core
behind both workspace and ACP session lifecycle E2E tests. It exists so a
second reusable lifecycle (sessions) didn't require re-inventing what
`workspace-lifecycle-helper.ts` already solved for workspaces, and so a
future workspace/session merge in the core app only requires reconciling
two step libraries, not two independently-built test runners.

For running instructions, env vars, and troubleshooting, see
[workspace-provider-e2e.md](./workspace-provider-e2e.md) — session tests run
in the same `Workspace-Provider` Playwright project with the same
Podman/API-key gating.

## The engine

```ts
interface ScenarioStep<TCtx> {
  id: string; // full bracketed test ID, e.g. "ACP-CREATE-01" or "WKS-CLAUDE-03"
  title: string;
  run: (fixtures: ProviderTestFixtures, ctx: TCtx) => Promise<void>;
}

interface ScenarioLifecycleConfig<TCtx> {
  setup: (fixtures: ProviderWorkerFixtures) => Promise<TCtx>;
  teardown?: (ctx: TCtx, fixtures: ProviderWorkerFixtures) => Promise<void>;
  steps: ScenarioStep<TCtx>[];
}

function registerScenarioLifecycleTests<TCtx>(test, config: ScenarioLifecycleConfig<TCtx>): void;
```

`registerScenarioLifecycleTests` runs `setup` once (`beforeAll`), then one
`test()` per entry in `steps` in order, then `teardown` once (`afterAll`),
plus a shared `beforeEach(waitForNavigationReady)`. `ctx` is a plain mutable
object: steps can both read and write it (e.g. a session step records the
session's current display label so a later step can look it up).

**It does not open its own `describe` block.** Callers that need
serial/tagged grouping wrap their own `test.describe.serial(...)` — this
avoids double-nesting when a domain helper already wraps (session) versus
when the wrapping happens at the call site (workspace).

## How each domain uses it

**Workspace** (`workspace-lifecycle-helper.ts`): `registerWorkspaceLifecycleTests(test, expect, config)`
keeps its existing flag-based `WorkspaceLifecycleConfig` public API
unchanged — no call-site changes needed in the 5 `workspace-*-smoke.spec.ts`
files or `workspace-sandbox-matrix.ts`. Internally, it translates
`config.sandbox`/`config.noProjectFolder`/etc. into an ordered
`ScenarioStep<WorkspaceCtx>[]` and delegates to the engine. It does **not**
wrap in its own `describe.serial` — that stays the caller's job, exactly as
today.

**Session** (`session-lifecycle-helper.ts` + `session-steps.ts`):
`registerSessionLifecycleTests(test, config)` takes a `workspaceSetup`
(provision a new workspace, or `{ existingWorkspaceName }` to reuse one
already running — e.g. across a future scenario matrix) and a `steps` array
assembled from `session-steps.ts` factories. It wraps its own
`test.describe.serial`, then auto-prepends a provisioning step and
auto-appends a cleanup step around the caller's `steps` (mirroring how
workspace's create/remove steps are baked into its own helper rather than
supplied by the caller).

```ts
registerSessionLifecycleTests(test, {
  describeName: 'Agent session lifecycle on an OpenCode+Ollama sandbox',
  tags: ['@workspace-provider'],
  workspaceSetup: {
    workspaceName: 'acp-e2e-workspace',
    workingDir: '/tmp/acp-e2e-project',
    sandboxLabel: 'OpenCode+Ollama',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'ollama',
    selectModel: createPage => createPage.searchAndSelectByRuntime('ollama', 'Ollama'),
  },
  steps: [
    createSessionStep({ initialPrompt, timeout }),
    followUpSessionStep({ followUpPrompt, timeout }),
    attachFileSessionStep({ file, followUpPrompt, timeout }),
    stopSessionStep({ longRunningPrompt }),
    permissionApproveSessionStep({ prompt, timeout }),
    permissionDenySessionStep({ prompt, timeout }),
    renameSessionStep({ newLabel }),
    searchFilterSessionStep(),
    staleSandboxSessionStep(),
    deleteSessionStep(),
  ],
});
```

## Adding a new session step

1. Write a factory in `session-steps.ts` returning `ScenarioStep<SessionCtx>`
   — give it a fixed `id`/`title` and a `run(fixtures, ctx)` that reads/writes
   `ctx.sessionLabel` / `ctx.workspaceName` as needed. Take only the values
   that step actually varies by as `config` parameters (mirroring the
   existing factories) — don't thread the whole `SessionCtx` through configs.
2. Reference it in the `steps` array of whichever spec(s) need it, in the
   position it should run.
3. No flag to add anywhere, no branch in the engine or in
   `session-lifecycle-helper.ts` — the step list itself is the source of
   truth for what a given session suite covers and in what order.

## Adding a new session spec (e.g. a different agent/provider)

Call `registerSessionLifecycleTests` again from a new `*.spec.ts` file with
a different `workspaceSetup` and its own `steps` array (reusing the same
`session-steps.ts` factories). For a full agent × scenario matrix (multiple
agents, multiple step-set variants), follow `workspace-sandbox-matrix.ts` as
the template: loop `agents × scenarios`, derive tags, and call
`registerSessionLifecycleTests` per cell — build this once a second concrete
session suite actually needs it, rather than speculatively ahead of time.
