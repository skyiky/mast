/**
 * Pure utility functions for session list presentation.
 * No React dependency — testable under node:test.
 */

import type { Session } from "./types.js";

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/**
 * Returns a compact relative time string (e.g., "now", "5m", "3h", "2d").
 */
export function getTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

// ---------------------------------------------------------------------------
// Project extraction & filtering
// ---------------------------------------------------------------------------

/**
 * Extract unique project names from sessions, sorted alphabetically.
 * Sessions without a project are excluded.
 */
export function getUniqueProjects(sessions: Session[]): string[] {
  const set = new Set<string>();
  for (const s of sessions) {
    if (s.project) set.add(s.project);
  }
  return [...set].sort();
}

/**
 * Filter sessions by project. Returns all sessions when project is null.
 */
export function filterSessionsByProject(
  sessions: Session[],
  project: string | null,
): Session[] {
  if (project === null) return sessions;
  return sessions.filter((s) => s.project === project);
}

// ---------------------------------------------------------------------------
// Day grouping
// ---------------------------------------------------------------------------

export interface SessionGroup {
  /** Display label: "Starred", "Idle", "Archived", or a date string */
  label: string;
  /** Sort key for ordering groups */
  dateKey: string;
  /** Sessions in this group, sorted newest first */
  sessions: Session[];
}

// ---------------------------------------------------------------------------
// Status-based grouping (Starred / Idle / Archived)
// ---------------------------------------------------------------------------

/** Threshold for "idle" — sessions updated within this window are considered idle/active */
const IDLE_THRESHOLD_MS = 2 * 3_600_000; // 2 hours

/**
 * Group sessions by status: Starred, Idle (recent), Archived (older).
 *
 * - Starred: sessions whose ID is in the starredIds set (always at top)
 * - Idle: sessions updated within the last 2 hours OR with hasActivity flag
 * - Archived: everything else
 *
 * Within each group, sessions are sorted newest first.
 * Empty groups are omitted.
 */
export function groupSessionsByStatus(
  sessions: Session[],
  starredIds: Set<string>,
): SessionGroup[] {
  if (sessions.length === 0) return [];

  const starred: Session[] = [];
  const idle: Session[] = [];
  const archived: Session[] = [];
  const now = Date.now();

  // Sort all sessions newest first
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  for (const s of sorted) {
    if (starredIds.has(s.id)) {
      starred.push(s);
    } else {
      const age = now - new Date(s.updatedAt).getTime();
      if (age < IDLE_THRESHOLD_MS || s.hasActivity) {
        idle.push(s);
      } else {
        archived.push(s);
      }
    }
  }

  const result: SessionGroup[] = [];
  if (starred.length > 0) result.push({ label: "Starred", dateKey: "0-starred", sessions: starred });
  if (idle.length > 0) result.push({ label: "Idle", dateKey: "1-idle", sessions: idle });
  if (archived.length > 0) result.push({ label: "Archived", dateKey: "2-archived", sessions: archived });

  return result;
}

// ---------------------------------------------------------------------------
// Day grouping (legacy, still used by tests)
// ---------------------------------------------------------------------------

/**
 * Group sessions by day (based on updatedAt), sorted newest day first.
 * Within each day, sessions are sorted newest first.
 */
export function groupSessionsByDay(sessions: Session[]): SessionGroup[] {
  if (sessions.length === 0) return [];

  // Sort all sessions newest first
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  // Group by date key
  const groups = new Map<string, Session[]>();
  for (const s of sorted) {
    const dateKey = toDateKey(s.updatedAt);
    const group = groups.get(dateKey);
    if (group) {
      group.push(s);
    } else {
      groups.set(dateKey, [s]);
    }
  }

  // Build result: newest day first (Map preserves insertion order, and we
  // sorted sessions newest first, so the first key is the newest day)
  const todayKey = toDateKey(new Date().toISOString());
  const yesterdayKey = toDateKey(
    new Date(Date.now() - 86_400_000).toISOString(),
  );

  const result: SessionGroup[] = [];
  for (const [dateKey, groupSessions] of groups) {
    let label: string;
    if (dateKey === todayKey) {
      label = "Today";
    } else if (dateKey === yesterdayKey) {
      label = "Yesterday";
    } else {
      label = formatDateLabel(dateKey);
    }
    result.push({ label, dateKey, sessions: groupSessions });
  }

  return result;
}

/**
 * Convert an ISO date string to a YYYY-MM-DD key (local timezone).
 */
function toDateKey(isoDate: string): string {
  const d = new Date(isoDate);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a YYYY-MM-DD key into a human-readable label (e.g., "Feb 20").
 */
function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const monthName = d.toLocaleDateString("en-US", { month: "short" });
  return `${monthName} ${day}`;
}

// ---------------------------------------------------------------------------
// API → Session mapping
// ---------------------------------------------------------------------------

/**
 * Format a session's project/directory into a short display path.
 *
 * Priority: session.project > last 2 segments of session.directory > null.
 */
export function formatProjectPath(session: Session): string | null {
  if (session.project) return session.project;
  if (!session.directory) return null;
  // Show last 2 path segments: "user/project"
  const parts = session.directory.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length >= 2
    ? parts.slice(-2).join("/")
    : parts[parts.length - 1] || null;
}

/**
 * Map a raw session object from the OpenCode REST API into our Session type.
 *
 * Handles the OpenCode format:
 *   { id, slug, title, directory, project, time: { created, updated }, ... }
 *
 * Falls back gracefully for missing fields.
 */
export function mapRawSession(raw: Record<string, unknown>): Session {
  const time = raw.time as Record<string, unknown> | undefined;
  const createdIso =
    (time?.created
      ? new Date(time.created as number).toISOString()
      : (raw.createdAt as string | undefined)) ??
    new Date().toISOString();
  const updatedIso =
    (time?.updated
      ? new Date(time.updated as number).toISOString()
      : (raw.updatedAt as string | undefined)) ??
    createdIso;

  return {
    id: raw.id as string,
    title: (raw.title ?? raw.slug) as string | undefined,
    directory: raw.directory as string | undefined,
    project: raw.project as string | undefined,
    createdAt: createdIso,
    updatedAt: updatedIso,
  };
}

/**
 * Map an array of raw API session objects into typed Session[].
 */
export function mapRawSessions(raw: Record<string, unknown>[]): Session[] {
  return raw.map(mapRawSession);
}
