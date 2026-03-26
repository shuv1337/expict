import { describe, expect, it } from "vite-plus/test";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { mapPiEventToAcpUpdates } from "../src/pi-event-mapper";

describe("mapPiEventToAcpUpdates", () => {
  it("maps text deltas to agent message chunks", () => {
    const event = {
      type: "message_update",
      message: {} as never,
      assistantMessageEvent: {
        type: "text_delta",
        delta: "hello",
      },
    } satisfies AgentSessionEvent;

    const updates = mapPiEventToAcpUpdates(event);
    expect(updates).toHaveLength(1);
    expect(updates[0].sessionUpdate).toBe("agent_message_chunk");
    if (updates[0].sessionUpdate === "agent_message_chunk") {
      expect(updates[0].content.type).toBe("text");
      expect(updates[0].content.text).toBe("hello");
    }
  });

  it("maps thinking deltas to agent thought chunks", () => {
    const event = {
      type: "message_update",
      message: {} as never,
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "thinking",
      },
    } satisfies AgentSessionEvent;

    const updates = mapPiEventToAcpUpdates(event);
    expect(updates).toHaveLength(1);
    expect(updates[0].sessionUpdate).toBe("agent_thought_chunk");
  });

  it("maps tool lifecycle events", () => {
    const start = mapPiEventToAcpUpdates({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "open",
      args: { url: "http://localhost:3000" },
    } satisfies AgentSessionEvent);
    const update = mapPiEventToAcpUpdates({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "open",
      args: { url: "http://localhost:3000" },
      partialResult: { content: [{ type: "text", text: "partial" }] },
    } satisfies AgentSessionEvent);
    const end = mapPiEventToAcpUpdates({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "open",
      args: { url: "http://localhost:3000" },
      result: { content: [{ type: "text", text: "done" }] },
      isError: false,
    } satisfies AgentSessionEvent);

    expect(start[0].sessionUpdate).toBe("tool_call");
    expect(update[0].sessionUpdate).toBe("tool_call_update");
    expect(end[0].sessionUpdate).toBe("tool_call_update");
    if (end[0].sessionUpdate === "tool_call_update") {
      expect(end[0].status).toBe("completed");
    }
  });
});
