/**
 * DiffView — modal overlay showing file diffs for a session.
 *
 * Fetches from GET /sessions/:id/diff and renders as terminal-style
 * unified diff output. Ported from mobile's DiffSheet.
 */

import { useEffect, useState, useCallback } from "react";
import { useApi } from "../hooks/useApi.js";

interface DiffEntry {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface DiffViewProps {
  sessionId: string;
  onClose: () => void;
}

export function DiffView({ sessionId, onClose }: DiffViewProps) {
  const api = useApi();

  const [loading, setLoading] = useState(true);
  const [diffs, setDiffs] = useState<DiffEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Fetch diffs on mount
  useEffect(() => {
    setLoading(true);
    api
      .diff(sessionId)
      .then((res) => {
        if (res.status === 200 && Array.isArray(res.body)) {
          setDiffs(res.body as DiffEntry[]);
        } else {
          setError("failed to load diff");
        }
      })
      .catch(() => setError("failed to load diff"))
      .finally(() => setLoading(false));
  }, [sessionId, api]);

  // Toggle file expansion
  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const totalAdded = diffs.reduce((sum, d) => sum + d.additions, 0);
  const totalRemoved = diffs.reduce((sum, d) => sum + d.deletions, 0);

  return (
    <div className="diff-overlay" onClick={handleBackdropClick}>
      <div className="diff-modal">
        {/* Header */}
        <div className="diff-header">
          <span className="diff-title">// diff</span>
          <button className="diff-close-btn" onClick={onClose}>
            [close]
          </button>
        </div>

        {/* Content */}
        <div className="diff-content">
          {loading && (
            <div className="diff-center">
              <span className="diff-loading">loading...</span>
            </div>
          )}

          {error && (
            <div className="diff-center">
              <span className="diff-error">{error}</span>
            </div>
          )}

          {!loading && !error && diffs.length === 0 && (
            <div className="diff-center">
              <span className="diff-empty">no changes</span>
            </div>
          )}

          {!loading && !error && diffs.length > 0 && (
            <>
              {/* Summary */}
              <div className="diff-summary">
                <span className="diff-summary-text">
                  {diffs.length} file{diffs.length !== 1 ? "s" : ""} changed
                </span>
                <span className="diff-summary-added">+{totalAdded}</span>
                <span className="diff-summary-removed">-{totalRemoved}</span>
              </div>

              {/* File list */}
              {diffs.map((diff) => (
                <div key={diff.path} className="diff-file-block">
                  {/* File header */}
                  <button
                    className="diff-file-header"
                    onClick={() => diff.patch && toggleFile(diff.path)}
                    disabled={!diff.patch}
                  >
                    <span
                      className={`diff-file-status ${
                        diff.status === "added"
                          ? "added"
                          : diff.status === "deleted"
                            ? "deleted"
                            : "modified"
                      }`}
                    >
                      {diff.status === "added"
                        ? "A"
                        : diff.status === "deleted"
                          ? "D"
                          : "M"}
                    </span>
                    <span className="diff-file-path">{diff.path}</span>
                    <span className="diff-file-added">+{diff.additions}</span>
                    <span className="diff-file-removed">-{diff.deletions}</span>
                    {diff.patch && (
                      <span className="diff-expand-icon">
                        {expandedFiles.has(diff.path) ? "\u25BC" : "\u25B6"}
                      </span>
                    )}
                  </button>

                  {/* Patch content */}
                  {expandedFiles.has(diff.path) && diff.patch && (
                    <div className="diff-patch">
                      {diff.patch.split("\n").map((line, idx) => {
                        let cls = "diff-line";
                        if (line.startsWith("+")) cls += " added";
                        else if (line.startsWith("-")) cls += " removed";
                        else if (line.startsWith("@@")) cls += " hunk";

                        return (
                          <div key={idx} className={cls}>
                            {line}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
