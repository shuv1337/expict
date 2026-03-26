import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  createExtensionRuntime,
} from "/home/shuv/.local/share/mise/installs/node/25.2.1/lib/node_modules/@mariozechner/pi-coding-agent/dist/index.js";
import { Type } from "/home/shuv/.local/share/mise/installs/node/25.2.1/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), ".tmp", "pi-eval");
await mkdir(outDir, { recursive: true });

const transcript = [];
const push = (entry) => {
  transcript.push({ ts: new Date().toISOString(), ...entry });
};

const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
});

const resourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => "You are a test harness for SDK evaluation. Be concise.",
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
};

const fakeTool = {
  name: "expect_probe",
  label: "Expect Probe",
  description: "A tiny evaluation tool that echoes and can stream progress updates.",
  parameters: Type.Object({
    input: Type.String({ description: "Text to echo" }),
  }),
  execute: async (_toolCallId, params, onUpdate) => {
    push({ kind: "tool_execute", tool: "expect_probe", params });
    onUpdate?.({
      content: [{ type: "text", text: `partial:${params.input}` }],
      details: { phase: "partial" },
    });
    return {
      content: [{ type: "text", text: `final:${params.input}` }],
      details: { phase: "final" },
    };
  },
};

const { session } = await createAgentSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
  settingsManager,
  resourceLoader,
  customTools: [fakeTool],
});

let text = "";
let thinking = "";
let toolStarts = 0;
let toolUpdates = 0;
let toolEnds = 0;
let agentEnds = 0;

session.subscribe((event) => {
  push({ kind: "event", event });
  if (event.type === "message_update") {
    const inner = event.assistantMessageEvent;
    if (inner.type === "text_delta") text += inner.delta;
    if (inner.type === "thinking_delta") thinking += inner.delta;
  }
  if (event.type === "tool_execution_start") toolStarts += 1;
  if (event.type === "tool_execution_update") toolUpdates += 1;
  if (event.type === "tool_execution_end") toolEnds += 1;
  if (event.type === "agent_end") agentEnds += 1;
});

const sessionId1 = session.sessionId;
push({ kind: "session", phase: "initial", sessionId: sessionId1 });

await session.prompt('Use the expect_probe tool once with input "sdk-spike" and then answer with exactly DONE.');

const afterFirst = {
  sessionId: session.sessionId,
  text,
  thinkingLength: thinking.length,
  toolStarts,
  toolUpdates,
  toolEnds,
  agentEnds,
  messageCount: session.messages.length,
  isStreaming: session.isStreaming,
};
push({ kind: "summary", phase: "after-first-prompt", data: afterFirst });

let steerResult = "not-run";
try {
  const pending = session.prompt("First long response: count slowly to twenty with one number per line.");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await session.steer("Instead, stop as soon as practical and say STEERED.");
  await pending;
  steerResult = "completed";
} catch (error) {
  steerResult = `error:${error instanceof Error ? error.message : String(error)}`;
}
push({ kind: "summary", phase: "steer-test", data: { steerResult, isStreaming: session.isStreaming } });

await session.newSession();
const sessionId2 = session.sessionId;
push({ kind: "session", phase: "after-new-session", sessionId: sessionId2 });

await session.prompt('Respond with exactly SECOND.');

const result = {
  option: "sdk",
  sessionId1,
  sessionId2,
  sessionChangedAfterNewSession: sessionId1 !== sessionId2,
  textContainsDone: text.includes("DONE"),
  textContainsSteered: text.includes("STEERED"),
  toolStarts,
  toolUpdates,
  toolEnds,
  agentEnds,
  finalMessageCount: session.messages.length,
  steerResult,
};

await writeFile(path.join(outDir, "sdk-transcript.json"), JSON.stringify(transcript, null, 2));
await writeFile(path.join(outDir, "sdk-result.json"), JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));

session.dispose();
