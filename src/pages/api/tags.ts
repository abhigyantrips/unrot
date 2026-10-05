import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listTags } from '../../lib/public';
export const GET: APIRoute = async () => {
  try { return Response.json({ tags: await listTags(env.DB) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Tags unavailable. Please retry.' }, { status: 503 }); }
};
