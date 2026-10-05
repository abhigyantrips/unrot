import { readFile } from 'node:fs/promises';

interface Rule { id?: string; ref: string; description: string; expression: string; action: string; enabled: boolean }
interface Ruleset { id: string; rules: Rule[] }
interface Envelope<T> { success: boolean; result: T; errors: { code: number; message: string }[] }
const configuration = JSON.parse(await readFile(new URL('../cloudflare/managed-challenge.json',import.meta.url),'utf8')) as { zone_id: string; rule: Rule };
const phase = 'http_request_firewall_custom';
const base = `https://api.cloudflare.com/client/v4/zones/${configuration.zone_id}/rulesets`;

async function main() {
  if (process.argv.includes('--dry-run')) { console.log(JSON.stringify({ phase,...configuration },null,2)); return; }
  const token = process.env.CLOUDFLARE_API_TOKEN || await readFile('.unrot/cloudflare-api-token','utf8').then(value => value.trim()).catch(() => '');
  if (!token) throw new Error('Cloudflare WAF credentials required: set CLOUDFLARE_API_TOKEN or save the token to .unrot/cloudflare-api-token. Grant Zone / Zone WAF / Edit for abhi.now. Wrangler OAuth lacks this permission.');
  async function api<T>(path: string,method = 'GET',body?: unknown,allowMissing = false): Promise<T | null> {
    const response = await fetch(`${base}${path}`,{ method,headers: { Authorization: `Bearer ${token}`,'Content-Type': 'application/json' },body: body ? JSON.stringify(body) : undefined,signal: AbortSignal.timeout(30_000) });
    const data = await response.json() as Envelope<T>;
    if (allowMissing && response.status === 404) return null;
    if (!response.ok || !data.success) throw new Error(`Cloudflare WAF request failed (${response.status}): ${data.errors.map(error => `${error.code}: ${error.message}`).join('; ')}`);
    return data.result;
  }
  const current = await api<Ruleset>(`/phases/${phase}/entrypoint`,'GET',undefined,true);
  const existing = current?.rules.find(rule => rule.ref === configuration.rule.ref);
  const matches = (rule?: Rule) => !!rule && Object.entries(configuration.rule).every(([key,value]) => rule[key as keyof Rule] === value);
  if (process.argv.includes('--check')) {
    if (!matches(existing)) throw new Error('The configured Unrot Managed Challenge is not active.');
    console.log('Verified active Unrot Managed Challenge:',existing?.id); return;
  }
  if (matches(existing)) { console.log('Unrot Managed Challenge already active; no changes.'); return; }
  // Mutate only our own rule. Other hostnames and existing rules are preserved.
  if (!current) await api('', 'POST',{ name: 'Zone custom firewall rules',kind: 'zone',phase,rules: [configuration.rule] });
  else if (existing) await api(`/${current.id}/rules/${existing.id}`,'PATCH',configuration.rule);
  else await api(`/${current.id}/rules`,'POST',configuration.rule);
  const verified = await api<Ruleset>(`/phases/${phase}/entrypoint`);
  const rule = verified?.rules.find(rule => rule.ref === configuration.rule.ref);
  if (!matches(rule)) throw new Error('Cloudflare did not return the expected enabled rule after applying it.');
  console.log('Unrot Managed Challenge enabled:',rule?.id);
}
await main().catch(error => { console.error(error instanceof Error ? error.message : 'Cloudflare WAF setup failed.'); process.exitCode = 1; });
