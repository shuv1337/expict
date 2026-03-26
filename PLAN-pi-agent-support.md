# PLAN-pi-agent-support.md

## Goal

Add first-class **pi agent** support to Expect so users can run:

```bash
expect -a pi -m "..." -y
```

with the same core behavior they get today from Claude/Codex:

- agent selection in CLI/TUI/headless mode
- browser-driven execution against changed code
- step/event streaming in the TUI
- replay/video artifact capture
- init-time detection and docs
- telemetry/logging/error handling
- targeted automated test coverage for the new backend

## Success criteria

- [x] `pi` is a supported backend everywhere `claude` / `codex` are currently supported for execution.
- [x] `expect --help`, `apps/cli/README.md`, and init/setup output all mention pi correctly.
- [x] The browser execution flow works end-to-end with pi, including the existing browser tool contract (`open`, `playwright`, `screenshot`, `console_logs`, `network_requests`, `close`).
- [x] Streaming updates render correctly in both headless output and the TUI.
- [x] Replay/video artifact extraction still works.
- [x] Auth / missing-binary / unsupported-version failures produce actionable user-facing errors.
- [x] Existing Claude/Codex support continues to work.
- [x] All relevant tests pass, plus new pi-specific tests are added.

---

## Full project review relevant to pi support

### 1. Monorepo structure

