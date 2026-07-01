const ALLOWED_ORIGINS = ["https://mygreektax.eu", "https://site-mygreektax.dimitriosg2002.workers.dev"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || ALLOWED_ORIGINS[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Step 1: redirect to GitHub
    if (url.pathname === "/auth") {
      const params = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        scope: "repo,user",
        state: crypto.randomUUID(),
      });
      return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
    }

    // Step 2: handle callback from GitHub
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const { access_token, error } = await tokenRes.json();
      if (error || !access_token) return new Response("OAuth error: " + error, { status: 400 });

      const script = `
        <script>
          (function() {
            window.opener.postMessage(
              'authorization:github:success:${JSON.stringify({ token: access_token, provider: "github" })}',
              '*'
            );
          })();
        </script>
      `;
      return new Response(script, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
