import { Type } from "/home/shuv/.local/share/mise/installs/node/25.2.1/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/index.js";

const makeTool = (name) => ({
  name,
  label: name,
  description: `Expect browser tool stub for ${name}`,
  promptSnippet: `Use ${name} when appropriate.`,
  parameters: Type.Object({}, { additionalProperties: true }),
  async execute(_toolCallId, params, _signal, onUpdate) {
    if (name === "screenshot") {
      onUpdate?.({
        content: [{ type: "text", text: "snapshot partial" }],
        details: { phase: "partial" },
      });
      return {
        content: [
          {
            type: "text",
            text: '{"tree":"- heading \\\"Demo\\\" [ref=e1]","refs":{"e1":{"role":"heading","name":"Demo"}}}',
          },
        ],
        details: { phase: "final" },
      };
    }
    if (name === "close") {
      return {
        content: [
          {
            type: "text",
            text: "Browser closed.\nrrweb report: /tmp/fake-report.html\nPlaywright video: /tmp/fake-video.webm",
          },
        ],
        details: { phase: "final" },
      };
    }
    return {
      content: [{ type: "text", text: `${name}:ok` }],
      details: { phase: "final" },
    };
  },
});

export default function (pi) {
  for (const name of [
    "open",
    "playwright",
    "screenshot",
    "console_logs",
    "network_requests",
    "close",
  ]) {
    pi.registerTool(makeTool(name));
  }
}
