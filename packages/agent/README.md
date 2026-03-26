# @expect/agent

Agent backends for Expect, including Claude, Codex, and Pi session integrations.

## Install

```bash
pnpm add @expect/agent
```

## `createClaudeModel`

Create a Claude model powered by the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Requires `claude login`.

```ts
import { createClaudeModel } from "@expect/agent";
import { generateText, streamText } from "ai";

const model = createClaudeModel({ cwd: "/my/project" });

const { text } = await generateText({ model, prompt: "Fix the bug in auth.ts" });

const result = streamText({ model, prompt: "List the files" });
for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## `createCodexModel`

Create a Codex model powered by the [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk). Requires `OPENAI_API_KEY` or Codex CLI auth.

```ts
import { createCodexModel } from "@expect/agent";
import { generateText } from "ai";

const model = createCodexModel({ cwd: "/my/project" });

const { text } = await generateText({ model, prompt: "Refactor the database layer" });
```

## Settings

Both `createClaudeModel` and `createCodexModel` accept the same settings:

```ts
interface AgentProviderSettings {
  cwd?: string; // working directory (default: process.cwd())
  sessionId?: string; // resume a previous session
  env?: Record<string, string>; // environment variables for the agent
}
```

## Session resumption

Both providers expose the session ID via `providerMetadata` on the result:

```ts
const result = await generateText({ model, prompt: "Explore the codebase" });
const sessionId = result.providerMetadata?.["expect-agent"]?.sessionId;

const resumed = createClaudeModel({ sessionId });
await generateText({ model: resumed, prompt: "Now fix the bug you found" });
```

## How it works

Both providers implement `LanguageModelV3` with `doGenerate` (non-streaming) and `doStream` (streaming). The agent SDKs execute tools autonomously — tool calls and results are emitted as `tool-call` and `tool-result` content with `providerExecuted: true`.

| SDK event                   | AI SDK content                                   |
| --------------------------- | ------------------------------------------------ |
| Text                        | `text`                                           |
| Thinking                    | `reasoning`                                      |
| Tool use (Bash, Read, etc.) | `tool-call` + `tool-result`                      |
| Command execution           | `tool-call("exec")` + `tool-result`              |
| File change                 | `tool-call("patch")` + `tool-result`             |
| MCP tool call               | `tool-call("mcp__server__tool")` + `tool-result` |
| Web search                  | `tool-call("web_search")` + `tool-result`        |
