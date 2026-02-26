/**
 * Pure utility functions for chat page presentation.
 * No React dependency — testable under node:test.
 */

/**
 * Pretty-print JSON args string. Falls back to raw string if not valid JSON.
 */
export function formatArgs(args: string): string {
  if (!args) return "";
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

/**
 * Format an ISO timestamp to HH:MM (24h). Returns null for missing/empty input.
 */
export function formatTimestamp(isoDate: string | undefined): string | null {
  if (!isoDate) return null;
  try {
    return new Date(isoDate).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}
