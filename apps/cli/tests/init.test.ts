import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { exec } from "node:child_process";
import { detectPackageManager, runInit } from "../src/commands/init";

const succeedSpy = vi.fn();
const failSpy = vi.fn();
const mockDetectAvailableAgents = vi.fn();

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  exec: vi.fn((command, callback) => callback(null)),
}));

vi.mock("@expect/agent", () => ({
  detectAvailableAgents: (...args: unknown[]) => mockDetectAvailableAgents(...args),
}));

vi.mock("../src/utils/spinner", () => ({
  spinner: () => ({
    start: () => ({
      succeed: succeedSpy,
      fail: failSpy,
    }),
  }),
}));

vi.mock("../src/utils/prompts", () => ({
  prompts: vi.fn().mockResolvedValue({ installSkill: false }),
}));

const mockedExec = vi.mocked(exec);

describe("init", () => {
  describe("detectPackageManager", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.VITE_PLUS_CLI_BIN;
      delete process.env.npm_config_user_agent;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("detects vp from VITE_PLUS_CLI_BIN", () => {
      process.env.VITE_PLUS_CLI_BIN = "/usr/local/bin/vp";
      expect(detectPackageManager()).toBe("vp");
    });

    it("prioritizes vp over npm_config_user_agent", () => {
      process.env.VITE_PLUS_CLI_BIN = "/usr/local/bin/vp";
      process.env.npm_config_user_agent = "npm/10.0.0 node/v20.0.0";
      expect(detectPackageManager()).toBe("vp");
    });

    it("detects npm from user agent", () => {
      process.env.npm_config_user_agent = "npm/10.0.0 node/v20.0.0";
      expect(detectPackageManager()).toBe("npm");
    });

    it("detects pnpm from user agent", () => {
      process.env.npm_config_user_agent = "pnpm/8.15.0 node/v20.0.0";
      expect(detectPackageManager()).toBe("pnpm");
    });

    it("detects yarn from user agent", () => {
      process.env.npm_config_user_agent = "yarn/4.0.0 node/v20.0.0";
      expect(detectPackageManager()).toBe("yarn");
    });

    it("detects bun from user agent", () => {
      process.env.npm_config_user_agent = "bun/1.0.0 node/v20.0.0";
      expect(detectPackageManager()).toBe("bun");
    });

    it("falls back to npm when no env vars set", () => {
      expect(detectPackageManager()).toBe("npm");
    });
  });

  describe("runInit", () => {
    const originalEnv = process.env;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.VITE_PLUS_CLI_BIN;
      delete process.env.npm_config_user_agent;
      vi.clearAllMocks();
      mockDetectAvailableAgents.mockReturnValue(["claude"]);
      mockedExec.mockImplementation((_command, callback) => {
        callback?.(null);
        return {} as never;
      });
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("exits with error when no agents are detected", async () => {
      mockDetectAvailableAgents.mockReturnValue([]);

      await runInit({ yes: true });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("proceeds when at least one agent is detected", async () => {
      mockDetectAvailableAgents.mockReturnValue(["pi"]);

      await runInit({ yes: true });

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("global install command uses the detected package manager binary", async () => {
      process.env.npm_config_user_agent = "pnpm/8.15.0 node/v20.0.0";
      mockDetectAvailableAgents.mockReturnValue(["pi"]);

      await runInit({ yes: true });

      const installCall = mockedExec.mock.calls.find((call) => String(call[0]).includes("-g"));
      expect(installCall).toBeDefined();
      expect(String(installCall![0])).toMatch(/^pnpm /);
    });

    it("uses vp binary when VITE_PLUS_CLI_BIN is set", async () => {
      process.env.VITE_PLUS_CLI_BIN = "/usr/local/bin/vp";
      mockDetectAvailableAgents.mockReturnValue(["pi"]);

      await runInit({ yes: true });

      const installCall = mockedExec.mock.calls.find((call) => String(call[0]).includes("-g"));
      expect(installCall).toBeDefined();
      expect(String(installCall![0])).toMatch(/^vp /);
    });

    it("continues to skill install even when global install fails", async () => {
      mockDetectAvailableAgents.mockReturnValue(["pi"]);
      mockedExec.mockImplementation((command, callback) => {
        const cmd = String(command);
        callback?.(cmd.includes("-g") ? new Error("install failed") : null);
        return {} as never;
      });

      await runInit({ yes: true });

      const skillCall = mockedExec.mock.calls.find((call) =>
        String(call[0]).includes("skills add"),
      );
      expect(skillCall).toBeDefined();
    });

    it("shows spinner fail when install throws", async () => {
      mockDetectAvailableAgents.mockReturnValue(["pi"]);
      mockedExec.mockImplementation((_command, callback) => {
        callback?.(new Error("install failed"));
        return {} as never;
      });

      await runInit({ yes: true });

      expect(failSpy).toHaveBeenCalled();
    });

    it("does not call prompts in non-interactive mode", async () => {
      const { prompts } = await import("../src/utils/prompts");
      mockDetectAvailableAgents.mockReturnValue(["pi"]);

      await runInit({ yes: true });

      expect(prompts).not.toHaveBeenCalled();
    });
  });
});
