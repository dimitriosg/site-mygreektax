// Worker entry point for site-mygreektax.
//
// Astro builds the static site into ./dist and Cloudflare serves it from the
// ASSETS binding. This script exists only to own /api/lead and /api/subscribe,
// which hold the Make webhook URLs as secrets instead of shipping them in the
// page source.
//
// wrangler.jsonc sets "run_worker_first": ["/api/*"], so every other request
// is served straight from static assets and never invokes this Worker. That
// keeps Worker invocations to form submissions only.
import { handleLead, handleSubscribe } from "./form-proxy.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/lead" || pathname === "/api/subscribe") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "POST" },
        });
      }
      return pathname === "/api/lead"
        ? handleLead(request, env)
        : handleSubscribe(request, env);
    }

    // Anything else: hand back to the static asset server.
    return env.ASSETS.fetch(request);
  },
};
