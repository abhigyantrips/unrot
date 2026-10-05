import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listPosts, QueryError } from '../../lib/public';
export const GET: APIRoute = async ({ url }) => {
  try { return Response.json(await listPosts(env.DB, url.searchParams), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof QueryError ? error.message : 'Archive unavailable. Please retry.' }, { status: error instanceof QueryError ? 400 : 503 }); }
};
