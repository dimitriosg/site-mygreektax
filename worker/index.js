// Worker entry point for site-mygreektax.
//
// Astro builds the static site into ./dist and Cloudflare serves it from the
// ASSETS binding. This script exists only to own /api/*, which holds the Make
// webhook URLs as secrets instead of shipping them in the page source.
//
// wrangler.jsonc sets "run_worker_first": ["/api/*"], so every other request
// is served straight from static assets and never invokes this Worker. That
// keeps Worker invocations to form submissions only.
//
// TRAILING SLASH: astro.config.mjs sets trailingSlash: "always", and the
// Cloudflare asset server normalises bare paths with a 301/308 to the slashed
// form. If run_worker_first is ever not in effect, /api/lead gets redirected
// before this code sees it. Accepting both spellings costs one line and
// removes a whole class of confusing failure.
import { handleLead, handleSubscribe } from "./form-proxy.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Diagnostic. Proves the Worker is being invoked and reports which secrets
    // are present. Reports booleans only, never values.
    if (path === "/api/health") {
      return Response.json({
        ok: true,
        worker: "live",
        secrets: {
          MAKE_FORM_WEBHOOK: Boolean(env.MAKE_FORM_WEBHOOK),
          MAKE_NEWSLETTER_WEBHOOK: Boolean(env.MAKE_NEWSLETTER_WEBHOOK),
          TURNSTILE_SECRET_KEY: Boolean(env.TURNSTILE_SECRET_KEY),
        },
      });
    }

    if (path === "/api/lead" || path === "/api/subscribe") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "POST" },
        });
      }
      return path === "/api/lead"
        ? handleLead(request, env)
        : handleSubscribe(request, env);
    }

    // Anything else: hand back to the static asset server.
    return env.ASSETS.fetch(request);
  },
};
