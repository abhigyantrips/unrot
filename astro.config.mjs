// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';
import curator from './local/integration';

// https://astro.build/config
export default defineConfig({
  site: 'https://unrot.abhi.now',
  output: 'server',
  session: false,
  adapter: cloudflare({
    imageService: 'passthrough',
    configPath: process.env.NODE_ENV === 'production' ? 'wrangler.remote.jsonc' : 'wrangler.local.jsonc',
    remoteBindings: false,
  }),
  integrations: [curator()],
  server: { host: '127.0.0.1' },

  vite: {
    plugins: [tailwindcss()]
  }
});
