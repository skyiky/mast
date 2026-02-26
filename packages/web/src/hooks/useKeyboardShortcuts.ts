/**
 * useKeyboardShortcuts — global keyboard shortcuts.
 *
 * - Escape: navigate back / close modals
 * - Ctrl/Cmd+K: focus session search (future)
 */

import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Escape: go back to home from chat/settings
      if (e.key === "Escape" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Don't intercept if user is in an input/textarea
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
          // Blur the input instead of navigating
          (active as HTMLElement).blur();
          return;
        }

        if (location.pathname !== "/") {
          e.preventDefault();
          navigate("/");
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, location.pathname]);
}
