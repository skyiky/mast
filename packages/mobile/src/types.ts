/**
 * Message types for the chat UI.
 *
 * These are the client-side representations of messages.
 * They are built from OpenCode SSE events.
 */

export interface MessagePart {
  type: "text" | "tool-invocation" | "tool-result" | "reasoning" | "file";
  content: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  /** Whether the message is still streaming */
  streaming: boolean;
  createdAt: string;
}

/** Server config for connecting to the orchestrator */
export interface ServerConfig {
  /** Base HTTP URL, e.g., "http://192.168.1.100:3000" */
  httpUrl: string;
  /** Base WS URL, e.g., "ws://192.168.1.100:3000" */
  wsUrl: string;
  /** API token for authentication */
  apiToken: string;
}
