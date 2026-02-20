/**
 * Fake Claude Agent SDK for testing.
 *
 * Provides a controllable mock of the @anthropic-ai/claude-agent-sdk query()
 * function. Tests push SDKMessages into a queue and the async generator
 * yields them. Supports simulating the PreToolUse permission hook flow.
 *
 * Framework: none — pure TypeScript, consumed by claude-adapter.test.ts
 */

import type { QueryOptions, SDKMessage } from "../src/adapters/claude-code-adapter.js";

// ---------------------------------------------------------------------------
// FakeClaudeSDK — controllable async generator
// ---------------------------------------------------------------------------

export interface FakeClaudeSDK {
  /**
   * The mock query function — pass this as _queryFn to ClaudeCodeAdapter.
   * Each call records the QueryOptions and returns an async iterable
   * that yields messages pushed via pushMessage().
   */
  queryFn: (opts: QueryOptions) => AsyncIterable<SDKMessage>;

  /** Push a message to be yielded by the current query stream. */
  pushMessage(msg: SDKMessage): void;

  /** Signal the current query stream to end (no more messages). */
  finish(): void;

  /** Get the QueryOptions from the most recent query() call. */
  lastQueryOpts(): QueryOptions | null;

  /** Get all QueryOptions from all query() calls. */
  allQueryOpts(): QueryOptions[];

  /**
   * Get the PreToolUse hook captured from the last query() call.
   * Call this after sendPrompt to simulate a tool use permission request.
   * Returns null if no hooks were registered.
   */
  getPreToolUseHook(): ((
    input: Record<string, unknown>,
    toolUseId: string,
    context: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>) | null;
}

export function createFakeClaudeSDK(): FakeClaudeSDK {
  const queryHistory: QueryOptions[] = [];
  let preToolUseHook: FakeClaudeSDK["getPreToolUseHook"] extends () => infer R ? R : never = null;

  // Message queue for the current stream
  let messageQueue: SDKMessage[] = [];
  let messageResolve: (() => void) | null = null;
  let finished = false;

  function resetStream() {
    messageQueue = [];
    messageResolve = null;
    finished = false;
  }

  const queryFn = (opts: QueryOptions): AsyncIterable<SDKMessage> => {
    queryHistory.push(opts);
    resetStream();

    // Extract PreToolUse hook if present
    const hooks = opts.options?.hooks?.PreToolUse;
    if (hooks && hooks.length > 0 && hooks[0].hooks.length > 0) {
      preToolUseHook = hooks[0].hooks[0];
    } else {
      preToolUseHook = null;
    }

    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<SDKMessage>> {
            // If there are queued messages, yield the next one
            if (messageQueue.length > 0) {
              return { done: false, value: messageQueue.shift()! };
            }

            // If finished and no more messages, we're done
            if (finished) {
              return { done: true, value: undefined };
            }

            // Wait for a new message or finish signal
            await new Promise<void>((resolve) => {
              messageResolve = resolve;
            });

            // Check again after being woken up
            if (messageQueue.length > 0) {
              return { done: false, value: messageQueue.shift()! };
            }

            return { done: true, value: undefined };
          },
        };
      },
    };
  };

  return {
    queryFn,

    pushMessage(msg: SDKMessage) {
      messageQueue.push(msg);
      if (messageResolve) {
        const resolve = messageResolve;
        messageResolve = null;
        resolve();
      }
    },

    finish() {
      finished = true;
      if (messageResolve) {
        const resolve = messageResolve;
        messageResolve = null;
        resolve();
      }
    },

    lastQueryOpts() {
      return queryHistory.length > 0 ? queryHistory[queryHistory.length - 1] : null;
    },

    allQueryOpts() {
      return [...queryHistory];
    },

    getPreToolUseHook() {
      return preToolUseHook;
    },
  };
}
