import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createTestHarness } from 'wrangler';
import { migrate } from '../local/platform';
import type { Bindings,Asset } from '../src/lib/types';
const temporary = await mkdtemp(join(tmpdir(),'unrot-browser-'));
const built = JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
// Load compiled code without inheriting the production account or remote bindings.
const server = createTestHarness({ root: temporary,workers: [{ config: {
  name: 'unrot-browser',main: resolve('dist/server',built.main),no_bundle: true,rules: built.rules,
  compatibility_date: built.compatibility_date,compatibility_flags: built.compatibility_flags,
  assets: { directory: resolve('dist/server',built.assets.directory),binding: 'ASSETS' },
  d1_databases: [{ binding: 'DB',database_name: 'unrot-browser',database_id: '00000000-0000-0000-0000-000000000000',remote: false }],
  r2_buckets: [{ binding: 'MEDIA',bucket_name: 'unrot-browser-media',remote: false }],
} }] });
const browser = await chromium.launch({ headless: true });
try {
  const { url } = await server.listen();
  const env = await server.getWorker<Bindings>().getEnv();
  await migrate(env.DB,false);
  await env.DB.batch(['INSERT INTO live_tags VALUES(\'architecture\',\'Architecture\',\'amber\')','INSERT INTO live_tags VALUES(\'places\',\'Places\',\'teal\')','INSERT INTO live_tags VALUES(\'design\',\'Design\',\'rose\')'].map(s => env.DB.prepare(s)));
  const put = async (buffer: Buffer,ext: string,mime: string) => { const hash = createHash('sha256').update(buffer).digest('hex'); const key = `objects/${hash}.${ext}`; await env.MEDIA.put(key,buffer,{ httpMetadata: { contentType: mime } }); return key; };
  const fixtures: Asset[] = [];
  for (const [i,width,height,color] of [[0,900,600,'#d6d3d1'],[1,600,800,'#a7b9aa'],[2,600,600,'#ecc98d']] as [number,number,number,string][]) {
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${color}"/><rect x="${width*.15}" y="${height*.15}" width="${width*.7}" height="${height*.7}" rx="20" fill="#fafaf9"/><circle cx="${width*.5}" cy="${height*.45}" r="${width*.18}" fill="${color}"/><text x="50%" y="78%" text-anchor="middle" font-family="serif" font-size="28" fill="#57534e">A saved discovery · ${i+1}</text></svg>`;
    const image = await sharp(Buffer.from(svg)).jpeg().toBuffer(); const key = await put(image,'jpg','image/jpeg'); const preview = await put(await sharp(image).resize(960,960,{ fit: 'inside' }).webp().toBuffer(),'webp','image/webp');
    fixtures.push({ position: 0,key,preview_key: preview,type: 'image',mime: 'image/jpeg',width,height,hash: key.split('/')[1]!.split('.')[0]!,bytes: image.length });
  }
  await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=640x480:d=5','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',`${temporary}/video.mp4`]);
  const bytes = await readFile(`${temporary}/video.mp4`); const videoKey = await put(bytes,'mp4','video/mp4');
  const video: Asset = { ...fixtures[0]!,position: 1,key: videoKey,type: 'video',mime: 'video/mp4',bytes: bytes.length,hash: videoKey.split('/')[1]!.split('.')[0]! };
  for (let i = 1; i <= 29; i++) {
    const id = `p${String(i).padStart(2,'0')}`, a = fixtures[i % 3]!;
    const date = `2025-01-${String(i).padStart(2,'0')}T00:00:00.000Z`;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO live_posts(id,source_url,creator,caption,source_date,notes,published_at,updated_at,revision_id,visible) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'https://www.instagram.com/p/FIXTURE/','fixture_creator','An original caption','2024-01-01T00:00:00.000Z','**A note for later.**\n\n<script>alert(1)</script>',date,date,`revision${i}`,i === 1 ? 0 : 1),
      ...[a,...(i === 29 ? [video] : [])].map(a => env.DB.prepare('INSERT INTO live_assets VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,a.position,a.key,a.preview_key,a.type,a.mime,a.width,a.height,a.hash,a.bytes)),
      env.DB.prepare('INSERT INTO live_post_tags VALUES(?,?)').bind(id,i % 2 === 0 ? 'architecture' : 'places'),
      ...(i % 3 === 0 ? [env.DB.prepare('INSERT INTO live_post_tags VALUES(?,?)').bind(id,'design')] : []),
    ]);
  }
  const page = await browser.newPage({ viewport: { width: 1440,height: 900 } });
  const errors: string[] = []; page.on('pageerror',error => errors.push(error.message));
  await page.goto(url.href); await page.locator('[data-post-id]').first().waitFor();
  assert.equal(await page.locator('[data-post-id]').count(),24);
  assert.equal(await page.locator('#loaded-count, #collection-label, #active-filters').count(),0);
  assert.equal(await page.locator('#archive-grid .tag').count(),0);
  assert.equal(await page.locator('#archive-grid .feed-author').count(),24);
  assert.equal(await page.locator('[data-post-id]').first().evaluate(el => el.children.length),1);
  assert.equal(await page.locator('h1').textContent(),'a curated feed of reels and such.');
  assert.equal(await page.locator('#archive-hero a').getAttribute('href'),'https://abhi.now');
  const gridBounds = await page.locator('#archive-grid').boundingBox();
  assert.ok(gridBounds && gridBounds.width === 1440 - 48);
  const heroHeight = await page.locator('#archive-hero').evaluate(el => el.getBoundingClientRect().height);
  const toggle = page.locator('#header-toggle');
  await toggle.click();
  assert.equal(await toggle.textContent(),'unrot.');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await page.waitForFunction(() => document.querySelector('#archive-hero')!.getBoundingClientRect().height === 0);
  assert.equal(await page.locator('#archive-hero').evaluate((el: HTMLElement) => el.inert),true);
  await toggle.press('Enter');
  await page.waitForFunction(height => Math.abs(document.querySelector('#archive-hero')!.getBoundingClientRect().height - height) < 1,heroHeight);
  assert.equal(await toggle.textContent(),'Hide Header');
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await mkdir('test-results',{ recursive: true }); await page.screenshot({ path: 'test-results/desktop.png',fullPage: true });
  const first = page.locator('[data-post-id="p29"]'); await first.click();
  await page.locator('#post-content [data-carousel]').waitFor(); assert.ok(page.url().endsWith('/posts/p29'));
  assert.ok(await page.locator('#post-content .tag').count() > 0);
  assert.equal(await page.locator('#post-dialog').evaluate((d: HTMLDialogElement) => d.open),true);
  assert.equal(await page.locator('#post-content script').count(),0);
  await page.locator('#post-content [data-next]').click();
  const player = page.locator('#post-content video'); await player.evaluate(async (video: HTMLVideoElement) => { await video.play(); });
  await player.evaluate((v: HTMLVideoElement) => { v.currentTime = 2; }); await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#post-content video')!.currentTime >= 2);
  await page.locator('#post-content [data-previous]').click(); assert.equal(await player.evaluate((v: HTMLVideoElement) => v.paused),true);
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#post-dialog')!.open);
  assert.ok(page.url().endsWith('/')); assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.postId),'p29');
  await page.goForward(); await page.locator('#post-content [data-carousel]').waitFor(); await page.locator('#post-close').click(); await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#post-dialog')!.open);
  await page.locator('#refine').click(); await page.locator('#filter-tags input').first().waitFor();
  await page.locator('label:has(input[value="architecture"])').click(); await page.locator('label:has(input[value="design"])').click(); await page.locator('label:has(input[name="match"][value="all"])').click(); await page.locator('#filter-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-post-id]').length === 4); assert.ok(page.url().includes('match=all')); assert.ok(page.url().includes('tag=architecture'));
  await page.reload(); assert.equal(await page.locator('[data-post-id]').count(),4);
  await page.locator('#refine').click(); assert.equal(await page.locator('#filter-tags input:checked').count(),2);
  await page.locator('#clear-filters').click(); await page.locator('#filter-form button[type="submit"]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-post-id]').length >= 24);
  await page.locator('#load-more').click(); await page.waitForFunction(() => document.querySelectorAll('[data-post-id]').length === 28);
  assert.equal(await page.locator('#archive-grid .tag').count(),0);
  assert.equal(await page.locator('#archive-grid .feed-author').count(),28);
  assert.equal(await page.evaluate(() => new Set([...document.querySelectorAll<HTMLElement>('[data-post-id]')].map(n => n.dataset.postId)).size),28);
  await page.goto(new URL('/posts/p29',url).href); assert.equal(await page.locator('[data-slide]').count(),2); assert.equal(await page.locator('video[autoplay]').count(),0);
  await page.goto(url.href); await page.setViewportSize({ width: 390,height: 844 }); await page.screenshot({ path: 'test-results/mobile.png',fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  assert.equal(await page.locator('#archive-hero').evaluate(el => el.getBoundingClientRect().height),0);
  await toggle.click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#refine').click(); await page.screenshot({ path: 'test-results/mobile-filter.png' }); await page.keyboard.press('Escape');
  for (const path of ['/curate','/__local/state','/posts/p01','/api/posts/p01']) assert.equal((await server.fetch(path)).status,404);
  await page.route('**/api/posts?**',route => route.fulfill({ status: 403,headers: { 'cf-mitigated': 'challenge','content-type': 'text/html' },body: '<html>Browser check</html>' }));
  await page.locator('#refine').click();
  await page.locator('label:has(input[value="architecture"])').click();
  await page.locator('#filter-form button[type="submit"]').click();
  await page.locator('#state-message').filter({ hasText: 'Refresh this page to complete Cloudflare' }).waitFor();
  await page.unroute('**/api/posts?**');
  await page.locator('#retry').click(); await page.locator('[data-post-id]').first().waitFor();
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: filters and URL restoration, pagination, history/focus, carousel playback/seeking, mobile layout, and production privacy.');
  console.log(`Isolated fixture preview: ${url.href}`);
  if (process.argv.includes('--keep-open')) { await browser.close(); await new Promise<void>(resolve => process.once('SIGINT',() => resolve())); }
} finally { await browser.close(); await server.close(); await rm(temporary,{ recursive: true,force: true }); }
