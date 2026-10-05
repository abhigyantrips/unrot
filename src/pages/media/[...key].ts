import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveMedia } from '../../lib/media';
export const GET: APIRoute = ({ request, params }) => serveMedia(request, env.DB, env.MEDIA, params.key ?? '');
export const HEAD = GET;
