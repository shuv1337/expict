import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), ".tmp", "pi-eval");
await mkdir(outDir, { recursive: true });

const transcript = [];
const push = (entry) => transcript.push({ ts: new Date().toISOString(), ...entry });

const proc = spawn("pi", [
  "--mode",
  "rpc",
  "--no-session",
  "--no-extensions",
  "--tools",
  "read,bash,edit,write",
  "--append-system-prompt",
  "You are an RPC evaluation harness. Be concise and follow instructions exactly.",
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

const waitFor = async (predicate, timeoutMs = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for RPC event");
};

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
  await waitFor((event) => event.type === "session", 10000).catch(() => undefined);

  await send({ id: "state-1", type: "get_state" });
  await send({ id: "prompt-1", type: "prompt", message: 'Respond with exactly DONE.' });
  await waitForAgentEndCount(1);

  const state1 = await send({ id: "state-2", type: "get_state" });

  await send({ id: "prompt-2", type: "prompt", message: "Count slowly to twenty with one number per line." });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await send({ id: "steer-1", type: "steer", message: "Instead, stop as soon as practical and say STEERED." });
  await waitForAgentEndCount(2);

  const beforeNewSession = await send({ id: "state-3", type: "get_state" });
  await send({ id: "new-1", type: "new_session" });
  const afterNewSession = await send({ id: "state-4", type: "get_state" });

  await send({ id: "prompt-3", type: "prompt", message: 'Respond with exactly SECOND.' });
  await waitForAgentEndCount(3);

  const textDeltas = events
    .filter((event) => event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta")
    .map((event) => event.assistantMessageEvent.delta)
    .join("");
  const thinkingDeltas = events
    .filter((event) => event.type === "message_update" && event.assistantMessageEvent?.type === "thinking_delta")
    .map((event) => event.assistantMessageEvent.delta)
    .join("");
  const toolStarts = events.filter((event) => event.type === "tool_execution_start").length;
  const toolUpdates = events.filter((event) => event.type === "tool_execution_update").length;
  const toolEnds = events.filter((event) => event.type === "tool_execution_end").length;
  const agentEnds = events.filter((event) => event.type === "agent_end").length;

  const result = {
    option: "rpc",
    textContainsDone: textDeltas.includes("DONE"),
    textContainsSteered: textDeltas.includes("STEERED"),
    thinkingLength: thinkingDeltas.length,
    toolStarts,
    toolUpdates,
    toolEnds,
    agentEnds,
    sessionIdBeforeNewSession: beforeNewSession?.data?.sessionId,
    sessionIdAfterNewSession: afterNewSession?.data?.sessionId,
    sessionChangedAfterNewSession:
      beforeNewSession?.data?.sessionId && afterNewSession?.data?.sessionId
        ? beforeNewSession.data.sessionId !== afterNewSession.data.sessionId
        : null,
    state1,
    stderr,
  };

  await writeFile(path.join(outDir, "rpc-transcript.json"), JSON.stringify(transcript, null, 2));
  await writeFile(path.join(outDir, "rpc-result.json"), JSON.stringify(result, null, 2));

  console.log(JSON.stringify(result, null, 2));
} finally {
  try {
    await send({ id: "abort-final", type: "abort" }).catch(() => undefined);
  } catch {}
  proc.kill("SIGTERM");
}
