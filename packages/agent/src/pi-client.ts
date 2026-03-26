import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { Cause, Effect, Layer, Option, Queue, Schema, ServiceMap, Stream } from "effect";
import { AcpSessionUpdate, AgentProvider } from "@expect/shared/models";
import { hasStringMessage } from "@expect/shared/utils";
import { NodeServices } from "@effect/platform-node";
import {
  AgentProviderUnauthenticatedError,
  AgentProviderUsageLimitError,
  AgentSessionCreateError,
  AgentStreamError,
  SessionId,
} from "./acp-client";
import type { McpEnvEntry } from "./types";
import { mapPiEventToAcpUpdates } from "./pi-event-mapper";
import { createPiBrowserTools } from "./pi-tools";

const PI_MINIMUM_VERSION = "0.62.0";
const PI_PROVIDER: AgentProvider = "pi";

export class PiBinaryNotFoundError extends Schema.ErrorClass<PiBinaryNotFoundError>(
  "PiBinaryNotFoundError",
)({
  _tag: Schema.tag("PiBinaryNotFoundError"),
  cause: Schema.Unknown,
}) {
  displayName = "Pi is not installed";
  message =
    "The `pi` CLI was not found on PATH. Install pi and make sure the binary is available before running expect with `-a pi`.";
}

export class PiUnsupportedVersionError extends Schema.ErrorClass<PiUnsupportedVersionError>(
  "PiUnsupportedVersionError",
)({
  _tag: Schema.tag("PiUnsupportedVersionError"),
  version: Schema.String,
  minimumVersion: Schema.String,
}) {
  displayName = "Pi version is unsupported";
  message = `Expect requires pi ${this.minimumVersion} or newer, but found ${this.version}. Please upgrade pi and retry.`;
}

const parseVersion = (version: string): number[] =>
  version
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));

