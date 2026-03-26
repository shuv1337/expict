import { execSync } from "node:child_process";
import { AGENT_BACKENDS, type AgentBackend } from "@expect/shared";

export type SupportedAgent = AgentBackend;

const SUPPORTED_AGENTS: readonly SupportedAgent[] = AGENT_BACKENDS;

const isCommandAvailable = (command: string): boolean => {
  try {
    execSync(`which ${command}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

export const detectAvailableAgents = (): SupportedAgent[] =>
  SUPPORTED_AGENTS.filter(isCommandAvailable);
