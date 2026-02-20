/**
 * ClaudeCodeAdapter — AgentAdapter implementation for Claude Code via Agent SDK.
 *
 * Uses @anthropic-ai/claude-agent-sdk to run Claude Code as an in-process
 * library. No separate server — sessions run as async iterators within
 * the daemon process.
 *
 * Permission flow:
 *   1. PreToolUse hook fires for every tool call
 *   2. Adapter emits "mast.permission.created" event
 *   3. Adapter stores a pending Promise keyed by permission ID
 *   4. Phone user approves/denies via orchestrator → daemon
 *   5. approvePermission/denyPermission resolves the stored Promise
 *   6. PreToolUse hook returns { permissionDecision: "allow"/"deny" }
 */

import { randomUUID } from "node:crypto";
import { BaseAdapter, type MastEvent, type MastSession, type MastMessage } from "../agent-adapter.js";

// ---------------------------------------------------------------------------
// Types for the Agent SDK (imported at runtime)
// We define minimal type signatures here to avoid hard compile-time dependency
// during development. The actual SDK provides the real types at runtime.
// ---------------------------------------------------------------------------

export interface QueryOptions {
  prompt: string;
  options?: {
    allowedTools?: string[];
    permissionMode?: string;
    resume?: string;
    hooks?: {
      PreToolUse?: Array<{
        matcher: string;
        hooks: Array<HookCallback>;
      }>;
    };
    [key: string]: unknown;
  };
}

type HookCallback = (
  input: Record<string, unknown>,
  toolUseId: string,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface SDKMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  [key: string]: unknown;
}

// Lazy-loaded SDK reference
let sdkQuery: ((opts: QueryOptions) => AsyncIterable<SDKMessage>) | null = null;

