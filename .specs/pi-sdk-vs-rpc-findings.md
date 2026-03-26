# Pi SDK vs RPC Evaluation Findings

Date: 2026-03-25
Project: `/home/shuv/repos/expict`

## Recommendation

Choose **Pi SDK** as the primary integration surface for Expect.

RPC is viable, but the SDK is the better fit for this codebase.

## Why SDK wins

1. **Cleaner browser tool integration**
   - SDK supports `customTools` directly in `createAgentSession(...)`.
   - I validated direct registration of Expect-style tool names: `open`, `screenshot`, `close`.
   - This matches Expect's likely implementation path better than spawning a separate RPC subprocess plus extension bootstrap.

2. **No JSONL/process protocol layer**
   - RPC requires strict LF-only framing, command/response bookkeeping, subprocess lifecycle, and abort coordination.
   - SDK avoids that entire layer and gives direct event subscription.

3. **Better fit for Expect's internal architecture**
   - Expect is already a Node/TypeScript monorepo.
   - SDK gives direct access to session state, events, custom tools, session management, and settings managers in-process.

4. **Equivalent event fidelity for the use cases we tested**
   - Both SDK and RPC exposed the lifecycle we need:
     - text streaming
     - tool execution start/end
     - session creation/new-session semantics
     - steering
     - abort
   - SDK exposed the same event family without needing a transport adapter layer first.

5. **Lower implementation complexity**
   - RPC can work, but only after solving:
     - subprocess management
     - protocol framing
     - extension file injection or equivalent dynamic tool strategy
     - more complex shutdown/error behavior

## What I tested

### SDK spike
Script:
- `scripts/pi-sdk-eval.mjs`

Observed:
- prompt worked
- text streaming worked
- custom tool registration worked
- session IDs changed correctly after `newSession()`
- `steer()` worked during streaming
- tool lifecycle events fired

Result summary:
```json
{
  "option": "sdk",
  "sessionChangedAfterNewSession": true,
  "textContainsDone": true,
  "textContainsSteered": true,
  "toolStarts": 2,
  "toolUpdates": 0,
  "toolEnds": 2,
  "agentEnds": 3,
  "steerResult": "completed"
}
```

### SDK browser-tool spike
Script:
- `scripts/pi-sdk-browser-tool-eval.mjs`

Observed:
- Expect-style browser tool names can be registered directly as custom tools
- agent called `open`, `screenshot`, and `close`
- partial tool update worked for `screenshot`

Result summary:
```json
{
  "option": "sdk-browser-tools",
  "textContainsBrowserOk": true,
  "toolStarts": 3,
  "toolUpdates": 1,
  "toolEnds": 3,
  "toolNamesCalled": ["open", "screenshot", "close"]
}
```

### RPC spike
Script:
- `scripts/pi-rpc-eval.mjs`

Observed:
- command/response flow worked
- text streaming worked
- `new_session` changed session IDs correctly
- `steer` worked
- no tools were exercised in the base RPC spike

Result summary:
```json
{
  "option": "rpc",
  "textContainsDone": true,
  "textContainsSteered": true,
  "toolStarts": 0,
  "toolUpdates": 0,
  "toolEnds": 0,
  "agentEnds": 3,
  "sessionChangedAfterNewSession": true
}
```

### RPC browser-tool spike
Scripts:
- `scripts/pi-rpc-browser-extension.ts`
- `scripts/pi-rpc-browser-eval.mjs`

Observed:
- RPC browser-tool integration is feasible
- but it required extension-file injection into the subprocess
- agent called `open`, `screenshot`, and `close`
- partial tool update worked

Result summary:
```json
{
  "option": "rpc-browser-tools",
  "textContainsBrowserOk": true,
  "toolStarts": 3,
  "toolUpdates": 1,
  "toolEnds": 3,
  "toolNamesCalled": ["open", "screenshot", "close"]
}
```

## Comparative assessment

| Category | SDK | RPC | Notes |
|---|---:|---:|---|
| Browser tool bridge | 5 | 4 | Both work; SDK is more direct via `customTools` |
| Event streaming fit | 5 | 4 | Both work; SDK avoids transport bookkeeping |
| Session lifecycle fit | 5 | 4 | Both work; SDK is simpler in-process |
| Error handling | 4 | 3 | RPC adds subprocess/protocol failure modes |
| Packaging complexity | 4 | 3 | SDK adds dependency work; RPC adds binary/process assumptions |
| Architectural cleanliness | 5 | 3 | SDK fits Node monorepo better |
| Testability | 5 | 4 | SDK easier to unit/integration test in-process |
| Operational robustness | 4 | 3 | RPC is more moving parts |
| **Total** | **37** | **28** | |

## Why not RPC

RPC is acceptable as a fallback, but weaker because it introduces extra complexity that Expect does not need if SDK works:

- strict JSONL framing requirements
- subprocess lifecycle management
- transport bookkeeping
- extension loading/injection as part of runtime startup
- more surface area for hangs and integration bugs

## Implications for the full implementation plan

`PLAN-pi-agent-support.md` should now be updated to treat **SDK as the chosen surface**.

That means:
- prefer `packages/agent/src/pi-client.ts` around `createAgentSession(...)`
- prefer direct `customTools` / SDK-side browser tool registration
- treat RPC as fallback only, not primary plan
- update packaging tasks to include the pi SDK package dependency path
- reduce emphasis on subprocess protocol concerns in the main plan

## Evidence artifacts

Generated during evaluation:
- `.tmp/pi-eval/sdk-result.json`
- `.tmp/pi-eval/sdk-transcript.json`
- `.tmp/pi-eval/sdk-browser-result.json`
- `.tmp/pi-eval/sdk-browser-transcript.json`
- `.tmp/pi-eval/rpc-result.json`
- `.tmp/pi-eval/rpc-transcript.json`
- `.tmp/pi-eval/rpc-browser-result.json`
- `.tmp/pi-eval/rpc-browser-transcript.json`

Spike scripts used:
- `scripts/pi-sdk-eval.mjs`
- `scripts/pi-sdk-browser-tool-eval.mjs`
- `scripts/pi-rpc-eval.mjs`
- `scripts/pi-rpc-browser-eval.mjs`
- `scripts/pi-rpc-browser-extension.ts`
