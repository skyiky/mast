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

// ---------------------------------------------------------------------------
// API → ChatMessage mapping
// ---------------------------------------------------------------------------

/** Raw part shape from OpenCode REST API / orchestrator cache. */
export interface RawApiPart {
  type: string;
  content?: string;
  text?: string;
  toolName?: string;
  tool?: string;
  toolArgs?: string;
  callID?: string;
  state?: Record<string, unknown>;
}

/** Raw message shape from OpenCode REST API. */
export interface RawApiMessage {
  id: string;
  role: string;
  /** Top-level content field — OpenCode puts user message text here instead of in parts. */
  content?: string;
  parts?: RawApiPart[];
  streaming?: boolean;
  createdAt?: string;
}

/** Map raw API messages to ChatMessage[]. Handles field-name differences
 *  between OpenCode wire format (`text`, `tool`, `state`) and our internal types. */
export function mapApiMessages(raw: RawApiMessage[]): ChatMessage[] {
  return raw.map((m) => {
    const mappedParts = (m.parts ?? []).map(mapApiPart);
    // OpenCode puts user message text in a top-level `content` field, not in parts.
    // Synthesize a text part so the message bubble has something to render.
    if (mappedParts.length === 0 && m.content) {
      mappedParts.push({ type: "text", content: m.content });
    }
    return {
      id: m.id,
      role: (m.role as "user" | "assistant") || "assistant",
      parts: mappedParts,
      streaming: m.streaming ?? false,
      createdAt: m.createdAt ?? new Date().toISOString(),
    };
  });
}

function mapApiPart(p: RawApiPart): MessagePart {
  const type = p.type === "tool" ? "tool-invocation" : (p.type as MessagePart["type"]) || "text";
  const content = p.text ?? p.content ?? "";
  const part: MessagePart = { type, content };
  if (p.toolName ?? p.tool) part.toolName = p.toolName ?? p.tool;
  if (p.toolArgs) part.toolArgs = p.toolArgs;
  if (p.callID) part.callID = p.callID;
  if (p.state) {
    if (p.state.input && !part.toolArgs) part.toolArgs = typeof p.state.input === "string" ? p.state.input : JSON.stringify(p.state.input);
    if (p.state.output) part.content = String(p.state.output);
    if (p.state.error) part.content = String(p.state.error);
  }
  return part;
}
