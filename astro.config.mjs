import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://mygreektax.eu',
  trailingSlash: 'always',
  integrations: [sitemap()]
});
