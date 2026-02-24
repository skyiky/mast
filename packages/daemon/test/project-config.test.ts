/**
 * ProjectConfig Tests
 *
 * Tests CRUD operations for ~/.mast/projects.json
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectConfig, type Project } from "../src/project-config.js";

let tempDir: string;
let config: ProjectConfig;

beforeEach(async () => {
  tempDir = join(tmpdir(), `mast-test-projconfig-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  config = new ProjectConfig(tempDir);
});

afterEach(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
});

describe("ProjectConfig", () => {
  // ===========================================================================
  // load()
  // ===========================================================================

  it("load() returns empty array when no file exists", async () => {
    const projects = await config.load();
    assert.deepEqual(projects, []);
  });

  it("load() returns empty array for corrupt JSON", async () => {
    await writeFile(config.file, "not json!!!", "utf-8");
    const projects = await config.load();
    assert.deepEqual(projects, []);
  });

  it("load() returns empty array when projects field is not an array", async () => {
    await writeFile(config.file, JSON.stringify({ projects: "oops" }), "utf-8");
    const projects = await config.load();
    assert.deepEqual(projects, []);
  });

  it("load() filters out invalid entries", async () => {
    await writeFile(
      config.file,
      JSON.stringify({
        projects: [
          { name: "good", directory: "/path/to/good" },
          { name: "", directory: "/path/to/empty-name" },      // invalid: empty name
          { name: "no-dir" },                                    // invalid: missing directory
          { directory: "/no-name" },                             // invalid: missing name
          { name: "also-good", directory: "/path/to/also-good" },
        ],
      }),
      "utf-8"
    );

    const projects = await config.load();
    assert.equal(projects.length, 2);
    assert.equal(projects[0].name, "good");
    assert.equal(projects[1].name, "also-good");
  });

  it("load() returns valid projects from disk", async () => {
    const expected: Project[] = [
      { name: "alpha", directory: "/home/user/alpha" },
      { name: "beta", directory: "E:\\dev\\beta" },
    ];
    await writeFile(config.file, JSON.stringify({ projects: expected }), "utf-8");

    const projects = await config.load();
    assert.deepEqual(projects, expected);
  });

  // ===========================================================================
  // save()
  // ===========================================================================

  it("save() writes projects to disk and creates directory", async () => {
    const nestedDir = join(tempDir, "sub", "dir");
    const nestedConfig = new ProjectConfig(nestedDir);

    const projects: Project[] = [
      { name: "my-app", directory: "/home/user/my-app" },
    ];

    await nestedConfig.save(projects);

    const raw = await readFile(nestedConfig.file, "utf-8");
    const data = JSON.parse(raw);
    assert.deepEqual(data.projects, projects);
  });

  it("save() overwrites existing file", async () => {
    await config.save([{ name: "old", directory: "/old" }]);
    await config.save([{ name: "new", directory: "/new" }]);

    const projects = await config.load();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "new");
  });

  // ===========================================================================
  // addProject()
  // ===========================================================================

  it("addProject() adds a project and returns updated list", async () => {
    const result = await config.addProject("alpha", "/path/to/alpha");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "alpha");
    assert.equal(result[0].directory, "/path/to/alpha");

    // Verify persistence
    const loaded = await config.load();
    assert.deepEqual(loaded, result);
  });

  it("addProject() appends to existing projects", async () => {
    await config.addProject("alpha", "/path/to/alpha");
    const result = await config.addProject("beta", "/path/to/beta");
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "alpha");
    assert.equal(result[1].name, "beta");
  });

  it("addProject() rejects duplicate name (case-insensitive)", async () => {
    await config.addProject("MyApp", "/path/a");
    await assert.rejects(
      () => config.addProject("myapp", "/path/b"),
      { message: /already exists/ }
    );
  });

  it("addProject() rejects duplicate directory", async () => {
    await config.addProject("app-one", "/path/to/app");
    await assert.rejects(
      () => config.addProject("app-two", "/path/to/app"),
      { message: /already exists/ }
    );
  });

  it("addProject() rejects duplicate directory with different separators (Windows)", async () => {
    await config.addProject("app-one", "E:\\dev\\my-app");

    // On Windows, forward-slash variant should also be rejected
    if (process.platform === "win32") {
      await assert.rejects(
        () => config.addProject("app-two", "E:/dev/my-app"),
        { message: /already exists/ }
      );
    }
  });

  // ===========================================================================
  // removeProject()
  // ===========================================================================

  it("removeProject() removes by name and returns updated list", async () => {
    await config.addProject("alpha", "/alpha");
    await config.addProject("beta", "/beta");
    await config.addProject("gamma", "/gamma");

    const result = await config.removeProject("beta");
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "alpha");
    assert.equal(result[1].name, "gamma");

    // Verify persistence
    const loaded = await config.load();
    assert.deepEqual(loaded, result);
  });

  it("removeProject() is case-insensitive", async () => {
    await config.addProject("MyApp", "/my-app");
    const result = await config.removeProject("myapp");
    assert.equal(result.length, 0);
  });

  it("removeProject() throws if project not found", async () => {
    await config.addProject("alpha", "/alpha");
    await assert.rejects(
      () => config.removeProject("nonexistent"),
      { message: /not found/ }
    );
  });

  // ===========================================================================
  // getProject()
  // ===========================================================================

  it("getProject() returns project by name", async () => {
    await config.addProject("alpha", "/alpha");
    await config.addProject("beta", "/beta");

    const project = await config.getProject("alpha");
    assert.ok(project);
    assert.equal(project.name, "alpha");
    assert.equal(project.directory, "/alpha");
  });

  it("getProject() is case-insensitive", async () => {
    await config.addProject("MyApp", "/my-app");
    const project = await config.getProject("myapp");
    assert.ok(project);
    assert.equal(project.name, "MyApp");
  });

  it("getProject() returns null if not found", async () => {
    const project = await config.getProject("nonexistent");
    assert.equal(project, null);
  });

  // ===========================================================================
  // Path accessors
  // ===========================================================================

  it("dir and file accessors return correct paths", () => {
    assert.equal(config.dir, tempDir);
    assert.equal(config.file, join(tempDir, "projects.json"));
  });

  it("defaultDir() returns ~/.mast", async () => {
    const os = await import("node:os");
    assert.equal(ProjectConfig.defaultDir(), join(os.homedir(), ".mast"));
  });
});
