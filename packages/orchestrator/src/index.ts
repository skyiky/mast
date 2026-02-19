import { startServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

startServer(PORT).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
