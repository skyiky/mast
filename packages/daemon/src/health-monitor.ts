// OpenCode health monitoring for the Mast daemon.
// Periodically checks the local OpenCode server's health endpoint.
// After 3 consecutive failures, marks OpenCode as down and triggers recovery.

export type HealthState = "healthy" | "degraded" | "down";

export interface HealthMonitorConfig {
  opencodeBaseUrl: string;
  checkIntervalMs?: number;     // Default 30_000 (30s)
  failureThreshold?: number;    // Default 3
  onStateChange?: (state: HealthState, ready: boolean) => void;
  onRecoveryNeeded?: () => Promise<void>;
}

export class HealthMonitor {
  private opencodeBaseUrl: string;
  private checkIntervalMs: number;
  private failureThreshold: number;
  private onStateChange?: (state: HealthState, ready: boolean) => void;
  private onRecoveryNeeded?: () => Promise<void>;

  private interval: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private _state: HealthState = "healthy";
  private _running = false;
  private recovering = false;

  constructor(config: HealthMonitorConfig) {
    this.opencodeBaseUrl = config.opencodeBaseUrl;
    this.checkIntervalMs = config.checkIntervalMs ?? 30_000;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.onStateChange = config.onStateChange;
    this.onRecoveryNeeded = config.onRecoveryNeeded;
  }

  get state(): HealthState {
    return this._state;
  }

  get running(): boolean {
    return this._running;
  }

  get failures(): number {
    return this.consecutiveFailures;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this.interval = setInterval(() => {
      this.check().catch((err) => {
        console.error("[health] check error:", err);
      });
    }, this.checkIntervalMs);
  }

  stop(): void {
    this._running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Run a single health check. Exposed for testing.
   */
  async check(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${this.opencodeBaseUrl}/global/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        return this.handleSuccess();
      } else {
        return this.handleFailure();
      }
    } catch {
      return this.handleFailure();
    }
  }

  private handleSuccess(): boolean {
    const wasDown = this._state === "down";
    this.consecutiveFailures = 0;
    this._state = "healthy";

    if (wasDown) {
      this.recovering = false;
      this.onStateChange?.("healthy", true);
    }

    return true;
  }

  private handleFailure(): boolean {
    this.consecutiveFailures++;

    if (this.consecutiveFailures < this.failureThreshold) {
      this._state = "degraded";
      // Don't fire state change for transient failures
      return false;
    }

    if (this._state !== "down") {
      this._state = "down";
      this.onStateChange?.("down", false);

      // Trigger recovery if not already recovering
      if (!this.recovering && this.onRecoveryNeeded) {
        this.recovering = true;
        this.onRecoveryNeeded().catch((err) => {
          console.error("[health] recovery error:", err);
          this.recovering = false;
        });
      }
    }

    return false;
  }

  /**
   * Reset state (e.g., after manual restart).
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this._state = "healthy";
    this.recovering = false;
  }
}
