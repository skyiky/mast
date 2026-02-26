/**
 * Tests for session list utility functions.
 * Covers: getTimeAgo, getUniqueProjects, filterSessionsByProject, groupSessionsByDay
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getTimeAgo,
  getUniqueProjects,
  filterSessionsByProject,
  groupSessionsByDay,
  groupSessionsByStatus,
  mapRawSession,
  mapRawSessions,
  formatProjectPath,
} from "../src/lib/sessions-utils.js";
import type { Session } from "../src/lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? "sess-1",
    title: overrides.title ?? "Test Session",
    createdAt: overrides.createdAt ?? "2026-02-25T12:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-02-25T12:00:00Z",
    project: overrides.project,
    directory: overrides.directory,
    lastMessagePreview: overrides.lastMessagePreview,
    hasActivity: overrides.hasActivity,
  };
}

// ---------------------------------------------------------------------------
// getTimeAgo
// ---------------------------------------------------------------------------

describe("getTimeAgo", () => {
  it("returns 'now' for times less than 1 minute ago", () => {
    const now = new Date();
    assert.equal(getTimeAgo(now.toISOString()), "now");
  });

  it("returns minutes for times less than 1 hour ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    assert.equal(getTimeAgo(fiveMinAgo.toISOString()), "5m");
  });

  it("returns hours for times less than 24 hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000);
    assert.equal(getTimeAgo(threeHoursAgo.toISOString()), "3h");
  });

  it("returns days for times 24+ hours ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    assert.equal(getTimeAgo(twoDaysAgo.toISOString()), "2d");
  });

  it("returns 'now' for future timestamps (edge case)", () => {
    const future = new Date(Date.now() + 60_000);
    assert.equal(getTimeAgo(future.toISOString()), "now");
  });

  it("handles exactly 60 minutes as 1h", () => {
    const sixtyMinAgo = new Date(Date.now() - 60 * 60_000);
    assert.equal(getTimeAgo(sixtyMinAgo.toISOString()), "1h");
  });

  it("handles exactly 24 hours as 1d", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 3_600_000);
    assert.equal(getTimeAgo(oneDayAgo.toISOString()), "1d");
  });
});

// ---------------------------------------------------------------------------
// getUniqueProjects
// ---------------------------------------------------------------------------

describe("getUniqueProjects", () => {
  it("returns empty array for empty sessions", () => {
    assert.deepEqual(getUniqueProjects([]), []);
  });

  it("extracts unique project names", () => {
    const sessions = [
      makeSession({ id: "1", project: "alpha" }),
      makeSession({ id: "2", project: "beta" }),
      makeSession({ id: "3", project: "alpha" }),
    ];
    const projects = getUniqueProjects(sessions);
    assert.deepEqual(projects.sort(), ["alpha", "beta"]);
  });

  it("excludes sessions without a project", () => {
    const sessions = [
      makeSession({ id: "1", project: "alpha" }),
      makeSession({ id: "2", project: undefined }),
    ];
    const projects = getUniqueProjects(sessions);
    assert.deepEqual(projects, ["alpha"]);
  });

  it("returns sorted project names", () => {
    const sessions = [
      makeSession({ id: "1", project: "zeta" }),
      makeSession({ id: "2", project: "alpha" }),
      makeSession({ id: "3", project: "mu" }),
    ];
    const projects = getUniqueProjects(sessions);
    assert.deepEqual(projects, ["alpha", "mu", "zeta"]);
  });
});

// ---------------------------------------------------------------------------
// filterSessionsByProject
// ---------------------------------------------------------------------------

describe("filterSessionsByProject", () => {
  const sessions = [
    makeSession({ id: "1", project: "alpha" }),
    makeSession({ id: "2", project: "beta" }),
    makeSession({ id: "3", project: "alpha" }),
    makeSession({ id: "4", project: undefined }),
  ];

  it("returns all sessions when project is null", () => {
    const result = filterSessionsByProject(sessions, null);
    assert.equal(result.length, 4);
  });

  it("filters to only matching project", () => {
    const result = filterSessionsByProject(sessions, "alpha");
    assert.equal(result.length, 2);
    assert.ok(result.every((s) => s.project === "alpha"));
  });

  it("returns empty array when no sessions match", () => {
    const result = filterSessionsByProject(sessions, "nonexistent");
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// groupSessionsByDay
// ---------------------------------------------------------------------------

describe("groupSessionsByDay", () => {
  it("returns empty array for empty sessions", () => {
    assert.deepEqual(groupSessionsByDay([]), []);
  });

  it("groups sessions by date", () => {
    const sessions = [
      makeSession({ id: "1", updatedAt: "2026-02-25T10:00:00Z" }),
      makeSession({ id: "2", updatedAt: "2026-02-25T08:00:00Z" }),
      makeSession({ id: "3", updatedAt: "2026-02-24T15:00:00Z" }),
    ];
    const groups = groupSessionsByDay(sessions);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].sessions.length, 2); // Feb 25
    assert.equal(groups[1].sessions.length, 1); // Feb 24
  });

  it("labels today's group as 'Today'", () => {
    const todayISO = new Date().toISOString();
    const sessions = [makeSession({ id: "1", updatedAt: todayISO })];
    const groups = groupSessionsByDay(sessions);
    assert.equal(groups[0].label, "Today");
  });

  it("labels yesterday's group as 'Yesterday'", () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const sessions = [makeSession({ id: "1", updatedAt: yesterday.toISOString() })];
    const groups = groupSessionsByDay(sessions);
    assert.equal(groups[0].label, "Yesterday");
  });

  it("sorts sessions within a group by updatedAt descending (newest first)", () => {
    const sessions = [
      makeSession({ id: "old", updatedAt: "2026-02-25T08:00:00Z" }),
      makeSession({ id: "new", updatedAt: "2026-02-25T14:00:00Z" }),
      makeSession({ id: "mid", updatedAt: "2026-02-25T11:00:00Z" }),
    ];
    const groups = groupSessionsByDay(sessions);
    assert.equal(groups[0].sessions[0].id, "new");
    assert.equal(groups[0].sessions[1].id, "mid");
    assert.equal(groups[0].sessions[2].id, "old");
  });

  it("sorts groups by date descending (newest day first)", () => {
    const sessions = [
      makeSession({ id: "1", updatedAt: "2026-02-20T12:00:00Z" }),
      makeSession({ id: "2", updatedAt: "2026-02-25T12:00:00Z" }),
      makeSession({ id: "3", updatedAt: "2026-02-22T12:00:00Z" }),
    ];
    const groups = groupSessionsByDay(sessions);
    // Most recent day first
    assert.equal(groups[0].sessions[0].id, "2");
    assert.equal(groups[1].sessions[0].id, "3");
    assert.equal(groups[2].sessions[0].id, "1");
  });

  it("uses date label for older dates (not Today/Yesterday)", () => {
    const oldDate = new Date("2026-01-15T12:00:00Z");
    const sessions = [makeSession({ id: "1", updatedAt: oldDate.toISOString() })];
    const groups = groupSessionsByDay(sessions);
    // Should be a date string, not "Today" or "Yesterday"
    assert.notEqual(groups[0].label, "Today");
    assert.notEqual(groups[0].label, "Yesterday");
    // Should contain "Jan" or "15" or similar date info
    assert.ok(groups[0].label.length > 0);
  });
});

// ---------------------------------------------------------------------------
// mapRawSession / mapRawSessions
// ---------------------------------------------------------------------------

describe("mapRawSession", () => {
  it("maps OpenCode format with time.created and time.updated", () => {
    const raw = {
      id: "ses_abc",
      title: "happy-wizard",
      slug: "happy-wizard",
      directory: "/home/user/proj",
      project: "my-project",
      time: { created: 1772082860000, updated: 1772082900000 },
    };
    const result = mapRawSession(raw);
    assert.equal(result.id, "ses_abc");
    assert.equal(result.title, "happy-wizard");
    assert.equal(result.directory, "/home/user/proj");
    assert.equal(result.project, "my-project");
    assert.equal(result.createdAt, new Date(1772082860000).toISOString());
    assert.equal(result.updatedAt, new Date(1772082900000).toISOString());
  });

  it("falls back to slug when title is missing", () => {
    const raw = { id: "ses_1", slug: "cool-slug", time: { created: 1000 } };
    const result = mapRawSession(raw);
    assert.equal(result.title, "cool-slug");
  });

  it("title is undefined when both title and slug are missing", () => {
    const raw = { id: "ses_1", time: { created: 1000 } };
    const result = mapRawSession(raw);
    assert.equal(result.title, undefined);
  });

  it("falls back to createdAt/updatedAt string fields when time object is missing", () => {
    const raw = {
      id: "ses_1",
      createdAt: "2026-02-25T10:00:00Z",
      updatedAt: "2026-02-25T11:00:00Z",
    };
    const result = mapRawSession(raw);
    assert.equal(result.createdAt, "2026-02-25T10:00:00Z");
    assert.equal(result.updatedAt, "2026-02-25T11:00:00Z");
  });

  it("uses createdAt as updatedAt fallback when time.updated is missing", () => {
    const raw = {
      id: "ses_1",
      time: { created: 1772082860000 },
    };
    const result = mapRawSession(raw);
    // updatedAt should fall back to createdAt
    assert.equal(result.updatedAt, result.createdAt);
  });

  it("defaults to current time when no timestamps are available", () => {
    const before = new Date().toISOString();
    const raw = { id: "ses_1" };
    const result = mapRawSession(raw);
    const after = new Date().toISOString();
    // createdAt should be between before and after
    assert.ok(result.createdAt >= before);
    assert.ok(result.createdAt <= after);
  });

  it("directory and project are undefined when missing", () => {
    const raw = { id: "ses_1", time: { created: 1000 } };
    const result = mapRawSession(raw);
    assert.equal(result.directory, undefined);
    assert.equal(result.project, undefined);
  });
});

describe("mapRawSessions", () => {
  it("maps an array of raw sessions", () => {
    const raw = [
      { id: "ses_1", title: "first", time: { created: 1000, updated: 2000 } },
      { id: "ses_2", slug: "second", time: { created: 3000, updated: 4000 } },
    ];
    const result = mapRawSessions(raw);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, "ses_1");
    assert.equal(result[0].title, "first");
    assert.equal(result[1].id, "ses_2");
    assert.equal(result[1].title, "second");
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(mapRawSessions([]), []);
  });
});

// ---------------------------------------------------------------------------
// groupSessionsByStatus
// ---------------------------------------------------------------------------

describe("groupSessionsByStatus", () => {
  it("returns empty array for empty sessions", () => {
    assert.deepEqual(groupSessionsByStatus([], new Set()), []);
  });

  it("puts recently-updated sessions (< 2h) in Idle group", () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString(); // 30 min ago
    const sessions = [makeSession({ id: "1", updatedAt: recent })];
    const groups = groupSessionsByStatus(sessions, new Set());
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Idle");
    assert.equal(groups[0].sessions.length, 1);
  });

  it("puts old sessions in Archived group", () => {
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString(); // 2 days ago
    const sessions = [makeSession({ id: "1", updatedAt: old })];
    const groups = groupSessionsByStatus(sessions, new Set());
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Archived");
  });

  it("separates Idle and Archived sessions", () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const sessions = [
      makeSession({ id: "idle1", updatedAt: recent }),
      makeSession({ id: "old1", updatedAt: old }),
      makeSession({ id: "idle2", updatedAt: recent }),
    ];
    const groups = groupSessionsByStatus(sessions, new Set());
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, "Idle");
    assert.equal(groups[0].sessions.length, 2);
    assert.equal(groups[1].label, "Archived");
    assert.equal(groups[1].sessions.length, 1);
  });

  it("Idle group comes before Archived", () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const sessions = [
      makeSession({ id: "old1", updatedAt: old }),
      makeSession({ id: "idle1", updatedAt: recent }),
    ];
    const groups = groupSessionsByStatus(sessions, new Set());
    assert.equal(groups[0].label, "Idle");
    assert.equal(groups[1].label, "Archived");
  });

  it("sorts sessions within each group by updatedAt descending", () => {
    const t1 = new Date(Date.now() - 10 * 60_000).toISOString(); // 10m ago
    const t2 = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago
    const t3 = new Date(Date.now() - 90 * 60_000).toISOString(); // 1.5h ago
    const sessions = [
      makeSession({ id: "mid", updatedAt: t2 }),
      makeSession({ id: "newest", updatedAt: t1 }),
      makeSession({ id: "oldest", updatedAt: t3 }),
    ];
    const groups = groupSessionsByStatus(sessions, new Set());
    assert.equal(groups[0].sessions[0].id, "newest");
    assert.equal(groups[0].sessions[1].id, "mid");
    assert.equal(groups[0].sessions[2].id, "oldest");
  });

  it("starred sessions appear in Starred group at the top", () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const sessions = [
      makeSession({ id: "idle1", updatedAt: recent }),
      makeSession({ id: "starred1", updatedAt: old }),
      makeSession({ id: "old1", updatedAt: old }),
    ];
    const starred = new Set(["starred1"]);
    const groups = groupSessionsByStatus(sessions, starred);
    assert.equal(groups[0].label, "Starred");
    assert.equal(groups[0].sessions.length, 1);
    assert.equal(groups[0].sessions[0].id, "starred1");
  });

  it("starred sessions are excluded from Idle and Archived groups", () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    const sessions = [
      makeSession({ id: "both", updatedAt: recent }),
      makeSession({ id: "idle1", updatedAt: recent }),
    ];
    const starred = new Set(["both"]);
    const groups = groupSessionsByStatus(sessions, starred);
    // Starred group should have "both", Idle should only have "idle1"
    const starredGroup = groups.find((g) => g.label === "Starred");
    const idleGroup = groups.find((g) => g.label === "Idle");
    assert.ok(starredGroup);
    assert.equal(starredGroup.sessions.length, 1);
    assert.equal(starredGroup.sessions[0].id, "both");
    assert.ok(idleGroup);
    assert.equal(idleGroup.sessions.length, 1);
    assert.equal(idleGroup.sessions[0].id, "idle1");
  });

  it("omits empty groups", () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    const sessions = [makeSession({ id: "1", updatedAt: recent })];
    const groups = groupSessionsByStatus(sessions, new Set());
    // Should only have Idle, no Starred or Archived
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Idle");
  });

  it("sessions with hasActivity flag are treated as Idle regardless of age", () => {
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const sessions = [makeSession({ id: "active-old", updatedAt: old, hasActivity: true })];
    const groups = groupSessionsByStatus(sessions, new Set());
    assert.equal(groups[0].label, "Idle");
    assert.equal(groups[0].sessions[0].id, "active-old");
  });
});

// ---------------------------------------------------------------------------
// formatProjectPath
// ---------------------------------------------------------------------------

describe("formatProjectPath", () => {
  it("returns project name when session has project field", () => {
    const session = makeSession({ project: "my-project" });
    assert.equal(formatProjectPath(session), "my-project");
  });

  it("returns last 2 path segments for Unix directory", () => {
    const session = makeSession({ directory: "/home/user/my-project" });
    assert.equal(formatProjectPath(session), "user/my-project");
  });

  it("returns last 2 path segments for Windows directory", () => {
    const session = makeSession({ directory: "C:\\Users\\david\\my-project" });
    assert.equal(formatProjectPath(session), "david/my-project");
  });

  it("returns single segment for shallow Unix path", () => {
    const session = makeSession({ directory: "/project" });
    assert.equal(formatProjectPath(session), "project");
  });

  it("returns null when session has no project and no directory", () => {
    const session = makeSession({});
    assert.equal(formatProjectPath(session), null);
  });

  it("prefers project field over directory", () => {
    const session = makeSession({
      project: "from-project",
      directory: "/home/user/from-directory",
    });
    assert.equal(formatProjectPath(session), "from-project");
  });

  it("handles trailing slashes", () => {
    const session = makeSession({ directory: "/home/user/my-project/" });
    assert.equal(formatProjectPath(session), "user/my-project");
  });

  it("returns null for empty directory string", () => {
    const session = makeSession({ directory: "" });
    assert.equal(formatProjectPath(session), null);
  });
});
