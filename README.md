# site-mygreektax

Astro rebuild of mygreektax.eu: marketing site and blog, with Sveltia CMS for editing blog posts via GitHub.

## Stack

- **Astro** (static output, builds to `dist/`)
- **Sveltia CMS** at `/admin`, Decap-compatible, git-based, no database
- **Cloudflare Worker with static assets** for hosting, deployed with `wrangler deploy`
- A small **Cloudflare Worker** (`cms-oauth-worker/`) for the CMS's GitHub OAuth handshake

The site Worker also owns `/api/*`, which proxies the two form submissions to Make so the webhook URLs stay out of the page source. See "Form endpoints" below.

## Local development

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
npm run preview
```

## Project structure

- `src/pages/index.astro`, homepage (ported 1:1 from the live site)
- `src/pages/blog/index.astro`, blog listing
- `src/pages/blog/[...slug].astro`, individual post route, reads from the `blog` content collection
- `src/content/blog/*.md`, blog posts (edit directly, or via `/admin`)
- `src/content/config.ts`, schema for blog post frontmatter
- `src/layouts/`, `src/components/`, shared layout, header, footer, newsletter popup
- `public/admin/`, Sveltia CMS (config.yml + loader)
- `worker/index.js`, Worker entry point, owns `/api/*` and hands everything else to static assets
- `worker/form-proxy.js`, validation and forwarding logic for the two form endpoints
- `wrangler.jsonc`, Worker config: name, entry point, assets directory, route behaviour
- `cms-oauth-worker/`, separate Worker for the CMS OAuth flow, deployed independently

## Form endpoints

Both forms post to same-origin paths, never directly to Make or n8n. The webhook URLs live in encrypted Worker secrets.

| Path | Source | Forwards to |
|---|---|---|
| `/api/lead` | consultation form in `index.astro` | `MAKE_FORM_WEBHOOK` |
| `/api/subscribe` | newsletter popup in `NewsletterPopup.astro` | whichever of `N8N_NEWSLETTER_WEBHOOK` or `MAKE_NEWSLETTER_WEBHOOK` is selected by `NEWSLETTER_TARGET`, with automatic failover to the other on any non-2xx |
| `/api/health` | diagnostic, GET only | nothing, reports which secrets are set and where a signup would actually go |

`NEWSLETTER_TARGET` selects the primary newsletter platform: `n8n` puts n8n first and Make on standby, `make` (the fallback when the variable is absent) puts Make first and n8n on standby. The platform that is not in charge stays a live standby: if the primary does not answer 2xx the other is tried immediately, so a restart of the n8n host does not lose a signup. Both paths are idempotent, so the retry cannot produce a duplicate subscriber.

Requests are rejected at the edge, before any Make operation is spent, when: the origin is not allowed, the honeypot field is filled (`hp_company` on the form, `mgt_hp` on the popup), the Turnstile token is missing or invalid, a required field is absent, the email fails a format check, or `status` / `referral_source` fall outside the allowed values. The allowed value lists mirror the router filter in the Make scenario, so keep the two in sync.

`wrangler.jsonc` sets `"run_worker_first": ["/api/*"]`. Every other request is served straight from static assets and never invokes the Worker.

### Secrets

Set these on the Worker (Settings, Variables and secrets) as **Secret**, not plaintext. They are never in this repo.

| Name | Purpose |
|---|---|
| `MAKE_FORM_WEBHOOK` | consultation form hook |
| `MAKE_NEWSLETTER_WEBHOOK` | newsletter popup hook, Make |
| `N8N_NEWSLETTER_WEBHOOK` | newsletter popup hook, n8n production webhook URL |
| `NEWSLETTER_TARGET` | `n8n` or `make`, selects the primary newsletter platform. Falls back to `make` when absent |
| `TURNSTILE_SECRET_KEY` | Turnstile verification. When unset, verification is skipped, which is the intended way to stage a rollout or to disable Turnstile fast without a deploy |

`NEWSLETTER_TARGET` must be stored as a **Secret** even though its value is not sensitive, because `wrangler deploy` deletes plaintext variables that are absent from `wrangler.jsonc` and Workers Builds runs it on every push to `main`, whereas secrets are never deleted by a deployment. Setting it as a plaintext variable is how it silently reverted to `make` once already. `wrangler.jsonc` also sets `"keep_vars": true` as a second line of defence for any plaintext variable added later.

Because the value is not sensitive, `/api/health` reports it back in full, along with whether it was configured or defaulted.

The Turnstile **site key** is public by design and is hardcoded in `index.astro`. Only the secret key is sensitive.

There is also a WAF rate limiting rule on the zone covering POSTs to `/api/`, configured in the Cloudflare dashboard rather than in this repo.

## Adding and editing blog posts

Two ways:

1. **Via the CMS** at `https://mygreektax.eu/admin`, log in with GitHub, edit posts in a form, it commits to this repo automatically and Cloudflare redeploys.
2. **Directly**: add a new `.md` file to `src/content/blog/` with frontmatter matching `src/content/config.ts` (title, description, category, pubDate, draft, and so on), commit, push.

## Deploying

### How it works now

The site is a Cloudflare **Worker**, not a Pages project. Cloudflare Workers Builds is connected to this repo and runs, on every push to `main`:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

`wrangler deploy` reads `wrangler.jsonc`, which must contain:

- `name`, matching the existing Worker name in the dashboard exactly. A different name silently creates a second Worker while the custom domain stays on the old one.
- `main`, the Worker entry point (`worker/index.js`). If this file is missing the deploy fails with "entry-point file not found" and Cloudflare keeps serving the previous version.
- `assets.directory` (`./dist`) and `assets.binding` (`ASSETS`)
- `assets.run_worker_first`, listing `/api/*`

A healthy deploy log shows `Uploaded site-mygreektax`, `env.ASSETS` in the bindings list, and `Deployed site-mygreektax triggers`.

Branch builds are enabled, so push to a branch and check the preview before merging to `main`.

### Verifying a deploy

```bash
curl -sS https://mygreektax.eu/api/health
```

Expect `{"ok":true,"worker":"live","secrets":{...}}` with all four booleans true, plus three newsletter fields:

- `newsletterTarget`, the configured value trimmed and lowercased, normally `"n8n"` or `"make"`. It is echoed as set rather than coerced, so a typo shows up here instead of being silently rounded to `make`
- `newsletterTargetSource`, `"configured"` when `NEWSLETTER_TARGET` exists on the Worker, `"default"` when the binding is absent and `make` is only the fallback. It tests for the binding, not for a truthy value, so an empty setting reads as `configured` with an empty target rather than pretending to be absent
- `newsletterOrder`, the platforms a signup is actually tried against, in order, e.g. `["n8n","make"]`. Names only, never URLs

Read them together:

- `newsletterTargetSource: "default"` on a Worker that is supposed to be on n8n means the value is missing, not that somebody chose Make.
- `newsletterTarget` showing anything other than `n8n` or `make` is a typo. `newsletterOrder` tells you what it is actually doing, which is Make first, since only `n8n` selects n8n.
- `newsletterOrder` shorter than two entries means one of the two webhook secrets is missing and there is no failover. `[]` means neither is set and `/api/subscribe` is returning 500.

### Sveltia CMS OAuth Worker

The CMS needs a small Worker to complete the GitHub OAuth login flow. It lives in `cms-oauth-worker/` with its own `wrangler.toml` and is deployed independently of the site.

1. Deploy from https://github.com/sveltia/sveltia-cms-auth. You get a URL like `https://sveltia-cms-auth.<your-subdomain>.workers.dev`.
2. Create a **GitHub OAuth App**: GitHub, Settings, Developer settings, OAuth Apps, New OAuth App.
   - Homepage URL: `https://mygreektax.eu`
   - Authorization callback URL: `https://sveltia-cms-auth.<your-subdomain>.workers.dev/callback`
3. Copy the OAuth App's **Client ID** and **Client Secret**.
4. In that Worker's settings (Settings, Variables), add:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `ALLOWED_DOMAINS` = `mygreektax.eu` (restricts login to your domain)
5. Edit `public/admin/config.yml`: set `backend.base_url` to your Worker URL. Commit and push.

### Using the CMS

Visit `https://mygreektax.eu/admin`, click **Login with GitHub**, authorize, and the blog post editor appears. Saving a post commits straight to `main` and Cloudflare redeploys automatically, usually under a minute.

## Notes

- The brand colours and fonts in `src/styles/global.css` were taken from the live site's actual CSS, which differs slightly from the original brand-guide doc (palette: night `#1E2A3A`, amber `#C9923A`, sage `#6B8F71`; fonts: Playfair Display + DM Sans). Treat this CSS as the source of truth going forward.
- `digital-nomad-greece-taxes.md` is a draft stub (`draft: true`) for the "coming soon" post already teased on the live blog index. Flip `draft: false` and fill in content when ready.
