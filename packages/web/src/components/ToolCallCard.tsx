/**
 * ToolCallCard — collapsible tool invocation display.
 * Collapsed: one-liner `[+] [tool] toolName checkmark`
 * Expanded: monospace args/result with show more/less for long results.
 */

import { memo, useState } from "react";
import { formatArgs } from "../lib/chat-utils.js";

const RESULT_TRUNCATE_LENGTH = 500;

interface ToolCallCardProps {
  toolName: string;
  args?: string;
  result?: string;
  collapsed?: boolean;
}

function ToolCallCardInner({
  toolName,
  args,
  result,
  collapsed: initialCollapsed = true,
}: ToolCallCardProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [resultExpanded, setResultExpanded] = useState(false);

  const isResultLong = result != null && result.length > RESULT_TRUNCATE_LENGTH;
  const displayResult = result
    ? isResultLong && !resultExpanded
      ? result.slice(0, RESULT_TRUNCATE_LENGTH)
      : result
    : undefined;

  return (
    <div className="tool-card">
      <button
        className="tool-card-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="tool-toggle">{collapsed ? "+" : "-"}</span>
        <span className="tool-label">[tool]</span>
        <span className="tool-name">{toolName}</span>
        {result && <span className="tool-check">{"\u2713"}</span>}
      </button>

      {!collapsed && (
        <div className="tool-card-body">
          {args && (
            <div className="tool-section">
              <div className="tool-section-label">args</div>
              <pre className="tool-section-content">{formatArgs(args)}</pre>
            </div>
          )}
          {displayResult != null && (
            <div className="tool-section">
              <div className="tool-section-label">result</div>
              <pre className="tool-result-content">{displayResult}</pre>
              {isResultLong && (
                <button
                  className="tool-show-more"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResultExpanded(!resultExpanded);
                  }}
                >
                  {resultExpanded ? "[show less]" : "[show more]"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ToolCallCard = memo(ToolCallCardInner);
ToolCallCard.displayName = "ToolCallCard";
