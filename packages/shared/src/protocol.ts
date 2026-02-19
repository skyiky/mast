// Mast WSS Protocol Types
// Shared types for the relay system:
//   Orchestrator (cloud) <--WSS--> Daemon (dev machine) --> OpenCode (localhost:4096)

// ---------------------------------------------------------------------------
// Messages: Orchestrator -> Daemon
// ---------------------------------------------------------------------------

export interface HttpRequest {
  type: "http_request";
  requestId: string;
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

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

export type OrchestratorMessage = HttpRequest | HeartbeatAck | SyncRequest | PairResponse;

// ---------------------------------------------------------------------------
// Messages: Daemon -> Orchestrator
// ---------------------------------------------------------------------------

export interface HttpResponse {
  type: "http_response";
  requestId: string;
  status: number;
  body: unknown;
}

export interface EventMessage {
  type: "event";
  event: {
    type: string;
    data: unknown;
  };
  timestamp: string;
}

export interface DaemonStatus {
  type: "status";
  opencodeReady: boolean;
  opencodeVersion?: string;
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

export type DaemonMessage = HttpResponse | EventMessage | DaemonStatus | Heartbeat | SyncResponse | PairRequest;

// ---------------------------------------------------------------------------
// Constants (Phase 1 — hardcoded, no real auth)
// ---------------------------------------------------------------------------

export const HARDCODED_DEVICE_KEY = "mast-dev-key-phase1";
export const HARDCODED_API_TOKEN = "mast-api-token-phase1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function generatePairingCode(): string {
  // 6-digit numeric code (100000-999999)
  return String(100000 + Math.floor(Math.random() * 900000));
}
