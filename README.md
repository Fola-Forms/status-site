# status.folaform.com

Public incident status page for the Fola Form platform.

## How it works

The site is a small static Astro build (HTML + a sprinkle of
client-side TS). The shell — header, footer, theme toggle, page
chrome — is rendered at build time and deployed to Netlify.

Live incident data is fetched client-side at runtime from
the platform's public API:

```
GET https://api.folaform.com/api/public/v1/incidents
```

That endpoint returns a `StatusEnvelope` (`enabled`, `open[]`,
`recent[]`) — see `src/lib/api.ts` for the typed shape and the
polling + caching strategy.

### Polling

`src/lib/api.ts` exports `startStatusPolling(onUpdate, onError)`.
Pages call it on mount and stop it on unload. Strategy:

- Initial fetch immediately on page load.
- 30-second revalidation interval while the page is visible.
- The Page Visibility API pauses the interval when the tab is
  hidden — we don't burn the user's data, and we don't burn
  ours.
- The most recent successful response is cached in-memory; if a
  fetch fails the cached payload keeps rendering and a small
  "couldn't reach the backend" chip surfaces at the top.

### Fallback when the API is down

The page always renders:

- Site header + footer + "Status" branding.
- The big status banner — if we have a cached payload, it shows
  the last-known state; if we don't, it shows a neutral "Last
  checked: never" state.
- A small offline chip ("Couldn't reach status API · retrying")
  near the timestamp.

Polling continues every 30s in the background; the moment the
API comes back, the banner flips to live state automatically.

## Pages

| Route                 | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `/`                   | Overall status, currently active incidents,    |
|                       | 30-day history grouped by day.                 |
| `/incidents/[id]`     | Single incident with full update timeline.     |
| `/history`            | 30-day per-day uptime grid.                    |

The `[id]` page does a client-side fetch of the envelope and
finds the incident by id — there are no per-incident SSR pages,
because incident IDs change too frequently to bake into the
build.

## Deploy

Auto-deploys from `main` on the
[`Fola-Forms/status-site`](https://github.com/Fola-Forms/) GitHub
repo via Netlify. Build command: `npm run build`. Publish dir:
`dist`. See `netlify.toml`.

This site is **not** the source of truth for incidents — the
backend's `/api/public/v1/incidents` endpoint is. The page is
just a render layer.

## Who runs it

The backend incident model is owned by the on-call engineer. The
admin UI at `folaform.com/workspace/admin/incidents` (gated by
`feature_admin_incidents`) is where incidents and updates are
posted. Once an incident is OPEN there, it appears here within
~30 seconds.
