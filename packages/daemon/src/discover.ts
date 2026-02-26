/**
 * discover.ts — Port-scan discovery for running OpenCode instances.
 *
 * Scans a range of localhost ports for OpenCode's /global/health endpoint.
 * Used by `mast attach` to find already-running instances.
 */

export interface DiscoveredInstance {
  url: string;
  port: number;
}

/**
 * Scan a range of localhost ports for running OpenCode instances.
 * Returns an array of discovered instances sorted by port.
 *
 * @param portRange - [start, end] inclusive port range (default [4096, 4110])
 * @param timeoutMs - Per-port timeout in ms (default 500)
 */
export async function discoverOpenCode(
  portRange: [number, number] = [4096, 4110],
  timeoutMs = 500,
): Promise<DiscoveredInstance[]> {
  const [start, end] = portRange;
  const probes: Promise<DiscoveredInstance | null>[] = [];

  for (let port = start; port <= end; port++) {
    probes.push(probePort(port, timeoutMs));
  }

  const results = await Promise.all(probes);
  return results.filter((r): r is DiscoveredInstance => r !== null);
}

async function probePort(
  port: number,
  timeoutMs: number,
): Promise<DiscoveredInstance | null> {
  try {
    const res = await fetch(`http://localhost:${port}/global/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      return { url: `http://localhost:${port}`, port };
    }
  } catch {
    // Not listening, timeout, or connection refused — skip
  }
  return null;
}
