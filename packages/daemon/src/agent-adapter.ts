/**
 * AgentAdapter — The interface every agent backend must implement.
 *
 * Each adapter wraps a specific coding agent (OpenCode, Claude Code, etc.)
 * and exposes a unified API for session management, messaging, permissions,
 * and event streaming.
 *
 * Adapters emit MastEvents via EventEmitter when the underlying agent
 * produces output (messages, permission requests, etc.).
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Mast canonical event types (agent-agnostic)
// ---------------------------------------------------------------------------

export type MastEventType =
  | "mast.message.created"
  | "mast.message.part.created"
  | "mast.message.part.updated"
  | "mast.message.completed"
  | "mast.permission.created"
  | "mast.permission.updated"
  | "mast.session.updated";

export interface MastEvent {
  type: MastEventType;
  sessionId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Mast canonical data types
// ---------------------------------------------------------------------------

export interface MastSession {
  id: string;
  title?: string;
  agentType: string; // "opencode" | "claude-code"
  createdAt: string;
}

export interface MastMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  completed: boolean;
}

export interface MastPermission {
  id: string;
  sessionId: string;
  description: string;
  toolName?: string;
  status: "pending" | "approved" | "denied";
}

// ---------------------------------------------------------------------------
// AgentAdapter interface
// ---------------------------------------------------------------------------

export interface AgentAdapter {
  /** Unique identifier for this agent type (e.g., "opencode", "claude-code") */
  readonly agentType: string;

  /** EventEmitter for streaming MastEvents. Use adapter.on("event", ...) */
  readonly events: EventEmitter;

  // -- Lifecycle --

  /** Start the agent (e.g., spawn process, validate API key). */
  start(): Promise<void>;

  /** Stop the agent and clean up all resources. */
  stop(): Promise<void>;

  /** Check if the agent is healthy and responsive. */
  healthCheck(): Promise<boolean>;

  // -- Sessions --

  /** List all sessions managed by this agent. */
  listSessions(): Promise<MastSession[]>;

  /** Create a new session. */
  createSession(): Promise<MastSession>;

  // -- Messaging --

  /**
   * Send a prompt to the agent in a session.
   * Fire-and-forget — response streams back via events.
   */
  sendPrompt(sessionId: string, text: string): void;

  /** Abort an in-progress session. */
  abortSession(sessionId: string): Promise<void>;

  /** Get all messages for a session. */
  getMessages(sessionId: string): Promise<MastMessage[]>;

  // -- Permissions --

  /** Approve a pending permission request. */
  approvePermission(sessionId: string, permissionId: string): void;

  /** Deny a pending permission request. */
  denyPermission(sessionId: string, permissionId: string): void;

  // -- Diff --

  /** Get the file diff for a session. */
  getDiff(sessionId: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Base class with EventEmitter wiring
// ---------------------------------------------------------------------------

/**
 * Convenience base class that wires up EventEmitter for adapters.
 * Extend this instead of implementing AgentAdapter from scratch.
 */
export abstract class BaseAdapter implements AgentAdapter {
  abstract readonly agentType: string;
  readonly events = new EventEmitter();

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract healthCheck(): Promise<boolean>;
  abstract listSessions(): Promise<MastSession[]>;
  abstract createSession(): Promise<MastSession>;
  abstract sendPrompt(sessionId: string, text: string): void;
  abstract abortSession(sessionId: string): Promise<void>;
  abstract getMessages(sessionId: string): Promise<MastMessage[]>;
  abstract approvePermission(sessionId: string, permissionId: string): void;
  abstract denyPermission(sessionId: string, permissionId: string): void;
  abstract getDiff(sessionId: string): Promise<unknown>;

  /** Emit a MastEvent to all listeners. */
  protected emitEvent(event: MastEvent): void {
    this.events.emit("event", event);
  }
}
