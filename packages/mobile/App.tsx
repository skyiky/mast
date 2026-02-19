/**
 * Mast — Phase 2 entry point.
 *
 * Renders the chat screen connected to the orchestrator.
 * In Phase 2, the server config is hardcoded. A real settings
 * screen will come in Phase 3.
 */

import { StatusBar } from "expo-status-bar";
import ChatScreen from "./src/screens/ChatScreen";
import type { ServerConfig } from "./src/types";

// Phase 2: hardcoded config.
// The user's dev machine runs the orchestrator on the local network.
// Update this IP to match your machine's LAN address.
const SERVER_CONFIG: ServerConfig = {
  httpUrl: "http://localhost:3000",
  wsUrl: "ws://localhost:3000",
  apiToken: "mast-api-token-phase1",
};

export default function App() {
  return (
    <>
      <ChatScreen config={SERVER_CONFIG} />
      <StatusBar style="auto" />
    </>
  );
}
