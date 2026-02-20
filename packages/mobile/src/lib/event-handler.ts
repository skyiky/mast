/**
 * WebSocket event handler — processes events from the orchestrator
 * and dispatches them into the session store.
 *
 * Extracted as a pure function (no React/hook dependencies) for testability.
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
  const sid = (sessionId ?? (props.sessionID as string) ?? "") as string;

  switch (event.type) {
    case "message.created": {
      const msg = props.message as
        | { id: string; role: string }
        | undefined;
      if (msg && sid) {
        deps.addMessage(sid, {
          id: msg.id,
          role: msg.role as "user" | "assistant",
          parts: [],
          streaming: msg.role === "assistant",
          createdAt: new Date().toISOString(),
        });
      }
      break;
    }

    case "message.part.created":
    case "message.part.updated": {
      const part = props.part as
        | {
            type: string;
            content?: string;
            toolName?: string;
            toolArgs?: string;
          }
        | undefined;
      const messageID = props.messageID as string | undefined;

      if (part && messageID && sid) {
        if (part.type === "text" && part.content !== undefined) {
          deps.updateLastTextPart(sid, messageID, part.content);
        }
        // Tool invocations and other part types can be handled here
        // in the future.
      }
      break;
    }

    case "message.completed": {
      const messageID = props.messageID as string | undefined;
      if (messageID && sid) {
        deps.markMessageComplete(sid, messageID);
      }
      break;
    }

    case "permission.created": {
      const perm = props.permission as
        | {
            id: string;
            description?: string;
          }
        | undefined;
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
