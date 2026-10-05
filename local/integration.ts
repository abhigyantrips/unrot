import type { AstroIntegration } from 'astro';
import { bridge } from './bridge';
export default function curator(): AstroIntegration {
  return {
    name: 'unrot-local-curator',
    hooks: {
      'astro:config:setup': ({ command, injectRoute, updateConfig }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/curate', entrypoint: new URL('./Curate.astro',import.meta.url).pathname });
        let shutdown: (() => Promise<void>) | undefined;
        updateConfig({ vite: { plugins: [{
          name: 'unrot-node-bridge',
          configureServer: async server => {
            // This module and its Node dependencies are never imported into Worker code.
            const local = await bridge();
            let closing: Promise<void> | undefined;
            shutdown = () => closing ??= local.close();
            server.middlewares.use(local.middleware);
            server.httpServer?.once('close',() => { void shutdown?.(); });
          },
          closeBundle: async () => { await shutdown?.(); },
        }] } });
      },
    },
  };
}
