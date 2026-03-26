import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createExtensionRuntime,
} from "/home/shuv/.local/share/mise/installs/node/25.2.1/lib/node_modules/@mariozechner/pi-coding-agent/dist/index.js";
import { Type } from "/home/shuv/.local/share/mise/installs/node/25.2.1/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), ".tmp", "pi-eval");
await mkdir(outDir, { recursive: true });

const transcript = [];
const push = (entry) => transcript.push({ ts: new Date().toISOString(), ...entry });

const mkTool = (name) => ({
  name,
  label: name,
  description: `Expect browser tool stub for ${name}`,
  promptSnippet: `Use ${name} when appropriate.`,
  parameters: Type.Object({}, { additionalProperties: true }),
  execute: async (_toolCallId, params, signal, onUpdate) => {
    push({ kind: "tool_execute", tool: name, params });
    if (name === "screenshot") {
      onUpdate?.({ content: [{ type: "text", text: "snapshot partial" }], details: { phase: "partial" } });
      return { content: [{ type: "text", text: '{"tree":"- heading \\\"Demo\\\" [ref=e1]","refs":{"e1":{"role":"heading","name":"Demo"}}}' }], details: { phase: "final" } };
    }
    if (name === "close") {
      return {
        content: [{ type: "text", text: 'Browser closed.\nrrweb report: /tmp/fake-report.html\nPlaywright video: /tmp/fake-video.webm' }],
        details: { phase: "final" },
      };
    }
    return { content: [{ type: "text", text: `${name}:ok` }], details: { phase: "final" } };
  },
});

const browserToolNames = ["open", "playwright", "screenshot", "console_logs", "network_requests", "close"];
const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => "You are evaluating whether browser tool names can be used directly. Be concise.",
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
};

const { session } = await createAgentSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
  settingsManager,
  resourceLoader,
  customTools: browserToolNames.map(mkTool),
});

let text = "";
let toolStarts = 0;
let toolUpdates = 0;
let toolEnds = 0;
const toolNamesCalled = new Set();

session.subscribe((event) => {
  push({ kind: "event", event });
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    text += event.assistantMessageEvent.delta;
  }
  if (event.type === "tool_execution_start") {
    toolStarts += 1;
    toolNamesCalled.add(event.toolName);
  }
  if (event.type === "tool_execution_update") toolUpdates += 1;
  if (event.type === "tool_execution_end") toolEnds += 1;
});

await session.prompt('Call open, then screenshot, then close. After that, answer with exactly BROWSER_OK.');

const result = {
  option: "sdk-browser-tools",
  textContainsBrowserOk: text.includes("BROWSER_OK"),
  toolStarts,
  toolUpdates,
  toolEnds,
  toolNamesCalled: [...toolNamesCalled],
};

await writeFile(path.join(outDir, "sdk-browser-transcript.json"), JSON.stringify(transcript, null, 2));
await writeFile(path.join(outDir, "sdk-browser-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
session.dispose();
