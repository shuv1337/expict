export const AGENT_BACKENDS = ["claude", "codex", "pi"] as const;

export type AgentBackend = (typeof AGENT_BACKENDS)[number];

export const AGENT_BACKEND_DISPLAY_NAMES: Record<AgentBackend, string> = {
  claude: "Claude",
  codex: "Codex",
  pi: "Pi",
};

export const DEFAULT_AGENT_BACKEND: AgentBackend = "claude";
