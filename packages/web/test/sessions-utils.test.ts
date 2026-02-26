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
