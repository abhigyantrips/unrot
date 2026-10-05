import { getPlatformProxy } from 'wrangler';
import type { Bindings } from '../src/lib/types';
const platform = await getPlatformProxy<Bindings>({ configPath: 'wrangler.publish.jsonc',remoteBindings: true,persist: false });
try {
  const posts = await platform.env.DB.prepare('SELECT COUNT(*) AS count FROM live_posts WHERE visible=1').first();
  const media = await platform.env.MEDIA.list({ limit: 1 });
  console.log({ published: posts,mediaBindingAvailable: Array.isArray(media.objects) });
} finally { await platform.dispose(); }
