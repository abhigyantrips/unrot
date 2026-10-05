import { element,postView } from '../src/lib/dom';
import { tagClass,type LocalPost,type Tag,type Revision } from '../src/lib/types';
type State = { posts: LocalPost[]; tags: Tag[]; pending: Revision[]; status: { state: string;message: string }; configured: boolean; reconnecting: boolean; counts: { review_state: string;download_state: string;published_at: string | null;count: number }[] };
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
let state: State, view = 'queue', selected = '', rendering = '', fetching = false;
const drafts = new Map<string,{ notes: string;tags: Set<string> }>();
const dirty = new Set<string>();
try {
  const saved = JSON.parse(sessionStorage.getItem('unrot-curator-drafts') ?? '[]');
  for (const item of saved) if (typeof item.id === 'string' && typeof item.notes === 'string' && Array.isArray(item.tags)) {
    drafts.set(item.id,{ notes: item.notes,tags: new Set(item.tags.filter((t: unknown) => typeof t === 'string')) }); dirty.add(item.id);
  }
} catch {}
function persistDrafts() {
  try { sessionStorage.setItem('unrot-curator-drafts',JSON.stringify([...dirty].map(id => ({ id,notes: drafts.get(id)!.notes,tags: [...drafts.get(id)!.tags] })))); } catch {}
}
const prefetched = new Set<string>();
const localMedia = (key: string) => `/__local/media/${key}`;
function notice(text: string) { $('#notice').textContent = text; $('#notice').hidden = !text; }
async function api<T = { ok: boolean }>(path: string,body?: unknown): Promise<T> {
  const response = await fetch(`/__local/${path}`,body === undefined ? {} : { method: 'POST',headers: { 'Content-Type': 'application/json' },body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(data.error); return data;
}
function current() { return state?.posts.find(p => p.id === selected); }
function draft(post: LocalPost) {
  if (!drafts.has(post.id)) drafts.set(post.id,{ notes: post.notes,tags: new Set(post.tags.map(t => t.id)) });
  return drafts.get(post.id)!;
}
function picker() {
  const post = current(); if (!post) return;
  const filter = $<HTMLInputElement>('#tag-search').value.toLowerCase(); const target = $('#tag-picker'); target.replaceChildren();
  for (const tag of state.tags.filter(t => t.name.toLowerCase().includes(filter))) {
    const label = element('label','cursor-pointer'); const input = element('input','peer sr-only'); input.type = 'checkbox'; input.value = tag.id; input.checked = draft(post).tags.has(tag.id);
    input.addEventListener('change',() => { input.checked ? draft(post).tags.add(tag.id) : draft(post).tags.delete(tag.id); dirty.add(post.id); persistDrafts(); });
    label.append(input,element('span',`tag border-2 border-transparent peer-checked:border-stone-700 peer-focus-visible:outline-2 peer-focus-visible:outline-stone-700 ${tagClass[tag.color]}`,tag.name)); target.append(label);
  }
  if (!target.childElementCount) target.append(element('p','text-xs text-stone-500',state.tags.length ? 'No matching tags.' : 'Create your first tag to save this post.'));
}
function render() {
  $('#job-status').textContent = state.status.message;
  $('#pending-count').textContent = `${state.pending.length} pending revisions`;
  $('#reconnect').classList.toggle('hidden',state.status.state !== 'reconnect' || state.reconnecting || !state.configured);
  $('#resume').classList.toggle('hidden',!state.reconnecting);
  $<HTMLButtonElement>('#sync').disabled = state.status.state === 'syncing' || state.reconnecting;
  for (const name of ['queue','ready','published','ignored','failed']) {
    const count = state.counts.filter(c => name === 'ignored' ? c.review_state === 'ignored' : name === 'ready' ? c.review_state === 'ready' : name === 'published' ? !!c.published_at && c.review_state !== 'ignored' : name === 'failed' ? c.download_state === 'failed' && c.review_state !== 'ignored' : c.review_state === 'queue' && !c.published_at && c.download_state !== 'failed').reduce((n,c) => n + c.count,0);
    $(`[data-count="${name}"]`).textContent = String(count);
    const button = $(`[data-view="${name}"]`); button.setAttribute('aria-pressed',String(view === name)); button.className = view === name ? 'button capitalize' : 'button-secondary capitalize';
  }
  if (!state.posts.some(p => p.id === selected)) selected = state.posts[0]?.id ?? '';
  const list = $('#queue-list'); list.replaceChildren();
  state.posts.forEach(post => {
    const button = element('button',`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${post.id === selected ? 'border-amber-700 bg-amber-50' : 'border-stone-200 bg-white'}`);
    if (post.assets[0]) { const img = element('img','h-12 w-12 rounded-lg object-cover'); img.src = localMedia(post.assets[0].preview_key); img.alt = ''; button.append(img); }
    const info = element('div','min-w-0'); info.append(element('p','truncate text-sm font-medium',post.creator ? `@${post.creator}` : post.id),element('p','mt-1 text-xs text-stone-500',`${post.expected_count} media · ${post.download_state}`)); button.append(info); button.onclick = () => { selected = post.id; rendering = ''; render(); }; list.append(button);
  });
  const post = current(); $('#curator-empty').hidden = !!post; $('#editor').hidden = !post;
  $('#empty-message').textContent = !state.configured ? 'Run pnpm setup:instagram to connect Instagram, then sync your collection.' : view === 'ready' ? 'Ready revisions appear here. Saving a reviewed post stages it for publication.' : `No ${view} posts. Sync or explore another view.`;
  if (!post) return;
  const signature = JSON.stringify([post.id,post.assets,post.download_state,post.error,post.review_state,post.published_at,state.tags,state.pending]);
  if (signature !== rendering) {
    rendering = signature;
    $('#editor-title').textContent = post.creator ? `@${post.creator}` : 'Saved discovery';
    $('#revision-status').textContent = state.pending.some(r => r.post_id === post.id) ? 'Revision staged locally.' : post.published_at ? 'Published. Edits stay local until publishing.' : 'Waiting for your review.';
    const gallery = $('#local-gallery'); gallery.replaceChildren();
    if (post.assets.length) {
      const root = postView({ ...post,notes: '' },'',localMedia);
      root.querySelector('section:last-child')!.remove(); root.className = ''; const media = root.firstElementChild as HTMLElement; media.className = 'relative overflow-hidden rounded-xl bg-stone-950'; media.querySelectorAll('.media-slide').forEach(node => node.className = 'h-96 w-full object-contain'); gallery.append(root);
    } else gallery.append(element('div','flex h-80 items-center justify-center rounded-xl bg-stone-200 p-6 text-sm text-stone-500',post.download_state === 'failed' ? 'Download needs another try.' : 'Downloading originals and previews…'));
    $('#download-status').textContent = post.error ?? `${post.assets.length} / ${post.expected_count} originals downloaded`;
    $('#retry-download').hidden = post.download_state !== 'failed';
    $<HTMLButtonElement>('#save').disabled = post.download_state !== 'complete' || post.review_state === 'ignored';
    $('#ignore').hidden = post.review_state === 'ignored'; $('#restore').hidden = post.review_state !== 'ignored'; $('#unpublish').hidden = !post.published_at;
    $<HTMLTextAreaElement>('#notes').value = draft(post).notes; $('#notes-preview').hidden = true; picker();
    const details = $('#source-details'); details.replaceChildren();
    const original = element('a','inline-flex text-xs underline underline-offset-4','Original Instagram post ↗'); original.href = post.source_url; original.target = '_blank'; original.rel = 'noopener noreferrer'; details.append(original);
    if (post.source_date) details.append(element('p','text-xs text-stone-500',new Date(post.source_date).toLocaleDateString('en',{ dateStyle: 'long' })));
    if (post.caption) { const cap = element('details'); cap.append(element('summary','cursor-pointer text-xs text-stone-500','Original caption'),element('p','mt-3 whitespace-pre-wrap text-xs leading-relaxed text-stone-600',post.caption)); details.append(cap); }
  }
  if (view === 'queue' && !state.reconnecting) {
    const index = state.posts.indexOf(post); const ids = state.posts.slice(index,index + 3).filter(p => p.download_state === 'pending' && !prefetched.has(p.id)).map(p => p.id);
    ids.forEach(id => prefetched.add(id)); if (ids.length) void api('download',{ ids }).catch(error => notice(error.message));
  }
}
async function refresh() {
  if (fetching) return; fetching = true;
  const requested = view;
  try { const next = await api<State>(`state?view=${requested}`); if (requested === view) { state = next; render(); } }
  catch (error) { notice((error as Error).message); }
  finally { fetching = false; if (requested !== view) void refresh(); }
}
function run(job: () => Promise<unknown>) {
  return async (event?: Event) => { event?.preventDefault(); try { await job(); notice(''); await refresh(); } catch (error) { notice((error as Error).message); } };
}
document.querySelectorAll<HTMLElement>('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view!; selected = ''; rendering = ''; void refresh(); });
$('#sync').onclick = run(() => api('sync',{})); $('#reconnect').onclick = run(() => api('reconnect',{})); $('#resume').onclick = run(() => api('resume',{}));
$('#retry-download').onclick = run(() => api('download',{ ids: [selected] }));
$('#tag-search').oninput = picker;
$<HTMLTextAreaElement>('#notes').oninput = () => { const post = current(); if (post) { draft(post).notes = $<HTMLTextAreaElement>('#notes').value; dirty.add(post.id); persistDrafts(); } };
$('#review-form').onsubmit = run(async () => { const post = current(); if (!post) return; const data = draft(post); await api('save',{ id: post.id,notes: data.notes,tags: [...data.tags] }); drafts.delete(post.id); dirty.delete(post.id); persistDrafts(); rendering = ''; });
for (const [id,action] of [['ignore','ignore'],['restore','restore'],['unpublish','unpublish']]) $(`#${id}`).onclick = run(async () => { await api('review',{ id: selected,action }); rendering = ''; });
$('#preview-notes').onclick = run(async () => { const { html } = await api<{ html: string }>('preview',{ notes: $<HTMLTextAreaElement>('#notes').value }); $('#notes-preview').innerHTML = html; $('#notes-preview').hidden = false; });
function manage() {
  if (!state) { notice('Connecting to the local archive…'); return; }
  const dialog = $<HTMLDialogElement>('#tags-dialog');
  const list = $('#tag-management'); list.replaceChildren();
  for (const tag of state.tags) {
    const button = element('button',`tag ${tagClass[tag.color]}`,`${tag.name} · edit`);
    button.onclick = () => { $<HTMLInputElement>('#tag-id').value = tag.id; $<HTMLInputElement>('#tag-name').value = tag.name; $<HTMLSelectElement>('#tag-color').value = tag.color; }; list.append(button);
  }
  for (const id of ['merge-from','merge-into']) { const select = $<HTMLSelectElement>(`#${id}`); select.replaceChildren(); for (const tag of state.tags) { const option = element('option','',tag.name); option.value = tag.id; select.append(option); } }
  if (!dialog.open) dialog.showModal();
}
$('#manage-tags').onclick = manage; $('#new-tag').onclick = manage; $('#tags-close').onclick = () => $<HTMLDialogElement>('#tags-dialog').close();
$('#reset-tag').onclick = () => { $<HTMLFormElement>('#tag-form').reset(); $<HTMLInputElement>('#tag-id').value = ''; };
$('#tag-form').onsubmit = run(async () => { await api('tag',{ id: $<HTMLInputElement>('#tag-id').value || undefined,name: $<HTMLInputElement>('#tag-name').value,color: $<HTMLSelectElement>('#tag-color').value }); $<HTMLFormElement>('#tag-form').reset(); $<HTMLInputElement>('#tag-id').value = ''; await refresh(); manage(); });
$('#merge-form').onsubmit = run(async () => {
  const from = $<HTMLSelectElement>('#merge-from').value, into = $<HTMLSelectElement>('#merge-into').value;
  await api('merge',{ from,into });
  drafts.forEach(d => { if (d.tags.delete(from)) d.tags.add(into); });
  persistDrafts();
  await refresh(); manage();
});
window.addEventListener('beforeunload',event => { if (dirty.size) event.preventDefault(); });
void refresh(); setInterval(() => { if (!$<HTMLDialogElement>('#tags-dialog').open) void refresh(); },3000);
