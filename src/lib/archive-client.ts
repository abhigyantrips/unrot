import { card,element,pauseMedia,postView,tagsView } from './dom';
import { tagClass,type Tag,type Post } from './types';
const grid = document.querySelector<HTMLElement>('#archive-grid')!;
const more = document.querySelector<HTMLButtonElement>('#load-more')!;
const status = document.querySelector<HTMLElement>('#load-status')!;
const empty = document.querySelector<HTMLElement>('#archive-state')!;
const title = document.querySelector<HTMLElement>('#state-title')!;
const message = document.querySelector<HTMLElement>('#state-message')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const refine = document.querySelector<HTMLDialogElement>('#refine-dialog')!;
const dialog = document.querySelector<HTMLDialogElement>('#post-dialog')!;
const content = document.querySelector<HTMLElement>('#post-content')!;
const form = document.querySelector<HTMLFormElement>('#filter-form')!;
let cursor: string | null = grid.dataset.cursor || null;
let gridUrl = location.pathname + location.search;
let scrollPosition = 0;
let focusCard: HTMLElement | null = null;
let busy = false, epoch = 0;
let feedAbort: AbortController | undefined, postAbort: AbortController | undefined;
let tagList: Tag[] = [];
const ids = new Set([...grid.querySelectorAll<HTMLElement>('[data-post-id]')].map(a => a.dataset.postId));
history.replaceState({ ...history.state,gridUrl },'',location.href);
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url,{ signal,cache: 'no-store' });
  if (response.headers.get('cf-mitigated') === 'challenge') throw new Error('Refresh this page to complete Cloudflare’s browser check, then try again.');
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'The archive could not be loaded.');
  return data;
}
function updateFilters() {
  const params = new URL(gridUrl,location.origin).searchParams;
  const selected = params.getAll('tag');
  form.querySelectorAll<HTMLInputElement>('[name="tag"]').forEach(input => input.checked = selected.includes(input.value));
  form.querySelectorAll<HTMLInputElement>('[name="match"]').forEach(input => input.checked = input.value === (params.get('match') ?? 'any'));
  document.querySelector('#collection-label')!.textContent = selected.length ? `${selected.length} tags selected · ${params.get('match') ?? 'any'} matching` : 'The whole collection';
  const count = document.querySelector<HTMLElement>('#filter-count')!; count.hidden = !selected.length; count.textContent = String(selected.length);
  const active = document.querySelector<HTMLElement>('#active-filters')!; active.hidden = !selected.length;
  if (tagList.length) active.replaceChildren(...tagsView(tagList.filter(tag => selected.includes(tag.id))).childNodes);
}
async function load(reset = false) {
  if (busy && !reset) return;
  if (!reset && !cursor) return;
  if (reset) { feedAbort?.abort(); epoch++; cursor = null; ids.clear(); grid.replaceChildren(); }
  const current = epoch; busy = true; more.disabled = true; status.textContent = 'Finding your next discoveries…';
  feedAbort = new AbortController();
  try {
    const params = new URL(gridUrl,location.origin).searchParams;
    if (cursor && !reset) params.set('cursor',cursor);
    const batch = await json<{ posts: Post[]; cursor: string | null }>(`/api/posts?${params}`,feedAbort.signal);
    if (current !== epoch) return;
    for (const post of batch.posts) if (!ids.has(post.id)) { ids.add(post.id); grid.append(card(post)); }
    cursor = batch.cursor; more.hidden = !cursor;
    empty.hidden = ids.size > 0; retry.hidden = true;
    title.textContent = params.getAll('tag').length ? 'Nothing here just yet.' : 'A place for good discoveries.';
    message.textContent = params.getAll('tag').length ? 'Try a different combination of tags, or explore the whole collection.' : 'The first saved finds are on their way. Come back for something worth returning to.';
    status.textContent = cursor ? '' : ids.size ? 'You’ve reached the end. Keep the good ones close.' : '';
    document.querySelector('#loaded-count')!.textContent = ids.size ? String(ids.size).padStart(2,'0') : '';
  } catch (error) {
    if ((error as Error).name === 'AbortError' || current !== epoch) return;
    status.textContent = (error as Error).message;
    if (!ids.size) { empty.hidden = false; title.textContent = 'A moment, please.'; message.textContent = (error as Error).message; retry.hidden = false; }
    else { more.hidden = false; more.textContent = 'Retry loading'; }
  } finally { if (current === epoch) { busy = false; more.disabled = false; } }
}
async function loadTags() {
  try {
    const { tags } = await json<{ tags: Tag[] }>('/api/tags'); tagList = tags;
    const target = document.querySelector('#filter-tags')!;
    target.replaceChildren();
    if (!tags.length) target.append(element('p','text-sm text-stone-500','Tags appear with the first published posts.'));
    for (const tag of tags) {
      const label = element('label','cursor-pointer'); const input = element('input','peer sr-only'); input.type = 'checkbox'; input.name = 'tag'; input.value = tag.id;
      label.append(input,element('span',`tag border-2 border-transparent peer-checked:border-stone-700 peer-focus-visible:outline-2 peer-focus-visible:outline-stone-700 ${tagClass[tag.color] ?? tagClass.stone}`,tag.name)); target.append(label);
    }
    updateFilters();
  } catch { document.querySelector('#filter-tags')!.replaceChildren(element('p','text-sm text-stone-500','Tags could not be loaded. Close and reopen Refine to retry.')); }
}
async function showPost(id: string, push: boolean) {
  postAbort?.abort(); postAbort = new AbortController();
  if (!dialog.open) { scrollPosition = window.scrollY; document.body.style.overflow = 'hidden'; dialog.showModal(); }
  content.replaceChildren(element('p','p-8 text-sm text-stone-500','Opening your discovery…'));
  document.querySelector<HTMLAnchorElement>('#post-permalink')!.href = `/posts/${id}`;
  if (push) history.pushState({ dialog: true,id,gridUrl,scrollPosition },'',`/posts/${id}`);
  try {
    const { post,notesHtml } = await json<{ post: Post; notesHtml: string }>(`/api/posts/${encodeURIComponent(id)}`,postAbort.signal);
    content.replaceChildren(postView(post,notesHtml));
    document.querySelector('#post-dialog-title')!.textContent = post.creator ? `Saved from @${post.creator}` : 'A saved discovery';
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    const area = element('div','space-y-4 p-8'); area.append(element('p','text-sm',(error as Error).message));
    const again = element('button','button-secondary','Try again'); again.onclick = () => void showPost(id,false); area.append(again); content.replaceChildren(area);
  }
}
function hidePost() {
  postAbort?.abort(); pauseMedia(content); dialog.close(); document.body.style.overflow = '';
  window.scrollTo({ top: scrollPosition,behavior: 'instant' }); focusCard?.focus({ preventScroll: true });
}
function closePost() { if (history.state?.dialog) history.back(); else hidePost(); }
grid.addEventListener('click',event => {
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('[data-post-id]');
  if (!anchor || event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
  event.preventDefault(); focusCard = anchor; void showPost(anchor.dataset.postId!,true);
});
document.querySelector('#post-close')!.addEventListener('click',closePost);
dialog.addEventListener('cancel',event => { event.preventDefault(); closePost(); });
dialog.addEventListener('click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closePost(); } });
window.addEventListener('popstate',() => {
  const match = /^\/posts\/([\w-]+)\/?$/.exec(location.pathname);
  if (match) { void showPost(match[1]!,false); return; }
  if (dialog.open) hidePost();
  const path = location.pathname + location.search;
  if (path !== gridUrl) { gridUrl = path; updateFilters(); void load(true); }
});
document.querySelector('#refine')!.addEventListener('click',() => { refine.showModal(); void loadTags(); });
document.querySelector('#refine-close')!.addEventListener('click',() => refine.close());
document.querySelector('#clear-filters')!.addEventListener('click',() => {
  form.querySelectorAll<HTMLInputElement>('[name="tag"]').forEach(input => input.checked = false);
  form.querySelector<HTMLInputElement>('[name="match"][value="any"]')!.checked = true;
});
form.addEventListener('submit',event => {
  event.preventDefault(); const data = new FormData(form); const params = new URLSearchParams();
  data.getAll('tag').forEach(tag => params.append('tag',String(tag)));
  if (data.get('match') === 'all') params.set('match','all');
  gridUrl = `/${params.size ? '?' + params : ''}`;
  history.pushState({ gridUrl },'',gridUrl); refine.close(); updateFilters(); void load(true);
});
more.addEventListener('click',() => void load());
retry.addEventListener('click',() => { void load(true); void loadTags(); });
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting) && cursor && !busy && !dialog.open) void load(); },{ rootMargin: '400px' });
  observer.observe(document.querySelector('#sentinel')!);
}
