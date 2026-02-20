// Mast WSS Protocol Types
// Shared types for the relay system:
//   Orchestrator (cloud) <--WSS--> Daemon (dev machine) --> Agent (OpenCode / Claude Code)

// ===========================================================================
// Mast Event Types (agent-agnostic)
// ===========================================================================

export type MastEventType =
  | "mast.message.created"
  | "mast.message.part.created"
  | "mast.message.part.updated"
  | "mast.message.completed"
  | "mast.permission.created"
  | "mast.permission.updated"
  | "mast.session.updated";

// ===========================================================================
// Semantic Commands: Orchestrator -> Daemon
// ===========================================================================

export interface ListSessionsCommand {
  type: "list_sessions";
  requestId: string;
}

export interface CreateSessionCommand {
  type: "create_session";
  requestId: string;
  agentType?: string; // "opencode" | "claude-code" — defaults to MAST_DEFAULT_AGENT
}

export interface SendPromptCommand {
  type: "send_prompt";
  requestId: string;
  sessionId: string;
  text: string;
}

export interface ApprovePermissionCommand {
  type: "approve_permission";
  requestId: string;
  sessionId: string;
  permissionId: string;
}

export interface DenyPermissionCommand {
  type: "deny_permission";
  requestId: string;
  sessionId: string;
  permissionId: string;
}

export interface GetMessagesCommand {
  type: "get_messages";
  requestId: string;
  sessionId: string;
}

export interface GetDiffCommand {
  type: "get_diff";
  requestId: string;
  sessionId: string;
}

export interface AbortSessionCommand {
  type: "abort_session";
  requestId: string;
  sessionId: string;
}

export type OrchestratorCommand =
  | ListSessionsCommand
  | CreateSessionCommand
  | SendPromptCommand
  | ApprovePermissionCommand
  | DenyPermissionCommand
  | GetMessagesCommand
  | GetDiffCommand
  | AbortSessionCommand;

// ===========================================================================
// Semantic Responses: Daemon -> Orchestrator
// ===========================================================================

export interface CommandResult {
  type: "command_result";
  requestId: string;
  status: "ok" | "error";
  data?: unknown;
  error?: string;
}

// ===========================================================================
// Infrastructure Messages (unchanged from v1)
// ===========================================================================

// -- Orchestrator -> Daemon --

export interface HeartbeatAck {
  type: "heartbeat_ack";
  timestamp: string;
}

export interface SyncRequest {
  type: "sync_request";
  cachedSessionIds: string[];
  lastEventTimestamp: string; // ISO 8601
}

export interface PairResponse {
  type: "pair_response";
  success: boolean;
  deviceKey?: string;
  error?: string;
}

// -- Daemon -> Orchestrator --

export interface EventMessage {
  type: "event";
  event: {
    type: string; // MastEventType (e.g. "mast.message.created")
    sessionId: string;
    data: Record<string, unknown>;
  };
  timestamp: string;
}

export interface DaemonStatus {
  type: "status";
  agentReady: boolean;
  agents: Array<{
    type: string; // "opencode" | "claude-code"
    ready: boolean;
  }>;
}

export interface Heartbeat {
  type: "heartbeat";
  timestamp: string;
}

export interface SyncResponse {
  type: "sync_response";
  sessions: Array<{
    id: string;
    messages: Array<{
      id: string;
      role: string;
      parts: unknown[];
      completed: boolean;
    }>;
  }>;
}

export interface PairRequest {
  type: "pair_request";
  pairingCode: string;
}

// ===========================================================================
// Union Types
// ===========================================================================

/** All messages the orchestrator can send to the daemon. */
export type OrchestratorMessage =
  | OrchestratorCommand
  | HeartbeatAck
  | SyncRequest
  | PairResponse;

/** All messages the daemon can send to the orchestrator. */
export type DaemonMessage =
  | CommandResult
  | EventMessage
  | DaemonStatus
  | Heartbeat
  | SyncResponse
  | PairRequest;

// ===========================================================================
// Legacy types (deprecated — will be removed after migration)
// ===========================================================================

/** @deprecated Use OrchestratorCommand instead. Kept for migration. */
export interface HttpRequest {
  type: "http_request";
  requestId: string;
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

/** @deprecated Use CommandResult instead. Kept for migration. */
export interface HttpResponse {
  type: "http_response";
  requestId: string;
  status: number;
  body: unknown;
}

// ===========================================================================
// Constants (Phase 1 — hardcoded, no real auth)
// ===========================================================================

export const HARDCODED_DEVICE_KEY = "mast-dev-key-phase1";
export const HARDCODED_API_TOKEN = "mast-api-token-phase1";

// ===========================================================================
// Helpers
// ===========================================================================

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function generatePairingCode(): string {
  // 6-digit numeric code (100000-999999)
  return String(100000 + Math.floor(Math.random() * 900000));
}
