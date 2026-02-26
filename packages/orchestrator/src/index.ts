/**
 * Mast Orchestrator — Entry point.
 *
 * Detects environment to decide configuration:
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY → use SupabaseSessionStore (production)
 * - SUPABASE_URL + SUPABASE_ANON_KEY → fallback (no service role key)
 * - Otherwise → InMemorySessionStore (local dev / testing)
 * - SUPABASE_JWT_SECRET → enables JWT verification for phone/API auth
 * - MAST_DEV_MODE=1 → accept hardcoded Phase 1 tokens (auto-enabled without JWT secret)
 * - EXPO_PUSH_URL → override push API endpoint (for testing)
 *
 * Wires up: session store, push notifier, pairing manager, server.
 */

import { startServer } from "./server.js";
import { InMemorySessionStore } from "./session-store.js";
import { SupabaseSessionStore } from "./supabase-store.js";
import { PushNotifier, PushDeduplicator } from "./push-notifications.js";
import { PairingManager } from "./pairing.js";
import { initJwks, hasJwks } from "./auth.js";
import type { SessionStore } from "./session-store.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  // --- Auth config ---
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;

  // Fetch JWKS from Supabase for ES256 JWT verification
  if (supabaseUrl) {
    await initJwks(supabaseUrl);
  }

  const jwtEnabled = hasJwks() || !!jwtSecret;
  const devMode = process.env.MAST_DEV_MODE === "1" || !jwtEnabled;

  if (hasJwks()) {
    console.log("[orchestrator] ES256 JWT verification enabled (JWKS)");
  }
  if (jwtSecret) {
    console.log("[orchestrator] HS256 JWT verification enabled (secret)");
  }
  if (devMode) {
    console.log("[orchestrator] Dev mode enabled — hardcoded tokens accepted");
  }

  // --- Session store ---
  let store: SessionStore;
  let supabaseStore: SupabaseSessionStore | undefined;

  // Prefer service role key (bypasses RLS), fall back to anon key
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log("[orchestrator] Using SupabaseSessionStore");
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log("[orchestrator] Using service role key (bypasses RLS)");
    } else {
      console.log("[orchestrator] Using anon key (RLS applies)");
    }
    const sbStore = new SupabaseSessionStore(supabaseUrl, supabaseKey);
    store = sbStore;
    supabaseStore = sbStore;
  } else {
    console.log("[orchestrator] Using InMemorySessionStore (no SUPABASE_URL set)");
    store = new InMemorySessionStore();
  }

  // --- Pairing manager ---
  const pairingManager = new PairingManager();

  // --- Push notifier ---
  const pushApiUrl = process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
  let phoneConnectedFn: ((userId: string) => boolean) | undefined;

  // We'll set this after the server starts (need phoneConnections reference)
  const pushNotifier = new PushNotifier(
    store,
    {
      pushApiUrl,
      isPhoneConnected: (userId: string) => phoneConnectedFn?.(userId) ?? false,
    },
    new PushDeduplicator(),
  );

  // --- Web client dist path (for Docker / hosted deployments) ---
  const webDistPath = process.env.WEB_DIST_PATH;
  if (webDistPath) {
    console.log(`[orchestrator] Serving web client from ${webDistPath}`);
  }

  // --- Start server ---
  const handle = await startServer(PORT, {
    store,
    pushNotifier,
    pairingManager,
    jwtSecret,
    devMode,
    supabaseStore,
    webDistPath,
  });

  // Now wire the phone-connected check to the actual phone connections
  phoneConnectedFn = (userId: string) => handle.phoneConnections.hasConnectedPhones(userId);

  console.log(`[orchestrator] Listening on port ${handle.port}`);
  if (supabaseUrl) {
    console.log(`[orchestrator] Supabase: ${supabaseUrl}`);
  }

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log("[orchestrator] Shutting down...");
    await handle.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
