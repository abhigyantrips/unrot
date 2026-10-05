/// <reference types="astro/client" />
// Import binding types without merging Worker DOM declarations into browser DOM types.
type D1Database = import('@cloudflare/workers-types').D1Database;
type D1PreparedStatement = import('@cloudflare/workers-types').D1PreparedStatement;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;
type Fetcher = import('@cloudflare/workers-types').Fetcher;
declare module 'cloudflare:workers' { export const env: Env; }