const isVersionAtLeast = (version: string, minimum: string): boolean => {
  const current = parseVersion(version);
  const target = parseVersion(minimum);
  const length = Math.max(current.length, target.length);
  for (let index = 0; index < length; index++) {
    const left = current[index] ?? 0;
    const right = target[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
};

const classifyPiError = (
  cause: unknown,
): AgentProviderUnauthenticatedError | AgentProviderUsageLimitError | AgentSessionCreateError => {
  const message = hasStringMessage(cause) ? cause.message : String(cause);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("api key") ||
    normalized.includes("auth") ||
    normalized.includes("oauth") ||
    normalized.includes("credential") ||
    normalized.includes("login")
  ) {
    return new AgentProviderUnauthenticatedError({ provider: PI_PROVIDER });
  }

  if (
    normalized.includes("rate limit") ||
    normalized.includes("usage") ||
    normalized.includes("quota") ||
    normalized.includes("billing")
  ) {
    return new AgentProviderUsageLimitError({ provider: PI_PROVIDER });
  }

  return new AgentSessionCreateError({ cause });
};

export class PiClient extends ServiceMap.Service<
  PiClient,
  {
    readonly createSession: (
      cwd: string,
    ) => Effect.Effect<
      SessionId,
      | AgentProviderUnauthenticatedError
      | AgentProviderUsageLimitError
      | AgentSessionCreateError
      | PiBinaryNotFoundError
      | PiUnsupportedVersionError
    >;
    readonly stream: (options: {
      sessionId: Option.Option<SessionId>;
      prompt: string;
      cwd: string;
      systemPrompt: Option.Option<string>;
      mcpEnv?: ReadonlyArray<McpEnvEntry>;
    }) => Stream.Stream<
      AcpSessionUpdate,
      | AgentProviderUnauthenticatedError
      | AgentProviderUsageLimitError
      | AgentSessionCreateError
      | PiBinaryNotFoundError
      | PiUnsupportedVersionError
      | AgentStreamError
    >;
  }
>()("@expect/PiClient", {
  make: Effect.gen(function* () {
    yield* Effect.logInfo("Initializing PiClient", { agentBackend: PI_PROVIDER });

    const ensurePiBinary = Effect.fn("PiClient.ensurePiBinary")(function* () {
      const versionOutput = yield* Effect.try({
        try: () => {
          const result = spawnSync("pi", ["--version"], { encoding: "utf8" });
          if (result.error) throw result.error;
          if (result.status !== 0) {
            throw new Error(
              result.stderr || result.stdout || `pi --version exited ${result.status}`,
            );
          }
          return String(result.stdout || result.stderr).trim();
        },
        catch: (cause) => new PiBinaryNotFoundError({ cause }),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Pi binary lookup failed", {
            cause,
            agentBackend: PI_PROVIDER,
          }),
        ),
      );

      if (!isVersionAtLeast(versionOutput, PI_MINIMUM_VERSION)) {
        yield* Effect.logWarning("Pi version unsupported", {
          version: versionOutput,
          minimumVersion: PI_MINIMUM_VERSION,
          agentBackend: PI_PROVIDER,
        });
        return yield* new PiUnsupportedVersionError({
          version: versionOutput,
          minimumVersion: PI_MINIMUM_VERSION,
        });
      }

      return versionOutput;
    });

    const authStorage = AuthStorage.create();
    const modelRegistry = new ModelRegistry(authStorage);
    const settingsManager = SettingsManager.create();

    const makeResourceLoader = (cwd: string, systemPrompt: Option.Option<string>) =>
      new DefaultResourceLoader({
        cwd,
        settingsManager,
        ...(Option.isSome(systemPrompt) ? { systemPromptOverride: () => systemPrompt.value } : {}),
      });

    yield* ensurePiBinary();

    const sessions = new Map<SessionId, AgentSession>();

    const createSession = Effect.fn("PiClient.createSession")(function* (cwd: string) {
      yield* Effect.annotateCurrentSpan({ cwd, agentBackend: PI_PROVIDER });

      const sessionManager = SessionManager.inMemory(cwd);
      const resourceLoader = makeResourceLoader(cwd, Option.none());
      yield* Effect.tryPromise(() => resourceLoader.reload()).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Pi resource loader reload failed; continuing with defaults", {
            cause,
          }),
        ),
      );
      const result = yield* Effect.tryPromise({
        try: () =>
          createAgentSession({
            cwd,
            authStorage,
            modelRegistry,
            settingsManager,
            resourceLoader,
            sessionManager,
            customTools: createPiBrowserTools([]),
          }),
        catch: (cause) => {
          const classified = classifyPiError(cause);
          void Effect.runFork(
            Effect.logWarning("Pi session creation failed", {
              cwd,
              agentBackend: PI_PROVIDER,
              errorTag: classified._tag,
              cause,
            }),
          );
          return classified;
        },
      });

      const sessionId = SessionId.makeUnsafe(result.session.sessionId);
      sessions.set(sessionId, result.session);
      yield* Effect.logInfo("Pi session created", { sessionId, cwd, agentBackend: PI_PROVIDER });
      return sessionId;
    });

    const getOrCreateSession = Effect.fn("PiClient.getOrCreateSession")(function* (
      cwd: string,
      sessionIdOption: Option.Option<SessionId>,
      mcpEnv: ReadonlyArray<McpEnvEntry>,
      systemPrompt: Option.Option<string>,
    ) {
      if (Option.isSome(sessionIdOption)) {
        const existing = sessions.get(sessionIdOption.value);
        if (existing) return { sessionId: sessionIdOption.value, session: existing } as const;
      }

      const sessionManager = SessionManager.inMemory(cwd);
      const resourceLoader = makeResourceLoader(cwd, systemPrompt);
      yield* Effect.tryPromise(() => resourceLoader.reload()).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Pi resource loader reload failed; continuing with defaults", {
            cause,
          }),
        ),
      );
      const result = yield* Effect.tryPromise({
        try: () =>
          createAgentSession({
            cwd,
            authStorage,
            modelRegistry,
            settingsManager,
            resourceLoader,
            sessionManager,
            customTools: createPiBrowserTools(mcpEnv),
          }),
        catch: (cause) => {
          const classified = classifyPiError(cause);
          void Effect.runFork(
            Effect.logWarning("Pi session creation failed", {
              cwd,
              agentBackend: PI_PROVIDER,
              errorTag: classified._tag,
              cause,
            }),
          );
          return classified;
        },
      });

      const sessionId = SessionId.makeUnsafe(result.session.sessionId);
      sessions.set(sessionId, result.session);
      yield* Effect.logInfo("Pi session created", { sessionId, cwd, agentBackend: PI_PROVIDER });
      return { sessionId, session: result.session } as const;
    });

    const stream = Effect.fn("PiClient.stream")(function* ({
      prompt,
      sessionId: sessionIdOption,
      cwd,
      systemPrompt,
      mcpEnv = [],
    }: {
      sessionId: Option.Option<SessionId>;
      prompt: string;
      cwd: string;
      systemPrompt: Option.Option<string>;
      mcpEnv?: ReadonlyArray<McpEnvEntry>;
    }) {
      const { sessionId, session } = yield* getOrCreateSession(
        cwd,
        sessionIdOption,
        mcpEnv,
        systemPrompt,
      );
      const updatesQueue = yield* Queue.unbounded<AcpSessionUpdate, Cause.Done>();

      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        const updates = mapPiEventToAcpUpdates(event);
        for (const update of updates) {
          Queue.offerUnsafe(updatesQueue, update);
        }
        if (event.type === "agent_end") {
          Queue.endUnsafe(updatesQueue);
        }
      });

      yield* Effect.logInfo("Pi stream starting", { sessionId, cwd, agentBackend: PI_PROVIDER });

      yield* Effect.tryPromise({
        try: () => session.prompt(prompt),
        catch: (cause) => new AgentStreamError({ cause }),
      }).pipe(
        Effect.tap(() =>
          Effect.logInfo("Pi stream completed", { sessionId, agentBackend: PI_PROVIDER }),
        ),
        Effect.tap(() => Effect.sleep(100)),
        Effect.tap(() => Queue.end(updatesQueue)),
        Effect.tapError((cause) =>
          Effect.logWarning("Pi stream failed", { sessionId, agentBackend: PI_PROVIDER, cause }),
        ),
        Effect.tapError(() => Queue.end(updatesQueue)),
        Effect.catchTag("AgentStreamError", (error) =>
          Effect.flatMap(
            Effect.logWarning("Pi prompt failed", {
              sessionId,
              agentBackend: PI_PROVIDER,
              errorTag: error._tag,
              cause: error.cause,
            }),
            () => error.asEffect(),
          ),
        ),
        Effect.ensuring(Effect.sync(() => unsubscribe())),
        Effect.forkScoped,
      );

      return Stream.fromQueue(updatesQueue).pipe(
        Stream.mapError((cause) => new AgentStreamError({ cause })),
      );
    }, Stream.unwrap);

    return {
      createSession,
      stream,
    } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(NodeServices.layer));
}
