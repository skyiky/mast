/**
 * Auto-detect project and first-run setup.
 *
 * Detects the current project from the working directory.
 * On first run (no config), creates ~/.mast/projects.json automatically.
 * On subsequent runs, checks if the current directory is already registered.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, basename, normalize } from "node:path";

export interface DetectedProject {
  name: string;
  directory: string;
  isNew: boolean;       // true if we just created/added to the config
}

interface ProjectEntry {
  name: string;
  directory: string;
}

interface ProjectsFile {
  projects: ProjectEntry[];
}

export async function autoDetect(options: {
  directory: string;
  configDir: string;
}): Promise<DetectedProject> {
  const { directory, configDir } = options;

  // Verify directory exists
  try {
    const s = await stat(directory);
    if (!s.isDirectory()) {
      throw new Error(`"${directory}" is not a directory`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Directory does not exist: "${directory}"`);
    }
    throw err;
  }

  const configFile = join(configDir, "projects.json");

  // Try to load existing config
  let projects: ProjectEntry[] = [];
  try {
    const raw = await readFile(configFile, "utf-8");
    const data = JSON.parse(raw) as ProjectsFile;
    if (Array.isArray(data.projects)) {
      projects = data.projects.filter(
        (p) => p && typeof p.name === "string" && typeof p.directory === "string",
      );
    }
  } catch {
    // File doesn't exist or is corrupt — treat as empty
  }

  // Normalize for comparison
  const normalizedDir = normalize(directory);

  // Check if this directory is already registered
  const existing = projects.find(
    (p) => normalize(p.directory) === normalizedDir,
  );
  if (existing) {
    return {
      name: existing.name,
      directory: existing.directory,
      isNew: false,
    };
  }

  // Not registered — derive name from basename and add it
  let name = basename(directory);

  // Deduplicate name if it conflicts with an existing project
  const existingNames = new Set(projects.map((p) => p.name.toLowerCase()));
  if (existingNames.has(name.toLowerCase())) {
    let suffix = 2;
    while (existingNames.has(`${name}-${suffix}`.toLowerCase())) {
      suffix++;
    }
    name = `${name}-${suffix}`;
  }

  // Add to config and save
  projects.push({ name, directory });
  await mkdir(configDir, { recursive: true });
  await writeFile(
    configFile,
    JSON.stringify({ projects }, null, 2),
    "utf-8",
  );

  return { name, directory, isNew: true };
}
