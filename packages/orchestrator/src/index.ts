/**
 * Mast Orchestrator — Entry point.
 *
 * Detects environment to decide configuration:
 * - SUPABASE_URL + SUPABASE_ANON_KEY → use SupabaseSessionStore (production)
 * - Otherwise → InMemorySessionStore (local dev / testing)
 * - EXPO_PUSH_URL → override push API endpoint (for testing)
 *
 * Wires up: session store, push notifier, pairing manager, server.
 */

import { startServer } from "./server.js";
import { InMemorySessionStore } from "./session-store.js";
import { SupabaseSessionStore } from "./supabase-store.js";
import { PushNotifier, PushDeduplicator } from "./push-notifications.js";
import { PairingManager } from "./pairing.js";
import type { SessionStore } from "./session-store.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  // --- Session store ---
  let store: SessionStore;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log("[orchestrator] Using SupabaseSessionStore");
    store = new SupabaseSessionStore(supabaseUrl, supabaseKey);
  } else {
    console.log("[orchestrator] Using InMemorySessionStore (no SUPABASE_URL set)");
    store = new InMemorySessionStore();
  }

  // --- Pairing manager ---
  const pairingManager = new PairingManager();

  // --- Push notifier ---
  const pushApiUrl = process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
  let phoneConnectedFn: (() => boolean) | undefined;

  // We'll set this after the server starts (need phoneConnections reference)
  const pushNotifier = new PushNotifier(
    store,
    {
      pushApiUrl,
      isPhoneConnected: () => phoneConnectedFn?.() ?? false,
    },
    new PushDeduplicator(),
  );

  // --- Start server ---
  const handle = await startServer(PORT, {
    store,
    pushNotifier,
    pairingManager,
  });

  // Now wire the phone-connected check to the actual phone connections
  phoneConnectedFn = () => handle.phoneConnections.count() > 0;

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
