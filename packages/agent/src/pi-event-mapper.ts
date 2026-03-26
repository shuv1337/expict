import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpSessionUpdate,
  AcpToolCall,
  AcpToolCallUpdate,
} from "@expect/shared/models";

const toToolStatus = (
  event: AgentSessionEvent,
): "pending" | "in_progress" | "completed" | "failed" | undefined => {
  switch (event.type) {
    case "tool_execution_start":
      return "pending";
    case "tool_execution_update":
      return "in_progress";
    case "tool_execution_end":
      return event.isError ? "failed" : "completed";
    default:
      return undefined;
  }
};

export const mapPiEventToAcpUpdates = (event: AgentSessionEvent): AcpSessionUpdate[] => {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        return [
          new AcpAgentMessageChunk({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: inner.delta },
            messageId: undefined,
          }),
        ];
      }
      if (inner.type === "thinking_delta") {
        return [
          new AcpAgentThoughtChunk({
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: inner.delta },
            messageId: undefined,
          }),
        ];
      }
      return [];
    }
    case "tool_execution_start":
      return [
        new AcpToolCall({
          sessionUpdate: "tool_call",
          toolCallId: event.toolCallId,
          title: event.toolName,
          status: toToolStatus(event),
          rawInput: event.args,
          rawOutput: undefined,
        }),
      ];
    case "tool_execution_update":
      return [
        new AcpToolCallUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          title: event.toolName,
          status: toToolStatus(event),
          rawInput: event.args,
          rawOutput: event.partialResult,
        }),
      ];
    case "tool_execution_end":
      return [
        new AcpToolCallUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          title: event.toolName,
          status: toToolStatus(event),
          rawOutput: event.result,
        }),
      ];
    default:
      return [];
  }
};
