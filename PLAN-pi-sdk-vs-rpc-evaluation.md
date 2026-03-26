# PLAN-pi-sdk-vs-rpc-evaluation.md

## Goal

Decide **before full pi support implementation** whether Expect should integrate with pi via:

- **Pi SDK** (`createAgentSession(...)` in-process), or
- **Pi RPC** (`pi --mode rpc` over JSONL stdin/stdout)

This plan is for a **short, high-signal evaluation spike** whose only output is a justified architectural decision and a recommended implementation path.

> This is not the full pi integration plan.
> It is a focused decision plan to compare the two integration surfaces against Expect’s actual architecture and constraints.
> It is a prerequisite companion to `PLAN-pi-agent-support.md`, and its outcome must be used to update that plan before full implementation begins.

---

## Decision to make

Choose exactly one of:

- [x] **SDK-first implementation**
- [ ] **RPC-first implementation**

The decision must be based on a small proof-of-concept in this repo, not only documentation review.

---

## Why we need this plan

Expect’s current integration model is shaped by:

- `packages/agent/src/agent.ts` — generic agent service, currently backed by ACP-only implementations
- `packages/agent/src/acp-client.ts` — current subprocess/session/event integration pattern
- `packages/shared/src/models.ts` — current execution UI/reducer model built around ACP-shaped updates
- `packages/browser/src/mcp/server.ts` — existing browser tool contract and implementation
- `packages/supervisor/src/executor.ts` — direct execution orchestration
- `apps/cli/src/data/execution-atom.ts` — live streaming, replay, and artifact extraction

Pi can fit this architecture in more than one way, but the wrong choice could create unnecessary complexity in:

- event translation
- browser tool bridging
- session lifecycle
- packaging/release behavior
- testability
- runtime robustness

We want to make that call early and intentionally.

---

## Primary evaluation question

Which pi surface gives Expect the **lowest-risk, cleanest, most maintainable integration** while preserving:

- streamed updates for the TUI/headless flows
- session creation/resumption
- existing browser tool semantics
- replay/video artifact capture
- actionable auth/version failure handling
- minimal churn to the rest of the codebase

---

## Success criteria for this evaluation

At the end of the spike, we should have:

- [x] a working **SDK proof-of-concept** against Expect’s architecture
- [x] a working **RPC proof-of-concept** against Expect’s architecture
- [x] a side-by-side comparison using the same test script / scenario
- [x] a written recommendation with evidence
- [x] a clear list of follow-on work for the chosen option
- [x] a clear list of risks/downsides for the rejected option
- [x] an explicit update back into `PLAN-pi-agent-support.md` reflecting the chosen surface and any changes to sequencing, files, packaging, or risks

---

## Timebox

Target: **1–2 focused implementation sessions**

Recommended budget:
- **Half day** for SDK spike
- **Half day** for RPC spike
- **1–2 hours** for comparison write-up and recommendation

If one option clearly fails critical requirements early, stop deepening it and document the failure.

---

## Decision rubric

Score both options against the same criteria.

### 1. Browser tool integration quality
Can we expose Expect’s existing browser contract cleanly?

Required tools:
- `open`
- `playwright`
- `screenshot`
- `console_logs`
- `network_requests`
- `close`

Questions:
- Can we preserve these names exactly?
- Can we reuse existing browser/runtime logic rather than duplicating it?
- Can we preserve replay/video behavior from `close`?
- Can we pass replay env/config through cleanly?

### 2. Event streaming compatibility
Can we map pi’s event stream into Expect’s execution/update model with low friction?

Questions:
- Do we get clean text/thinking/tool lifecycle events?
- Can we model progress updates reliably?
- Can we translate into `ExecutedTestPlan.addEvent(...)` expectations without hacks?
- Is the event API stable/documented enough for maintenance?

### 3. Session lifecycle fit
Can we support the lifecycle Expect needs?

Questions:
- Can we create an isolated session per run?
- Can we resume by session ID if needed?
- Can we abort/cancel a run cleanly?
- Can we keep sessions ephemeral for test runs?

### 4. Error handling / operability
Can we produce actionable user-facing failures?

Questions:
- Can we reliably detect missing binary / missing package / bad auth / unsupported version?
- Are failures structured enough to classify?
- Is startup behavior deterministic enough for CI and local use?

