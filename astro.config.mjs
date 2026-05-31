// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * status.folaform.com — public incident status page.
 *
 * The site shell is static (Astro `output: 'static'` is the default),
 * but the incident data is fetched client-side from
 *   https://api.folaform.com/api/public/v1/incidents
 * so the page reflects current state without redeploying. See
 * `src/lib/api.ts` for the polling + caching strategy.
 *
 * Deploys to Netlify at the status.folaform.com subdomain. The
 * @astrojs/sitemap plugin emits /sitemap-index.xml at build time.
 */
export default defineConfig({
  site: 'https://status.folaform.com',
  trailingSlash: 'never',
  integrations: [
    sitemap({
      changefreq: 'daily',
    }),
  ],
  build: {
    format: 'file',
  },
});
