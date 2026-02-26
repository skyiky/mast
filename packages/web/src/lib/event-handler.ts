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

import type { ChatMessage, MessagePart, PermissionRequest } from "./types.js";

// ---------------------------------------------------------------------------
// Deduplication state for replayed SSE events.
//
// When the daemon reconnects to OpenCode's SSE endpoint, OpenCode replays
// buffered events. This causes duplicate events arriving at the client. We
// track "finalized" part IDs (parts that have received their final snapshot
// with time.end) and skip any subsequent updates for them.
//
// For message.part.delta events (which don't carry a unique delta ID), we
// track finalized message IDs — once a text part for a message has been
// finalized, we skip further deltas for that message.
// ---------------------------------------------------------------------------
const finalizedPartIds = new Set<string>();
const finalizedTextMessageIds = new Set<string>();

/**
 * Reset dedup tracking. Call this when establishing a new SSE/WebSocket
 * session to avoid stale dedup state from a previous connection.
 */
export function resetEventDedup(): void {
  finalizedPartIds.clear();
  finalizedTextMessageIds.clear();
}

/** Dependencies injected from Zustand stores (or mocks in tests). */
export interface EventHandlerDeps {
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateLastTextPart: (
    sessionId: string,
    messageId: string,
    text: string,
  ) => void;
  appendTextDelta: (
    sessionId: string,
    messageId: string,
    delta: string,
  ) => void;
  addPartToMessage: (
    sessionId: string,
    messageId: string,
    part: MessagePart,
  ) => void;
  /** Upsert a tool part by callID — updates in-place or appends. */
  upsertToolPart: (
    sessionId: string,
    messageId: string,
    part: MessagePart,
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
      } else if (info.role === "user") {
        // Skip user messages from SSE — they were already added
        // optimistically by handleSend. Adding them again would create
        // duplicates since the local message has a client-side ID
        // (user-{timestamp}) while the server echo has a real ID (msg_...).
        break;
      } else {
        // New assistant message (no finish yet) — add it
        deps.addMessage(sid, {
          id: info.id,
          role: info.role as "user" | "assistant",
          parts: [],
          streaming: true,
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
            id?: string;
            type: string;
            text?: string;
            content?: string;
            messageID?: string;
            sessionID?: string;
            toolName?: string;
            toolArgs?: string;
            time?: { start?: number; end?: number };
          }
        | undefined;
      // messageID can be on the part itself (OpenCode) or on props (legacy)
      const messageID = (part?.messageID ?? props.messageID) as string | undefined;
      // sessionID can be on the part (OpenCode) or on props (legacy) or param
      const sid = sessionId ?? (part?.sessionID as string) ?? (props.sessionID as string) ?? "";

      if (part && messageID && sid) {
        const partId = part.id;

        // Dedup: skip events for already-finalized parts (replayed from
        // SSE reconnection). A finalized part has received its final
        // snapshot (time.end set), so any subsequent update is a replay.
        if (partId && finalizedPartIds.has(partId)) break;

        // Mark part as finalized when it has a completion time
        if (partId && part.time?.end) {
          finalizedPartIds.add(partId);
          if (part.type === "text" && messageID) {
            finalizedTextMessageIds.add(messageID);
          }
        }

        if (part.type === "text") {
          // OpenCode uses "text", legacy uses "content"
          const textContent = part.text ?? part.content;
          if (textContent !== undefined) {
            deps.updateLastTextPart(sid, messageID, textContent);
          }
        } else if (part.type === "tool-invocation") {
          // Legacy tool invocation format (tests / backward compat)
          deps.addPartToMessage(sid, messageID, {
            type: "tool-invocation",
            content: part.text ?? part.content ?? "",
            toolName: part.toolName ?? (part as any).name,
            toolArgs: part.toolArgs ?? ((part as any).args ? JSON.stringify((part as any).args) : undefined),
          });
        } else if (part.type === "tool") {
          // OpenCode v1.x tool format — combines invocation + result in one part:
          //   { type: "tool", tool: "read", callID: "...",
          //     state: { status, input, output, error, time } }
          // OpenCode sends multiple updates per tool call (pending → running →
          // completed). We upsert by callID to avoid duplicate tool cards.
          const toolPart = part as Record<string, unknown>;
          const state = toolPart.state as {
            status?: string;
            input?: unknown;
            output?: string;
            error?: string;
          } | undefined;
          const toolName = (toolPart.tool as string)
            ?? part.toolName
            ?? (toolPart.name as string)
            ?? "tool";
          const args = state?.input
            ? JSON.stringify(state.input)
            : part.toolArgs;
          // Combine output/error as the result content
          const result = state?.error ?? state?.output ?? "";
          const callID = (toolPart.callID as string) ?? partId;
          deps.upsertToolPart(sid, messageID, {
            type: "tool-invocation",
            content: result,
            toolName,
            toolArgs: args,
            callID,
          });
        }
        // Other part types (step-start, step-finish, patch, etc.) are ignored.
      }
      break;
    }

    // -----------------------------------------------------------------
    // message.part.delta — incremental text streaming from OpenCode.
    // Shape: { part?: { messageID, sessionID }, field: "text", delta: "..." }
    // We append the delta to the existing text part for real-time
    // character-by-character streaming in the UI.
    // -----------------------------------------------------------------
    case "message.part.delta": {
      const part = props.part as
        | { messageID?: string; sessionID?: string; id?: string }
        | undefined;
      const field = props.field as string | undefined;
      const delta = props.delta as string | undefined;

      const messageID = (part?.messageID ?? props.messageID) as string | undefined;
      const sid = sessionId ?? (part?.sessionID as string) ?? (props.sessionID as string) ?? "";

      if (field === "text" && delta && messageID && sid) {
        // Dedup: if the text part for this message has already been
        // finalized (received final snapshot with time.end), skip
        // replayed deltas that would double the text content.
        if (finalizedTextMessageIds.has(messageID)) break;

        deps.appendTextDelta(sid, messageID, delta);
      }
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
