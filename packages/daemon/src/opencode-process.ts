import { spawn, type ChildProcess } from "child_process";

export interface OpenCodeProcessConfig {
  port?: number;
  cwd?: string;    // Working directory — OpenCode scopes sessions to this directory
  command?: string; // Override for testing (e.g., path to mock executable)
  args?: string[];  // Override args for testing
  onCrash?: (code: number | null, signal: string | null) => void;
}

export class OpenCodeProcess {
  private process: ChildProcess | null = null;
  private port: number;
  private _cwd?: string;
  private command: string;
  private args: string[];
  private _stopping = false; // true during intentional stop/restart
  private onCrash?: (code: number | null, signal: string | null) => void;

  constructor(config?: OpenCodeProcessConfig | number) {
    // Backwards-compatible: accept bare port number or config object
    if (typeof config === "number") {
      this.port = config;
      this.command = "opencode";
      this.args = ["serve", "--port", String(config)];
    } else {
      this.port = config?.port ?? 4096;
      this._cwd = config?.cwd;
      this.command = config?.command ?? "opencode";
      this.args = config?.args ?? ["serve", "--port", String(this.port)];
      this.onCrash = config?.onCrash;
    }
  }

  async start(): Promise<void> {
    if (process.env.MAST_SKIP_OPENCODE === "1") {
      console.log("[opencode] Skipping start (MAST_SKIP_OPENCODE=1)");
      return;
    }

    this._stopping = false;

    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        cwd: this._cwd,
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          console.error(
            `[opencode] '${this.command}' command not found. Is it installed and on PATH?`
          );
        } else {
          console.error("[opencode] Failed to start process:", err.message);
        }
        this.process = null;
        reject(err);
      });

      child.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().trimEnd().split("\n");
        for (const line of lines) {
          console.log(`[opencode] ${line}`);
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().trimEnd().split("\n");
        for (const line of lines) {
          console.error(`[opencode] ${line}`);
        }
      });

      child.on("exit", (code, signal) => {
        const wasRunning = this.process !== null;
        this.process = null;

        if (wasRunning && !this._stopping) {
          // Unexpected exit — this is a crash
          console.warn(
            `[opencode] Process crashed (code=${code}, signal=${signal})`
          );
          if (this.onCrash) {
            this.onCrash(code, signal);
          }
        }
      });

      this.process = child;

      // Process has been spawned — resolve immediately.
      // Callers should use waitForReady() to confirm the server is up.
      resolve();
    });
  }

  async waitForReady(maxAttempts?: number, intervalMs?: number): Promise<void> {
    const url = `${this.baseUrl}/global/health`;
    const attempts = maxAttempts ?? 30;
    const interval = intervalMs ?? 1000;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          return;
        }
        console.log(
          `[opencode] Health check attempt ${attempt}/${attempts}: status ${res.status}`
        );
      } catch {
        console.log(
          `[opencode] Health check attempt ${attempt}/${attempts}: not reachable`
        );
      }
      await sleep(interval);
    }

    throw new Error(
      `OpenCode server did not become ready within ${attempts} seconds`
    );
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    this._stopping = true;
    const child = this.process;
    this.process = null;

    return new Promise<void>((resolve) => {
      const killTimeout = setTimeout(() => {
        console.warn("[opencode] Forcing kill (SIGKILL)");
        child.kill("SIGKILL");
      }, 5000);

      child.on("exit", () => {
        clearTimeout(killTimeout);
        resolve();
      });

      child.kill("SIGTERM");
    });
  }

  /**
   * Restart the OpenCode process: stop, then start + wait for ready.
   */
  async restart(): Promise<void> {
    console.log("[opencode] Restarting...");
    await this.stop();
    await this.start();
    await this.waitForReady();
    console.log("[opencode] Restart complete");
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  get cwd(): string | undefined {
    return this._cwd;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
