# site-mygreektax

Astro rebuild of mygreektax.eu — marketing site + blog, with Sveltia CMS for editing blog posts via GitHub.

## Stack

- **Astro 6** (static output)
- **Sveltia CMS** at `/admin` — Decap-compatible, git-based, no database
- **Cloudflare Pages** for hosting + a small **Cloudflare Worker** for the CMS's GitHub OAuth handshake

## Local development

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
npm run preview
```

## Project structure

- `src/pages/index.astro` — homepage (ported 1:1 from the live site)
- `src/pages/blog/index.astro` — blog listing
- `src/pages/blog/[...slug].astro` — individual post route, reads from the `blog` content collection
- `src/content/blog/*.md` — blog posts (edit directly, or via `/admin`)
- `src/content/config.ts` — schema for blog post frontmatter
- `src/layouts/`, `src/components/` — shared layout, header, footer, newsletter popup
- `public/admin/` — Sveltia CMS (config.yml + loader)

## Adding/editing blog posts

Two ways:
1. **Via the CMS** at `https://mygreektax.eu/admin` once deployed (see below) — log in with GitHub, edit posts in a form, it commits to this repo automatically and Cloudflare redeploys.
2. **Directly**: add a new `.md` file to `src/content/blog/` with frontmatter matching `src/content/config.ts` (title, description, category, pubDate, draft, etc.), commit, push.

## Deploying — first time setup

### 1. Push this repo to GitHub

```bash
git init
git add -A
git commit -m "Initial Astro site"
git branch -M main
git remote add origin https://github.com/dimitriosg/site-mygreektax.git
git push -u origin main
```

### 2. Connect Cloudflare Pages

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git** → select `dimitriosg/site-mygreektax`.

Build settings:
- Framework preset: **Astro**
- Build command: `npm run build`
- Build output directory: `dist`

Add the custom domain `mygreektax.eu` (and `www`) once the deploy succeeds, then update DNS/nameservers if not already on Cloudflare.

### 3. Deploy the Sveltia CMS OAuth Worker

The CMS needs a tiny Cloudflare Worker to complete the GitHub OAuth login flow (Cloudflare Pages alone can't do this).

1. Go to https://github.com/sveltia/sveltia-cms-auth and click **Deploy to Cloudflare Workers**. This deploys the worker to your Cloudflare account and gives you a URL like `https://sveltia-cms-auth.<your-subdomain>.workers.dev`.
2. Create a **GitHub OAuth App**: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
   - Homepage URL: `https://mygreektax.eu`
   - Authorization callback URL: `https://sveltia-cms-auth.<your-subdomain>.workers.dev/callback`
3. Copy the OAuth App's **Client ID** and **Client Secret**.
4. In the Cloudflare Worker's settings (Settings → Variables), add:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `ALLOWED_DOMAINS` = `mygreektax.eu` (restricts login to your domain)
5. Edit `public/admin/config.yml` in this repo: set `backend.base_url` to your Worker URL (the same one from step 1). Commit and push.

### 4. Use the CMS

Visit `https://mygreektax.eu/admin`, click **Login with GitHub**, authorize, and you'll see the blog post editor. Saving a post commits straight to the `main` branch and Cloudflare Pages redeploys automatically (usually under a minute).

## Notes

- The brand colors/fonts in `src/styles/global.css` were taken from the live site's actual CSS, which differs slightly from the original brand-guide doc (palette: night `#1E2A3A`, amber `#C9923A`, sage `#6B8F71`; fonts: Playfair Display + DM Sans). Treat this CSS as the source of truth going forward.
- The consultation form posts to Formspree; the newsletter popup posts to a Make.com webhook. Both are unchanged from the live site — no backend needed.
- `digital-nomad-greece-taxes.md` is a draft stub (`draft: true`) for the "coming soon" post already teased on the live blog index. Flip `draft: false` and fill in content when ready.
