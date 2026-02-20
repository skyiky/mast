/**
 * AgentRouter — Routes semantic commands to the correct AgentAdapter
 * based on session ownership.
 *
 * The router maintains a map of registered adapters (keyed by agentType)
 * and a map of sessionId → agentType for dispatch. When a session is created,
 * the router records which adapter owns it. All subsequent operations on that
 * session are dispatched to the owning adapter.
 *
 * Events from all adapters are aggregated and forwarded through a single
 * callback registered via onEvent().
 */

import type {
  AgentAdapter,
  MastEvent,
  MastSession,
  MastMessage,
} from "./agent-adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentInfo {
  type: string;
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class AgentRouter {
  /** agentType → adapter instance */
  private adapters = new Map<string, AgentAdapter>();

  /** sessionId → agentType (tracks which adapter owns each session) */
  private sessionOwner = new Map<string, string>();

  /** Registered event handlers */
  private eventHandlers: Array<(event: MastEvent) => void> = [];

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register an adapter. Subscribes to its events and adds it to the lookup.
   * If an adapter with the same agentType is already registered, it is replaced.
   */
  registerAdapter(adapter: AgentAdapter): void {
    const existing = this.adapters.get(adapter.agentType);
    if (existing) {
      // Remove old event listeners
      existing.events.removeAllListeners("event");
    }

    this.adapters.set(adapter.agentType, adapter);

    // Forward adapter events to our handlers
    adapter.events.on("event", (event: MastEvent) => {
      // Auto-track session ownership from events
      if (event.sessionId && !this.sessionOwner.has(event.sessionId)) {
        this.sessionOwner.set(event.sessionId, adapter.agentType);
      }

      for (const handler of this.eventHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error("[agent-router] Event handler error:", err);
        }
      }
    });
  }

  /**
   * Unregister an adapter. Removes event listeners and cleans up session mappings.
   */
  unregisterAdapter(agentType: string): void {
    const adapter = this.adapters.get(agentType);
    if (!adapter) return;

    adapter.events.removeAllListeners("event");
    this.adapters.delete(agentType);

    // Clean up session ownership entries for this adapter
    for (const [sessionId, owner] of this.sessionOwner) {
      if (owner === agentType) {
        this.sessionOwner.delete(sessionId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Event subscription
  // -----------------------------------------------------------------------

  /**
   * Register a handler for aggregated events from all adapters.
   * Returns an unsubscribe function.
   */
  onEvent(handler: (event: MastEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx !== -1) this.eventHandlers.splice(idx, 1);
    };
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /** Get info about all registered adapters. */
  getAgents(): AgentInfo[] {
    const agents: AgentInfo[] = [];
    for (const adapter of this.adapters.values()) {
      agents.push({
        type: adapter.agentType,
        // ready is determined by healthCheck, but we report based on registration
        // The caller can do healthCheck() individually if needed
        ready: true,
      });
    }
    return agents;
  }

  /** Get the list of registered adapter types. */
  getAdapterTypes(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** Check if a specific agent type is registered. */
  hasAdapter(agentType: string): boolean {
    return this.adapters.has(agentType);
  }

  /** Get the adapter that owns a session, or undefined. */
  getSessionOwner(sessionId: string): string | undefined {
    return this.sessionOwner.get(sessionId);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Start all registered adapters. */
  async startAll(): Promise<void> {
    const startPromises = Array.from(this.adapters.values()).map((a) =>
      a.start().catch((err) => {
        console.error(`[agent-router] Failed to start ${a.agentType}:`, err);
      }),
    );
    await Promise.all(startPromises);
  }

  /** Stop all registered adapters. */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.adapters.values()).map((a) =>
      a.stop().catch((err) => {
        console.error(`[agent-router] Failed to stop ${a.agentType}:`, err);
      }),
    );
    await Promise.all(stopPromises);
  }

  /** Run health checks on all adapters. Returns per-adapter results. */
  async healthCheckAll(): Promise<AgentInfo[]> {
    const results: AgentInfo[] = [];
    for (const adapter of this.adapters.values()) {
      let ready = false;
      try {
        ready = await adapter.healthCheck();
      } catch {
        ready = false;
      }
      results.push({ type: adapter.agentType, ready });
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Sessions
  // -----------------------------------------------------------------------

  /**
   * List sessions from all adapters, merged into a single array.
   */
  async listSessions(): Promise<MastSession[]> {
    const allSessions: MastSession[] = [];

    const results = await Promise.allSettled(
      Array.from(this.adapters.values()).map((a) => a.listSessions()),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const session of result.value) {
          allSessions.push(session);
          // Ensure session ownership is tracked (in case adapter was restarted
          // and has sessions we don't know about yet)
          if (!this.sessionOwner.has(session.id)) {
            this.sessionOwner.set(session.id, session.agentType);
          }
        }
      }
    }

    return allSessions;
  }

  /**
   * Create a new session on a specific agent.
   *
   * @param agentType - Which agent to create the session on.
   *   If not specified, uses MAST_DEFAULT_AGENT env var, then falls back
   *   to the first registered adapter.
   */
  async createSession(agentType?: string): Promise<MastSession> {
    const resolvedType = this.resolveAgentType(agentType);
    const adapter = this.adapters.get(resolvedType);
    if (!adapter) {
      throw new Error(`No adapter registered for agent type: ${resolvedType}`);
    }

    const session = await adapter.createSession();
    this.sessionOwner.set(session.id, resolvedType);
    return session;
  }

  // -----------------------------------------------------------------------
  // Messaging
  // -----------------------------------------------------------------------

  /**
   * Send a prompt to the agent that owns the session.
   * Fire-and-forget — response streams back via events.
   */
  sendPrompt(sessionId: string, text: string): void {
    const adapter = this.getAdapterForSession(sessionId);
    adapter.sendPrompt(sessionId, text);
  }

  /** Abort a running session. */
  async abortSession(sessionId: string): Promise<void> {
    const adapter = this.getAdapterForSession(sessionId);
    await adapter.abortSession(sessionId);
  }

  /** Get messages for a session. */
  async getMessages(sessionId: string): Promise<MastMessage[]> {
    const adapter = this.getAdapterForSession(sessionId);
    return adapter.getMessages(sessionId);
  }

  // -----------------------------------------------------------------------
  // Permissions
  // -----------------------------------------------------------------------

  /** Approve a pending permission. */
  approvePermission(sessionId: string, permissionId: string): void {
    const adapter = this.getAdapterForSession(sessionId);
    adapter.approvePermission(sessionId, permissionId);
  }

  /** Deny a pending permission. */
  denyPermission(sessionId: string, permissionId: string): void {
    const adapter = this.getAdapterForSession(sessionId);
    adapter.denyPermission(sessionId, permissionId);
  }

  // -----------------------------------------------------------------------
  // Diff
  // -----------------------------------------------------------------------

  /** Get the file diff for a session. */
  async getDiff(sessionId: string): Promise<unknown> {
    const adapter = this.getAdapterForSession(sessionId);
    return adapter.getDiff(sessionId);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve which agent type to use for a new session.
   * Priority: explicit param > MAST_DEFAULT_AGENT env var > first registered adapter.
   */
  private resolveAgentType(agentType?: string): string {
    if (agentType) {
      if (!this.adapters.has(agentType)) {
        throw new Error(
          `Agent type "${agentType}" is not registered. ` +
          `Available: ${this.getAdapterTypes().join(", ")}`,
        );
      }
      return agentType;
    }

    // Check env var
    const envDefault = process.env.MAST_DEFAULT_AGENT;
    if (envDefault && this.adapters.has(envDefault)) {
      return envDefault;
    }

    // Fall back to first registered adapter
    const firstType = this.adapters.keys().next().value;
    if (!firstType) {
      throw new Error("No adapters registered. Cannot create session.");
    }
    return firstType as string;
  }

  /**
   * Look up the adapter for a session by its ownership mapping.
   * Falls back to the default adapter when only one adapter is registered
   * (single-agent mode) or when a default can be resolved.
   */
  private getAdapterForSession(sessionId: string): AgentAdapter {
    const agentType = this.sessionOwner.get(sessionId);
    if (agentType) {
      const adapter = this.adapters.get(agentType);
      if (adapter) return adapter;

      throw new Error(
        `Adapter "${agentType}" for session ${sessionId} is no longer registered.`,
      );
    }

    // Fallback: resolve to default adapter (first registered / env override)
    // This supports the common single-agent case where sessions may exist
    // on the agent without the router having seen them created or announced.
    try {
      const defaultType = this.resolveAgentType();
      const defaultAdapter = this.adapters.get(defaultType);
      if (defaultAdapter) {
        // Auto-assign ownership so future lookups are fast
        this.sessionOwner.set(sessionId, defaultType);
        return defaultAdapter;
      }
    } catch {
      // resolveAgentType throws if no adapters registered
    }

    throw new Error(
      `Unknown session: ${sessionId}. ` +
      `No adapter is registered as the owner of this session.`,
    );
  }
}
