/**
 * Client-side fetch + polling for the per-service health envelope.
 *
 * The status page polls TWO endpoints:
 *   • /api/public/v1/incidents — open + recent incidents
 *   • /api/public/v1/services  — per-service 90-day uptime bars
 *
 * Kept in separate files so the homepage's incident rendering and
 * the service-breakdown rendering can be reasoned about independently.
 * Both stay simple — no shared base class, no state machine, just
 * a small "fetch on mount, poll while visible" loop per side.
 */

export type ServiceStatus = 'OK' | 'DEGRADED' | 'DOWN' | null;

export interface ServiceDayPoint {
  /** ISO date in UTC (YYYY-MM-DD). */
  day: string;
  /** Worst observed status that day; null if there are no samples. */
  status: ServiceStatus;
  /** 0–100 percentage; null if no samples. */
  uptimePct: number | null;
}

export interface ServiceRow {
  id: string;
  label: string;
  description: string;
  /** "INFRA" | "PRODUCT" | "VENDOR" */
  category: string;
  /** Most recent sample's status; falls back to "OK" when no
   *  sample yet exists. */
  currentStatus: 'OK' | 'DEGRADED' | 'DOWN';
  currentMessage: string | null;
  currentLatencyMs: number | null;
  days: ServiceDayPoint[];
}

export interface ServiceGroup {
  category: string;
  label: string;
  services: ServiceRow[];
}

export interface ServicesEnvelope {
  windowDays: number;
  groups: ServiceGroup[];
}

export interface ServicesPollMeta {
  lastSuccessAt: Date | null;
  hasSettled: boolean;
  isOffline: boolean;
}

export interface ServicesPollOptions {
  onUpdate: (env: ServicesEnvelope, meta: ServicesPollMeta) => void;
  onError: (err: Error, meta: ServicesPollMeta) => void;
  endpoint?: string;
  intervalMs?: number;
}

const DEFAULT_ENDPOINT =
  'https://api.folaform.com/api/public/v1/services?days=90';
const DEFAULT_INTERVAL_MS = 60_000; // services change slowly; 60s is plenty

let memoryCache: {
  envelope: ServicesEnvelope | null;
  lastSuccessAt: Date | null;
} = { envelope: null, lastSuccessAt: null };

export function getCachedServices() {
  return { ...memoryCache };
}

export function startServicesPolling(opts: ServicesPollOptions): () => void {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  let timer: number | null = null;
  let stopped = false;
  let hasSettled = false;
  let isOffline = false;

  function buildMeta(): ServicesPollMeta {
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
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as ServicesEnvelope;
      memoryCache = { envelope: json, lastSuccessAt: new Date() };
      isOffline = false;
      hasSettled = true;
      if (!stopped) opts.onUpdate(json, buildMeta());
    } catch (err) {
      isOffline = true;
      hasSettled = true;
      const error = err instanceof Error ? err : new Error(String(err));
      if (!stopped) opts.onError(error, buildMeta());
    }
  }

  function tick(): void {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    void fetchOnce();
  }

  function onVisibilityChange(): void {
    if (typeof document === 'undefined' || document.hidden || stopped) return;
    void fetchOnce();
  }

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
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

// ─── Subscribe helpers ────────────────────────────────────────────

const SUBSCRIBE_BASE =
  'https://api.folaform.com/api/public/v1/status-subscriptions';

export type SubscribeStatus =
  | 'email_sent'
  | 'already_subscribed'
  | 'no_account'
  | 'invalid'
  | 'network';

export async function subscribeEmail(email: string): Promise<SubscribeStatus> {
  try {
    const res = await fetch(SUBSCRIBE_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    if (!res.ok && res.status !== 202) {
      if (res.status === 400) return 'invalid';
      return 'network';
    }
    const json = await res.json();
    const s = String(json?.status ?? 'network');
    if (s === 'email_sent' || s === 'already_subscribed'
        || s === 'no_account' || s === 'invalid') return s;
    return 'network';
  } catch {
    return 'network';
  }
}

export type ConfirmStatus =
  | 'confirmed' | 'already_active' | 'invalid' | 'network';

export async function confirmSubscription(token: string): Promise<ConfirmStatus> {
  try {
    const res = await fetch(SUBSCRIBE_BASE + '/confirm?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    const s = String(json?.status ?? '');
    if (s === 'confirmed' || s === 'already_active' || s === 'invalid') return s;
    return 'network';
  } catch {
    return 'network';
  }
}

export type UnsubscribeStatus =
  | 'unsubscribed' | 'already_unsubscribed' | 'invalid' | 'network';

export async function unsubscribeSubscription(token: string): Promise<UnsubscribeStatus> {
  try {
    const res = await fetch(SUBSCRIBE_BASE + '/unsubscribe?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    const s = String(json?.status ?? '');
    if (s === 'unsubscribed' || s === 'already_unsubscribed' || s === 'invalid') return s;
    return 'network';
  } catch {
    return 'network';
  }
}
