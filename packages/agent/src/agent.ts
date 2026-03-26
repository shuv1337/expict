import { Effect, FileSystem, Layer, Option, Schema, ServiceMap, Stream } from "effect";
import {
  AcpAdapter,
  AcpClient,
  type AgentProviderUnauthenticatedError,
  type AgentProviderUsageLimitError,
  type AgentSessionCreateError,
  type AgentStreamError,
  type SessionId,
} from "./acp-client";
import { AcpSessionUpdate } from "@expect/shared/models";
import { type AgentBackend } from "@expect/shared";
export type { AgentBackend } from "@expect/shared";
import { AgentStreamOptions } from "./types";
import { NodeServices } from "@effect/platform-node";
import { PiBinaryNotFoundError, PiClient, PiUnsupportedVersionError } from "./pi-client";

export class Agent extends ServiceMap.Service<
  Agent,
  {
    readonly stream: (
      options: AgentStreamOptions,
    ) => Stream.Stream<
      AcpSessionUpdate,
      | AgentStreamError
      | AgentSessionCreateError
      | AgentProviderUnauthenticatedError
      | AgentProviderUsageLimitError
      | PiBinaryNotFoundError
      | PiUnsupportedVersionError
    >;
    readonly createSession: (
      cwd: string,
    ) => Effect.Effect<
      SessionId,
      | AgentSessionCreateError
      | AgentProviderUnauthenticatedError
      | AgentProviderUsageLimitError
      | PiBinaryNotFoundError
      | PiUnsupportedVersionError
    >;
  }
>()("@expect/Agent") {
  static layerAcp = Layer.effect(Agent)(
    Effect.gen(function* () {
      const acpClient = yield* AcpClient;

      return Agent.of({
        createSession: (cwd) => acpClient.createSession(cwd),
        stream: (options) =>
          acpClient.stream({
            cwd: options.cwd,
            sessionId: Option.map(options.sessionId, (id) => id as SessionId),
            prompt: options.prompt,
            mcpEnv: options.mcpEnv,
          }),
      });
    }),
  ).pipe(Layer.provide(AcpClient.layer));

  static layerCodex = Agent.layerAcp.pipe(Layer.provide(AcpAdapter.layerCodex));
  static layerClaude = Agent.layerAcp.pipe(Layer.provide(AcpAdapter.layerClaude));
  static layerPi = Layer.effect(Agent)(
    Effect.gen(function* () {
      const piClient = yield* PiClient;

      return Agent.of({
        createSession: (cwd) => piClient.createSession(cwd),
        stream: (options) =>
          piClient.stream({
            cwd: options.cwd,
            sessionId: Option.map(options.sessionId, (id) => id as SessionId),
            prompt: options.prompt,
            systemPrompt: options.systemPrompt,
            mcpEnv: options.mcpEnv,
          }),
      });
    }),
  ).pipe(Layer.provide(PiClient.layer));

  static layerFor = (backend: AgentBackend) => {
    switch (backend) {
      case "claude":
        return Agent.layerClaude;
      case "codex":
        return Agent.layerCodex;
      case "pi":
        return Agent.layerPi;
      default:
        return Agent.layerClaude;
    }
  };

  static layerTest = (fixturePath: string) =>
    Layer.effect(
      Agent,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const decode = Schema.decodeSync(AcpSessionUpdate);

        return Agent.of({
          stream: () =>
            fs.stream(fixturePath).pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.map((line) => decode(JSON.parse(line))),
              Stream.orDie,
            ),
          createSession: () => Effect.die("createSession not supported for test layer"),
        });
      }),
    ).pipe(Layer.provide(NodeServices.layer));
}
