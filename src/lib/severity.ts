/**
 * Helpers to translate severity + open incidents into a visual
 * banner state. The four banner states are:
 *
 *   operational  — no open incidents, all good
 *   maintenance  — only OPEN incidents are MAINTENANCE
 *   degraded     — there's an open MINOR incident, or MAJOR but
 *                  the active status is MONITORING (impact
 *                  reduced, not eliminated)
 *   outage       — there's an open MAJOR or CRITICAL incident in
 *                  OPEN status
 *
 * The "MAINTENANCE outranks degraded" rule is intentional but only
 * applies when there are no real incidents alongside it. A planned
 * maintenance window + a coincident outage should still read as
 * outage to the user.
 */

import type {
  IncidentStatus,
  IncidentView,
  Severity,
} from './api';

export type BannerState =
  | 'operational'
  | 'maintenance'
  | 'degraded'
  | 'outage';

/** Compute the overall banner state from the list of open incidents. */
export function bannerStateFor(
  openIncidents: IncidentView[],
): BannerState {
  if (openIncidents.length === 0) return 'operational';

  // If at least one real (non-maintenance) incident is open and
  // not just monitoring, escalate based on the worst severity.
  const realIncidents = openIncidents.filter(
    (i) => i.severity !== 'MAINTENANCE',
  );

  if (realIncidents.length === 0) {
    // Only maintenance windows open.
    return 'maintenance';
  }

  const hasOutage = realIncidents.some(
    (i) =>
      (i.severity === 'MAJOR' || i.severity === 'CRITICAL') &&
      i.status === 'OPEN',
  );
  if (hasOutage) return 'outage';

  // Escalate the banner ONLY when a MAJOR / CRITICAL incident is
  // open — MINOR-only noise (e.g. a single carrier polling delay)
  // shouldn't paint the whole page amber and alarm every visitor.
  // MINOR incidents still appear in the Active section below the
  // banner so users who scroll see what's going on.
  const hasMajorOrCritical = realIncidents.some(
    (i) => i.severity === 'MAJOR' || i.severity === 'CRITICAL',
  );
  if (!hasMajorOrCritical) return 'operational';

  // MAJOR/CRITICAL in MONITORING — partially recovered, still
  // worth flagging as degraded so visitors know not to file a bug
  // report yet.
  return 'degraded';
}

export function bannerCopy(state: BannerState): {
  title: string;
  sub: string;
} {
  switch (state) {
    case 'operational':
      return {
        title: 'All systems operational',
        sub: 'Fola is running normally across all surfaces.',
      };
    case 'maintenance':
      return {
        title: 'Scheduled maintenance in progress',
        sub: 'A planned maintenance window is currently underway. Some features may be briefly unavailable.',
      };
    case 'degraded':
      return {
        title: 'Service degraded',
        sub: 'Some users may experience slow responses or reduced functionality. Engineering is investigating.',
      };
    case 'outage':
      return {
        title: 'Active outage',
        sub: 'We are aware of the issue and engineering is working on it right now. Updates will post below.',
      };
  }
}

export function severityLabel(sev: Severity): string {
  switch (sev) {
    case 'MINOR':       return 'Minor';
    case 'MAJOR':       return 'Major';
    case 'CRITICAL':    return 'Critical';
    case 'MAINTENANCE': return 'Maintenance';
  }
}

export function statusLabel(status: IncidentStatus): string {
  switch (status) {
    case 'OPEN':       return 'Open';
    case 'MONITORING': return 'Monitoring';
    case 'RESOLVED':   return 'Resolved';
  }
}

/**
 * Reduce a set of incidents that overlap one day to a single
 * banner state for that day. Used by the history grid.
 *
 * <p>MINOR incidents only color the day amber if they were
 * actually disruptive — a 30-second polling blip used to paint
 * the whole day yellow, which is misleading both visually and
 * trust-wise. The threshold treats MINOR < 5 min (or any MINOR
 * still without a resolved-at after we hit the cutoff) as a
 * transient and leaves the day green. MAJOR / CRITICAL /
 * MAINTENANCE are NOT thresholded — those are real events worth
 * surfacing for any duration.
 */
const MINOR_DURATION_THRESHOLD_MS = 5 * 60 * 1000;

export function dayState(
  incidentsOnDay: IncidentView[],
): BannerState {
  if (incidentsOnDay.length === 0) return 'operational';
  const worst = incidentsOnDay.reduce<BannerState>((acc, inc) => {
    const s = singleIncidentBannerState(inc);
    return worstOf(acc, s);
  }, 'operational');
  return worst;
}

function incidentDurationMs(inc: IncidentView): number {
  const start = Date.parse(inc.startedAt);
  if (Number.isNaN(start)) return 0;
  const end = inc.resolvedAt ? Date.parse(inc.resolvedAt) : Date.now();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function singleIncidentBannerState(
  incident: IncidentView,
): BannerState {
  if (incident.severity === 'MAINTENANCE') return 'maintenance';
  if (incident.severity === 'MAJOR' || incident.severity === 'CRITICAL') {
    return 'outage';
  }
  // MINOR — duration gate. Short blips don't color the day.
  if (incidentDurationMs(incident) < MINOR_DURATION_THRESHOLD_MS) {
    return 'operational';
  }
  return 'degraded';
}

const RANK: Record<BannerState, number> = {
  operational: 0,
  maintenance: 1,
  degraded:    2,
  outage:      3,
};

function worstOf(a: BannerState, b: BannerState): BannerState {
  return RANK[a] >= RANK[b] ? a : b;
}
