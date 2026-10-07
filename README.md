# Unrot

A public archive at **https://unrot.abhi.now** and a curator that runs only on your computer. Built with Astro, browser TypeScript, Tailwind, D1, and R2. There is no UI framework or cloud import job.

## Start locally

Use Node 22.12+ and pnpm. Install FFmpeg and FFprobe on your system.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm setup:instagram
pnpm dev --background
```

Open **http://127.0.0.1:4321/curate**. Setup opens a dedicated Chromium profile: log into Instagram, open Saved, choose a collection, and return to the terminal. It verifies authentication and every pagination cursor before storing configuration. Cobalt defaults to `https://download.abhi.now`; an optional API key stays local.

To verify an already-authenticated collection without interactive prompts:

```sh
pnpm setup:instagram 'https://www.instagram.com/USERNAME/saved/COLLECTION-NAME/COLLECTION-ID/'
```

Stop the development server before running setup again. Manage background development with `pnpm astro dev status`, `pnpm astro dev logs`, and `pnpm astro dev stop`.

## Curate

- Startup and **Sync** scan the entire collection, including older posts newly saved. Instagram identities deduplicate discoveries; existing notes, tags, ignored records, and publications survive sync. Unsaving never deletes an archive entry.
- Selecting an item downloads its originals and prefetches the next two. Downloads run serially. Cobalt single files, tunnels, and ordered pickers are checked against Instagram media counts/types. Failures and incomplete downloads fall back to refreshed media through the authenticated browser, including embedded post-page data. Failed items remain retryable.
- Create flat tags with stable IDs and a fixed palette. At least one tag and a complete download are required to **Save as ready**. Markdown notes are optional. Preview and published rendering disable raw HTML and sanitize links.
- **Tags** supports creation, renaming, colors, and merging. Merges stage affected post revisions. **Ignored** items can be restored. Ignoring never modifies Instagram saves or unpublishes an existing live post.
- Edit published items or **Stage unpublish** locally. Public queries continue using the previous publication until publishing succeeds.
- On session expiry or a challenge, select **Reconnect Instagram**, finish login in Chromium, and select **Resume sync**. Challenges require interactive resolution.

`/curate` and `/__local/*` exist only during development. The Node bridge requires loopback connections and Host headers; mutations also require an exact Origin. Curator code, Playwright, media-processing operations, account configuration, and browser credentials are excluded from the Worker build. Unsaved editor changes survive page reloads in browser session storage.

## Publish content

```sh
pnpm publish:content --dry-run
pnpm publish:content
```

Dry run lists pending post additions/edits/removals and tag changes without production bindings. Publishing snapshots that list, verifies local hashes, uploads missing content-hashed media to R2, and applies a parameterized atomic D1 batch per post after all its assets are available. Stable IDs and object keys make retries idempotent. Local acknowledgment follows remote metadata success; unsuccessful revisions stay pending. Existing publication dates are retained. Concurrent edits create newer pending revisions for the next run.

**Content publishing does not deploy code.** Dynamic D1 queries show new publications immediately. Unpublishing hides a post and its media routes; local copies and R2 objects remain archived.

`wrangler.local.jsonc` supplies Astro development and local Node scripts with D1/R2 bindings. Development explicitly disables remote bindings and persists data in `.wrangler/state/v3`.

`wrangler.remote.jsonc` configures the production Worker at `unrot.abhi.now`, D1 `unrot`, and R2 `unrot-media`. Astro production builds use this config, and `pnpm deploy` deploys the generated `dist/server/wrangler.json`. Builds disable remote binding access, so building alone never reads or writes production storage. Publishing and `cloudflare:check` explicitly select this config with remote bindings enabled. Wrangler stores authentication outside this project.

For another account, update the account ID, D1 ID, and bucket names in both configs, and the production domain in the remote config, then initialize and deploy:

```sh
pnpm wrangler login
pnpm wrangler d1 create unrot --config wrangler.remote.jsonc
pnpm wrangler r2 bucket create unrot-media --config wrangler.remote.jsonc
pnpm wrangler d1 migrations apply unrot --remote --config wrangler.remote.jsonc
pnpm cloudflare:check
pnpm deploy
```

## Cloudflare Managed Challenge

`cloudflare/managed-challenge.json` defines a hostname-specific WAF rule: visitors to `unrot.abhi.now` receive a **Managed Challenge**, except Cloudflare-verified bots. Other hostnames are unaffected. Browser clearance also covers API requests and video ranges; clients without clearance may receive a challenge page. The archive displays a refresh instruction when an API request is challenged. Worker `workers.dev` and preview URLs are disabled to prevent an alternate hostname bypass.

