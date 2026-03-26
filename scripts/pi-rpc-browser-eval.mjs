import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), ".tmp", "pi-eval");
await mkdir(outDir, { recursive: true });

const transcript = [];
const push = (entry) => transcript.push({ ts: new Date().toISOString(), ...entry });

const extensionPath = path.join(process.cwd(), "scripts", "pi-rpc-browser-extension.ts");
const proc = spawn("pi", [
  "--mode",
  "rpc",
  "--no-session",
  "--no-extensions",
  "-e",
  extensionPath,
  "--append-system-prompt",
  "You are an RPC browser-tool evaluation harness. Be concise.",
], {
  cwd: process.cwd(),
  env: { ...process.env, PI_OFFLINE: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuffer = "";
const pending = new Map();
const events = [];

const send = (command) => {
  push({ kind: "command", command });
  proc.stdin.write(JSON.stringify(command) + "\n");
  return new Promise((resolve, reject) => {
    if (command.id) pending.set(command.id, { resolve, reject });
    else resolve(undefined);
  });
};

proc.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString("utf8");
  while (true) {
    const index = stdoutBuffer.indexOf("\n");
    if (index === -1) break;
    let line = stdoutBuffer.slice(0, index);
    stdoutBuffer = stdoutBuffer.slice(index + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    push({ kind: "stdout", message });
    if (message.type === "response" && message.id && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    } else {
      events.push(message);
    }
  }
});

let stderr = "";
proc.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

const waitForAgentEndCount = async (count, timeoutMs = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = events.filter((event) => event.type === "agent_end").length;
    if (current >= count) return current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for agent_end count");
};

try {
  await send({
    id: "prompt-1",
    type: "prompt",
    message: "Call open, then screenshot, then close. After that, answer with exactly BROWSER_OK.",
  });
  await waitForAgentEndCount(1);

  const textDeltas = events
    .filter((event) => event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta")
    .map((event) => event.assistantMessageEvent.delta)
    .join("");
  const toolStarts = events.filter((event) => event.type === "tool_execution_start").length;
  const toolUpdates = events.filter((event) => event.type === "tool_execution_update").length;
  const toolEnds = events.filter((event) => event.type === "tool_execution_end").length;
  const toolNamesCalled = [...new Set(events.filter((e) => e.type === 'tool_execution_start').map((e) => e.toolName))];

  const result = {
    option: "rpc-browser-tools",
    textContainsBrowserOk: textDeltas.includes("BROWSER_OK"),
    toolStarts,
    toolUpdates,
    toolEnds,
    toolNamesCalled,
    stderr,
  };

  await writeFile(path.join(outDir, "rpc-browser-transcript.json"), JSON.stringify(transcript, null, 2));
  await writeFile(path.join(outDir, "rpc-browser-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  try {
    await send({ id: "abort-final", type: "abort" }).catch(() => undefined);
  } catch {}
  proc.kill("SIGTERM");
}