### 5. Packaging / release complexity
How hard is it to ship this in Expect’s CLI build?

Questions:
- Does this require a heavy dependency surface?
- Will Vite/packaging need special treatment?
- Are there ESM/CJS or runtime-resolution problems?
- Are global-install assumptions acceptable?

### 6. Architectural cleanliness
How well does the option fit the current repo?

Questions:
- Can pi-specific code live outside ACP files?
- Does the integration introduce a clean backend abstraction?
- Does it avoid coupling browser runtime to one transport?
- Does it keep follow-on implementation understandable?

### 7. Testability
Can we test the integration well?

Questions:
- Can we record/fixture events deterministically?
- Can we unit-test the event mapper and tool bridge?
- Can we add an opt-in live integration test?

### 8. Operational robustness
Questions:
- Does it behave predictably under cancellation?
- Does it tolerate tool concurrency well?
- Does it create fewer moving parts at runtime?
- Is it likely to be less fragile across pi upgrades?

---

## Hard blockers

If either option fails any of these, it should be rejected unless there is a very strong compensating reason.

- [ ] Cannot expose the browser tool contract cleanly
- [ ] Cannot provide streaming updates sufficient for Expect UI/headless output
- [ ] Cannot support isolated per-run sessions cleanly
- [ ] Requires unacceptable duplication of browser behavior
- [ ] Has packaging/runtime complexity that materially threatens reliability

---

## Evaluation methodology

Use one identical acceptance script for both options.

### Canonical spike scenario
Run a tiny prototype that does all of the following:

- [ ] initialize a pi session bound to `process.cwd()`
- [ ] send a prompt requesting a tiny browser task
- [ ] expose at least one fake tool first, then the real browser tool contract if feasible
- [ ] stream text updates
- [ ] stream tool call lifecycle updates
- [ ] complete the run cleanly
- [ ] capture final session/output state
- [ ] try session reuse once
- [ ] try cancellation once

### Preferred canonical prompt
Use a very small but realistic prompt such as:

```text
Open the app, take a snapshot, report the current URL and page title, then close the browser.
```

This is enough to validate:
- tool registration
- tool invocation
- streaming
- finalization
- artifact flushing on `close`

---

## Phase 1 — Define the minimum backend contract Expect needs

Before spiking either option, document the exact contract the rest of Expect requires from a backend.

### Tasks
- [ ] Write down the minimum generic agent backend shape implied by current code:
  - stream updates
  - create session
  - optional resume via session ID
  - abort/cancel
  - pass cwd
  - pass env/config for replay/live view
- [ ] Identify which parts of the current shape are ACP-specific and which are truly generic.
- [ ] List the exact update types downstream consumers rely on in:
  - `packages/shared/src/models.ts`
  - `packages/supervisor/src/executor.ts`
  - `apps/cli/src/data/execution-atom.ts`
  - `apps/cli/src/utils/run-test.ts`
- [ ] Define a tiny internal adapter target for the spike, e.g.:
  - `text`
  - `thinking`
  - `tool_start`
  - `tool_progress`
  - `tool_end`
  - `run_end`

### Deliverable
- [ ] Short internal note in this plan or a companion markdown section: “minimum backend contract”.

---

## Phase 2 — SDK spike

## Objective
Validate whether the pi SDK can serve as the primary integration surface.

### Relevant upstream source
- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md`

### Implementation approach
Build a small prototype in a disposable location or spike file that:

- [ ] creates an in-memory or isolated pi session with `createAgentSession(...)`
- [ ] subscribes to session events
- [ ] sends a prompt
- [ ] registers a minimal fake tool first
- [ ] then attempts to register or bridge the real browser tool contract
- [ ] logs the raw event shapes
- [ ] maps those event shapes into a tiny normalized stream

### Specific questions to answer
- [ ] Is tool registration ergonomic enough for Expect’s browser tool set?
- [ ] Can the SDK carry the browser runtime and replay plumbing in-process cleanly?
- [ ] Are session events rich enough to model tool lifecycle and streaming updates?
- [ ] Is cancellation/abort easy to implement?
- [ ] Can we isolate pi session/config state from the user environment when needed?
- [ ] Does the SDK pull in packaging/runtime concerns that are awkward for `expect-cli`?

### Recommended spike artifacts
- [ ] A scratch adapter function, e.g. `createPiSdkSpikeSession(...)`
- [ ] Raw event transcript saved to a temp file
- [ ] Tiny normalized event transcript for comparison against RPC

### Record these observations explicitly
- [ ] lines of glue code needed
- [ ] number of concept mismatches with Expect architecture
- [ ] any bundling/import issues
- [ ] any awkwardness around custom tools or resource loading
- [ ] any auth/bootstrap surprises

---

## Phase 3 — RPC spike

## Objective
Validate whether pi RPC can serve as the primary integration surface.

### Relevant upstream source
- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md`

