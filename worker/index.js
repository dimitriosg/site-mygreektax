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
import { handleLead, handleSubscribe, newsletterTargets } from "./form-proxy.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Diagnostic. Proves the Worker is being invoked and reports which secrets
    // are present. Webhook and Turnstile secrets are reported as booleans only,
    // never values. NEWSLETTER_TARGET is echoed in full on purpose: it is held
    // as a Secret for durability against deploys, not because it is sensitive.
    //
    // newsletterTargetSource distinguishes "NEWSLETTER_TARGET says make" from
    // "the binding is absent and make is the fallback". Those two look
    // identical in newsletterTarget alone, which is what made a wiped variable
    // read as a deliberate setting. It tests for the binding existing rather
    // than for a truthy value, so an empty string reads as configured-but-empty
    // instead of masquerading as absent.
    //
    // newsletterTarget echoes the normalised value as set, and is deliberately
    // NOT coerced to one of the two known names: a typo needs to be visible
    // here rather than silently rounded to "make". newsletterOrder is then the
    // honest answer to "where does a signup actually go", because it reflects
    // the real ordering after the configured-URL filter. It holds only the
    // names "n8n" and "make", never a webhook URL.
    if (path === "/api/health") {
      return Response.json({
        ok: true,
        worker: "live",
        secrets: {
          MAKE_FORM_WEBHOOK: Boolean(env.MAKE_FORM_WEBHOOK),
          MAKE_NEWSLETTER_WEBHOOK: Boolean(env.MAKE_NEWSLETTER_WEBHOOK),
          N8N_NEWSLETTER_WEBHOOK: Boolean(env.N8N_NEWSLETTER_WEBHOOK),
          TURNSTILE_SECRET_KEY: Boolean(env.TURNSTILE_SECRET_KEY),
        },
        newsletterTarget: String(env.NEWSLETTER_TARGET || "make")
          .trim()
          .toLowerCase(),
        newsletterTargetSource:
          typeof env.NEWSLETTER_TARGET === "undefined" ? "default" : "configured",
        newsletterOrder: newsletterTargets(env).map(([name]) => name),
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
