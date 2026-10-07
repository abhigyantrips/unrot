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
function feedIcon(kind: 'video' | 'image' | 'layers' | 'user' | 'link' | 'close', size = 14) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  for (const [key,value] of Object.entries({ width: String(size),height: String(size),viewBox: '0 0 24 24',fill: 'none',stroke: 'currentColor','stroke-width': '2','stroke-linecap': 'round','stroke-linejoin': 'round','aria-hidden': 'true' })) svg.setAttribute(key,value);
  const paths = kind === 'user' ? ['M20 21v-2a7 7 0 0 0-14 0v2','M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'] : kind === 'link' ? ['M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2','M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2'] : kind === 'close' ? ['m6 6 12 12','M18 6 6 18'] : kind === 'video' ? ['m6 3 14 9-14 9V3Z'] : kind === 'image' ? ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','m21 15-5-5L5 21','M9 8h.01'] : ['m12 3 10 5-10 5L2 8l10-5Z','m2 12 10 5 10-5','m2 16 10 5 10-5'];
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
export function postLoading(preview: HTMLImageElement | null, creator: string, onClose: () => void) {
  const root = element('div','grid md:grid-cols-5'); root.dataset.carousel = ''; root.dataset.postLoading = '';
  const width = Number(preview?.getAttribute('width')) || preview?.naturalWidth || 1;
  const height = Number(preview?.getAttribute('height')) || preview?.naturalHeight || 1;
  root.style.setProperty('--media-ratio',String(width / height));
  const media = element('section','relative overflow-hidden bg-stone-950 md:col-span-3'); media.setAttribute('aria-label','Archived media');
  if (preview) {
    const image = element('img','media-slide'); image.src = preview.currentSrc || preview.src; image.alt = preview.alt;
    image.width = width; image.height = height; media.append(image);
  }
  const detail = element('section','post-detail md:col-span-2');
  const header = element('div','post-author-row');
  const close = element('button','post-icon post-close'); close.type = 'button'; close.setAttribute('aria-label','Close post'); close.onclick = onClose; close.append(feedIcon('close',18));
  header.append(element('h2','post-author',creator || 'Instagram creator'),close);
  const status = element('p','text-sm text-stone-500','Opening your discovery…'); status.setAttribute('role','status');
  detail.append(header,status); root.append(media,detail); return root;
}
export function postView(post: Post, notesHtml: string, urlFor = mediaUrl, onClose?: () => void) {
  const root = element('div','grid md:grid-cols-5'); root.dataset.carousel = '';
  const media = element('section','relative overflow-hidden bg-stone-950 md:col-span-3'); media.setAttribute('aria-label','Archived media');
  post.assets.forEach((a,index) => {
    const slide = element('div','h-full'); slide.dataset.slide = ''; slide.dataset.mediaRatio = String(a.width / a.height || 1); slide.hidden = index !== 0;
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
  const detail = element('section','post-detail md:col-span-2');
  const header = element('div','post-author-row');
  const author = element('div','min-w-0');
  const heading = element('h2','post-author',post.creator ? `@${post.creator}` : 'Instagram creator');
  if (onClose) heading.id = 'post-dialog-title';
  author.append(heading);
  let date: HTMLTimeElement | undefined;
  if (post.source_date) {
    date = element('time','col-span-2 block text-xs text-stone-500',new Date(post.source_date).toLocaleDateString('en',{ dateStyle: 'long',timeZone: 'UTC' }));
    date.dateTime = post.source_date;
  }
  const actions = element('div','post-actions');
  const action = (href: string, label: string, icon: 'user' | 'image' | 'link', external = false) => {
    const link = element('a','post-icon'); link.href = href; link.setAttribute('aria-label',label); link.title = label;
    if (external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.append(feedIcon(icon,18)); actions.append(link);
  };
  if (post.creator) action(`https://www.instagram.com/${encodeURIComponent(post.creator)}/`,'View author profile','user',true);
  action(post.source_url,'View original post','image',true);
  action(`/posts/${post.id}`,'Post permalink','link');
  if (onClose) {
    const close = element('button','post-icon post-close'); close.type = 'button'; close.id = 'post-close'; close.setAttribute('aria-label','Close post'); close.title = 'Close post';
    close.append(feedIcon('close',18)); close.onclick = onClose; actions.append(close);
  }
  header.append(author,actions); if (date) header.append(date); detail.append(header);
  if (post.notes) {
    const note = element('div','post-note'); note.setAttribute('aria-label',"Curator's note");
    const notes = element('div','notes'); notes.innerHTML = notesHtml;
    note.append(element('h3','post-section-label',"Curator's note"),notes); detail.append(note);
  }
  if (post.caption) {
    const caption = element('p','post-caption'); caption.dataset.caption = '';
    const text = element('span','',post.caption); text.dataset.captionText = '';
    const more = element('button','caption-more','Show more...'); more.type = 'button'; more.dataset.captionMore = ''; more.setAttribute('aria-expanded','false'); more.hidden = true;
    caption.append(text,more);
    const section = element('div','post-section'); section.append(element('h3','post-section-label','Original caption'),caption); detail.append(section);
  }
  if (post.tags.length) {
    const section = element('div','post-section'); section.append(element('h3','post-section-label','Tags'),tagsView(post.tags,true)); detail.append(section);
  }
  root.append(media,detail); mountCarousels(root); requestAnimationFrame(() => mountCaptions(root)); return root;
}
export function pauseMedia(root: ParentNode) { root.querySelectorAll('video').forEach(video => video.pause()); }
export function mountCarousels(root: ParentNode) {
  const carousels = [...root.querySelectorAll<HTMLElement>('[data-carousel]')];
  if (root instanceof HTMLElement && root.matches('[data-carousel]')) carousels.push(root);
  for (const carousel of carousels) {
    if (carousel.dataset.mounted) continue; carousel.dataset.mounted = 'true';
    const slides = [...carousel.querySelectorAll<HTMLElement>('[data-slide]')];
    const fitMedia = () => {
      const active = slides.find(slide => !slide.hidden);
      if (!active) return;
      const video = active.querySelector('video');
      const ratio = video?.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : Number(active.dataset.mediaRatio) || 1;
      carousel.style.setProperty('--media-ratio',String(ratio));
      requestAnimationFrame(() => mountCaptions(carousel));
    };
    fitMedia();
    carousel.querySelectorAll('video').forEach(video => video.addEventListener('loadedmetadata',fitMedia));
    if (slides.length < 2) continue;
    let position = 0;
    const move = (delta: number) => {
      pauseMedia(carousel); slides[position]!.hidden = true;
      position = (position + delta + slides.length) % slides.length; slides[position]!.hidden = false; fitMedia();
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

const captions = new WeakMap<HTMLElement,{ full: string; expanded: boolean }>();
export function mountCaptions(root: ParentNode) {
  for (const caption of root.querySelectorAll<HTMLElement>('[data-caption]')) {
    const text = caption.querySelector<HTMLElement>('[data-caption-text]')!;
    const more = caption.querySelector<HTMLButtonElement>('[data-caption-more]')!;
    let state = captions.get(caption);
    if (!state) {
      state = { full: text.textContent ?? '',expanded: false }; captions.set(caption,state);
      more.onclick = () => {
        state!.expanded = true; text.textContent = state!.full; more.hidden = true; more.setAttribute('aria-expanded','true');
      };
    }
    if (state.expanded || !caption.clientWidth) continue;
    text.textContent = state.full; more.hidden = true;
    const maxHeight = parseFloat(getComputedStyle(caption).lineHeight) * 6 + 1;
    if (caption.getBoundingClientRect().height <= maxHeight) continue;
    more.hidden = false;
    // Measure with the inline button included so it fits on the sixth line.
    const characters = Array.from(state.full);
    let low = 0, high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      text.textContent = characters.slice(0,middle).join('').trimEnd() + '… ';
      if (caption.getBoundingClientRect().height <= maxHeight) low = middle; else high = middle - 1;
    }
    text.textContent = characters.slice(0,low).join('').trimEnd() + '… ';
  }
}
window.addEventListener('resize',() => mountCaptions(document));
