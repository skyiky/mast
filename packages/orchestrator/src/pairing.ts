// Pairing flow for the Mast orchestrator.
// Manages the lifecycle of pairing codes: generation, storage, expiry, verification.
// Only one active pairing code at a time per orchestrator instance.

import type { WebSocket as WsWebSocket } from "ws";
import type { PairResponse } from "@mast/shared";

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PendingPairing {
  code: string;
  createdAt: number;
  daemonWs: WsWebSocket;
}

export class PairingManager {
  private pending: PendingPairing | null = null;
  private issuedKeys = new Set<string>();

  /**
   * Register a new pairing code from a daemon.
   * Invalidates any previously pending code.
   */
  registerCode(code: string, daemonWs: WsWebSocket): void {
    // Invalidate any previous pending pairing
    if (this.pending) {
      this.rejectPending("replaced");
    }
    this.pending = { code, createdAt: Date.now(), daemonWs };
  }

  /**
   * Verify a pairing code submitted by the phone.
   * Returns a device key on success, or an error string on failure.
   */
  verify(code: string): { success: true; deviceKey: string } | { success: false; error: string } {
    if (!this.pending) {
      return { success: false, error: "no_pending_pairing" };
    }

    // Check expiry
    if (Date.now() - this.pending.createdAt > PAIRING_CODE_TTL_MS) {
      this.cleanup();
      return { success: false, error: "code_expired" };
    }

    // Check code
    if (this.pending.code !== code) {
      return { success: false, error: "invalid_code" };
    }

    // Success — generate device key and notify daemon
    const deviceKey = `dk_${crypto.randomUUID()}`;
    this.issuedKeys.add(deviceKey);

    const response: PairResponse = {
      type: "pair_response",
      success: true,
      deviceKey,
    };

    try {
      this.pending.daemonWs.send(JSON.stringify(response));
    } catch {
      // Daemon may have disconnected — key is still valid
    }

    this.pending = null;
    return { success: true, deviceKey };
  }

  /**
   * Check if a device key was issued by this pairing manager.
   * Used for auth in addition to the hardcoded Phase 1 key.
   */
  isValidKey(key: string): boolean {
    return this.issuedKeys.has(key);
  }

  /**
   * Clean up when the pairing daemon disconnects before completing.
   */
  handleDaemonDisconnect(ws: WsWebSocket): void {
    if (this.pending && this.pending.daemonWs === ws) {
      this.pending = null;
    }
  }

  /**
   * Whether there is an active (non-expired) pending pairing.
   */
  hasPending(): boolean {
    if (!this.pending) return false;
    if (Date.now() - this.pending.createdAt > PAIRING_CODE_TTL_MS) {
      this.cleanup();
      return false;
    }
    return true;
  }

  /**
   * Get the pending pairing code (for testing).
   */
  getPendingCode(): string | null {
    if (!this.hasPending()) return null;
    return this.pending!.code;
  }

  private rejectPending(reason: string): void {
    if (!this.pending) return;
    const response: PairResponse = {
      type: "pair_response",
      success: false,
      error: reason,
    };
    try {
      this.pending.daemonWs.send(JSON.stringify(response));
    } catch {
      // Daemon may have disconnected
    }
    this.pending = null;
  }

  private cleanup(): void {
    this.pending = null;
  }
}
