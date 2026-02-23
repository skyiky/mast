/**
 * Push notification module — Phase 3 + multi-user.
 *
 * Decides when to send push notifications and handles deduplication.
 * The actual HTTP send goes to Expo's push API (or a fake in tests).
 *
 * All methods that interact with the store or check phone connectivity
 * now require a userId parameter for multi-user scoping.
 *
 * Design:
 * - permission.created → push immediately (if no phone connected)
 * - message.completed → push "Task complete" (if no phone connected)
 * - message.part.updated → debounce, one "agent working" push per 5 min
 * - daemon disconnect → push after 30s grace period
 * - daemon reconnect within 30s → cancel disconnect push
 */

import type { SessionStore } from "./session-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushPayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushConfig {
  /** Expo push API URL (override for testing) */
  pushApiUrl: string;
  /** Function that returns whether a phone is currently connected for a user */
  isPhoneConnected: (userId: string) => boolean;
}

// ---------------------------------------------------------------------------
// Push decision logic
// ---------------------------------------------------------------------------

export type PushDecision =
  | { send: true; title: string; body: string; data?: Record<string, unknown> }
  | { send: false };

/**
 * Given an event type and its properties, decide whether to push.
 * This is a pure function — no side effects.
 */
export function decidePush(
  eventType: string,
  properties?: Record<string, unknown>,
): PushDecision {
  switch (eventType) {
    case "permission.created": {
      const description =
        (properties?.permission as { description?: string })?.description ??
        (properties?.permission as { command?: string })?.command ??
        "perform an action";
      return {
        send: true,
        title: "Approval needed",
        body: `Agent wants to: ${description}`,
        data: {
          type: "permission",
          permissionId: (properties?.permission as { id?: string })?.id,
          sessionId: properties?.sessionID,
        },
      };
    }

    case "message.completed": {
      return {
        send: true,
        title: "Task complete",
        body: "Tap to review.",
        data: {
          type: "completed",
          sessionId: properties?.sessionID,
        },
      };
    }

    case "message.part.updated": {
      return {
        send: true,
        title: "Agent working",
        body: "Agent is working on your task.",
        data: { type: "working", sessionId: properties?.sessionID },
      };
    }

    default:
      return { send: false };
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Tracks last push time per category to prevent spam.
 * Keys include userId for multi-user isolation.
 * - "permission" → no dedup (always send immediately)
 * - "working" → max once per 5 minutes per user
 * - "completed" → no dedup
 * - "daemon_offline" → 30s grace period per user
 */
export class PushDeduplicator {
  private lastSent = new Map<string, number>();
  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Interval in ms for "working" notifications */
  private workingIntervalMs: number;
  /** Grace period in ms for daemon disconnect */
  private disconnectGraceMs: number;

  constructor(opts?: {
    workingIntervalMs?: number;
    disconnectGraceMs?: number;
  }) {
    this.workingIntervalMs = opts?.workingIntervalMs ?? 5 * 60 * 1000;
    this.disconnectGraceMs = opts?.disconnectGraceMs ?? 30 * 1000;
  }

  /**
   * Check if a push for this category should be sent now.
   * Returns true if it should be sent, false if it should be suppressed.
   */
  shouldSend(userId: string, category: string): boolean {
    // Permission and completed: always send
    if (category === "permission" || category === "completed") {
      return true;
    }

    // Working: debounce to once per interval, per user
    if (category === "working") {
      const key = `${userId}:working`;
      const last = this.lastSent.get(key);
      const now = Date.now();
      if (last && now - last < this.workingIntervalMs) {
        return false;
      }
      this.lastSent.set(key, now);
      return true;
    }

    return true;
  }

  /**
   * Schedule a deferred push (for daemon disconnect), per user.
   */
  scheduleDaemonOffline(userId: string, callback: () => void): void {
    const key = `${userId}:daemon_offline`;
    // Cancel any existing timer for this user
    this.cancelDaemonOffline(userId);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(key);
      callback();
    }, this.disconnectGraceMs);
    this.pendingTimers.set(key, timer);
  }

  /** Cancel a pending daemon offline push for a user (daemon reconnected in time). */
  cancelDaemonOffline(userId: string): void {
    const key = `${userId}:daemon_offline`;
    const timer = this.pendingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(key);
    }
  }

  /** Whether a daemon offline push is pending for a user. */
  hasPendingDaemonOffline(userId: string): boolean {
    return this.pendingTimers.has(`${userId}:daemon_offline`);
  }

  /** Reset all state (for tests). */
  reset(): void {
    this.lastSent.clear();
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }
}

// ---------------------------------------------------------------------------
// PushNotifier — sends pushes via Expo's API
// ---------------------------------------------------------------------------

export class PushNotifier {
  private store: SessionStore;
  private config: PushConfig;
  private dedup: PushDeduplicator;

  constructor(
    store: SessionStore,
    config: PushConfig,
    dedup?: PushDeduplicator,
  ) {
    this.store = store;
    this.config = config;
    this.dedup = dedup ?? new PushDeduplicator();
  }

  /**
   * Handle an incoming event — decide whether to push and send if needed.
   * Only sends when the phone is NOT connected (push is a fallback channel).
   */
  async handleEvent(
    userId: string,
    event: {
      type: string;
      properties?: Record<string, unknown>;
    },
  ): Promise<void> {
    // If phone is connected, no push needed
    if (this.config.isPhoneConnected(userId)) {
      return;
    }

    const decision = decidePush(event.type, event.properties);
    if (!decision.send) return;

    // Map event type to dedup category
    const category = this.eventCategory(event.type);
    if (!this.dedup.shouldSend(userId, category)) return;

    await this.sendPush(userId, decision.title, decision.body, decision.data);
  }

  /** Handle daemon disconnect — schedule a deferred push for the user. */
  handleDaemonDisconnect(userId: string): void {
    this.dedup.scheduleDaemonOffline(userId, async () => {
      await this.sendPush(
        userId,
        "Dev machine offline",
        "Your dev machine went offline.",
        { type: "daemon_offline" },
      );
    });
  }

  /** Handle daemon reconnect — cancel pending offline push for the user. */
  handleDaemonReconnect(userId: string): void {
    this.dedup.cancelDaemonOffline(userId);
  }

  /** Expose dedup for testing. */
  getDeduplicator(): PushDeduplicator {
    return this.dedup;
  }

  private eventCategory(eventType: string): string {
    if (eventType === "permission.created") return "permission";
    if (eventType === "message.completed") return "completed";
    if (eventType === "message.part.updated") return "working";
    return "other";
  }

  private async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const tokens = await this.store.getPushTokens(userId);
    if (tokens.length === 0) return;

    const payloads: PushPayload[] = tokens.map((token) => ({
      to: token,
      title,
      body,
      data,
    }));

    try {
      await fetch(this.config.pushApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloads),
      });
    } catch (err) {
      console.error(
        "[push] failed to send:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
