/**
 * KeyStore — Persistent device key storage for the Mast daemon.
 *
 * Saves/loads the device key to ~/.mast/device-key.json so the daemon
 * can reconnect to the orchestrator after restart without re-pairing.
 *
 * File permissions are restricted to owner-only (0o600 on Unix).
 */

import { readFile, writeFile, mkdir, unlink, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface KeyData {
  deviceKey: string;
  pairedAt: string; // ISO 8601
}

export class KeyStore {
  private dirPath: string;
  private filePath: string;

  constructor(customDir?: string) {
    this.dirPath = customDir ?? KeyStore.defaultDir();
    this.filePath = join(this.dirPath, "device-key.json");
  }

  /**
   * Default directory: ~/.mast
   */
  static defaultDir(): string {
    return join(homedir(), ".mast");
  }

  /**
   * Save a device key to disk.
   * Creates ~/.mast directory if it doesn't exist.
   */
  async save(deviceKey: string): Promise<void> {
    await mkdir(this.dirPath, { recursive: true });

    const data: KeyData = {
      deviceKey,
      pairedAt: new Date().toISOString(),
    };

    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");

    // Restrict permissions on Unix (no-op on Windows)
    if (platform() !== "win32") {
      try {
        await chmod(this.filePath, 0o600);
      } catch {
        // Non-fatal — best effort
        console.warn("[key-store] Could not set file permissions to 600");
      }
    }
  }

  /**
   * Load a previously saved device key.
   * Returns null if no key file exists or if it's corrupt.
   */
  async load(): Promise<string | null> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as KeyData;

      if (!data.deviceKey || typeof data.deviceKey !== "string") {
        console.warn("[key-store] Invalid key file — missing deviceKey");
        return null;
      }

      return data.deviceKey;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // No key file — normal on first run
        return null;
      }
      console.warn("[key-store] Failed to read key file:", err);
      return null;
    }
  }

  /**
   * Delete the stored key (for re-pairing).
   */
  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Already gone — fine
        return;
      }
      throw err;
    }
  }

  /**
   * Check if a key file exists.
   */
  async exists(): Promise<boolean> {
    try {
      await stat(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Expose paths for testing. */
  get dir(): string {
    return this.dirPath;
  }

  get file(): string {
    return this.filePath;
  }
}