Wrangler OAuth cannot edit WAF rules. Create a Cloudflare API token with **Zone → Zone WAF → Edit**, limited to `abhi.now`, and save its value to the gitignored `.unrot/cloudflare-api-token` (or set `CLOUDFLARE_API_TOKEN` in your shell). Keep the token local.

```sh
chmod 600 .unrot/cloudflare-api-token
pnpm cloudflare:challenge --dry-run
pnpm cloudflare:challenge
pnpm cloudflare:challenge --check
```

The command adds or updates only the rule with ref `unrot_managed_challenge`, preserving existing zone rules. Repeating it makes no changes when the rule is already correct. Challenge configuration is separate from Worker deployment and content publishing. See [Cloudflare custom rules](https://developers.cloudflare.com/waf/custom-rules/create-api/) and [challenge response detection](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/).

## Backup and restore

Stop development first; these commands take the curator and publishing locks.

```sh
pnpm backup backups/my-archive
pnpm restore backups/my-archive
# Deliberately replace existing local metadata:
pnpm restore backups/my-archive --replace
```

Backups contain portable JSON metadata and all downloaded originals/previews, including archived objects no longer referenced by current posts. They exclude API configuration/keys, browser profiles/cookies, and signed source URLs. Restore verifies hashes before replacement, applies metadata in an atomic D1 batch, restores local R2 objects, and recovers interrupted jobs. Production is untouched. Reconnect Instagram after moving to another computer.

## Public archive

- `GET /api/posts?tag=ID&tag=ID&match=any|all&cursor=CURSOR`: 24 posts per batch, publication date descending with stable ID tie-breaking. No tags means all posts; default matching is Any.
- `GET /api/tags`: tags attached to visible publications.
- `GET /api/posts/:id` and `/posts/:id`: published detail data and shareable standalone pages.
- `GET /media/objects/:hash.ext` and `HEAD`: visible-post assets only, media MIME types, ETags, Last-Modified, single byte ranges, If-Range, and conditional reads.

Cards use orientation-based grid spans. Native dialogs update browser history and restore focus/scroll on close. Ordered carousels pause video on navigation/close and never autoplay. Refine filters persist in URL parameters. Infinite scrolling has a manual continuation/retry fallback. Empty, loading, retry, and unavailable-post states are included.

## Validation

```sh
pnpm check
pnpm test
pnpm build
pnpm test:browser
pnpm test:cloud
```

`pnpm test` uses isolated local Cloudflare D1/R2 instances and media fixtures. Coverage includes pagination/deduplication, interruption/session expiry, edits/ignored records, Cobalt variants, real Sharp/FFmpeg processing of images/reels/mixed carousels, fallback/stale URLs, tags/revisions, publishing failures/retries/idempotency, filters/cursors, media conditions/ranges, origin checks, and backup restoration.

`pnpm test:browser` requires a current production build. It loads the compiled code into a separate harness with temporary storage and explicitly local D1/R2 fixture bindings. It does not inherit production account/resource configuration from the build. Checks cover desktop/mobile layout, Any/All filters and URL restoration, pagination, history/focus, sanitization, carousel playback/seeking, permalinks, and production 404s. Screenshots go to gitignored `test-results/`. Add `--keep-open` to keep the fixture preview available for inspection.

`pnpm test:cloud` creates temporary remote D1/R2 resources in the authenticated Wrangler account, tests upload interruption, metadata failure, retry, repeat publishing, editing, and unpublishing, then empties/deletes those resources. It never writes fixtures to production.

Instagram's web response shapes are undocumented. Setup is an explicit integration checkpoint; unrecognized pagination fails without claiming completeness. For diagnostics, `pnpm exec tsx scripts/diagnose-instagram.ts <url> <collection-or-post-id>` prints response shapes and media availability without cookies, request tokens, captions, or signed URLs.

## Local data

| Location | Contents |
| --- | --- |
| `.wrangler/state/v3` | Persistent local D1/R2 state shared by Astro and the Node bridge |
| `.unrot/config.json` | Local collection and Cobalt configuration |
| `.unrot/instagram-profile` | Dedicated Chromium profile; never exported or deployed |
| `.unrot/assets/objects` | Immutable content-hashed originals/previews |
| `.unrot/*.lock` | Curator, browser-profile, and publishing locks |

All these paths are gitignored. Public migrations contain only `live_*` tables; review/download state, tag changes, revisions, and sync runs use a separate local schema. V1 assumes one account, one collection, and one curation computer.