### Implementation approach
Build a small prototype that:

- [ ] launches `pi --mode rpc` in an isolated way
- [ ] implements correct LF-only JSONL framing
- [ ] sends prompt/session commands
- [ ] receives and logs streamed events
- [ ] exercises one fake tool path first if needed
- [ ] then attempts the real browser flow through the best available mechanism
- [ ] records raw event shapes
- [ ] maps them into the same normalized event stream used in the SDK spike

### Specific questions to answer
- [ ] Is command/response + async event handling straightforward enough?
- [ ] Is the framing/protocol complexity acceptable long-term?
- [ ] Can we handle abort/session management cleanly?
- [ ] Can we bridge browser tools without ugly extension-management complexity?
- [ ] Do we need to manage `--no-extensions`, temp config dirs, or version checks specially?
- [ ] Is this simpler or more fragile than the SDK path in practice?

### Recommended spike artifacts
- [ ] A scratch RPC client helper
- [ ] Raw stdout JSONL transcript saved to a temp file
- [ ] Tiny normalized event transcript for side-by-side comparison

### Record these observations explicitly
- [ ] framing complexity
- [ ] subprocess lifecycle complexity
- [ ] extension/tool registration complexity
- [ ] error classification quality
- [ ] any blocking/interactive hazards

---

## Phase 4 — Browser tool bridge comparison

This phase is the most important practical comparison for Expect.

### Goal
Determine which option gives the cleaner path for exposing Expect’s browser semantics.

### Tasks
For both SDK and RPC, answer the same questions:

- [ ] Can we expose `open`, `playwright`, `screenshot`, `console_logs`, `network_requests`, `close` with the same semantics?
- [ ] Can we reuse logic from:
  - `packages/browser/src/browser.ts`
  - `packages/browser/src/mcp/server.ts`
- [ ] Do we need a second implementation of browser behavior, or only a wrapper?
- [ ] Can `close` still return replay/video paths in a way the rest of Expect can consume?
- [ ] Can snapshot/ref workflows remain intact?

### Output
- [ ] Write a short browser-bridge comparison table in the decision note.

---

## Phase 5 — Event model comparison

### Goal
Determine which option produces the cleaner translation into Expect’s current execution pipeline.

### Tasks
For both SDK and RPC:
- [ ] capture one representative run transcript
- [ ] map the transcript into a tiny normalized event model
- [ ] compare how easy it would be to translate into the current reducer model used by `ExecutedTestPlan.addEvent(...)`
- [ ] identify any missing data needed for:
  - text streaming
  - thinking streaming
  - tool start/progress/end
  - completion/failure

### Questions
- [ ] Which option yields fewer adapter assumptions?
- [ ] Which option is more likely to survive pi upgrades without constant fixes?
- [ ] Which option makes it easier to generalize away from ACP naming later?

---

## Phase 6 — Packaging and release spike

### Goal
Find out early whether one option is significantly harder to ship.

### Tasks
#### SDK
- [ ] Add the dependency in a temporary branch if needed.
- [ ] Verify import/runtime behavior under this repo’s packaging setup.
- [ ] Note whether `apps/cli/vite.config.ts` and/or `packages/agent/vite.config.ts` need special treatment.

#### RPC
- [ ] Verify assumptions about a global/local `pi` binary.
- [ ] Verify version detection strategy.
- [ ] Verify whether this can be documented/validated cleanly in `expect init`.

### Output
- [ ] Packaging risk note for each option.

---

## Phase 7 — Write the recommendation

At the end of the spike, produce a short decision record.

### Required structure