async function loadSDK(): Promise<typeof sdkQuery> {
  if (sdkQuery) return sdkQuery;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    sdkQuery = sdk.query as unknown as typeof sdkQuery;
    return sdkQuery;
  } catch (err) {
    throw new Error(
      `Failed to load @anthropic-ai/claude-agent-sdk. ` +
      `Install it with: npm install @anthropic-ai/claude-agent-sdk\n` +
      `Error: ${err instanceof Error ? err.message : err}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ClaudeCodeAdapterConfig {
  /** Tools Claude is allowed to use. Defaults to common coding tools. */
  allowedTools?: string[];
  /** Working directory for the agent. Defaults to cwd. */
  workingDirectory?: string;
  /**
   * Override the SDK query function (for testing).
   * When set, the adapter skips loading the real SDK and uses this instead.
   * Also skips the ANTHROPIC_API_KEY check.
   */
  _queryFn?: (opts: QueryOptions) => AsyncIterable<SDKMessage>;
}

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface SessionState {
  id: string;
  sdkSessionId?: string; // The SDK's internal session ID (for resume)
  messages: MastMessage[];
  abortController: AbortController | null;
  running: boolean;
}

interface PendingPermission {
  resolve: (decision: { permissionDecision: "allow" | "deny" }) => void;
  sessionId: string;
  toolName: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly agentType = "claude-code";

  private sessions = new Map<string, SessionState>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private config: ClaudeCodeAdapterConfig;
  private _started = false;

  constructor(config?: ClaudeCodeAdapterConfig) {
    super();
    this.config = config ?? {};
  }

  // -- Lifecycle --

  async start(): Promise<void> {
    if (this._started) return;

    if (this.config._queryFn) {
      // Test mode — skip API key check and SDK loading
      this._started = true;
      console.log("[claude-code-adapter] Started (test mode)");
      return;
    }

    // Validate that the API key is available
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for Claude Code adapter",
      );
    }

    // Pre-load the SDK to catch import errors early
    await loadSDK();

    this._started = true;
    console.log("[claude-code-adapter] Started");
  }

  async stop(): Promise<void> {
    // Abort all running sessions
    for (const session of this.sessions.values()) {
      if (session.abortController) {
        session.abortController.abort();
      }
    }

    // Reject all pending permissions
    for (const [pid, pending] of this.pendingPermissions) {
      pending.resolve({ permissionDecision: "deny" });
      this.pendingPermissions.delete(pid);
    }

    this.sessions.clear();
    this._started = false;
    console.log("[claude-code-adapter] Stopped");
  }

  async healthCheck(): Promise<boolean> {
    if (this.config._queryFn) return this._started;
    return this._started && !!process.env.ANTHROPIC_API_KEY;
  }

  // -- Sessions --

  async listSessions(): Promise<MastSession[]> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      agentType: "claude-code" as const,
      createdAt: new Date().toISOString(),
    }));
  }

  async createSession(): Promise<MastSession> {
    const id = randomUUID();
    const session: SessionState = {
      id,
      messages: [],
      abortController: null,
      running: false,
    };
    this.sessions.set(id, session);

    return {
      id,
      agentType: "claude-code",
      createdAt: new Date().toISOString(),
    };
  }

  // -- Messaging --

  sendPrompt(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.running) {
      throw new Error(
        `Session ${sessionId} already has a running query. ` +
        `Abort the current query before sending a new prompt.`,
      );
    }

    // Fire-and-forget — response streams back via events
    this.runQuery(sessionId, text).catch((err) => {
      console.error(`[claude-code-adapter] Query error for session ${sessionId}:`, err);
    });
  }

  async abortSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
      session.running = false;
    }
  }

  async getMessages(sessionId: string): Promise<MastMessage[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session.messages;
  }

  // -- Permissions --

  approvePermission(_sessionId: string, permissionId: string): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (pending) {
      pending.resolve({ permissionDecision: "allow" });
      this.pendingPermissions.delete(permissionId);

      this.emitEvent({
        type: "mast.permission.updated",
        sessionId: pending.sessionId,
        data: {
          permissionId,
          status: "approved",
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  denyPermission(_sessionId: string, permissionId: string): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (pending) {
      pending.resolve({ permissionDecision: "deny" });
      this.pendingPermissions.delete(permissionId);

      this.emitEvent({
        type: "mast.permission.updated",
        sessionId: pending.sessionId,
        data: {
          permissionId,
          status: "denied",
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // -- Diff --

  async getDiff(_sessionId: string): Promise<unknown> {
    // Claude Code SDK doesn't expose diffs the same way OpenCode does.
    // For now, return empty. This will be enhanced in a future iteration
    // to use git diff in the working directory.
    return { files: [] };
  }

  // -- Internal: Run a query --

  private async runQuery(sessionId: string, text: string): Promise<void> {
    const queryFn = this.config._queryFn ?? await loadSDK();
    if (!queryFn) throw new Error("SDK not loaded");

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.abortController = new AbortController();
    session.running = true;

    // Create a user message
    const userMsgId = `user-${randomUUID()}`;
    const userMessage: MastMessage = {
      id: userMsgId,
      role: "user",
      parts: [{ type: "text", text }],
      completed: true,
    };
    session.messages.push(userMessage);

    // Create the assistant message placeholder
    const assistantMsgId = `asst-${randomUUID()}`;
    const assistantMessage: MastMessage = {
      id: assistantMsgId,
      role: "assistant",
      parts: [],
      completed: false,
    };
    session.messages.push(assistantMessage);

    // Emit message.created for the assistant message
    this.emitEvent({
      type: "mast.message.created",
      sessionId,
      data: {
        sessionID: sessionId,
        message: { id: assistantMsgId, role: "assistant" },
      },
      timestamp: new Date().toISOString(),
    });

    // Build PreToolUse hook for permission flow
    const preToolUseHook: HookCallback = async (input, toolUseId, _context) => {
      const toolName = (input as Record<string, unknown>).tool_name as string ?? "unknown";
      const permissionId = randomUUID();

      // Emit permission event
      this.emitEvent({
        type: "mast.permission.created",
        sessionId,
        data: {
          sessionID: sessionId,
          permission: {
            id: permissionId,
            description: `${toolName}`,
            toolName,
            input: (input as Record<string, unknown>).tool_input,
          },
        },
        timestamp: new Date().toISOString(),
      });

      // Wait for user decision
      const decision = await new Promise<{ permissionDecision: "allow" | "deny" }>(
        (resolve) => {
          this.pendingPermissions.set(permissionId, {
            resolve,
            sessionId,
            toolName,
          });
        },
      );

      return {
        hookSpecificOutput: {
          permissionDecision: decision.permissionDecision,
        },
      };
    };

    try {
      const queryOpts: QueryOptions = {
        prompt: text,
        options: {
          allowedTools: this.config.allowedTools ?? [
            "Read", "Write", "Edit", "Bash", "Glob", "Grep",
          ],
          hooks: {
            PreToolUse: [
              {
                matcher: "*",
                hooks: [preToolUseHook],
              },
            ],
          },
          // Resume session if we have a previous SDK session ID
          ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
        },
      };

      const stream = queryFn(queryOpts);

      for await (const message of stream) {
        if (session.abortController?.signal.aborted) break;

        // Capture SDK session ID from init message
        if (message.type === "system" && message.subtype === "init" && message.session_id) {
          session.sdkSessionId = message.session_id;
          continue;
        }

        // Handle result messages (final text output)
        if ("result" in message && typeof message.result === "string") {
          const part = { type: "text" as const, content: message.result };
          assistantMessage.parts.push(part);

          this.emitEvent({
            type: "mast.message.part.updated",
            sessionId,
            data: {
              sessionID: sessionId,
              messageID: assistantMsgId,
              part,
            },
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        // Handle tool use events — emit as message parts
        if (message.type === "tool_use" || message.tool_name) {
          const toolPart = {
            type: "tool-invocation" as const,
            toolName: message.tool_name ?? "unknown",
            input: message.tool_input,
            toolUseId: message.tool_use_id,
          };
          assistantMessage.parts.push(toolPart);

          this.emitEvent({
            type: "mast.message.part.updated",
            sessionId,
            data: {
              sessionID: sessionId,
              messageID: assistantMsgId,
              part: toolPart,
            },
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        // Handle text content blocks
        if (message.type === "text" && message.content) {
          const textPart = { type: "text" as const, content: String(message.content) };
          assistantMessage.parts.push(textPart);

          this.emitEvent({
            type: "mast.message.part.updated",
            sessionId,
            data: {
              sessionID: sessionId,
              messageID: assistantMsgId,
              part: textPart,
            },
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        console.log(`[claude-code-adapter] Session ${sessionId} aborted`);
      } else {
        console.error(`[claude-code-adapter] Query error:`, err);
        // Emit error as a message part
        const errorPart = {
          type: "text" as const,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
        assistantMessage.parts.push(errorPart);

        this.emitEvent({
          type: "mast.message.part.updated",
          sessionId,
          data: {
            sessionID: sessionId,
            messageID: assistantMsgId,
            part: errorPart,
          },
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      // Mark message as complete
      assistantMessage.completed = true;
      session.running = false;
      session.abortController = null;

      this.emitEvent({
        type: "mast.message.completed",
        sessionId,
        data: {
          sessionID: sessionId,
          messageID: assistantMsgId,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
}
