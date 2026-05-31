/**
 * Tiny relative-time + absolute-time helpers. Kept dependency-free
 * on purpose — there are exactly two callers (the status banner's
 * "last checked" stamp and incident timestamps) and both want the
 * same warm voice.
 */

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year',   60 * 60 * 24 * 365],
  ['month',  60 * 60 * 24 * 30],
  ['week',   60 * 60 * 24 * 7],
  ['day',    60 * 60 * 24],
  ['hour',   60 * 60],
  ['minute', 60],
  ['second', 1],
];

let rtf: Intl.RelativeTimeFormat | null = null;
function getRtf(): Intl.RelativeTimeFormat {
  if (rtf) return rtf;
  rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return rtf;
}

/**
 * "5 minutes ago", "just now", "yesterday", etc. Accepts a Date,
 * ISO string, or null (returns "—" so callers can render the
 * stamp area unconditionally).
 */
export function relativeTime(input: Date | string | null): string {
  if (input === null) return '—';
  const date = input instanceof Date ? input : new Date(input);
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 10) return 'just now';

  for (const [unit, secondsPerUnit] of UNITS) {
    if (abs >= secondsPerUnit || unit === 'second') {
      const value = Math.round(diffSec / secondsPerUnit);
      return getRtf().format(value, unit);
    }
  }
  return getRtf().format(diffSec, 'second');
}

/** "Nov 12, 2025 · 9:42 AM" — used in incident detail header. */
export function absoluteTime(input: Date | string | null): string {
  if (input === null) return '—';
  const date = input instanceof Date ? input : new Date(input);
  const dateStr = date.toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'short',
    day:   'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
  });
  return `${dateStr} · ${timeStr}`;
}

/** "Sunday, November 12" — used as the history per-day heading. */
export function longDay(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
  });
}

/** "November 2025" — month bucket heading on /history. */
export function monthLabel(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year:  'numeric',
  });
}

/** YYYY-MM-DD in local time. Used as a bucket key. */
export function dayKey(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
