import { describe, expect, it } from "vite-plus/test";
import { Agent } from "../src/agent";

describe("Agent.layerFor", () => {
  it("selects the pi layer", () => {
    expect(Agent.layerFor("pi")).toBe(Agent.layerPi);
  });

  it("selects the claude layer", () => {
    expect(Agent.layerFor("claude")).toBe(Agent.layerClaude);
  });

  it("selects the codex layer", () => {
    expect(Agent.layerFor("codex")).toBe(Agent.layerCodex);
  });
});
