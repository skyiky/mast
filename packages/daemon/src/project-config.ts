/**
 * ProjectConfig — CRUD for ~/.mast/projects.json
 *
 * Manages the list of project directories that the daemon should run
 * OpenCode instances for. Each project gets its own OpenCode process
 * scoped to that directory.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Project {
  name: string;      // Human-readable label (e.g., "mast", "my-app")
  directory: string;  // Absolute path to project root
}

export interface ProjectsFile {
  projects: Project[];
}

export class ProjectConfig {
  private dirPath: string;
  private filePath: string;

  constructor(customDir?: string) {
    this.dirPath = customDir ?? ProjectConfig.defaultDir();
    this.filePath = join(this.dirPath, "projects.json");
  }

  static defaultDir(): string {
    return join(homedir(), ".mast");
  }

  /**
   * Load the project list from disk.
   * Returns an empty array if the file doesn't exist or is corrupt.
   */
  async load(): Promise<Project[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as ProjectsFile;

      if (!Array.isArray(data.projects)) {
        console.warn("[project-config] Invalid projects file — missing projects array");
        return [];
      }

      // Validate each entry
      return data.projects.filter((p) => {
        if (!p.name || typeof p.name !== "string") return false;
        if (!p.directory || typeof p.directory !== "string") return false;
        return true;
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      console.warn("[project-config] Failed to read projects file:", err);
      return [];
    }
  }

  /**
   * Save the full project list to disk.
   * Creates the directory if it doesn't exist.
   */
  async save(projects: Project[]): Promise<void> {
    await mkdir(this.dirPath, { recursive: true });

    const data: ProjectsFile = { projects };
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Add a project. Rejects duplicates by name or directory (case-insensitive on Windows).
   * Returns the updated list.
   */
  async addProject(name: string, directory: string): Promise<Project[]> {
    const projects = await this.load();

    const nameLower = name.toLowerCase();
    const dirNorm = normalizePath(directory);

    const dupName = projects.find((p) => p.name.toLowerCase() === nameLower);
    if (dupName) {
      throw new Error(`Project with name "${name}" already exists`);
    }

    const dupDir = projects.find((p) => normalizePath(p.directory) === dirNorm);
    if (dupDir) {
      throw new Error(`Project with directory "${directory}" already exists (as "${dupDir.name}")`);
    }

    projects.push({ name, directory });
    await this.save(projects);
    return projects;
  }

  /**
   * Remove a project by name (case-insensitive match).
   * Returns the updated list.
   * Throws if the project doesn't exist.
   */
  async removeProject(name: string): Promise<Project[]> {
    const projects = await this.load();
    const nameLower = name.toLowerCase();
    const index = projects.findIndex((p) => p.name.toLowerCase() === nameLower);

    if (index === -1) {
      throw new Error(`Project "${name}" not found`);
    }

    projects.splice(index, 1);
    await this.save(projects);
    return projects;
  }

  /**
   * Get a single project by name (case-insensitive).
   * Returns null if not found.
   */
  async getProject(name: string): Promise<Project | null> {
    const projects = await this.load();
    const nameLower = name.toLowerCase();
    return projects.find((p) => p.name.toLowerCase() === nameLower) ?? null;
  }

  /** Expose paths for testing. */
  get dir(): string {
    return this.dirPath;
  }

  get file(): string {
    return this.filePath;
  }
}

/**
 * Normalize a path for comparison:
 * - Lowercase on Windows (case-insensitive filesystem)
 * - Forward slashes
 * - Strip trailing slash
 */
function normalizePath(p: string): string {
  let norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32") {
    norm = norm.toLowerCase();
  }
  return norm;
}
