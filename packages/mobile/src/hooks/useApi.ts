/**
 * API client hook for sending HTTP requests to the orchestrator.
 */

import { useCallback } from "react";
import type { ServerConfig } from "../types";

export function useApi(config: ServerConfig) {
  const request = useCallback(
    async (method: string, path: string, body?: unknown) => {
      const opts: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
      };
      if (body !== undefined) {
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(`${config.httpUrl}${path}`, opts);
      const text = await res.text();
      let parsed: unknown = null;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, body: parsed };
    },
    [config],
  );

  /** Create a new session */
  const createSession = useCallback(async () => {
    return request("POST", "/sessions");
  }, [request]);

  /** Send a prompt to a session */
  const sendPrompt = useCallback(
    async (sessionId: string, text: string) => {
      return request("POST", `/sessions/${sessionId}/prompt`, {
        parts: [{ type: "text", text }],
      });
    },
    [request],
  );

  /** List sessions */
  const listSessions = useCallback(async () => {
    return request("GET", "/sessions");
  }, [request]);

  /** Get messages for a session */
  const getMessages = useCallback(
    async (sessionId: string) => {
      return request("GET", `/sessions/${sessionId}/messages`);
    },
    [request],
  );

  return { request, createSession, sendPrompt, listSessions, getMessages };
}
