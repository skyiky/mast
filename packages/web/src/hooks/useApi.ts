/**
 * API hook — wraps lib/api.ts with config from Zustand connection store.
 *
 * Architecture: The `createApiBinding` factory is extracted for testability
 * under node:test. The `useApi` React hook is a thin useMemo wrapper.
 */

import { useMemo } from "react";
import { useConnectionStore } from "../stores/connection.js";
import * as api from "../lib/api.js";

// ---------------------------------------------------------------------------
// Testable factory (no React dependency)
// ---------------------------------------------------------------------------

export interface BoundApi {
  health: () => ReturnType<typeof api.fetchHealth>;
  sessions: () => ReturnType<typeof api.fetchSessions>;
  newSession: (project?: string) => ReturnType<typeof api.createSession>;
  messages: (sessionId: string) => ReturnType<typeof api.fetchMessages>;
  prompt: (sessionId: string, text: string) => ReturnType<typeof api.sendPrompt>;
  approve: (sessionId: string, permId: string) => ReturnType<typeof api.approvePermission>;
  deny: (sessionId: string, permId: string) => ReturnType<typeof api.denyPermission>;
  pair: (code: string) => ReturnType<typeof api.verifyPairingCode>;
  abort: (sessionId: string) => ReturnType<typeof api.abortSession>;
  diff: (sessionId: string) => ReturnType<typeof api.fetchDiff>;
  providers: () => ReturnType<typeof api.fetchProviders>;
  projectCurrent: () => ReturnType<typeof api.fetchProjectCurrent>;
  revert: (sessionId: string, messageId: string) => ReturnType<typeof api.revertMessage>;
  projects: () => ReturnType<typeof api.fetchProjects>;
  addProject: (name: string, directory: string) => ReturnType<typeof api.addProject>;
  removeProject: (name: string) => ReturnType<typeof api.removeProject>;
  mcpServers: () => ReturnType<typeof api.fetchMcpServers>;
}

/**
 * Create a bound API object that captures serverUrl and apiToken.
 * Pure function — no React dependency — for testability.
 */
export function createApiBinding(serverUrl: string, apiToken: string): BoundApi {
  const config: api.ApiConfig = { serverUrl, apiToken };

  return {
    health: () => api.fetchHealth(config),
    sessions: () => api.fetchSessions(config),
    newSession: (project?: string) => api.createSession(config, project),
    messages: (sessionId: string) => api.fetchMessages(config, sessionId),
    prompt: (sessionId: string, text: string) => api.sendPrompt(config, sessionId, text),
    approve: (sessionId: string, permId: string) => api.approvePermission(config, sessionId, permId),
    deny: (sessionId: string, permId: string) => api.denyPermission(config, sessionId, permId),
    pair: (code: string) => api.verifyPairingCode(config, code),
    abort: (sessionId: string) => api.abortSession(config, sessionId),
    diff: (sessionId: string) => api.fetchDiff(config, sessionId),
    providers: () => api.fetchProviders(config),
    projectCurrent: () => api.fetchProjectCurrent(config),
    revert: (sessionId: string, messageId: string) => api.revertMessage(config, sessionId, messageId),
    projects: () => api.fetchProjects(config),
    addProject: (name: string, directory: string) => api.addProject(config, name, directory),
    removeProject: (name: string) => api.removeProject(config, name),
    mcpServers: () => api.fetchMcpServers(config),
  };
}

// ---------------------------------------------------------------------------
// React hook (thin wrapper)
// ---------------------------------------------------------------------------

export function useApi(): BoundApi {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);

  return useMemo(
    () => createApiBinding(serverUrl, apiToken),
    [serverUrl, apiToken],
  );
}
