import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { execSync } from "node:child_process";
import { detectAvailableAgents } from "../src/detect-agents";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

describe("detectAvailableAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns agents whose binaries are on PATH", () => {
    mockedExecSync.mockImplementation((command) => {
      if (String(command) === "which claude") return Buffer.from("/usr/local/bin/claude");
      throw new Error("not found");
    });

    const agents = detectAvailableAgents();
    expect(agents).toEqual(["claude"]);
  });

  it("returns empty array when no agents are found", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const agents = detectAvailableAgents();
    expect(agents).toEqual([]);
  });

  it("returns multiple agents when available", () => {
    mockedExecSync.mockImplementation((command) => {
      const cmd = String(command);
      if (cmd === "which claude" || cmd === "which codex") return Buffer.from("");
      throw new Error("not found");
    });

    const agents = detectAvailableAgents();
    expect(agents).toEqual(["claude", "codex"]);
  });

  it("detects pi as a supported agent", () => {
    mockedExecSync.mockImplementation((command) => {
      if (String(command) === "which pi") return Buffer.from("/usr/local/bin/pi");
      throw new Error("not found");
    });

    const agents = detectAvailableAgents();
    expect(agents).toEqual(["pi"]);
  });

  it("checks all supported agents", () => {
    mockedExecSync.mockImplementation(() => Buffer.from(""));

    const agents = detectAvailableAgents();
    expect(agents).toEqual(["claude", "codex", "pi"]);
  });
});
