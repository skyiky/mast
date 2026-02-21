/**
 * API hook — wraps lib/api.ts with config from Zustand connection store.
 */

import { useCallback } from "react";
import { useConnectionStore } from "../stores/connection";
import * as api from "../lib/api";

export function useApi() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);

  const config: api.ApiConfig = { serverUrl, apiToken };

  const health = useCallback(() => api.fetchHealth(config), [serverUrl, apiToken]);
  const sessions = useCallback(() => api.fetchSessions(config), [serverUrl, apiToken]);
  const newSession = useCallback(() => api.createSession(config), [serverUrl, apiToken]);
  const messages = useCallback(
    (sessionId: string) => api.fetchMessages(config, sessionId),
    [serverUrl, apiToken],
  );
  const prompt = useCallback(
    (sessionId: string, text: string) => api.sendPrompt(config, sessionId, text),
    [serverUrl, apiToken],
  );
  const approve = useCallback(
    (sessionId: string, permId: string) => api.approvePermission(config, sessionId, permId),
    [serverUrl, apiToken],
  );
  const deny = useCallback(
    (sessionId: string, permId: string) => api.denyPermission(config, sessionId, permId),
    [serverUrl, apiToken],
  );
  const pair = useCallback(
    (code: string) => api.verifyPairingCode(config, code),
    [serverUrl, apiToken],
  );
  const pushToken = useCallback(
    (token: string) => api.registerPushToken(config, token),
    [serverUrl, apiToken],
  );
  const abort = useCallback(
    (sessionId: string) => api.abortSession(config, sessionId),
    [serverUrl, apiToken],
  );
  const diff = useCallback(
    (sessionId: string) => api.fetchDiff(config, sessionId),
    [serverUrl, apiToken],
  );
  const providers = useCallback(
    () => api.fetchProviders(config),
    [serverUrl, apiToken],
  );
  const projectCurrent = useCallback(
    () => api.fetchProjectCurrent(config),
    [serverUrl, apiToken],
  );
  const revert = useCallback(
    (sessionId: string, messageId: string) => api.revertMessage(config, sessionId, messageId),
    [serverUrl, apiToken],
  );

  return { health, sessions, newSession, messages, prompt, approve, deny, pair, pushToken, abort, diff, providers, projectCurrent, revert };
}
