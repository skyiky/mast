/**
 * ConfigStore — Persistent configuration for Mast.
 *
 * Saves/loads settings to ~/.mast/config.json so the CLI and plugin
 * can share configuration (e.g. orchestrator URL) without flags or env vars.
 *
 * File permissions are restricted to owner-only (0o600 on Unix).
 */

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface MastConfig {
  orchestratorUrl?: string;
}

export class ConfigStore {
  private dirPath: string;
  private filePath: string;

  constructor(customDir?: string) {
    this.dirPath = customDir ?? ConfigStore.defaultDir();
    this.filePath = join(this.dirPath, "config.json");
  }

  /**
   * Default directory: ~/.mast
   */
  static defaultDir(): string {
    return join(homedir(), ".mast");
  }

  /**
   * Load the full config from disk.
   * Returns an empty object if no config file exists or it's corrupt.
   */
  async load(): Promise<MastConfig> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw);

      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        console.warn("[config-store] Invalid config file — expected JSON object");
        return {};
      }

      return data as MastConfig;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // No config file — normal on first run
        return {};
      }
      console.warn("[config-store] Failed to read config file:", err);
      return {};
    }
  }

  /**
   * Save the full config to disk.
   * Creates ~/.mast directory if it doesn't exist.
   */
  async save(config: MastConfig): Promise<void> {
    await mkdir(this.dirPath, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(config, null, 2), "utf-8");

    // Restrict permissions on Unix (no-op on Windows)
    if (platform() !== "win32") {
      try {
        await chmod(this.filePath, 0o600);
      } catch {
        // Non-fatal — best effort
        console.warn("[config-store] Could not set file permissions to 600");
      }
    }
  }

  /**
   * Get a single config value.
   */
  async get<K extends keyof MastConfig>(key: K): Promise<MastConfig[K]> {
    const config = await this.load();
    return config[key];
  }

  /**
   * Set a single config value (merges with existing config).
   */
  async set<K extends keyof MastConfig>(key: K, value: MastConfig[K]): Promise<void> {
    const config = await this.load();
    config[key] = value;
    await this.save(config);
  }

  /** Expose paths for testing. */
  get dir(): string {
    return this.dirPath;
  }

  get file(): string {
    return this.filePath;
  }
}
