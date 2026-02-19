import { spawn, type ChildProcess } from "child_process";

export class OpenCodeProcess {
  private process: ChildProcess | null = null;
  private port: number;

  constructor(port: number = 4096) {
    this.port = port;
  }

  async start(): Promise<void> {
    if (process.env.MAST_SKIP_OPENCODE === "1") {
      console.log("[opencode] Skipping start (MAST_SKIP_OPENCODE=1)");
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const child = spawn("opencode", ["serve", "--port", String(this.port)], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          console.error(
            "[opencode] 'opencode' command not found. Is it installed and on PATH?"
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
        if (this.process) {
          console.warn(
            `[opencode] Process exited unexpectedly (code=${code}, signal=${signal})`
          );
        }
        this.process = null;
      });

      this.process = child;

      // Process has been spawned — resolve immediately.
      // Callers should use waitForReady() to confirm the server is up.
      resolve();
    });
  }

  async waitForReady(): Promise<void> {
    const url = `${this.baseUrl}/global/health`;
    const maxAttempts = 30;
    const intervalMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          return;
        }
        console.log(
          `[opencode] Health check attempt ${attempt}/${maxAttempts}: status ${res.status}`
        );
      } catch {
        console.log(
          `[opencode] Health check attempt ${attempt}/${maxAttempts}: not reachable`
        );
      }
      await sleep(intervalMs);
    }

    throw new Error(
      `OpenCode server did not become ready within ${maxAttempts} seconds`
    );
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    const child = this.process;
    this.process = null; // clear so exit handler doesn't warn

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

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
