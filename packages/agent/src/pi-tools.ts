import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import {
  EXPECT_LIVE_VIEW_URL_ENV_NAME,
  EXPECT_REPLAY_OUTPUT_ENV_NAME,
  McpSession,
} from "@expect/browser/mcp";
import type { McpEnvEntry } from "./types";

const jsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const asTextResult = (text: string, details?: unknown) => ({
  content: [{ type: "text" as const, text }],
  details,
});

const OpenParameters = Type.Object(
  {
    url: Type.String({ description: "URL to navigate to" }),
    headed: Type.Optional(Type.Boolean({ description: "Show browser window" })),
    cookies: Type.Optional(
      Type.Boolean({
        description: "Reuse local browser cookies for the target URL when available",
      }),
    ),
    waitUntil: Type.Optional(
      Type.Union([
        Type.Literal("load"),
        Type.Literal("domcontentloaded"),
        Type.Literal("networkidle"),
        Type.Literal("commit"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const PlaywrightParameters = Type.Object(
  {
    code: Type.String({ description: "Playwright code to execute" }),
  },
  { additionalProperties: false },
);

const ScreenshotParameters = Type.Object(
  {
    mode: Type.Optional(
      Type.Union([Type.Literal("screenshot"), Type.Literal("snapshot"), Type.Literal("annotated")]),
    ),
    fullPage: Type.Optional(Type.Boolean({ description: "Capture the full page" })),
  },
  { additionalProperties: false },
);

const ConsoleLogsParameters = Type.Object(
  {
    type: Type.Optional(Type.String({ description: "Filter by log type" })),
    clear: Type.Optional(Type.Boolean({ description: "Clear captured messages after reading" })),
  },
  { additionalProperties: false },
);

const NetworkRequestsParameters = Type.Object(
  {
    method: Type.Optional(Type.String({ description: "Filter by HTTP method" })),
    url: Type.Optional(Type.String({ description: "Filter by URL substring" })),
    resourceType: Type.Optional(Type.String({ description: "Filter by resource type" })),
    clear: Type.Optional(Type.Boolean({ description: "Clear captured requests after reading" })),
  },
  { additionalProperties: false },
);

const CloseParameters = Type.Object({}, { additionalProperties: false });

const browserLayer = (mcpEnv: ReadonlyArray<McpEnvEntry> = []) => {
  const configObject = Object.fromEntries(mcpEnv.map((entry) => [entry.name, entry.value]));

  return McpSession.layer.pipe(
    Layer.provide(NodeServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(configObject))),
  );
};

export const createPiBrowserTools = (
  mcpEnv: ReadonlyArray<McpEnvEntry> = [],
): Array<ToolDefinition<any>> => {
  const runtime = ManagedRuntime.make(browserLayer(mcpEnv));
  const runBrowser = <A>(effect: Effect.Effect<A, unknown, any>) => runtime.runPromise(effect);

  const openTool: ToolDefinition<typeof OpenParameters> = {
    name: "open",
    label: "Open URL",
    description: "Navigate to a URL, launching a browser if needed.",
    promptSnippet: "open(url, headed?, cookies?, waitUntil?) — launch a browser and navigate.",
    parameters: OpenParameters,
    execute: async (_toolCallId, params) =>
      runBrowser(
        Effect.gen(function* () {
          const session = yield* McpSession;
          if (session.hasSession()) {
            yield* session.navigate(params.url, { waitUntil: params.waitUntil });
            return asTextResult(`Navigated to ${params.url}`);
          }
          const result = yield* session.open(params.url, {
            headed: params.headed,
            cookies: params.cookies,
            waitUntil: params.waitUntil,
          });
          return asTextResult(
            `Opened ${params.url}` +
              (result.injectedCookieCount > 0
                ? ` (${result.injectedCookieCount} cookies synced from local browser)`
                : ""),
            result,
          );
        }),
      ),
  };

  const playwrightTool: ToolDefinition<typeof PlaywrightParameters> = {
    name: "playwright",
    label: "Execute Playwright",
    description:
      "Execute Playwright code in the Node.js context. Available globals: page, context, browser, ref(id).",
    promptSnippet:
      "playwright(code) — execute Playwright code using page/context/browser/ref(). Return JSON-serializable values.",
    parameters: PlaywrightParameters,
    execute: async (_toolCallId, params) =>
      runBrowser(
        Effect.gen(function* () {
          const session = yield* McpSession;
          const sessionData = yield* session.requireSession();
          const ref = (refId: string) => {
            if (!sessionData.lastSnapshot) {
              throw new Error("No snapshot taken yet. Call screenshot with mode 'snapshot' first.");
            }
            return Effect.runSync(sessionData.lastSnapshot.locator(refId));
          };

          return yield* Effect.promise(async () => {
            try {
              const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
                ...args: string[]
              ) => (...args: unknown[]) => Promise<unknown>;
              const userFunction = new AsyncFunction(
                "page",
                "context",
                "browser",
                "ref",
                params.code,
              );
              const result = await userFunction(
                sessionData.page,
                sessionData.context,
                sessionData.browser,
                ref,
              );
              if (result === undefined) return asTextResult("OK");
              return asTextResult(jsonStringify(result), result);
            } catch (error) {
              return asTextResult(
                `Error: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          });
        }),
      ),
  };

  const screenshotTool: ToolDefinition<typeof ScreenshotParameters> = {
    name: "screenshot",
    label: "Screenshot",
    description:
      "Capture the current page state. Modes: screenshot (PNG), snapshot (ARIA tree with refs), annotated (PNG with labels).",
    promptSnippet:
      "screenshot(mode?, fullPage?) — capture a snapshot tree, PNG screenshot, or annotated screenshot.",
    parameters: ScreenshotParameters,
    execute: async (_toolCallId, params, _signal, onUpdate) =>
      runBrowser(
        Effect.gen(function* () {
          const session = yield* McpSession;
          const page = yield* session.requirePage();
          const mode = params.mode ?? "screenshot";

          if (mode === "snapshot") {
            const result = yield* session.snapshot(page);
            yield* session.updateLastSnapshot(result);
            const payload = { tree: result.tree, refs: result.refs, stats: result.stats };
            return asTextResult(jsonStringify(payload), payload);
          }

          if (mode === "annotated") {
            const result = yield* session.annotatedScreenshot(page, {
              fullPage: params.fullPage,
            });
            return {
              content: [
                {
                  type: "image" as const,
                  data: result.screenshot.toString("base64"),
                  mimeType: "image/png",
                },
                {
                  type: "text" as const,
                  text: result.annotations
                    .map(
                      (annotation) =>
                        `[${annotation.label}] @${annotation.ref} ${annotation.role} "${annotation.name}"`,
                    )
                    .join("\n"),
                },
              ],
              details: { annotations: result.annotations },
            };
          }

          const buffer = yield* Effect.tryPromise(() =>
            page.screenshot({ fullPage: params.fullPage }),
          );
          onUpdate?.({
            content: [{ type: "text", text: "Captured screenshot" }],
            details: { mimeType: "image/png", phase: "partial" },
          });
          return {
            content: [
              {
                type: "image" as const,
                data: buffer.toString("base64"),
                mimeType: "image/png",
              },
            ],
            details: { mimeType: "image/png" },
          };
        }),
      ),
  };

  const consoleLogsTool: ToolDefinition<typeof ConsoleLogsParameters> = {
    name: "console_logs",
    label: "Console Logs",
    description: "Get browser console log messages.",
    promptSnippet: "console_logs(type?, clear?) — inspect browser console output.",
    parameters: ConsoleLogsParameters,
    execute: async (_toolCallId, params) =>
      runBrowser(
        Effect.gen(function* () {
          const session = yield* McpSession;
          const sessionData = yield* session.requireSession();
          const entries = params.type
            ? sessionData.consoleMessages.filter((entry) => entry.type === params.type)
            : sessionData.consoleMessages;
          if (params.clear) sessionData.consoleMessages.length = 0;
          return entries.length === 0
            ? asTextResult("No console messages captured.")
            : asTextResult(jsonStringify(entries), entries);
        }),
      ),
  };

  const networkRequestsTool: ToolDefinition<typeof NetworkRequestsParameters> = {
    name: "network_requests",
    label: "Network Requests",
    description: "Get captured network requests.",
    promptSnippet:
      "network_requests(method?, url?, resourceType?, clear?) — inspect captured requests.",
    parameters: NetworkRequestsParameters,
    execute: async (_toolCallId, params) =>
      runBrowser(
        Effect.gen(function* () {
          const session = yield* McpSession;
          const sessionData = yield* session.requireSession();
          const method = params.method?.toUpperCase();
          const resourceType = params.resourceType?.toLowerCase();
          const entries = sessionData.networkRequests.filter(
            (entry) =>
              (!method || entry.method === method) &&
              (!params.url || entry.url.includes(params.url)) &&
              (!resourceType || entry.resourceType === resourceType),
          );
          if (params.clear) sessionData.networkRequests.length = 0;
          return entries.length === 0
            ? asTextResult("No network requests captured.")
            : asTextResult(jsonStringify(entries), entries);
        }),
      ),
  };

  const closeTool: ToolDefinition<typeof CloseParameters> = {
    name: "close",
    label: "Close Browser",
    description: "Close the browser and end the session.",
    promptSnippet:
      "close() — close the browser and flush replay/video artifacts before completion.",
    parameters: CloseParameters,
    execute: async () =>
      runBrowser(
        Effect.gen(function* () {
          const session = yield* McpSession;
          const result = yield* session.close();
          if (!result) return asTextResult("No browser open.");
          const lines = ["Browser closed."];
          if (result.tmpReplaySessionPath) {
            lines.push(`rrweb replay: ${result.tmpReplaySessionPath}`);
          }
          if (result.tmpReportPath) {
            lines.push(`rrweb report: ${result.tmpReportPath}`);
          }
          if (result.tmpVideoPath) {
            lines.push(`Playwright video: ${result.tmpVideoPath}`);
          } else if (result.videoPath) {
            lines.push(`Playwright video: ${result.videoPath}`);
          }
          return asTextResult(lines.join("\n"), result);
        }),
      ),
  };

  const tools: Array<ToolDefinition<any>> = [
    openTool,
    playwrightTool,
    screenshotTool,
    consoleLogsTool,
    networkRequestsTool,
    closeTool,
  ];

  return tools;
};

export const PI_BROWSER_ENV_NAMES = [
  EXPECT_REPLAY_OUTPUT_ENV_NAME,
  EXPECT_LIVE_VIEW_URL_ENV_NAME,
] as const;
