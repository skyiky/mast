/**
 * SSE (Server-Sent Events) client for subscribing to OpenCode's event stream.
 *
 * Connects to GET /event on OpenCode, parses the SSE stream,
 * and fires a callback for each event. Handles reconnection.
 */

export interface SseEvent {
  type: string;
  data: unknown;
}

export class SseSubscriber {
  private controller: AbortController | null = null;
  private running = false;
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Start subscribing to the SSE stream.
   * Calls onEvent for each parsed event.
   * Resolves when the stream ends or stop() is called.
   */
  async subscribe(onEvent: (event: SseEvent) => void): Promise<void> {
    this.running = true;
    this.controller = new AbortController();

    try {
      const res = await fetch(`${this.baseUrl}/event`, {
        signal: this.controller.signal,
        headers: { Accept: "text/event-stream" },
      });

      if (!res.ok) {
        console.error(`[sse] failed to connect: ${res.status} ${res.statusText}`);
        return;
      }

      if (!res.body) {
        console.error("[sse] no response body");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE events (terminated by double newline)
        while (true) {
          const eventEnd = buffer.indexOf("\n\n");
          if (eventEnd === -1) break;

          const eventBlock = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          // Extract data lines from the event block
          for (const line of eventBlock.split("\n")) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6);
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.type) {
                  // Real OpenCode sends { type, properties: { ... } }
                  // Normalize to SseEvent { type, data }
                  const { type, properties, data, ...rest } = parsed;
                  onEvent({
                    type,
                    data: data ?? properties ?? rest,
                  });
                }
              } catch {
                console.error("[sse] failed to parse event data:", jsonStr);
              }
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Expected when stop() is called
        return;
      }
      console.error("[sse] stream error:", err);
    }
  }

  stop(): void {
    this.running = false;
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }
}
