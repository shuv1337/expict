import { Layer, References } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { Executor, FlowStorage, Git, GitRepoRoot, Reporter, Updates } from "@expect/supervisor";
import { Agent } from "@expect/agent";
import { type AgentBackend, DEFAULT_AGENT_BACKEND } from "@expect/shared";
import { Analytics, DebugFileLoggerLayer, Tracing } from "@expect/shared/observability";

export const layerCli = ({
  verbose,
  agent,
}: {
  verbose: boolean;
  agent: AgentBackend;
}): Layer.Layer<
  Analytics | Executor | FlowStorage | Git | GitRepoRoot | Reporter | Updates,
  any,
  never
> => {
  const gitLayer = Git.withRepoRoot(process.cwd());

  const baseLayer = Layer.mergeAll(
    Executor.layer.pipe(Layer.provide(gitLayer)),
    Reporter.layer,
    Updates.layer,
    FlowStorage.layer,
    DevTools.layer(),
    gitLayer,
    Analytics.layerPostHog,
  ).pipe(
    Layer.provide(DebugFileLoggerLayer),
    Layer.provide(Tracing.layerAxiom),
    Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, verbose ? "All" : "Error")),
  );

  switch (agent ?? DEFAULT_AGENT_BACKEND) {
    case "pi":
      return baseLayer.pipe(Layer.provide(Agent.layerPi));
    case "codex":
      return baseLayer.pipe(Layer.provide(Agent.layerCodex));
    case "claude":
    default:
      return baseLayer.pipe(Layer.provide(Agent.layerClaude));
  }
};
