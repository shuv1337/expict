# Research: Pi Coding Agent — Integration Brief for Expect

> Source: [badlogic/pi-mono](https://github.com/badlogic/pi-mono) · Researched 2026-03-25

---

## Summary

Pi is a minimal, aggressively extensible terminal coding agent published as
`@mariozechner/pi-coding-agent`. It runs in four modes — interactive TUI, print
(one-shot), JSON event stream, and **RPC (stdin/stdout JSONL)** — and exposes a
first-class **Node.js SDK** (`createAgentSession`). For Expect, the two cleanest
integration paths are the **RPC subprocess** (language-agnostic, process-isolated)
and the **SDK** (same Node.js runtime, full type safety, no subprocess overhead).
Both surfaces are stable, well-documented, and explicitly designed for third-party
orchestrators.

---

## Findings

### 1. Monorepo package map

Pi is one package inside a seven-package monorepo:

| npm package | Role |
|---|---|
| `@mariozechner/pi-ai` | Unified multi-provider LLM API (OpenAI, Anthropic, Google, 20+ total) |
| `@mariozechner/pi-agent-core` | Stateful `Agent` class, event streaming, tool execution loop |
| `@mariozechner/pi-coding-agent` | Interactive CLI/TUI **and** the SDK/RPC surface |
| `@mariozechner/pi-mom` | Slack bot delegate |
| `@mariozechner/pi-tui` | Differential terminal renderer |
| `@mariozechner/pi-web-ui` | Web chat components |
| `@mariozechner/pi-pods` | vLLM GPU-pod management |

For Expect, only `@mariozechner/pi-coding-agent` and `@mariozechner/pi-agent-core`
matter.  
[Source: pi-mono README](https://github.com/badlogic/pi-mono)

---

### 2. CLI modes — what Expect can invoke

Pi exposes four distinct run modes via `pi [options] [@files...] [messages...]`:

| Mode | Flag | Description |
|---|---|---|
| Interactive TUI | (default) | Full terminal UI, human-facing |
| Print | `-p` / `--print` | One-shot: send prompt, print response, exit |
| JSON stream | `--mode json` | All events as JSONL to stdout, no stdin |
| **RPC** | `--mode rpc` | Bidirectional JSONL over stdin/stdout |
| Export | `--export <in> [out]` | Render a session file to HTML |

Print mode also accepts piped stdin: `cat diff.txt | pi -p "Write tests for this"`.

Relevant flags for Expect's use:

```bash
pi --mode rpc \
   --no-session \          # ephemeral — no JSONL history written
   --provider anthropic \
   --model claude-sonnet-4-20250514 \
   --tools read,bash,edit,write \
   --append-system-prompt "$(cat expect-context.md)" \
   --no-extensions         # disable user's global extensions for clean env
```

[Source: CLI Reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#cli-reference)

---

### 3. RPC protocol — the primary integration surface

Started with `pi --mode rpc`. Communication is **strict LF-delimited JSONL** on
stdin/stdout. Every command can carry an optional `id` for request/response
correlation.

**⚠️ Critical framing constraint:** Split records on `\n` only. Node's `readline`
module is non-compliant because it also splits on Unicode paragraph/line
separators (`U+2028`, `U+2029`) that can appear inside JSON strings. Use manual
buffer splitting.

#### Command → Response round-trip

```jsonc
// stdin →
{ "id": "r1", "type": "prompt", "message": "Run the test suite" }

// stdout ← (immediate)
{ "id": "r1", "type": "response", "command": "prompt", "success": true }

// stdout ← (async event stream)
{ "type": "agent_start" }
{ "type": "turn_start" }
{ "type": "message_start",  "message": { "role": "assistant", ... } }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "Running..." } }
{ "type": "tool_execution_start", "toolCallId": "c1", "toolName": "bash", "args": { "command": "pnpm test" } }
{ "type": "tool_execution_end",   "toolCallId": "c1", "result": { ... }, "isError": false }
{ "type": "turn_end",   "message": {...}, "toolResults": [...] }
{ "type": "agent_end",  "messages": [...] }
```

#### Full command set

| Category | Commands |
|---|---|
| **Prompting** | `prompt`, `steer`, `follow_up`, `abort` |
| **State** | `get_state`, `get_messages` |
| **Model** | `set_model`, `cycle_model`, `get_available_models` |
| **Thinking** | `set_thinking_level`, `cycle_thinking_level` |
| **Queue modes** | `set_steering_mode`, `set_follow_up_mode` |
| **Compaction** | `compact`, `set_auto_compaction` |
| **Retry** | `set_auto_retry`, `abort_retry` |
| **Bash** | `bash`, `abort_bash` |
| **Session** | `new_session`, `switch_session`, `fork`, `get_fork_messages`, `get_session_stats`, `get_last_assistant_text`, `set_session_name`, `export_html` |
| **Resources** | `get_commands` |

#### Steering vs follow-up

- `steer` — injects a message **after the current tool-call batch finishes** but before the next LLM call. Use to redirect mid-run.
- `follow_up` — enqueues a message to be delivered **only when the agent becomes fully idle**. Use to chain test steps.

#### Key events for Expect

| Event | When | Expect use |
|---|---|---|
| `agent_start` | Prompt accepted | Start progress timer |
| `tool_execution_start` | Tool about to run | Surface in TUI (tool name, args) |
| `tool_execution_update` | Streaming bash output | Live output in result panel |
| `tool_execution_end` | Tool done | Record pass/fail per tool call |
| `turn_end` | One LLM+tools cycle done | Show turn count |
| `agent_end` | All done | Finalize results |
| `auto_compaction_start/end` | Context window pressure | Warn user |
| `auto_retry_start/end` | Provider rate-limit | Show retry state |

[Source: RPC docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)

---

### 4. SDK — same-process integration

If Expect imports pi directly (no subprocess), use `createAgentSession()`:

```typescript
import {
  AuthStorage, createAgentSession, ModelRegistry,
  SessionManager, SettingsManager
} from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();       // reads ~/.pi/agent/auth.json + env vars
const modelRegistry = new ModelRegistry(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),    // no disk I/O for test runs
  settingsManager: SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 3 },
  }),
  authStorage,
  modelRegistry,
  tools: createCodingTools(cwd),               // tools scoped to project dir
  cwd,
});

session.subscribe((event) => {
  if (event.type === "tool_execution_start") { /* update Expect UI */ }
  if (event.type === "agent_end") { /* extract results */ }
});

await session.prompt("Validate the login flow against the diff");
```

`AgentSession` interface exposes: `prompt()`, `steer()`, `followUp()`, `abort()`,
`setModel()`, `compact()`, `newSession()`, `fork()`, `dispose()`.

SDK is preferred for Expect because:
- Type safety across the full event/message schema
- No subprocess overhead or JSONL framing concerns
- Direct access to `session.agent.state.messages` for result extraction
- `createAgentSession` accepts `customTools` and `extensionFactories` — Expect could
  inject its own Playwright/rrweb tools into the pi agent context

[Source: SDK docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)

---

### 5. Extension system — hooks available to Expect

Extensions are TypeScript modules loaded by pi at startup. They expose a rich event
bus that is the primary mechanism for intercepting and augmenting agent behaviour.

Key hooks for an Expect integration extension:

| Hook | What Expect could do |
|---|---|
| `before_agent_start` | Inject test plan context into system prompt per-run |
| `tool_call` | Intercept `bash` calls to sandbox execution or capture for recording |
| `tool_result` | Augment bash results with rrweb snapshot triggers |
| `agent_end` | Collect final message list, extract pass/fail assertions |
| `session_shutdown` | Flush rrweb session recording |
| `input` | Validate that Expect-injected prompts are well-formed |

The extension API can also `registerTool()` to give pi Playwright tools directly,
so the LLM can call `browser.navigate(url)` as a first-class tool alongside
`read`, `bash`, etc.

Extensions are loaded via CLI (`-e ./expect-ext.ts`) or SDK
(`DefaultResourceLoader({ extensionFactories: [...] })`), making them composable
with project extensions.

[Source: Extensions docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)

---

### 6. Configuration model

Two-level JSON config with project overriding global, deep-merged:

| File | Scope |
|---|---|
| `~/.pi/agent/settings.json` | Global |
| `.pi/settings.json` | Project (cwd) |

Key settings for Expect orchestration:

```jsonc
// .pi/settings.json (drop in test project root)
{
  "compaction": { "enabled": false },           // prevent mid-run summarization
  "retry": { "enabled": true, "maxRetries": 3 }, // handle rate limits
  "steeringMode": "one-at-a-time",               // predictable message delivery
  "followUpMode": "one-at-a-time"
}
```

Environment variables:
- `PI_CODING_AGENT_DIR` — override `~/.pi/agent` (useful for CI isolation)
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. — standard provider env vars
- `PI_SKIP_VERSION_CHECK` — skip version check in CI
- `PI_CACHE_RETENTION=long` — extend prompt cache (1h Anthropic, 24h OpenAI)

Context files: `AGENTS.md` (or `CLAUDE.md`) are loaded hierarchically from cwd
upward plus `~/.pi/agent/AGENTS.md`. Expect can place its own `.pi/AGENTS.md` or
use `--append-system-prompt` to inject test context without touching the user's
own context files.

System prompt override: `.pi/SYSTEM.md` (project) or `~/.pi/agent/SYSTEM.md`
(global) replaces the default. `APPEND_SYSTEM.md` appends without replacing.

[Source: Settings docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)

---

### 7. Session format — readable JSONL tree

Sessions are JSONL files stored at:
```
~/.pi/agent/sessions/--<cwd-path>--/<timestamp>_<uuid>.jsonl
```

Each line is a typed entry. All entries except the header carry `id` + `parentId`,
forming a tree that supports in-place branching without new files.

Entry types: `session` (header), `message`, `model_change`, `thinking_level_change`,
`compaction`, `branch_summary`, `custom` (extension state), `custom_message`
(extension LLM context), `label`, `session_info`.

For Expect, `--no-session` is the right default (ephemeral run). If replay/audit
is needed, use `--session-dir /tmp/expect-sessions` to isolate from the user's
session history.

Session files are directly parseable — no special tooling needed beyond `JSON.parse`
per line. The `buildSessionContext()` method on `SessionManager` produces the
canonical message list for a given tree leaf.

[Source: Session docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)

---

### 8. How to launch and control a pi session from Expect

**Option A: RPC subprocess (language-agnostic, process-isolated)**

```typescript
// packages/@expect/agent/src/drivers/pi-driver.ts
const proc = spawn("pi", [
  "--mode", "rpc",
  "--no-session",
  "--no-extensions",                     // isolate from user's global config
  "--system-prompt", testPlanMarkdown,   // inject Expect test plan
  "--tools", "read,bash,edit,write",
], { cwd: projectDir });

// Manual JSONL framing (NOT readline)
attachJsonlReader(proc.stdout, handleEvent);

const send = (cmd: object) =>
  proc.stdin.write(JSON.stringify(cmd) + "\n");

send({ id: "p1", type: "prompt", message: "Run the test plan" });
// ...wait for agent_end...
send({ type: "abort" });
proc.kill();
```

**Option B: SDK (same process, Effect-compatible)**

```typescript
// Effect wrapper around AgentSession
const runPiAgent = (testPlan: string, cwd: string) =>
  Effect.acquireRelease(
    Effect.promise(() =>
      createAgentSession({
        sessionManager: SessionManager.inMemory(),
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
        cwd,
        tools: createCodingTools(cwd),
      })
    ),
    ({ session }) => Effect.sync(() => session.dispose())
  ).pipe(
    Effect.flatMap(({ session }) =>
      Effect.async<AgentEndEvent, AgentError>((resume) => {
        session.subscribe((event) => {
          if (event.type === "agent_end") resume(Effect.succeed(event));
        });
        session.prompt(testPlan).catch((e) => resume(Effect.fail(e)));
      })
    )
  );
```

---

### 9. What matters for first-class Expect support

To add pi as a supported coding agent in Expect (alongside Claude Code, Codex CLI,
Cursor), Expect needs to implement:

1. **Agent detection**: Check `which pi` or look for `@mariozechner/pi-coding-agent`
   in the project's `node_modules`. Pi is installed globally (`npm install -g
   @mariozechner/pi-coding-agent`) so `which pi` is the reliable check.

2. **Session launch**: Spawn `pi --mode rpc --no-session --no-extensions` with the
   diff context injected via `--append-system-prompt` or a temporary `.pi/AGENTS.md`
   file scoped to the Expect run.

3. **JSONL transport layer**: Implement a compliant LF-only buffer splitter
   (see the Node.js example in RPC docs). Wire to Effect's `Stream` or
   `Queue` for backpressure-safe event handling.

4. **Event → Supervisor state mapping**: Translate pi's event stream to
   Expect's `ExecutionEvent` domain model. Key mappings:
   - `tool_execution_start` → show running tool in TUI
   - `tool_execution_end` → record tool result
   - `agent_end` → extract final assertions from last assistant message
   - `auto_retry_start` → surface rate-limit state to user

5. **Context injection**: Pass the diff (`git diff --staged` or branch diff)
   and the generated test plan as the initial prompt. Pi respects
   `--system-prompt` / `--append-system-prompt` without touching user's own
   `AGENTS.md`.

6. **Extension UI protocol**: If extensions are allowed (not `--no-extensions`),
   pi may emit `extension_ui_request` events for `select`, `confirm`, `input`,
   `editor` dialogs. Expect's TUI must handle these or send a cancellation response
   to avoid blocking.

7. **Cleanup**: On timeout or user cancel, send `{"type": "abort"}` then kill the
   subprocess. With `--no-session` there's nothing to clean up on disk.

---

## Sources

| Source | Kept/Dropped | Why |
|---|---|---|
| [pi-mono README](https://github.com/badlogic/pi-mono) | ✅ Kept | Primary source, package map |
| [coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md) | ✅ Kept | Full CLI/mode reference |
| [RPC docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md) | ✅ Kept | Complete protocol spec with examples |
| [SDK docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) | ✅ Kept | Full SDK API with typed examples |
| [pi-agent-core README](https://github.com/badlogic/pi-mono/tree/main/packages/agent) | ✅ Kept | Agent event model and loop internals |
| [Extensions docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) | ✅ Kept | Event hooks, tool registration |
| [Settings docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md) | ✅ Kept | Full settings schema |
| [Session docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md) | ✅ Kept | JSONL format, tree structure |

---

## Gaps and Risks

### Known unknowns

1. **Extension UI protocol blocking behaviour in RPC mode** — If Expect doesn't
   disable extensions (`--no-extensions`) and a user has a global extension that
   calls `ctx.ui.confirm()`, the subprocess will block indefinitely waiting for an
   `extension_ui_response`. Expect must either (a) always pass `--no-extensions`,
   or (b) implement the full extension UI sub-protocol as a fallback handler that
   auto-cancels dialogs with a timeout.

2. **`--no-extensions` vs. project extensions** — `--no-extensions` disables
   extension discovery globally. If the user's project depends on an extension to
   function correctly (e.g., a custom tool their `AGENTS.md` references), disabling
   extensions may cause pi to fail silently or produce bad output. Need a policy:
   allow project-local extensions (`.pi/extensions/`) but disable global ones.
   There is no CLI flag for this granularity; would need a custom `PI_CODING_AGENT_DIR`
   pointing to a clean agent dir.

3. **Version stability** — Pi is actively developed (OSS Weekend events, no
   semver-stable version observed). The RPC protocol and SDK API are described as
   stable in the docs but there's no explicit versioning contract. Expect should
   pin to a specific `@mariozechner/pi-coding-agent` version and test on update.

4. **Parallel tool execution interleaving** — Pi executes tools concurrently by
   default. `tool_execution_start` events arrive in assistant source order but
   `tool_execution_update` events may interleave across tools. Expect's streaming
   display layer must correlate events via `toolCallId`.

5. **`pi-agent-core` low-level API vs. `AgentSession`** — The README warns that
   `agentLoop()` / `agentLoopContinue()` are "observational" and do not act as
   barriers before tool preflight. For correct event ordering, use `AgentSession`
   (the SDK class) or the RPC mode — not raw `agentLoop()`.

6. **No published TypeScript types for the RPC protocol** — The RPC types live in
   `src/modes/rpc/rpc-types.ts` inside the package source but it's not clear they
   are exported from the package's public API. The SDK (`createAgentSession` etc.)
   is the typed surface; RPC is JSON-only. Expect would need to define its own
   RPC command/event types or use `as` casts.

### Suggested next steps

- Spike the RPC integration path: spawn pi, send a test prompt, validate the
  event stream parses cleanly with the LF-only splitter.
- Verify `--no-extensions --no-session` leaves no side-effects in `~/.pi/agent/`.
- Check whether `PI_CODING_AGENT_DIR` pointing to a temp dir fully isolates pi
  from the user's global configuration (auth, settings, sessions).
- Review `src/modes/rpc/rpc-client.ts` and `test/rpc-example.ts` in the pi-mono
  source for the canonical TypeScript client reference implementation.
- Evaluate whether the SDK path (same-process import) is viable given Effect-TS
  compatibility — pi-agent-core uses plain Promises and Node.js streams, not
  Effect, so bridging is needed at the subscription boundary.
