// Pairing flow for the Mast orchestrator.
// Manages the lifecycle of pairing codes: generation, storage, expiry, verification.
// Supports multiple simultaneous pending pairings (one per daemon connection).
// After verification, device keys are mapped to user IDs.

import type { WebSocket as WsWebSocket } from "ws";
import type { PairResponse } from "@mast/shared";

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PendingPairing {
  code: string;
  createdAt: number;
  daemonWs: WsWebSocket;
}

export class PairingManager {
  /** Active pending pairings, keyed by pairing code */
  private pendingByCode = new Map<string, PendingPairing>();
  /** Track which daemon WS has a pending pairing (for disconnect cleanup) */
  private pendingByWs = new Map<WsWebSocket, string>();
  /** Issued device keys → userId mapping */
  private issuedKeys = new Map<string, string>();

  /**
   * Register a new pairing code from a daemon.
   * If this daemon already has a pending code, the old one is replaced.
   */
  registerCode(code: string, daemonWs: WsWebSocket): void {
    // If this daemon already has a pending pairing, reject the old one
    const existingCode = this.pendingByWs.get(daemonWs);
    if (existingCode) {
      this.rejectPending(existingCode, "replaced");
    }

    this.pendingByCode.set(code, { code, createdAt: Date.now(), daemonWs });
    this.pendingByWs.set(daemonWs, code);
  }

  /**
   * Verify a pairing code submitted by the phone.
   * userId is the authenticated user who is verifying.
   * Returns a device key on success, or an error string on failure.
   */
  verify(
    code: string,
    userId: string,
  ): { success: true; deviceKey: string } | { success: false; error: string } {
    const pending = this.pendingByCode.get(code);

    if (!pending) {
      return { success: false, error: "no_pending_pairing" };
    }

    // Check expiry
    if (Date.now() - pending.createdAt > PAIRING_CODE_TTL_MS) {
      this.cleanupCode(code, pending.daemonWs);
      return { success: false, error: "code_expired" };
    }

    // Success — generate device key bound to this user
    const deviceKey = `dk_${crypto.randomUUID()}`;
    this.issuedKeys.set(deviceKey, userId);

    const response: PairResponse = {
      type: "pair_response",
      success: true,
      deviceKey,
    };

    try {
      pending.daemonWs.send(JSON.stringify(response));
    } catch {
      // Daemon may have disconnected — key is still valid
    }

    // Clean up the pending pairing
    this.pendingByCode.delete(code);
    this.pendingByWs.delete(pending.daemonWs);

    return { success: true, deviceKey };
  }

  /**
   * Check if a device key was issued by this pairing manager.
   */
  isValidKey(key: string): boolean {
    return this.issuedKeys.has(key);
  }

  /**
   * Get the userId bound to a device key.
   * Returns undefined if the key was not issued by this manager.
   */
  getUserIdForKey(key: string): string | undefined {
    return this.issuedKeys.get(key);
  }

  /**
   * Clean up when a pairing daemon disconnects before completing.
   */
  handleDaemonDisconnect(ws: WsWebSocket): void {
    const code = this.pendingByWs.get(ws);
    if (code) {
      this.pendingByCode.delete(code);
      this.pendingByWs.delete(ws);
    }
  }

  /**
   * Whether there is any active (non-expired) pending pairing.
   */
  hasPending(): boolean {
    this.cleanupExpired();
    return this.pendingByCode.size > 0;
  }

  /**
   * Get a pending pairing code (for testing — returns first active code).
   */
  getPendingCode(): string | null {
    this.cleanupExpired();
    const first = this.pendingByCode.keys().next();
    return first.done ? null : first.value;
  }

  private rejectPending(code: string, reason: string): void {
    const pending = this.pendingByCode.get(code);
    if (!pending) return;

    const response: PairResponse = {
      type: "pair_response",
      success: false,
      error: reason,
    };
    try {
      pending.daemonWs.send(JSON.stringify(response));
    } catch {
      // Daemon may have disconnected
    }
    this.pendingByCode.delete(code);
    this.pendingByWs.delete(pending.daemonWs);
  }

  private cleanupCode(code: string, daemonWs: WsWebSocket): void {
    this.pendingByCode.delete(code);
    this.pendingByWs.delete(daemonWs);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [code, pending] of this.pendingByCode) {
      if (now - pending.createdAt > PAIRING_CODE_TTL_MS) {
        this.pendingByCode.delete(code);
        this.pendingByWs.delete(pending.daemonWs);
      }
    }
  }
}
