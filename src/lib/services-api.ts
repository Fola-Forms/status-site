/**
 * Client-side fetch + polling for the per-service health envelope.
 *
 * Two endpoints split by cost:
 *   • GET /api/public/v1/services?days=90 — full envelope. ~90 days
 *     × N services of JSON. Called rarely: on cold load, and again
 *     once the localStorage cache exceeds {@link FULL_TTL_MS}.
 *   • GET /api/public/v1/services/today — current-state + today's
 *     rollup only. Called every {@link DEFAULT_INTERVAL_MS}; small,
 *     cacheable upstream, fine to hit aggressively.
 *
 * The browser session keeps the full envelope in memory + persists
 * to localStorage so a tab reload re-renders instantly while the
 * "today" poll catches the snapshot up.
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
  category: string;
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

export interface ServicesTodayService {
  id: string;
  currentStatus: 'OK' | 'DEGRADED' | 'DOWN';
  currentMessage: string | null;
  currentLatencyMs: number | null;
  today: ServiceDayPoint;
}

export interface ServicesTodayEnvelope {
  day: string;
  services: ServicesTodayService[];
}

export interface ServicesPollMeta {
  lastSuccessAt: Date | null;
  hasSettled: boolean;
  isOffline: boolean;
  /** True iff the most recent render used the persisted cache as
   *  its starting point (not a fresh full fetch). Lets the UI
   *  optionally show a "stale" hint while the today-poll catches up. */
  fromCache: boolean;
}

export interface ServicesPollOptions {
  onUpdate: (env: ServicesEnvelope, meta: ServicesPollMeta) => void;
  onError: (err: Error, meta: ServicesPollMeta) => void;
  fullEndpoint?: string;
  todayEndpoint?: string;
  /** How often to poll {@code /today}. Defaults to 60 s. */
  intervalMs?: number;
}

const DEFAULT_FULL_ENDPOINT =
  'https://api.folaform.com/api/public/v1/services?days=90';
const DEFAULT_TODAY_ENDPOINT =
  'https://api.folaform.com/api/public/v1/services/today';
const DEFAULT_INTERVAL_MS = 60_000;

const LS_KEY = 'fola.status.services.v1';
/** Local-storage cache freshness window. Past this, the next boot
 *  fetches the full envelope again so newly-added services + day
 *  rollups land. Six hours keeps the wire traffic low even for
 *  users with the page pinned in a tab. */
const FULL_TTL_MS = 6 * 60 * 60 * 1000;

// ───── In-memory cache shared between callers ─────

let memoryEnvelope: ServicesEnvelope | null = null;
let memoryLastSuccessAt: Date | null = null;

export function getCachedServices() {
  return {
    envelope: memoryEnvelope,
    lastSuccessAt: memoryLastSuccessAt,
  };
}

// ───── localStorage cache helpers ─────

interface PersistedCache {
  envelope: ServicesEnvelope;
  cachedAt: number;
}

function readPersisted(): PersistedCache | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCache;
    if (!parsed || !parsed.envelope || typeof parsed.cachedAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersisted(envelope: ServicesEnvelope): void {
  try {
    const payload: PersistedCache = { envelope, cachedAt: Date.now() };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — silent */
  }
}

function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < FULL_TTL_MS;
}

// ───── Merge "today" poll into an existing envelope ─────

/**
 * Apply a today-poll snapshot onto the cached envelope. Updates
 * the per-service `currentStatus` / `currentMessage` / `currentLatencyMs`
 * fields + replaces the first (today's) day-point. Returns a fresh
 * envelope reference so SSR / signal-based consumers see the change.
 */
export function mergeToday(
  envelope: ServicesEnvelope,
  today: ServicesTodayEnvelope,
): ServicesEnvelope {
  const byId = new Map<string, ServicesTodayService>();
  for (const t of today.services) byId.set(t.id, t);

  return {
    windowDays: envelope.windowDays,
    groups: envelope.groups.map((g) => ({
      category: g.category,
      label: g.label,
      services: g.services.map((s) => {
        const t = byId.get(s.id);
        if (!t) return s;
        const days = s.days.slice();
        if (days.length > 0 && days[0]!.day === t.today.day) {
          days[0] = t.today;
        } else {
          // Today rolled over since last full fetch — prepend and
          // drop the tail so the window length stays stable.
          days.unshift(t.today);
          days.pop();
        }
        return {
          ...s,
          currentStatus: t.currentStatus,
          currentMessage: t.currentMessage,
          currentLatencyMs: t.currentLatencyMs,
          days,
        };
      }),
    })),
  };
}

// ───── Polling driver ─────

export function startServicesPolling(opts: ServicesPollOptions): () => void {
  const fullEndpoint = opts.fullEndpoint ?? DEFAULT_FULL_ENDPOINT;
  const todayEndpoint = opts.todayEndpoint ?? DEFAULT_TODAY_ENDPOINT;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  let timer: number | null = null;
  let stopped = false;
  let hasSettled = false;
  let isOffline = false;
  let fromCache = false;

  function meta(): ServicesPollMeta {
    return {
      lastSuccessAt: memoryLastSuccessAt,
      hasSettled,
      isOffline,
      fromCache,
    };
  }

  async function fetchFullEnvelope(): Promise<void> {
    try {
      const res = await fetch(fullEndpoint, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const env = (await res.json()) as ServicesEnvelope;
      memoryEnvelope = env;
      memoryLastSuccessAt = new Date();
      writePersisted(env);
      isOffline = false;
      hasSettled = true;
      fromCache = false;
      if (!stopped) opts.onUpdate(env, meta());
    } catch (err) {
      isOffline = true;
      hasSettled = true;
      const error = err instanceof Error ? err : new Error(String(err));
      if (!stopped) opts.onError(error, meta());
    }
  }

  async function fetchTodayAndMerge(): Promise<void> {
    if (!memoryEnvelope) {
      // Today-only poll is useless without a base envelope; fall
      // back to the full fetch.
      await fetchFullEnvelope();
      return;
    }
    try {
      const res = await fetch(todayEndpoint, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const todayEnv = (await res.json()) as ServicesTodayEnvelope;
      memoryEnvelope = mergeToday(memoryEnvelope, todayEnv);
      memoryLastSuccessAt = new Date();
      writePersisted(memoryEnvelope);
      isOffline = false;
      hasSettled = true;
      fromCache = false;
      if (!stopped) opts.onUpdate(memoryEnvelope, meta());
    } catch (err) {
      isOffline = true;
      hasSettled = true;
      const error = err instanceof Error ? err : new Error(String(err));
      if (!stopped) opts.onError(error, meta());
    }
  }

  function tick(): void {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    void fetchTodayAndMerge();
  }

  function onVisibilityChange(): void {
    if (typeof document === 'undefined' || document.hidden || stopped) return;
    void fetchTodayAndMerge();
  }

  // Boot sequence: try to render from cache first, then hydrate.
  (async () => {
    if (typeof window !== 'undefined') {
      const cached = readPersisted();
      if (cached) {
        memoryEnvelope = cached.envelope;
        fromCache = true;
        hasSettled = true;
        if (!stopped) opts.onUpdate(cached.envelope, meta());
        if (isFresh(cached.cachedAt)) {
          // Cache still warm — just catch today up.
          await fetchTodayAndMerge();
          return;
        }
        // Cache expired — refresh in the background so the page
        // already rendered keeps showing while we hit the slow
        // endpoint.
      }
    }
    await fetchFullEnvelope();
  })();

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
