/**
 * Non-hook API client for the Mast orchestrator.
 * Can be used from Zustand stores, callbacks, and components.
 */

export interface ApiConfig {
  serverUrl: string;
  apiToken: string;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T | null;
}

async function request<T = unknown>(
  config: ApiConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
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

  const res = await fetch(`${config.serverUrl}${path}`, opts);
  const text = await res.text();
  let parsed: T | null = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      parsed = text as unknown as T;
    }
  }
  return { status: res.status, body: parsed };
}

export async function fetchHealth(config: ApiConfig) {
  return request<{
    status: string;
    daemonConnected: boolean;
    opencodeReady: boolean;
  }>(config, "GET", "/health");
}

export async function fetchSessions(config: ApiConfig) {
  return request<Array<{ id: string; slug?: string; title?: string; createdAt?: string }>>(
    config,
    "GET",
    "/sessions",
  );
}

export async function createSession(config: ApiConfig) {
  return request<{ id: string }>(config, "POST", "/sessions");
}

export async function fetchMessages(config: ApiConfig, sessionId: string) {
  return request<Array<{
    id: string;
    role: string;
    parts?: Array<{ type: string; content?: string }>;
    streaming?: boolean;
    createdAt?: string;
  }>>(config, "GET", `/sessions/${sessionId}/messages`);
}

export async function sendPrompt(
  config: ApiConfig,
  sessionId: string,
  text: string,
) {
  return request(config, "POST", `/sessions/${sessionId}/prompt`, {
    parts: [{ type: "text", text }],
  });
}

export async function approvePermission(
  config: ApiConfig,
  sessionId: string,
  permissionId: string,
) {
  return request(config, "POST", `/sessions/${sessionId}/approve/${permissionId}`, {
    approve: true,
  });
}

export async function denyPermission(
  config: ApiConfig,
  sessionId: string,
  permissionId: string,
) {
  return request(config, "POST", `/sessions/${sessionId}/deny/${permissionId}`, {
    approve: false,
  });
}

export async function verifyPairingCode(
  config: ApiConfig,
  code: string,
) {
  return request<{ success: boolean; deviceKey?: string; error?: string }>(
    config,
    "POST",
    "/pair/verify",
    { code },
  );
}

export async function registerPushToken(
  config: ApiConfig,
  token: string,
) {
  return request(config, "POST", "/push/register", { token });
}

export async function abortSession(
  config: ApiConfig,
  sessionId: string,
) {
  return request<boolean>(config, "POST", `/sessions/${sessionId}/abort`);
}

export async function fetchDiff(
  config: ApiConfig,
  sessionId: string,
) {
  return request<Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>>(config, "GET", `/sessions/${sessionId}/diff`);
}

export async function fetchProviders(config: ApiConfig) {
  return request<{
    all: Record<string, unknown>;
    default: Record<string, string>;
    connected: string[];
  }>(config, "GET", "/providers");
}

export async function fetchProjectCurrent(config: ApiConfig) {
  return request<{
    path?: string;
    name?: string;
    root?: string;
  }>(config, "GET", "/project/current");
}

export async function revertMessage(
  config: ApiConfig,
  sessionId: string,
  messageId: string,
) {
  return request(config, "POST", `/sessions/${sessionId}/revert`, {
    messageID: messageId,
  });
}
