import { createInterface } from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { Instagram, scanCollection } from '../local/instagram';
import { config, saveConfig } from '../local/config';
import { lock } from '../local/lock';
const release = await lock('curator');
const prompt = createInterface({ input: stdin,output: stdout });
const browser = new Instagram();
try {
  const old = await config();
  const suppliedUrl = process.argv[2];
  const cobaltUrl = suppliedUrl ? old?.cobaltUrl ?? 'https://download.abhi.now' : (await prompt.question(`Cobalt URL [${old?.cobaltUrl ?? 'https://download.abhi.now'}]: `)).trim() || old?.cobaltUrl || 'https://download.abhi.now';
  const cobaltKey = suppliedUrl ? old?.cobaltKey : (await prompt.question('Optional Cobalt API key (blank keeps the existing key): ')).trim() || old?.cobaltKey;
  const page = await browser.open(!!suppliedUrl);
  await page.goto(suppliedUrl ?? old?.collectionUrl ?? 'https://www.instagram.com/');
  if (!suppliedUrl) {
  console.log('Log into Instagram in the dedicated Chromium window. Open Saved, then the collection to archive.');
  await prompt.question('When that collection is open, press Enter here. ');
  }
  const collectionUrl = page.url();
  const inferred = new URL(collectionUrl).pathname.split('/').filter(Boolean).at(-1);
  const collectionId = suppliedUrl ? inferred ?? '' : (await prompt.question(`Stable collection ID${inferred ? ` [${inferred}]` : ' (from the selected collection URL)'}: `)).trim() || inferred || '';
  const value = { cobaltUrl,cobaltKey,collectionUrl,collectionId };
  const feed = await browser.collection(value);
  console.log('Checking all collection pages before enabling synchronization…');
  const count = await scanCollection(feed.first,feed.next,async () => {});
  await saveConfig(value);
  console.log(`Verified authenticated discovery and full pagination: ${count} posts. Run pnpm dev, then visit http://127.0.0.1:4321/curate.`);
} finally { prompt.close(); await browser.close(); await release(); }