**Workspace root**
- `package.json` — root scripts (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`)
- `pnpm-workspace.yaml` — apps + packages workspaces
- `turbo.json` — task graph and caching

**Apps**
- `apps/cli` — production CLI/TUI entrypoint
- `apps/website` — marketing/replay website, not directly involved in agent integration

**Packages**
- `packages/agent` — coding-agent backend abstraction and current Claude/Codex ACP adapters
- `packages/browser` — Playwright/browser runtime + MCP server + rrweb/video plumbing
- `packages/shared` — shared models, prompt builder, analytics, observability
- `packages/supervisor` — execution orchestration, git context gathering, reporting
- `packages/cookies` — browser profile/cookie extraction
- `packages/expect-skill` — skill docs for invoking Expect from other agents

### 2. Current runtime flow

#### CLI entrypoints
- `apps/cli/src/index.tsx`
  - Parses CLI args
  - Resolves test scope (`unstaged`, `branch`, `changes`)
  - Boots either interactive Ink UI or headless mode
  - Accepts `-a, --agent <provider>` but currently documents only `claude or codex`

#### Layer composition
- `apps/cli/src/layers.ts`
  - Composes `Executor`, `Reporter`, `Updates`, `FlowStorage`, analytics, tracing, git layer
  - Injects the agent layer through `Agent.layerFor(agent)`

#### Headless execution
- `apps/cli/src/utils/run-test.ts`
  - Calls `Executor.execute(...)`
  - Streams step events to stdout
  - Builds final `TestReport`
  - Emits analytics events and exits nonzero on failure

#### TUI execution
- `apps/cli/src/data/execution-atom.ts`
  - Runs `Executor.execute(...)`
  - Pushes live replay state
  - Parses the final `close` tool result for replay/video paths
  - Reports results and saves tested fingerprints

### 3. Agent abstraction today

#### Main abstraction
- `packages/agent/src/agent.ts`
  - `AgentBackend = "claude" | "codex"`
  - `Agent.stream(...)`
  - `Agent.createSession(cwd)`
  - Implementation is currently **ACP-specific** even though the service name is generic

#### Current backend implementation
- `packages/agent/src/acp-client.ts`
  - Spawns ACP subprocesses
  - Initializes ACP connection
  - Registers the browser MCP server
  - Streams ACP session updates
  - Maps auth/usage-limit/session/stream failures to ACP-branded error classes

#### Current agent detection
- `packages/agent/src/detect-agents.ts`
  - Detects `claude`, `codex`, `cursor` on PATH
  - This already exposes a mismatch:
    - detection includes `cursor`
    - `AgentBackend` does **not** include `cursor`
    - CLI/docs do **not** support cursor execution

### 4. Shared execution/update model today

- `packages/shared/src/models.ts`
  - Defines `AcpSessionUpdate` and all ACP-branded streaming message shapes
  - Defines `AgentProvider = "claude" | "codex" | "cursor"`
  - Defines `ExecutedTestPlan.addEvent(...)` which reduces agent stream updates into Expect UI/reporting events

**Important constraint:**
The whole downstream execution/rendering pipeline is coupled to **ACP-shaped updates**, even though only Claude/Codex currently use ACP.

### 5. Prompt and browser tool contract

#### Prompt builder
- `packages/shared/src/prompts.ts`
  - Builds the single large execution prompt used for direct browser testing
  - Assumes a browser MCP server named `browser`
  - Instructs the agent to use tools named:
    - `open`
    - `playwright`
    - `screenshot`
    - `console_logs`
    - `network_requests`
    - `close`

#### Browser implementation
- `packages/browser/src/mcp/server.ts`
  - Exposes those tools via MCP
- `packages/browser/src/mcp/start.ts`
  - Starts the MCP stdio server
- `packages/browser/src/browser.ts`
  - Handles Playwright launch/navigation/snapshots/annotations/cookies

### 6. Supervisor / reporting

#### Execution orchestration
- `packages/supervisor/src/executor.ts`
  - Collects changed files, recent commits, diff preview
  - Builds the execution prompt
  - Creates a synthetic `TestPlan`
  - Injects replay-related env vars into the agent tool environment
  - Streams agent updates into `ExecutedTestPlan`

#### Reporting
- `packages/supervisor/src/reporter.ts`
  - Builds the final `TestReport`
  - Extracts screenshot paths from tool result events

### 7. Observability / telemetry

- `packages/shared/src/analytics/analytics.ts`
  - Analytics provider abstraction + PostHog implementation
  - Attempts to identify the user by calling `claude auth status` first, then falls back to git config

**Important pi-related issue:**
This logic assumes Claude is the primary auth source. Pi support should not deepen that coupling.

### 8. Existing tests relevant to this work

#### Agent package
- `packages/agent/tests/agent.test.ts`
  - Live-ish integration tests for Claude/Codex layers
- `packages/agent/tests/detect-agents.test.ts`
  - Detection coverage

#### Shared/supervisor
- `packages/shared/tests/prompts.test.ts`
  - Prompt content assertions
- `packages/supervisor/tests/executor.test.ts`
  - Reducer/execution model coverage (currently more model-focused than backend-focused)

#### CLI
- `apps/cli/tests/init.test.ts`
  - Init flow / package-manager / supported agent behavior

---

## Why pi support is non-trivial

Pi is **not** another ACP backend.

The current Expect architecture assumes:

1. the agent runtime speaks ACP
2. browser tools are exposed through MCP
3. stream updates arrive in ACP session-update format

Pi, per upstream docs/research, offers two real integration surfaces:

- **RPC mode** — bidirectional JSONL over stdin/stdout
- **Node SDK** — `createAgentSession(...)` + direct event subscription

That means pi support is not just “add another adapter entry.” It requires one of:

- a pi-specific compatibility layer that translates pi events into Expect’s current internal update model, and
- a pi-specific browser tool bridge (because Expect’s current browser tool exposure is MCP-based, not pi-native)

---

## External research summary (pi-mono)

### Primary upstream sources

- Main repo: `https://github.com/badlogic/pi-mono`
- CLI/overview: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md`
- RPC docs: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md`
- SDK docs: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md`
- Extensions docs: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md`
- Settings docs: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md`
- Session docs: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md`

### Key facts that matter to Expect

- Pi has a stable documented **RPC** mode meant for orchestration.
- Pi also has a documented **Node SDK** that may be easier for in-process tool injection.
- Pi supports **custom tools/extensions**, which is the likely path for exposing Expect’s browser tool contract.
- Pi session/event types differ from ACP, so Expect must either:
  - translate them into the current update model, or
  - generalize its internal update schema.
- Pi can run without persistent sessions (`--no-session`) but still supports session control primitives.
- Pi auth/config is centered around `~/.pi/agent` and provider API keys / auth storage, not Claude-specific login semantics.

---

## Architecture decision

## Recommendation

Implement pi support behind a **dedicated pi backend client** with a **pi-native browser tool bridge**, while keeping the rest of the CLI/supervisor layers unchanged as much as possible.

### Decision gate: RPC vs SDK spike first

This phase is explicitly governed by `PLAN-pi-sdk-vs-rpc-evaluation.md`.
That plan is the prerequisite decision record for this document: complete it first, then come back here and update this plan's architecture decision, chosen implementation surface, file layout notes, packaging tasks, and risk sections based on the result.

Because both pi RPC and the pi SDK are viable, the first task should be a short spike that validates three things with real code:

- [x] session creation/resumption works the way Expect needs
- [x] the browser tool contract can be exposed cleanly
- [x] event streaming can be translated into Expect’s current reducer model without losing fidelity

### Chosen implementation surface

**Use the pi Node SDK as the primary integration surface.**

This decision is based on the completed evaluation documented in:
- `PLAN-pi-sdk-vs-rpc-evaluation.md`
- `.specs/pi-sdk-vs-rpc-findings.md`

Why SDK won for this repo:
- it supports direct in-process `customTools` registration for Expect-style browser tools
- it avoids an extra subprocess JSONL/protocol layer
- it fits Expect's Node/TypeScript architecture better
- it preserves the event fidelity needed for streaming UI/headless execution
- it is simpler to test and reason about than an RPC subprocess client

### Fallback if SDK proves insufficient during implementation

Use **pi RPC** only as a fallback path if full integration uncovers blockers around:

- packaging/bundling issues that were not visible in the spike
- missing SDK event details in the real browser-tool flow
- session semantics that diverge under full Expect orchestration

### Non-goal for this project

Do **not** attempt to force pi into ACP. That would add a brittle compatibility shim in the wrong direction.

---

## Implementation plan

## Phase 0 — Integration spike and backend contract freeze

### Objectives
- confirm the best pi surface (SDK vs RPC)
- freeze the minimum backend contract Expect actually needs

### Tasks
- [x] Prototype a scratch pi session in a throwaway branch or temporary file:
  - prompt once
  - stream text updates
  - create/resume a session
  - register or expose one fake tool
- [x] Verify how pi represents:
  - agent text chunks
  - thinking/reasoning chunks
  - tool-call start/progress/end
  - final completion / abort / failure
- [x] Verify whether Expect can preserve the current browser tool names exactly.
- [x] Verify the auth failure story (missing auth/config/API key) and record the raw failure shapes.
- [x] Freeze a written decision: **pi SDK** or **pi RPC**.

### Deliverable
- [x] Complete `PLAN-pi-sdk-vs-rpc-evaluation.md` and use its final recommendation as the source of truth.
- [x] Add a short architecture note to this plan (or a companion spec file) recording the chosen surface and rejected alternative.
- [x] Replace the provisional wording in this document (`chosen pi implementation surface (SDK or RPC)`) with the concrete choice.

---

## Phase 1 — Normalize provider/backend plumbing before adding pi

### Why this is needed
The current code already has provider drift:

- `packages/shared/src/models.ts` has `AgentProvider = "claude" | "codex" | "cursor"`
- `packages/agent/src/agent.ts` has `AgentBackend = "claude" | "codex"`
- `packages/agent/src/detect-agents.ts` detects `cursor`
- CLI docs mention only `claude or codex`

Adding pi on top of this without cleanup will make the model even more inconsistent.

### Tasks
- [x] Define a single source of truth for executable backends.
  - Primary candidates:
    - `packages/shared/src/models.ts`
    - or a new dedicated `packages/shared/src/agent-backends.ts`
- [x] Decide how to handle `cursor` during this cleanup:
  - either explicitly mark it unsupported in runtime/docs
  - or keep it out of the executable backend union until real support exists
- [x] Update these files to use the same source of truth:
  - `packages/shared/src/models.ts`
  - `packages/agent/src/agent.ts`
  - `packages/agent/src/detect-agents.ts`
  - `apps/cli/src/index.tsx`
  - `apps/cli/src/stores/use-preferences.ts`
  - `apps/cli/src/data/runtime.ts`
  - `apps/cli/src/data/execution-atom.ts`
  - `apps/cli/src/layers.ts`
  - `apps/cli/src/commands/init.ts`
- [x] Add `pi` display metadata wherever provider display names are defined.

### Acceptance criteria
- [x] There is one authoritative backend union.
- [x] CLI/runtime/help/init all agree on the supported backends.
- [x] Pi can be added without creating another type mismatch.

---

## Phase 2 — Add the pi backend implementation in `packages/agent`

### Recommended file layout
If we keep ACP for Claude/Codex, add pi in parallel instead of cramming it into ACP files:

- [x] `packages/agent/src/pi-client.ts` — pi SDK client built around `createAgentSession(...)`
- [x] `packages/agent/src/pi-event-mapper.ts` — pi event → internal update translation
- [ ] `packages/agent/src/pi-errors.ts` — pi-specific startup/auth/stream/session errors if needed
- [x] `packages/agent/src/pi-tools.ts` — pi-native browser tool registration/bridge

### Core tasks
- [x] Extend `AgentBackend` / equivalent union to include `pi`.
- [x] Add `Agent.layerPi`.
- [x] Update `Agent.layerFor(...)` to select pi.
- [x] Implement `createSession(cwd)` for pi.
- [x] Implement `stream(options)` for pi.
- [x] Ensure `sessionId` reuse works the same way existing callers expect.
- [x] Ensure cancellation/abort semantics are wired cleanly for pi.

### Error handling tasks
- [x] Add actionable user-facing failures for:
  - missing pi binary or missing runtime dependency
  - missing auth / missing provider key / invalid auth storage
  - unsupported pi version
  - session creation failure
  - stream failure / process crash
- [x] Keep the existing user experience quality bar set by `AcpProviderUnauthenticatedError`.
- [x] Decide whether to:
  - generalize ACP-branded error names now, or
  - keep them for MVP and schedule a follow-up rename

### Recommendation
For maintainability, prefer generalizing the error names now if the churn is manageable:

- `AcpProviderUnauthenticatedError` → `AgentProviderUnauthenticatedError`
- `AcpProviderUsageLimitError` → `AgentProviderUsageLimitError`
- `AcpSessionCreateError` → `AgentSessionCreateError`
- `AcpStreamError` → `AgentStreamError`

If this rename is too large for the first pass, keep it as a follow-up task but **do not** let pi-specific code live inside `acp-client.ts`.

---

## Phase 3 — Build a pi-native browser tool bridge

### Problem
Expect currently exposes browser capabilities through the MCP server started by:

- `packages/browser/src/mcp/server.ts`
- `packages/browser/src/mcp/start.ts`

Pi does not natively consume that ACP/MCP wiring path the way Claude/Codex do in this codebase.

### Goal
Expose the **same logical tool contract** to pi so the existing execution strategy still works:

- `open`
- `playwright`
- `screenshot`
- `console_logs`
- `network_requests`
- `close`

### Tasks
- [x] Design a pi tool bridge that calls the existing browser package logic rather than duplicating browser behavior.
- [x] Reuse the current artifact behavior from `close` so replay/video paths remain available.
- [x] Preserve existing snapshot/ref workflows used by the prompt (`ref()`, snapshot-first interaction, etc.).
- [x] Preserve cookie behavior (`requiresCookies`).
- [x] Ensure replay env vars still reach the browser runtime when pi is the backend.

### File targets
- `packages/browser/src/browser.ts`
- `packages/browser/src/mcp/server.ts` (read-only reference for behavior parity)
- new pi bridge file(s) in `packages/agent/src/` or a small shared location if that ends up cleaner

### Important design constraint
Do **not** fork the browser behavior into two subtly different implementations if it can be avoided. The browser runtime should stay the source of truth; only the agent-facing tool wrapper should differ.

---

## Phase 4 — Make the execution prompt backend-aware

### Problem
`packages/shared/src/prompts.ts` currently assumes a browser MCP server named `browser`.

That wording is correct for Claude/Codex in the current architecture, but it will be wrong or at least misleading for pi if pi gets native/custom browser tools.

### Tasks
- [x] Extend `ExecutionPromptOptions` so the prompt builder knows which backend/capability style is active.
- [x] Keep the tool **names** stable if possible.
- [x] Split the prompt wording into:
  - backend-agnostic browser testing instructions
  - backend-specific tool availability wording
- [x] Keep all existing execution policy guidance intact:
  - snapshot-first workflow
  - step markers
  - assertion depth
  - recovery policy
  - close-tool requirement before `RUN_COMPLETED`

### Acceptance criteria
- [x] Claude/Codex prompt output stays valid.
- [x] Pi prompt output accurately describes how pi will access browser tools.
- [x] Prompt tests are updated to cover pi wording.

---

## Phase 5 — Update supervisor execution plumbing only where necessary

### Goal
Keep `packages/supervisor/src/executor.ts` mostly backend-agnostic, but pass the minimum extra information needed for pi.

### Tasks
- [x] Decide whether `Executor.execute(...)` needs an explicit `agentBackend` parameter, or whether backend-aware prompt/tool behavior can stay inside the injected `Agent` layer.
- [x] If needed, thread backend information through:
  - `packages/supervisor/src/executor.ts`
  - `apps/cli/src/utils/run-test.ts`
  - `apps/cli/src/data/execution-atom.ts`
- [x] Keep replay/live-view env propagation working for pi.
- [x] Verify `createSession()` / multi-turn reuse still works if any future planner flow is restored.

### Important note
The commented-out planner in `packages/supervisor/src/planner.ts` is not required for shipping pi execution support. Do not expand scope into reviving planner support unless pi support uncovers a direct blocker.

---

## Phase 6 — Decide how much to generalize the update model

### Current state
Downstream UI/reducer/reporting code consumes `AcpSessionUpdate` from `packages/shared/src/models.ts`.

### Recommended MVP strategy
Translate pi events into the **existing internal update shape** first, so the rest of the app can stay stable.

### Tasks
- [x] Add a dedicated event-mapping layer from pi events to the current internal execution updates.
- [x] Cover the following mappings explicitly:
  - agent text
  - agent thinking/reasoning
  - tool-call start
  - tool-call progress/update
  - tool-call completion/failure
- [x] Validate that `ExecutedTestPlan.addEvent(...)` still behaves correctly with mapped pi events.

### Follow-up cleanup (recommended but not required to ship MVP)
- [ ] Rename `AcpSessionUpdate` and related ACP-branded classes to generic agent/update names.
- [x] Rename ACP-branded error types as noted above.

This cleanup is desirable, but it should not block a good MVP if the translation layer is clean and well-tested.

---

## Phase 7 — CLI, init, docs, and packaging updates

### CLI help and runtime
- [x] Update `apps/cli/src/index.tsx` help text to include pi.
- [x] Ensure `-a pi` is accepted everywhere agent parsing occurs.
- [x] Ensure defaults remain unchanged unless product explicitly wants pi as the default.

### Init/setup flow
- [x] Update `apps/cli/src/commands/init.ts`:
  - detect pi
  - mention pi in supported-agent messaging
  - add a pi install/auth URL if helpful
- [x] Make sure init messaging no longer implies support for backends that cannot actually execute.

### Docs
- [x] Update `apps/cli/README.md` usage text.
- [x] Update any relevant agent package docs:
  - `packages/agent/README.md`
- [ ] Decide whether `packages/expect-skill/SKILL.md` needs any pi-specific wording.

### Packaging / bundling
This depends on the chosen implementation surface.

#### If using pi SDK
- [x] Add the pi package dependency in the appropriate workspace package(s).
- [x] Update bundler config as needed:
  - `packages/agent/package.json`
  - `apps/cli/package.json`
  - `apps/cli/vite.config.ts`
  - `packages/agent/vite.config.ts`
- [x] Ensure the packaged CLI can load pi cleanly in production builds.

#### If using pi RPC + global binary
- [x] Add version/binary detection (`pi --version` / PATH lookup).
- [x] Decide whether Expect should hard-require a global `pi` install or document it as optional.

---

## Phase 8 — Telemetry and logging updates

### Why this matters
Per project rules, telemetry is part of the definition of done.

### Tasks
- [ ] Add structured logs for pi backend lifecycle events:
  - backend selected
  - pi session created
  - pi stream started/completed
  - pi auth/version failures
- [x] Include `agentBackend` or equivalent in relevant logs/analytics properties.
- [x] Update analytics user-identification logic in `packages/shared/src/analytics/analytics.ts` so it no longer treats Claude as the primary universal auth source.
  - safest default: prefer git config when available
  - optionally add backend-aware auth enrichment later
- [x] Ensure new failures are surfaced through the same logging/reporting pipeline as existing backends.

### Acceptance criteria
- [x] A pi run is distinguishable from Claude/Codex in logs and analytics.
- [ ] Missing pi auth/version/binary failures are diagnosable from logs.

---

## Phase 9 — Tests

### Unit and contract tests
- [x] Extend `packages/agent/tests/detect-agents.test.ts` to cover pi detection.
- [x] Add pi backend selection coverage around `Agent.layerFor(...)`.
- [x] Add event-mapper tests for pi → internal update translation.
- [x] Add prompt tests in `packages/shared/tests/prompts.test.ts` for backend-specific wording.
- [x] Add supervisor/execution tests proving the reducer/reporter still work with mapped pi events.

### Integration tests
- [x] Add at least one opt-in integration test for pi in `packages/agent/tests/`.
- [x] Gate it behind environment/binary checks if necessary so CI remains stable.
- [ ] Validate:
  - prompt streaming
  - cwd propagation
  - session resume
  - browser tool availability

### CLI tests
- [x] Update `apps/cli/tests/init.test.ts` for pi detection/messaging.
- [ ] Add any missing CLI parsing tests for `-a pi`.

### Recommended fixture strategy
- [x] Record representative pi event fixtures and use them in reducer tests.
- [x] Keep fixtures minimal and deterministic.

---

## Phase 10 — Manual validation matrix

### Basic validation
- [ ] `expect --help` shows pi.
- [ ] `expect init` detects pi correctly.
- [ ] Headless run works:
  ```bash
  expect -a pi -m "smoke test the changed flow" -y
  ```
- [ ] Interactive TUI can execute a run with pi selected.

### Browser behavior validation
- [ ] `open` works
- [ ] `screenshot` snapshot mode works
- [ ] `playwright` actions work with `ref()` flow
- [ ] console/network tools work
- [ ] `close` flushes replay/video artifacts

### Failure validation
- [ ] missing pi binary
- [ ] unauthenticated pi config
- [ ] unsupported pi version
- [ ] browser tool failure
- [ ] agent abort/cancel

### Regression validation
- [ ] Claude still works
- [ ] Codex still works
- [ ] Existing replay/report output still works

---

## Risks and mitigation

### Risk 1 — Tool bridge drift
If pi gets a separate browser-tool implementation that diverges from MCP behavior, Expect will behave differently by backend.

**Mitigation**
- [ ] Keep browser runtime logic shared.
- [ ] Restrict backend-specific code to the tool wrapper layer.

### Risk 2 — ACP naming debt spreads further
If pi code is shoved into ACP-branded files/classes, the architecture will become harder to maintain.

**Mitigation**
- [ ] Put pi in its own backend files.
- [ ] Add a clean translation layer.
- [ ] Schedule or perform the generic rename cleanup.

### Risk 3 — Auth/version UX is poor
Pi failures may be harder for users to interpret than current Claude failures.

**Mitigation**
- [ ] Add explicit binary/version/auth checks where possible.
- [ ] Preserve actionable, provider-specific error messages.

### Risk 4 — Existing cursor mismatch gets worse
Pi could become “detected but not actually executable,” repeating the cursor situation.

**Mitigation**
- [ ] Fix provider/backend source-of-truth issues before or during pi rollout.

### Risk 5 — Packaging complexity
If the SDK path adds heavy dependencies or bundling quirks, release stability may suffer.

**Mitigation**
- [ ] Use the Phase 0 spike to validate packaging early.
- [ ] Fall back to RPC if SDK packaging is painful.

---

## Recommended implementation order

### Milestone 1 — Decision + plumbing cleanup
- [x] Complete Phase 0 spike
- [x] Normalize backend/provider source of truth
- [x] Decide SDK vs RPC

### Milestone 2 — Backend MVP
- [x] Implement pi backend in `packages/agent`
- [x] Implement pi browser tool bridge
- [x] Wire pi into `Agent.layerFor(...)`

### Milestone 3 — Prompt/CLI/docs
- [x] Make prompt builder backend-aware
- [x] Update CLI parsing/help/init/docs
- [x] Add logging/analytics support

### Milestone 4 — Validation
- [x] Add tests
- [ ] Run manual validation matrix
- [ ] Run full repo verification

---

## Verification commands before merge

Run the project-standard checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Recommended targeted smoke checks during implementation:

```bash
pnpm --filter @expect/agent test
pnpm --filter @expect/shared test
pnpm --filter @expect/supervisor test
pnpm --filter expect-cli test
```

---

## Files most likely to change

### Definitely or very likely
- `packages/agent/src/agent.ts`
- `packages/agent/src/index.ts`
- `packages/agent/src/detect-agents.ts`
- `packages/shared/src/models.ts`
- `packages/shared/src/prompts.ts`
- `packages/supervisor/src/executor.ts`
- `apps/cli/src/index.tsx`
- `apps/cli/src/layers.ts`
- `apps/cli/src/commands/init.ts`
- `apps/cli/src/utils/run-test.ts`
- `apps/cli/src/data/execution-atom.ts`
- `apps/cli/README.md`
- `packages/shared/src/analytics/analytics.ts`

### New files likely
- `packages/agent/src/pi-client.ts`
- `packages/agent/src/pi-event-mapper.ts`
- `packages/agent/src/pi-errors.ts` (optional but recommended)
- `packages/agent/src/pi-tools.ts` or equivalent bridge file
- new tests/fixtures under `packages/agent/tests/`

### Potential packaging/config files (SDK-first path)
- `packages/agent/package.json`
- `apps/cli/package.json`
- `apps/cli/vite.config.ts`
- `packages/agent/vite.config.ts`

---

## Out of scope unless required by the implementation

- restoring the commented-out planner flow in `packages/supervisor/src/planner.ts`
- implementing true Cursor runtime support
- redesigning the full TUI state model
- broad refactors unrelated to agent/backend integration

---

## Final recommendation

Ship pi support as a **first-class backend**, but do it in a way that avoids hard-wiring another non-ACP agent into ACP-only internals.

The cleanest path is:

1. **run a short SDK vs RPC spike**
2. **normalize backend/provider plumbing**
3. **implement pi in dedicated files with a thin translation layer**
4. **expose Expect’s existing browser tool contract to pi**
5. **update prompt wording, init/docs, and telemetry**
6. **validate thoroughly without regressing Claude/Codex**

If the spike succeeds with the SDK, prefer the SDK. If not, use RPC. In both cases, keep the browser/runtime contract stable and keep pi-specific concerns out of `acp-client.ts`.
