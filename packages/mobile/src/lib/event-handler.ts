/**
 * WebSocket event handler — processes events from the orchestrator
 * and dispatches them into the session store.
 *
 * Extracted as a pure function (no React/hook dependencies) for testability.
 *
 * OpenCode SSE event flow (after daemon normalizes `properties` → `data`):
 *
 *   message.updated        → new or updated message:
 *                             { info: { id, role, sessionID, finish?, time? } }
 *   message.part.updated   → text / step-start / step-finish:
 *                             { part: { id, sessionID, messageID, type, text? } }
 *   message.part.delta     → incremental text streaming:
 *                             { part: { messageID, sessionID }, field: "text", delta: "..." }
 *   permission.created     → tool permission request
 *   permission.updated     → tool permission resolved
 *
 * Legacy events (message.created, message.completed, message.part.created)
 * are also handled for backward compatibility with tests and the fake-opencode
 * server used in the orchestrator test suite.
 */

import type { ChatMessage, PermissionRequest } from "../stores/sessions";

/** Dependencies injected from Zustand stores (or mocks in tests). */
export interface EventHandlerDeps {
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateLastTextPart: (
    sessionId: string,
    messageId: string,
    text: string,
  ) => void;
  markMessageComplete: (sessionId: string, messageId: string) => void;
  addPermission: (perm: PermissionRequest) => void;
  updatePermission: (permId: string, status: "approved" | "denied") => void;
}

export interface WsEvent {
  type: string;
  data?: Record<string, unknown>;
  /** OpenCode SSE events use "properties" instead of "data". */
  properties?: Record<string, unknown>;
}

/**
 * Handle a WebSocket event message by dispatching to the appropriate
 * store action. Pure function — no side effects beyond calling deps.
 */
export function handleWsEvent(
  deps: EventHandlerDeps,
  event: WsEvent,
  sessionId?: string,
): void {
  // Normalize: OpenCode uses "properties", our relay normalizes to "data"
  const props = (event.data ?? event.properties ?? {}) as Record<
    string,
    unknown
  >;

  switch (event.type) {
    // -----------------------------------------------------------------
    // message.updated — OpenCode sends this for BOTH new and updated
    // messages. The message info is at props.info (NOT props.message).
    // A message is "complete" when info.finish is set (e.g., "stop").
    // -----------------------------------------------------------------
    case "message.updated": {
      const info = props.info as
        | { id: string; role: string; sessionID?: string; finish?: string; time?: { completed?: number } }
        | undefined;
      if (!info) break;

      const sid = sessionId ?? info.sessionID ?? (props.sessionID as string) ?? "";
      if (!sid) break;

      // If the message has a finish marker, mark it complete
      if (info.finish || info.time?.completed) {
        deps.markMessageComplete(sid, info.id);
      } else {
        // New message (no finish yet) — add it
        deps.addMessage(sid, {
          id: info.id,
          role: info.role as "user" | "assistant",
          parts: [],
          streaming: info.role === "assistant",
          createdAt: new Date().toISOString(),
        });
      }
      break;
    }

    // -----------------------------------------------------------------
    // message.created — legacy / test compat. Some test fakes still
    // send this. Data shape: { message: { id, role }, sessionID }.
    // -----------------------------------------------------------------
    case "message.created": {
      const msg = props.message as
        | { id: string; role: string }
        | undefined;
      // Also check props.info for OpenCode-shaped events that happen
      // to use this event type (belt-and-suspenders).
      const info = props.info as
        | { id: string; role: string; sessionID?: string }
        | undefined;
      const source = msg ?? info;
      const sid = sessionId ?? (info?.sessionID as string) ?? (props.sessionID as string) ?? "";

      if (source && sid) {
        deps.addMessage(sid, {
          id: source.id,
          role: source.role as "user" | "assistant",
          parts: [],
          streaming: source.role === "assistant",
          createdAt: new Date().toISOString(),
        });
      }
      break;
    }

    // -----------------------------------------------------------------
    // message.part.updated / message.part.created
    // OpenCode shape: { part: { id, sessionID, messageID, type, text } }
    // Legacy shape:   { messageID, part: { type, content } }
    // -----------------------------------------------------------------
    case "message.part.created":
    case "message.part.updated": {
      const part = props.part as
        | {
            type: string;
            text?: string;
            content?: string;
            messageID?: string;
            sessionID?: string;
            toolName?: string;
            toolArgs?: string;
          }
        | undefined;
      // messageID can be on the part itself (OpenCode) or on props (legacy)
      const messageID = (part?.messageID ?? props.messageID) as string | undefined;
      // sessionID can be on the part (OpenCode) or on props (legacy) or param
      const sid = sessionId ?? (part?.sessionID as string) ?? (props.sessionID as string) ?? "";

      if (part && messageID && sid) {
        // Only process text parts — skip step-start, step-finish, etc.
        if (part.type === "text") {
          // OpenCode uses "text", legacy uses "content"
          const textContent = part.text ?? part.content;
          if (textContent !== undefined) {
            deps.updateLastTextPart(sid, messageID, textContent);
          }
        }
        // Tool invocations and other part types can be handled here
        // in the future.
      }
      break;
    }

    // -----------------------------------------------------------------
    // message.part.delta — incremental text streaming from OpenCode.
    // Shape: { part?: { messageID, sessionID }, field: "text", delta: "..." }
    // We append the delta to the existing text part.
    // -----------------------------------------------------------------
    case "message.part.delta": {
      // Delta events are informational — the full text arrives via
      // message.part.updated with the complete text. We intentionally
      // skip processing deltas to avoid double-updating. The final
      // message.part.updated has the full text.
      //
      // If we wanted real-time character-by-character streaming in the
      // future, we'd handle deltas here. For now, the part.updated
      // events arrive fast enough.
      break;
    }

    // -----------------------------------------------------------------
    // message.completed — legacy event. OpenCode signals completion
    // via message.updated with info.finish = "stop" instead.
    // -----------------------------------------------------------------
    case "message.completed": {
      const messageID = props.messageID as string | undefined;
      const sid = sessionId ?? (props.sessionID as string) ?? "";
      if (messageID && sid) {
        deps.markMessageComplete(sid, messageID);
      }
      break;
    }

    // -----------------------------------------------------------------
    // permission.created
    // -----------------------------------------------------------------
    case "permission.created": {
      const perm = props.permission as
        | {
            id: string;
            description?: string;
          }
        | undefined;
      const sid = sessionId ?? (props.sessionID as string) ?? "";
      if (perm && sid) {
        deps.addPermission({
          id: perm.id,
          sessionId: sid,
          description: perm.description ?? "Permission requested",
          status: "pending",
          createdAt: new Date().toISOString(),
        });
      }
      break;
    }

    // -----------------------------------------------------------------
    // permission.updated
    // -----------------------------------------------------------------
    case "permission.updated": {
      const perm = props.permission as
        | {
            id: string;
            status?: string;
          }
        | undefined;
      if (perm) {
        deps.updatePermission(
          perm.id,
          (perm.status as "approved" | "denied") ?? "approved",
        );
      }
      break;
    }
  }
}
