import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPost } from '../../../lib/public';
import { markdown } from '../../../lib/markdown';
export const GET: APIRoute = async ({ params }) => {
  try {
    const post = await getPost(env.DB, params.id!);
    return post ? Response.json({ post, notesHtml: markdown(post.notes) }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'This post is unavailable.' }, { status: 404 });
  } catch { return Response.json({ error: 'Archive unavailable. Please retry.' }, { status: 503 }); }
};
