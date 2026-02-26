/**
 * ProjectManager — Manages multiple OpenCode instances, one per project.
 *
 * Each project gets:
 *   - An OpenCodeProcess spawned with `cwd` set to the project directory
 *   - An SseSubscriber connected to that instance's /event stream
 *   - A HealthMonitor checking that instance's /global/health
 *
 * The ProjectManager owns session→project routing: it knows which OpenCode
 * instance owns which session, so the Relay can route requests correctly.
 *
 * Port allocation: base port (default 4096) + index in project list.
 */

import { OpenCodeProcess } from "./opencode-process.js";
import { SseSubscriber, type SseEvent } from "./sse-client.js";
import { HealthMonitor, type HealthState } from "./health-monitor.js";
import { ProjectConfig, type Project } from "./project-config.js";

export interface ManagedProject {
  name: string;
  directory: string;
  port: number;
  opencode: OpenCodeProcess;
  sse: SseSubscriber | null;
  health: HealthMonitor | null;
  ready: boolean;
}

export interface EnrichedSession {
  id: string;
  slug?: string;
  projectID?: string;
  directory: string;
  title?: string;
  version?: string;
  summary?: string;
  time?: { created: number; updated: number };
  revert?: unknown;
  // Enriched fields
  project: string; // project name from config
}

/**
 * MCP server status as returned by OpenCode's GET /mcp endpoint.
 * Each key is a server name, value contains at least a status string.
 */
export interface McpServerStatus {
  status: string;
  [key: string]: unknown;
}

/**
 * Aggregated MCP server info enriched with the owning project name.
 */
export interface EnrichedMcpServers {
  project: string;
  servers: Record<string, McpServerStatus>;
}

export interface ProjectManagerConfig {
  basePort?: number;          // Default 4096
  skipOpenCode?: boolean;     // MAST_SKIP_OPENCODE=1 equivalent
  opencodeCommand?: string;   // Override for testing
  opencodeArgs?: (port: number) => string[]; // Override args for testing
  healthCheckIntervalMs?: number;
  healthFailureThreshold?: number;

  // Callbacks — wired by the Relay
  onEvent?: (projectName: string, event: SseEvent) => void;
  onHealthStateChange?: (projectName: string, state: HealthState, ready: boolean) => void;
  onRecoveryNeeded?: (projectName: string) => Promise<void>;
}

export class ProjectManager {
  private projects = new Map<string, ManagedProject>();
  private sessionToProject = new Map<string, string>(); // sessionId → project name
  private config: ProjectManagerConfig;
  private projectConfig: ProjectConfig;
  private basePort: number;
  private nextPortOffset = 0; // Track next available port offset

  constructor(projectConfig: ProjectConfig, config?: ProjectManagerConfig) {
    this.projectConfig = projectConfig;
    this.config = config ?? {};
    this.basePort = config?.basePort ?? 4096;
  }

  /**
   * Load projects from config and start all OpenCode instances.
   * Returns the list of projects that were started.
   */
  async startAll(): Promise<Project[]> {
    const projectList = await this.projectConfig.load();

    if (projectList.length === 0) {
      console.warn("[project-manager] No projects configured — nothing to start");
      return [];
    }

    const results: Project[] = [];
    for (const project of projectList) {
      try {
        await this.startProject(project);
        results.push(project);
      } catch (err) {
        console.error(
          `[project-manager] Failed to start project "${project.name}":`,
          err,
        );
      }
    }

    return results;
  }

  /**
   * Start a single project's OpenCode instance.
   * Allocates the next available port.
   */
  async startProject(project: Project): Promise<ManagedProject> {
    const existing = this.projects.get(project.name);
    if (existing) {
      console.warn(
        `[project-manager] Project "${project.name}" is already running on port ${existing.port}`,
      );
      return existing;
    }

    const port = this.basePort + this.nextPortOffset++;

    const opencode = new OpenCodeProcess({
      port,
      cwd: project.directory,
      command: this.config.opencodeCommand,
      args: this.config.opencodeArgs?.(port),
      onCrash: (code, signal) => {
        console.error(
          `[project-manager] OpenCode crashed for "${project.name}" (code=${code}, signal=${signal})`,
        );
      },
    });

    const managed: ManagedProject = {
      name: project.name,
      directory: project.directory,
      port,
      opencode,
      sse: null,
      health: null,
      ready: false,
    };

    this.projects.set(project.name, managed);

    if (!this.config.skipOpenCode) {
      await opencode.start();
      await opencode.waitForReady();
      managed.ready = true;
      console.log(
        `[project-manager] Started "${project.name}" on port ${port} (cwd: ${project.directory})`,
      );
    } else {
      managed.ready = true;
      console.log(
        `[project-manager] Registered "${project.name}" on port ${port} (skip opencode)`,
      );
    }

    return managed;
  }

