import { Instagram,extractDiscoveries,parseCollection } from '../local/instagram';
const browser = new Instagram();
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: pnpm exec tsx scripts/diagnose-instagram.ts <collection-url> <collection-id>');
try {
  const page = await browser.open();
  const pending: Promise<void>[] = [];
  page.on('response',response => {
    const parsed = new URL(response.url());
    if (parsed.hostname !== 'www.instagram.com' || !/graphql|api\/v1/.test(parsed.pathname)) return;
    pending.push((async () => {
      const request = response.request();
      const body = request.postData() ?? '';
      const variables = new URLSearchParams(body).get('variables') ?? parsed.searchParams.get('variables');
      const meta = { path: parsed.pathname,status: response.status(),type: response.headers()['content-type'],selectedCollection: `${response.url()} ${body}`.includes(process.argv[3]!),variableKeys: variables ? Object.keys(JSON.parse(variables)) : [] };
      try {
        const payload = await response.json();
        let pagination = 'none'; try { const page = parseCollection(payload); pagination = `${page.more ? 'more' : 'end'} (${page.items.length} items)`; } catch {}
        console.log({ ...meta,keys: Object.keys(payload),discoveries: extractDiscoveries(payload).map(p => ({ id: p.id,types: p.media.map(m => m.type),available: p.media.map(m => !!m.url) })),pagination });
      } catch { console.log(meta); }
    })());
  });
  await page.goto(process.argv[2],{ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000); await Promise.all(pending);
  const embedded = [];
  for (const json of await page.locator('script[type="application/json"]').allTextContents()) {
    try { embedded.push(...extractDiscoveries(JSON.parse(json))); } catch {}
  }
  console.log({ embedded: embedded.map(p => ({ id: p.id,types: p.media.map(m => m.type),available: p.media.map(m => !!m.url) })) });
  console.log({ location: page.url(),loginRequired: !!await page.locator('input[name="username"]').count() });
} finally { await browser.close(); }
