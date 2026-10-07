import { mediaUrl, tagClass, type Post, type Tag } from './types';
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function tagsView(tags: Tag[], links = false) {
  const row = element('div','flex flex-wrap gap-2');
  for (const tag of tags) {
    const chip = links ? element('a',`tag ${tagClass[tag.color] ?? tagClass.stone}`,tag.name) : element('span',`tag ${tagClass[tag.color] ?? tagClass.stone}`,tag.name);
    if (chip instanceof HTMLAnchorElement) chip.href = `/?tag=${encodeURIComponent(tag.id)}`;
    row.append(chip);
  }
  return row;
}
function feedIcon(kind: 'video' | 'image' | 'layers') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  for (const [key,value] of Object.entries({ width: '14',height: '14',viewBox: '0 0 24 24',fill: 'none',stroke: 'currentColor','stroke-width': '2','stroke-linecap': 'round','stroke-linejoin': 'round','aria-hidden': 'true' })) svg.setAttribute(key,value);
  const paths = kind === 'video' ? ['m6 3 14 9-14 9V3Z'] : kind === 'image' ? ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','m21 15-5-5L5 21','M9 8h.01'] : ['m12 3 10 5-10 5L2 8l10-5Z','m2 12 10 5 10-5','m2 16 10 5 10-5'];
  for (const d of paths) { const path = document.createElementNS(ns,'path'); path.setAttribute('d',d); svg.append(path); }
  return svg;
}
export function card(post: Post) {
  const a = post.assets[0];
  const span = a && a.width > a.height ? 'sm:col-span-2' : a && a.height > a.width * 1.2 ? 'sm:row-span-2' : '';
  const link = element('a',`group relative flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 transition hover:border-stone-400 ${span}`);
  link.href = `/posts/${post.id}`; link.dataset.postId = post.id;
  const visual = element('div','relative min-h-64 flex-1 overflow-hidden sm:min-h-0');
  if (a) {
    const image = element('img','absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105');
    image.src = mediaUrl(a.preview_key); image.alt = `Saved post by ${post.creator ? '@' + post.creator : 'an Instagram creator'}`;
    image.width = a.width; image.height = a.height; image.loading = 'lazy'; visual.append(image);
  }
  const overlay = element('div','feed-overlay');
  const badges = element('div','flex shrink-0 items-center gap-2');
  if (post.assets.length > 1) {
    const count = element('span','feed-badge gap-1 px-2');
    count.append(feedIcon('layers'),element('span','',String(post.assets.length)),element('span','sr-only','media items')); badges.append(count);
  }
  const kind = a?.type === 'video' ? 'video' : 'image';
  const type = element('span','feed-badge w-8');
  type.append(feedIcon(kind),element('span','sr-only',kind === 'video' ? 'Video' : 'Photo')); badges.append(type);
  overlay.append(element('span','feed-author',post.creator ? `@${post.creator}` : 'Instagram'),badges);
  visual.append(overlay);
  link.append(visual); return link;
}
export function postView(post: Post, notesHtml: string, urlFor = mediaUrl) {
  const root = element('div','grid md:grid-cols-5'); root.dataset.carousel = '';
  const media = element('section','relative overflow-hidden bg-stone-950 md:col-span-3'); media.setAttribute('aria-label','Archived media');
  post.assets.forEach((a,index) => {
    const slide = element('div','h-full'); slide.dataset.slide = ''; slide.hidden = index !== 0;
    if (a.type === 'video') {
      const video = element('video','media-slide'); video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.poster = urlFor(a.preview_key); video.src = urlFor(a.key); video.setAttribute('aria-label',`Video ${index + 1}`); slide.append(video);
    } else {
      const img = element('img','media-slide'); img.src = urlFor(a.key); img.alt = `Media ${index + 1} by ${post.creator || 'Instagram creator'}`; img.width = a.width; img.height = a.height; slide.append(img);
    }
    media.append(slide);
  });
  if (post.assets.length > 1) {
    const controls = element('div','absolute inset-x-0 bottom-4 flex items-center justify-center gap-3');
    const previous = element('button','rounded-full bg-stone-50 px-3 py-2 text-stone-800','←'); previous.dataset.previous = ''; previous.setAttribute('aria-label','Previous media');
    const counter = element('span','rounded-full bg-stone-950/70 px-3 py-1 text-xs text-white',`1 / ${post.assets.length}`); counter.dataset.counter = ''; counter.setAttribute('aria-live','polite');
    const next = element('button','rounded-full bg-stone-50 px-3 py-2 text-stone-800','→'); next.dataset.next = ''; next.setAttribute('aria-label','Next media');
    controls.append(previous,counter,next); media.append(controls);
  }
  const detail = element('section','space-y-6 p-6 sm:p-8 md:col-span-2');
  detail.append(element('p','text-xs uppercase tracking-widest text-stone-500','Kept from Instagram'));
  if (post.creator) {
    const creator = element('a','block text-lg font-semibold',`@${post.creator} ↗`); creator.href = `https://www.instagram.com/${encodeURIComponent(post.creator)}/`; creator.target = '_blank'; creator.rel = 'noopener noreferrer'; detail.append(creator);
  }
  if (post.source_date) detail.append(element('p','text-xs text-stone-500',new Date(post.source_date).toLocaleDateString('en',{ dateStyle: 'long',timeZone: 'UTC' })));
  detail.append(tagsView(post.tags,true));
  if (post.notes) { const notes = element('div','notes'); notes.innerHTML = notesHtml; detail.append(notes); }
  if (post.caption) {
    const caption = element('details','border-t border-stone-200 pt-4'); caption.append(element('summary','cursor-pointer text-sm text-stone-600','Original caption'),element('p','mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-600',post.caption)); detail.append(caption);
  }
  const original = element('a','button-secondary text-xs','Original post ↗'); original.href = post.source_url; original.target = '_blank'; original.rel = 'noopener noreferrer'; detail.append(original);
  root.append(media,detail); mountCarousels(root); return root;
}
export function pauseMedia(root: ParentNode) { root.querySelectorAll('video').forEach(video => video.pause()); }
export function mountCarousels(root: ParentNode) {
  const carousels = [...root.querySelectorAll<HTMLElement>('[data-carousel]')];
  if (root instanceof HTMLElement && root.matches('[data-carousel]')) carousels.push(root);
  for (const carousel of carousels) {
    if (carousel.dataset.mounted) continue; carousel.dataset.mounted = 'true';
    const slides = [...carousel.querySelectorAll<HTMLElement>('[data-slide]')];
    if (slides.length < 2) continue;
    let position = 0;
    const move = (delta: number) => {
      pauseMedia(carousel); slides[position]!.hidden = true;
      position = (position + delta + slides.length) % slides.length; slides[position]!.hidden = false;
      const counter = carousel.querySelector('[data-counter]'); if (counter) counter.textContent = `${position + 1} / ${slides.length}`;
    };
    carousel.querySelector('[data-previous]')?.addEventListener('click',() => move(-1));
    carousel.querySelector('[data-next]')?.addEventListener('click',() => move(1));
    carousel.addEventListener('keydown',event => {
      if ((event.target as HTMLElement).closest('video,input,textarea')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    });
  }
}
