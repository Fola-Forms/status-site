/**
 * Client-side fetch + polling for the public status envelope.
 *
 * The status page is a STATIC build, but the underlying incident
 * data lives in the backend at api.folaform.com. This module is
 * the only thing the page calls — it fetches once on mount,
 * revalidates every 30 seconds while the page is visible, and
 * exposes a graceful "stale + offline" fallback so the page never
 * goes blank when the API is down.
 *
 * Usage from a page:
 *
 *   import { startStatusPolling } from '../lib/api';
 *
 *   const stop = startStatusPolling({
 *     onUpdate(envelope, meta) { ... render ... },
 *     onError(error, meta)     { ... show offline chip ... },
 *   });
 *
 *   window.addEventListener('beforeunload', stop);
 */

export type Severity = 'MINOR' | 'MAJOR' | 'CRITICAL' | 'MAINTENANCE';
export type IncidentStatus = 'OPEN' | 'MONITORING' | 'RESOLVED';

export interface UpdateView {
  id: string;
  body: string;
  postedAt: string;
}

export interface IncidentView {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  body: string;
  startedAt: string;
  resolvedAt: string | null;
  updates: UpdateView[];
}

export interface StatusEnvelope {
  enabled: boolean;
  open: IncidentView[];
  recent: IncidentView[];
}

export interface PollMeta {
  /** When this snapshot was last successfully fetched. */
  lastSuccessAt: Date | null;
  /** True once the very first fetch (success OR fail) has settled. */
  hasSettled: boolean;
  /** Whether the most recent fetch failed. */
  isOffline: boolean;
}

export interface PollOptions {
  onUpdate: (envelope: StatusEnvelope, meta: PollMeta) => void;
  onError: (error: Error, meta: PollMeta) => void;
  /** Override the endpoint — handy for local dev. */
  endpoint?: string;
  /** Override the poll interval. Defaults to 30s. */
  intervalMs?: number;
}

const DEFAULT_ENDPOINT =
  'https://api.folaform.com/api/public/v1/incidents';
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * In-memory cache shared across all callers on a page. Lets the
 * single-incident page reuse the homepage's fetch when the user
 * clicks through and back within a single session.
 */
let memoryCache: {
  envelope: StatusEnvelope | null;
  lastSuccessAt: Date | null;
} = {
  envelope: null,
  lastSuccessAt: null,
};

/** Synchronous accessor for the most recent successful envelope. */
export function getCachedEnvelope(): {
  envelope: StatusEnvelope | null;
  lastSuccessAt: Date | null;
} {
  return { ...memoryCache };
}

/**
 * Begin polling. Returns a `stop()` function that tears down the
 * interval + visibility listener. Idempotent — calling stop()
 * multiple times is safe.
 */
export function startStatusPolling(opts: PollOptions): () => void {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  let timer: number | null = null;
  let stopped = false;
  let hasSettled = false;
  let isOffline = false;

  function buildMeta(): PollMeta {
    return {
      lastSuccessAt: memoryCache.lastSuccessAt,
      hasSettled,
      isOffline,
    };
  }

  async function fetchOnce(): Promise<void> {
    if (stopped) return;
    try {
      const res = await fetch(endpoint, {
        // Don't let the browser hold a cached response for too long
        // — the whole point of polling is to see new incidents.
        cache: 'no-store',
        // The status endpoint is public; no credentials.
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const json = (await res.json()) as StatusEnvelope;
      memoryCache = { envelope: json, lastSuccessAt: new Date() };
      isOffline = false;
      hasSettled = true;
      if (!stopped) opts.onUpdate(json, buildMeta());
    } catch (err) {
      isOffline = true;
      hasSettled = true;
      const error =
        err instanceof Error ? err : new Error(String(err));
      if (!stopped) opts.onError(error, buildMeta());
    }
  }

  function tick(): void {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.hidden) {
      // Don't burn the user's bandwidth (or ours) while the tab is
      // hidden. The visibilitychange handler below will fire a
      // fresh fetch the moment the tab comes back.
      return;
    }
    void fetchOnce();
  }

  function onVisibilityChange(): void {
    if (
      typeof document === 'undefined' ||
      document.hidden ||
      stopped
    ) {
      return;
    }
    // Returning to a tab that's been hidden for a while → fetch
    // immediately so the user sees current state, then keep
    // ticking at the normal interval.
    void fetchOnce();
  }

  // Initial fetch fires immediately.
  void fetchOnce();
  timer = window.setInterval(tick, intervalMs);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return function stop(): void {
    stopped = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange,
      );
    }
  };
}
