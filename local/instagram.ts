import { chromium, type BrowserContext, type Page, type Response as BrowserResponse } from 'playwright';
import type { Discovery, SourceMedia } from '../src/lib/types';
import { ROOT, type LocalConfig } from './config';
import { lock } from './lock';

export class SessionExpired extends Error {
  constructor(message = 'Instagram session expired or challenged. Reconnect to continue.') { super(message); }
}
type Json = Record<string, any>;
export function normalizeMedia(node: Json): Discovery | null {
  const code = node.code ?? node.shortcode;
  const identity = node.pk ?? node.id;
  if (!code || !identity || !/^[\w-]+$/.test(String(identity)) || !/^[\w-]+$/.test(code)) return null;
  const children = node.carousel_media ?? node.edge_sidecar_to_children?.edges?.map((e: Json) => e.node) ?? [node];
  const media: SourceMedia[] = children.map((child: Json) => {
    const video = child.video_versions?.[0]?.url ?? child.video_url;
    const image = child.image_versions2?.candidates?.[0]?.url ?? child.display_url ?? child.display_resources?.at(-1)?.src;
    const isVideo = !!(video || child.is_video || child.media_type === 2);
    return { url: isVideo ? video ?? '' : image ?? '', type: isVideo ? 'video' : 'image', width: child.original_width ?? child.dimensions?.width ?? 0, height: child.original_height ?? child.dimensions?.height ?? 0 };
  });
  const caption = typeof node.caption === 'string' ? node.caption : node.caption?.text ?? node.edge_media_to_caption?.edges?.[0]?.node?.text ?? null;
  const date = node.taken_at ?? node.taken_at_timestamp;
  return { id: String(identity).split('_')[0]!, source_url: `https://www.instagram.com/p/${code}/`, creator: node.user?.username ?? node.owner?.username ?? '', caption, source_date: date ? new Date(Number(date) * 1000).toISOString() : null, media, expected_count: node.carousel_media_count ?? children.length };
}
export function extractDiscoveries(payload: unknown): Discovery[] {
  const found = new Map<string, Discovery>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const node = value as Json;
    const item = normalizeMedia(node);
    if (item) { found.set(item.id, item); return; }
    Object.values(node).forEach(walk);
  };
  walk(payload);
  return [...found.values()];
}
export interface CollectionPage { items: Discovery[]; more: boolean; cursor: string | null }
export function parseCollection(payload: unknown): CollectionPage {
  let pagination: { more: boolean; cursor: string | null } | undefined;
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || pagination) return;
    const node = value as Json;
    if (typeof node.more_available === 'boolean') pagination = { more: node.more_available, cursor: node.next_max_id ?? null };
    else if (typeof node.has_more === 'boolean') pagination = { more: node.has_more, cursor: node.next_max_id ?? node.max_id ?? null };
    else if (node.page_info && typeof node.page_info.has_next_page === 'boolean') pagination = { more: node.page_info.has_next_page, cursor: node.page_info.end_cursor ?? null };
    else Object.entries(node).filter(([key]) => !['comments','edge_media_to_comment','carousel_media','edge_sidecar_to_children'].includes(key)).forEach(([,v]) => walk(v));
  };
  walk(payload);
  if (!pagination) throw new Error('Collection pagination was not recognized. Setup checkpoint failed; no partial sync was accepted.');
  if (pagination.more && !pagination.cursor) throw new Error('Instagram reported more pages without a cursor. Retry or reconnect.');
  return { items: extractDiscoveries(payload), ...pagination };
}
export async function retry<T>(job: () => Promise<T>, attempts = 3, delay = 1500): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await job(); }
    catch (error) {
      if (error instanceof SessionExpired || i >= attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * 2 ** i));
    }
  }
}
export async function scanCollection(first: CollectionPage, next: (cursor: string) => Promise<CollectionPage>, save: (items: Discovery[]) => Promise<void>, pacing = 1500) {
  const cursors = new Set<string>();
  const identities = new Set<string>();
  let page = first;
  for (;;) {
    await save(page.items.filter(item => { if (identities.has(item.id)) return false; identities.add(item.id); return true; }));
    if (!page.more) return identities.size;
    if (!page.cursor || cursors.has(page.cursor)) throw new Error('Collection pagination stalled. Sync is incomplete and can be retried.');
    cursors.add(page.cursor);
    await new Promise(resolve => setTimeout(resolve, pacing));
    page = await retry(() => next(page.cursor!));
  }
}
interface Replay { url: string; method: string; body: string | null; headers: Record<string,string> }
export class Instagram {
  private context?: BrowserContext;
  private page?: Page;
  private release?: () => Promise<void>;
  async open(headless = true) {
    if (this.page && this.context) return this.page;
    this.release = await lock('instagram');
    try { this.context = await chromium.launchPersistentContext(`${ROOT}/instagram-profile`, { headless, viewport: { width: 1280, height: 900 } }); }
    catch (error) { await this.release(); this.release = undefined; throw error; }
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    return this.page;
  }
  async close() { try { await this.context?.close(); } finally { this.context = undefined; this.page = undefined; await this.release?.(); this.release = undefined; } }
  private async authenticated() {
    const page = this.page!;
    if (/accounts\/login|challenge|checkpoint/.test(page.url()) || await page.locator('input[name="username"]').count()) throw new SessionExpired();
  }
  async collection(config: LocalConfig): Promise<{ first: CollectionPage; next: (cursor: string) => Promise<CollectionPage> }> {
    if (!this.page) await this.open();
    const page = this.page!;
    let template: Replay | undefined;
    let first: CollectionPage | undefined;
    let captureError: Error | undefined;
    const pending: Promise<void>[] = [];
    const listener = (response: BrowserResponse) => {
      const request = response.request();
      const relevant = response.url().includes(`/feed/collection/${config.collectionId}`) ||
        (/graphql|api\/v1/.test(response.url()) && `${response.url()} ${request.postData() ?? ''}`.includes(config.collectionId));
      if (!relevant || !/json|javascript/.test(response.headers()['content-type'] ?? '')) return;
      pending.push((async () => {
        try {
          if ([401,403].includes(response.status())) throw new SessionExpired();
          const body = await response.json();
          if (body.message === 'login_required' || body.challenge) throw new SessionExpired();
          const parsed = parseCollection(body);
          if (!first) {
            const headers = await request.allHeaders();
            first = parsed; template = { url: response.url(), method: request.method(), body: request.postData(),headers: Object.fromEntries(Object.entries(headers).filter(([key]) => ['x-ig-app-id','x-ig-www-claim','x-asbd-id','x-requested-with'].includes(key))) };
          }
        } catch (error) { captureError = error as Error; }
      })());
    };
    page.on('response',listener);
    try {
      await page.goto(config.collectionUrl,{ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await this.authenticated();
      for (let i = 0; i < 12 && !first && !captureError; i++) { await page.waitForTimeout(1000); await Promise.all(pending); }
    } finally { page.off('response',listener); await Promise.all(pending); }
    if (!first || !template) throw captureError ?? new Error('No authenticated collection response was captured. Open the selected collection during setup and reconnect.');
    const replay = template;
    return { first, next: async cursor => {
      await this.authenticated();
      const response = await page.evaluate(async ({ replay, cursor }) => {
        const url = new URL(replay.url);
        const csrf = document.cookie.split('; ').find(c => c.startsWith('csrftoken='))?.slice(10) ?? '';
        const headers: Record<string,string> = { ...replay.headers,'X-CSRFToken': csrf };
        const helpers = { replace(node: any): boolean {
          if (!node || typeof node !== 'object') return false;
          let changed = false;
          for (const key of Object.keys(node)) {
            if (['after','max_id','cursor','end_cursor'].includes(key)) { node[key] = cursor; changed = true; }
            else changed = helpers.replace(node[key]) || changed;
          }
          return changed;
        } };
        let body = replay.body;
        if (replay.method === 'GET' && !url.searchParams.has('variables')) url.searchParams.set('max_id',cursor);
        else {
          const params = body ? new URLSearchParams(body) : url.searchParams;
          const variables = params.get('variables');
          if (!variables) throw new Error('Unsupported collection request format. Reconnect to verify pagination.');
          const object = JSON.parse(variables);
          if (!helpers.replace(object)) object.after = cursor;
          params.set('variables',JSON.stringify(object));
          if (body) { body = params.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
        }
        const result = await fetch(url.toString(),{ method: replay.method, headers, credentials: 'include', ...(body ? { body } : {}) });
        return { status: result.status, body: await result.json() };
      }, { replay, cursor });
      if ([401,403].includes(response.status) || response.body.message === 'login_required' || response.body.challenge) throw new SessionExpired();
      if (response.status !== 200) throw new Error(`Instagram collection request failed (${response.status}).`);
      return parseCollection(response.body);
    } };
  }
  async refresh(post: { id: string; source_url: string }): Promise<Discovery> {
    if (!this.page) await this.open();
    let found: Discovery | undefined;
    const pending: Promise<void>[] = [];
    const listener = (response: BrowserResponse) => {
      if (!/instagram\.com\//.test(response.url()) || !/json|javascript/.test(response.headers()['content-type'] ?? '')) return;
      pending.push(response.json().then(body => { found = extractDiscoveries(body).find(p => p.id === post.id) ?? found; }).catch(() => {}));
    };
    this.page!.on('response',listener);
    try { await this.page!.goto(post.source_url,{ waitUntil: 'domcontentloaded' }); await this.page!.waitForTimeout(3500); await this.authenticated(); }
    finally { this.page!.off('response',listener); await Promise.all(pending); }
    // Direct post pages can hydrate media from embedded JSON without issuing an API request.
    for (const json of await this.page!.locator('script[type="application/json"]').allTextContents()) {
      try { found = extractDiscoveries(JSON.parse(json)).find(p => p.id === post.id) ?? found; } catch {}
    }
    if (!found || found.media.some(m => !m.url)) {
      // Hydration can omit progressive video URLs. Request fresh detail metadata in
      // the same authenticated browser, rather than treating a video poster as a video.
      const response = await this.page!.evaluate(async id => {
        const csrf = document.cookie.split('; ').find(c => c.startsWith('csrftoken='))?.slice(10) ?? '';
        const result = await fetch(`/api/v1/media/${encodeURIComponent(id)}/info/`,{ credentials: 'include',headers: { 'X-CSRFToken': csrf,'X-IG-App-ID': '936619743392459' } });
        return { status: result.status,body: await result.json() };
      },post.id);
      if ([401,403].includes(response.status) || response.body.message === 'login_required' || response.body.challenge) throw new SessionExpired();
      if (response.status === 200) found = extractDiscoveries(response.body).find(p => p.id === post.id) ?? found;
    }
    if (!found || found.media.some(m => !m.url)) throw new Error('Could not refresh complete Instagram media. This item remains retryable.');
    return found;
  }
  async download(url: string) {
    if (!this.context) await this.open();
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com)$/.test(parsed.hostname)) throw new Error('Unrecognized Instagram media host.');
    const response = await this.context!.request.get(url, { timeout: 60000 });
    if ([401,403,410].includes(response.status())) throw new Error('Expired Instagram media URL.');
    if (!response.ok()) throw new Error(`Instagram download failed (${response.status()}).`);
    return { buffer: await response.body(), mime: response.headers()['content-type'] ?? '' };
  }
}
