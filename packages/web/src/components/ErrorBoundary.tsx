/**
 * ErrorBoundary — catches React render errors in child components
 * and displays them visibly instead of crashing to a black screen.
 *
 * Wrap around <Outlet /> in Layout so page-level crashes are caught
 * and the sidebar / navigation remain functional.
 */

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  /** Optional fallback — defaults to built-in error display. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          padding: "24px",
          color: "#ff6b6b",
          fontFamily: "monospace",
          fontSize: "13px",
          whiteSpace: "pre-wrap",
          overflow: "auto",
          height: "100%",
        }}>
          <div style={{ marginBottom: "12px", fontWeight: "bold" }}>
            Something went wrong
          </div>
          <div style={{ color: "#ccc", marginBottom: "8px" }}>
            {this.state.error.message}
          </div>
          <div style={{ color: "#888", fontSize: "11px" }}>
            {this.state.error.stack}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: "16px",
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid #666",
              color: "#ccc",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: "12px",
            }}
          >
            [retry]
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
