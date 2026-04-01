// /home/r_/projects/jeremysayers/astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://jeremysayers.com',
  adapter: cloudflare({
    inspectorPort: false,
    platformProxy: {
      enabled: true
    }
  }),
  output: 'server'
});