#### 1. Recommendation
Choose one:
- [ ] SDK
- [ ] RPC

#### 2. Why
Summarize the top 3–5 reasons the chosen option fits Expect better.

#### 3. Why not the other option
Summarize the main reasons the rejected option is weaker for this repo.

#### 4. Impact on the full implementation plan
State what changes in `PLAN-pi-agent-support.md` based on the decision.
Be explicit about:
- the chosen implementation surface references to update
- any phase resequencing
- any packaging/task changes
- any browser-bridge changes
- any risk section changes

#### 5. Follow-on work
List the first concrete implementation tasks unlocked by the decision.

---

## Suggested scoring table

Use a 1–5 score for each category.

| Category | SDK | RPC | Notes |
|---|---:|---:|---|
| Browser tool bridge |  |  |  |
| Event streaming fit |  |  |  |
| Session lifecycle fit |  |  |  |
| Error handling |  |  |  |
| Packaging complexity |  |  |  |
| Architectural cleanliness |  |  |  |
| Testability |  |  |  |
| Operational robustness |  |  |  |
| **Total** |  |  |  |

A score difference of **3+ points** should generally decide the outcome unless there is a strategic concern not captured by the table.

---

## Files likely involved in the spike

### Reference files to read closely
- `packages/agent/src/agent.ts`
- `packages/agent/src/acp-client.ts`
- `packages/agent/src/types.ts`
- `packages/shared/src/models.ts`
- `packages/shared/src/prompts.ts`
- `packages/supervisor/src/executor.ts`
- `apps/cli/src/data/execution-atom.ts`
- `apps/cli/src/utils/run-test.ts`
- `packages/browser/src/browser.ts`
- `packages/browser/src/mcp/server.ts`

### Temporary spike files likely
- `packages/agent/src/pi-sdk-spike.ts` or temporary scratch equivalent
- `packages/agent/src/pi-rpc-spike.ts` or temporary scratch equivalent
- optional transcript artifacts under a temp or ignored path

> These spike files should be removed or turned into real implementation files only after the decision is made.

---

## Guardrails

- [ ] Do not start full pi integration during this spike.
- [ ] Do not rewrite the agent abstraction broadly before the decision is made.
- [ ] Do not entangle pi code into `acp-client.ts` during evaluation.
- [ ] Keep the spike focused on evidence gathering.
- [ ] Prefer disposable or clearly-marked spike code.

---

## Validation checklist for each option

Use this exact checklist for **both** SDK and RPC.

- [ ] Prompt can be sent successfully
- [ ] Text updates stream successfully
- [ ] Tool lifecycle is observable
- [ ] Session can be created
- [ ] Session can be resumed or equivalent state can be reused
- [ ] Run can be aborted/cancelled
- [ ] Browser tool bridge is feasible
- [ ] `close` can flush artifacts or equivalent finalization data
- [ ] Failures are intelligible
- [ ] Local packaging/runtime story is acceptable

---

## Final recommendation

**Decision: choose the Pi SDK as the primary integration surface for Expect.**

Supporting evidence is recorded in:
- `.specs/pi-sdk-vs-rpc-findings.md`
- `.tmp/pi-eval/sdk-result.json`
- `.tmp/pi-eval/sdk-browser-result.json`
- `.tmp/pi-eval/rpc-result.json`
- `.tmp/pi-eval/rpc-browser-result.json`

Why SDK won:
- direct `customTools` registration cleanly supports Expect-style browser tool names
- event streaming and session APIs match Expect's needs without a transport layer
- fewer moving parts than a subprocess RPC client
- better fit for a Node/TypeScript monorepo
- simpler path for implementation and testing

RPC remains a viable fallback, but not the preferred path.

## Final recommendation target

Based on current architecture, the likely winner will be the option that best satisfies this hierarchy:

1. **clean browser tool bridge**
2. **clean event translation**
3. **manageable packaging/runtime complexity**
4. **good session/cancellation semantics**
5. **testability and long-term maintainability**

If the SDK provides a clean in-process browser tool bridge and event stream with acceptable packaging complexity, it should likely win.

If the SDK creates awkward packaging/resource-loading/tool-registration issues, and RPC provides cleaner separation with acceptable protocol complexity, RPC should win.

This plan exists to verify that with code, not intuition.