  /**
   * Start SSE subscription for a project.
   * Called by the Relay after WSS connection is established.
   */
  startSse(projectName: string): void {
    const managed = this.projects.get(projectName);
    if (!managed) return;

    this.stopSse(projectName);

    managed.sse = new SseSubscriber(managed.opencode.baseUrl);
    managed.sse
      .subscribe((event: SseEvent) => {
        this.config.onEvent?.(projectName, event);
      })
      .catch((err) => {
        console.error(`[project-manager] SSE error for "${projectName}":`, err);
      });
  }

  /**
   * Stop SSE subscription for a project.
   */
  stopSse(projectName: string): void {
    const managed = this.projects.get(projectName);
    if (managed?.sse) {
      managed.sse.stop();
      managed.sse = null;
    }
  }

  /**
   * Start SSE for all projects.
   */
  startAllSse(): void {
    for (const name of this.projects.keys()) {
      this.startSse(name);
    }
  }

  /**
   * Stop SSE for all projects.
   */
  stopAllSse(): void {
    for (const name of this.projects.keys()) {
      this.stopSse(name);
    }
  }

  /**
   * Start health monitoring for a project.
   */
  startHealth(projectName: string): void {
    const managed = this.projects.get(projectName);
    if (!managed) return;

    this.stopHealth(projectName);

    managed.health = new HealthMonitor({
      opencodeBaseUrl: managed.opencode.baseUrl,
      checkIntervalMs: this.config.healthCheckIntervalMs,
      failureThreshold: this.config.healthFailureThreshold,
      onStateChange: (state, ready) => {
        managed.ready = ready;
        this.config.onHealthStateChange?.(projectName, state, ready);
      },
      onRecoveryNeeded: async () => {
        if (this.config.onRecoveryNeeded) {
          await this.config.onRecoveryNeeded(projectName);
        } else {
          // Default: restart the OpenCode process
          console.log(
            `[project-manager] Auto-restarting OpenCode for "${projectName}"`,
          );
          try {
            await managed.opencode.restart();
          } catch (err) {
            console.error(
              `[project-manager] Failed to restart OpenCode for "${projectName}":`,
              err,
            );
          }
        }
      },
    });
    managed.health.start();
  }

  /**
   * Stop health monitoring for a project.
   */
  stopHealth(projectName: string): void {
    const managed = this.projects.get(projectName);
    if (managed?.health) {
      managed.health.stop();
      managed.health = null;
    }
  }

  /**
   * Start health monitoring for all projects.
   */
  startAllHealth(): void {
    for (const name of this.projects.keys()) {
      this.startHealth(name);
    }
  }

  /**
   * Stop health monitoring for all projects.
   */
  stopAllHealth(): void {
    for (const name of this.projects.keys()) {
      this.stopHealth(name);
    }
  }

  /**
   * Stop a single project: kill OpenCode, stop SSE, stop health.
   * Removes it from the managed set.
   */
  async stopProject(projectName: string): Promise<void> {
    const managed = this.projects.get(projectName);
    if (!managed) return;

    this.stopSse(projectName);
    this.stopHealth(projectName);

    if (managed.opencode.isRunning()) {
      await managed.opencode.stop();
    }

    // Remove session mappings for this project
    for (const [sessionId, name] of this.sessionToProject.entries()) {
      if (name === projectName) {
        this.sessionToProject.delete(sessionId);
      }
    }

    this.projects.delete(projectName);
    console.log(`[project-manager] Stopped project "${projectName}"`);
  }

  /**
   * Stop all projects and clean up.
   */
  async stopAll(): Promise<void> {
    const names = [...this.projects.keys()];
    for (const name of names) {
      await this.stopProject(name);
    }
    this.nextPortOffset = 0;
  }

  /**
   * Add a new project at runtime: save to config, start it, begin SSE + health.
   * Returns the managed project.
   */
  async addProject(name: string, directory: string): Promise<ManagedProject> {
    // Save to config (validates no duplicates)
    await this.projectConfig.addProject(name, directory);

    // Start the project
    const managed = await this.startProject({ name, directory });

    return managed;
  }

  /**
   * Remove a project at runtime: stop it, remove from config.
   */
  async removeProject(projectName: string): Promise<void> {
    await this.stopProject(projectName);
    await this.projectConfig.removeProject(projectName);
  }

