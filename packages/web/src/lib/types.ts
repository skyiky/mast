/**
 * Shared domain types for the MAST web client.
 *
 * These mirror the types defined in the mobile app's session store.
 * They are defined here (not in @mast/shared) because the mobile app
 * also keeps its own local copies — the two clients evolve independently.
 */

export interface MessagePart {
  type: "text" | "tool-invocation" | "tool-result" | "reasoning" | "file";
  content: string;
  /** Tool name, if this is a tool-invocation or tool-result */
  toolName?: string;
  /** Tool arguments as JSON string */
  toolArgs?: string;
  /** OpenCode tool call ID — used to upsert tool parts as they progress
   *  through lifecycle states (pending → running → completed). */
  callID?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  streaming: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  /** Human-readable session nickname from OpenCode (e.g., "happy-wizard") */
  title?: string;
  /** Working directory the agent is operating in */
  directory?: string;
  /** Project name this session belongs to (from multi-project daemon) */
  project?: string;
  createdAt: string;
  updatedAt: string;
  /** Last user prompt text (truncated, for session list preview) */
  lastMessagePreview?: string;
  /** Whether the session has unread messages */
  hasActivity?: boolean;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  description: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
}