  /**
   * List all sessions across all projects.
   * Fetches GET /session from each running OpenCode instance,
   * enriches each session with the project name, and updates
   * the session→project routing map.
   */
  async listAllSessions(): Promise<EnrichedSession[]> {
    const allSessions: EnrichedSession[] = [];

    const fetchPromises = [...this.projects.entries()].map(
      async ([name, managed]) => {
        if (!managed.ready) return [];

        try {
          const res = await fetch(`${managed.opencode.baseUrl}/session`);
          if (!res.ok) {
            console.error(
              `[project-manager] Failed to list sessions for "${name}": ${res.status}`,
            );
            return [];
          }

          const sessions = (await res.json()) as Array<Record<string, unknown>>;
          if (!Array.isArray(sessions)) return [];

          return sessions.map((s) => {
            const enriched: EnrichedSession = {
              id: s.id as string,
              slug: s.slug as string | undefined,
              projectID: s.projectID as string | undefined,
              directory: s.directory as string,
              title: s.title as string | undefined,
              version: s.version as string | undefined,
              summary: s.summary as string | undefined,
              time: s.time as { created: number; updated: number } | undefined,
              revert: s.revert,
              project: name,
            };

            // Update routing map
            this.sessionToProject.set(enriched.id, name);

            return enriched;
          });
        } catch (err) {
          console.error(
            `[project-manager] Error listing sessions for "${name}":`,
            err,
          );
          return [];
        }
      },
    );

    const results = await Promise.all(fetchPromises);
    for (const batch of results) {
      allSessions.push(...batch);
    }

    return allSessions;
  }

  /**
   * List MCP servers across all running projects.
   * Fetches GET /mcp from each running OpenCode instance and
   * enriches the result with the project name.
   */
  async listAllMcpServers(): Promise<EnrichedMcpServers[]> {
    const fetchPromises = [...this.projects.entries()].map(
      async ([name, managed]): Promise<EnrichedMcpServers | null> => {
        if (!managed.ready) return null;

        try {
          const res = await fetch(`${managed.opencode.baseUrl}/mcp`);
          if (!res.ok) {
            console.error(
              `[project-manager] Failed to list MCP servers for "${name}": ${res.status}`,
            );
            return { project: name, servers: {} };
          }

          const servers = (await res.json()) as Record<string, McpServerStatus>;
          return { project: name, servers };
        } catch (err) {
          console.error(
            `[project-manager] Error listing MCP servers for "${name}":`,
            err,
          );
          return { project: name, servers: {} };
        }
      },
    );

    const results = await Promise.all(fetchPromises);
    return results.filter((r): r is EnrichedMcpServers => r !== null);
  }

  /**
   * Get the base URL of the OpenCode instance that owns a given session.
   * Uses the session→project routing map (populated by listAllSessions).
   * Returns null if the session is unknown.
   */
  getBaseUrlForSession(sessionId: string): string | null {
    const projectName = this.sessionToProject.get(sessionId);
    if (!projectName) return null;

    const managed = this.projects.get(projectName);
    if (!managed) return null;

    return managed.opencode.baseUrl;
  }

  /**
   * Get the project name that owns a given session.
   */
  getProjectForSession(sessionId: string): string | null {
    return this.sessionToProject.get(sessionId) ?? null;
  }

  /**
   * Get the base URL for a project by name.
   */
  getBaseUrlForProject(projectName: string): string | null {
    const managed = this.projects.get(projectName);
    return managed?.opencode.baseUrl ?? null;
  }

  /**
   * Register a session→project mapping explicitly.
   * Used when a new session is created via POST /session for a specific project.
   */
  registerSession(sessionId: string, projectName: string): void {
    this.sessionToProject.set(sessionId, projectName);
  }

  /**
   * Get the list of currently managed projects.
   */
  listProjects(): Array<{ name: string; directory: string; port: number; ready: boolean }> {
    return [...this.projects.values()].map((p) => ({
      name: p.name,
      directory: p.directory,
      port: p.port,
      ready: p.ready,
    }));
  }

  /**
   * Get a specific managed project by name.
   */
  getProject(name: string): ManagedProject | undefined {
    return this.projects.get(name);
  }

  /**
   * Get the count of managed projects.
   */
  get size(): number {
    return this.projects.size;
  }

  /**
   * Check if all projects are ready.
   */
  get allReady(): boolean {
    if (this.projects.size === 0) return false;
    for (const p of this.projects.values()) {
      if (!p.ready) return false;
    }
    return true;
  }
}
