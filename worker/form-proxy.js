// MyGreekTax edge form proxy (core logic)
//
// WHY THIS EXISTS: the Make webhook URLs used to sit in the page source, as
// the consultation form action= and as WEBHOOK_URL in NewsletterPopup.astro.
// Scrapers picked them up and every junk POST cost a Make operation. Make
// bills the gateway:CustomWebHook trigger the moment a request lands, BEFORE
// the "Real submission only" router filter runs, so filtering inside the
// scenario never saved the operation.
//
// Everything below runs at the Cloudflare edge and decides whether a request
// is worth an operation. Only survivors are forwarded to Make. The real hook
// URLs live in encrypted Worker secrets and are never served to a browser.
//
// Secrets expected (Worker settings, Variables and secrets):
//   MAKE_FORM_WEBHOOK        consultation form hook
//   MAKE_NEWSLETTER_WEBHOOK  newsletter popup hook
//   TURNSTILE_SECRET_KEY     optional. Verification is SKIPPED when unset,
//                            so the proxy can go live before the widget does.

const ALLOWED_ORIGINS = [
  "https://mygreektax.eu",
  "https://www.mygreektax.eu",
];

// Mirrors the regex in the Make router filter. Keep the two in sync: the
// scenario filter stays as a second line of defence.
const STATUS_VALUES = new Set([
  "Yes, in Greece",
  "Planning to move",
  "Leaving Greece",
  "Other",
]);

const REFERRAL_VALUES = new Set([
  "Google or another search engine",
  "AI assistant (ChatGPT, Claude, etc.)",
  "Facebook group or page",
  "Reddit",
  "Recommendation from someone",
  "Other",
]);

const URGENCY_VALUES = new Set(["Within a week", "This month", "Just exploring"]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Whitelist of fields forwarded to Make, with hard length caps. Anything not
// listed (hp_company, _subject, cf-turnstile-response, injected junk) is
// dropped, so the Make data structure never sees a surprise key.
const LEAD_FIELDS = {
  name: 200,
  email: 200,
  phone: 50,
  status: 60,
  situation: 4000,
  urgency: 40,
  referral_source: 80,
  referral_other: 200,
  llm_name: 40,
  llm_question: 1000,
};

const MAX_BODY_BYTES = 32 * 1024;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Same origin POSTs carry an Origin header in every current browser. Some
// privacy setups strip it, so fall back to Referer before rejecting.
function originAllowed(request) {
  const origin = request.headers.get("origin");
  if (origin) return ALLOWED_ORIGINS.includes(origin);
  const referer = request.headers.get("referer") || "";
  return ALLOWED_ORIGINS.some((allowed) => referer.startsWith(allowed + "/"));
}

// index.astro posts FormData (multipart), NewsletterPopup.astro posts
// URLSearchParams. JSON is accepted too, so the endpoint can be curl tested.
async function readFields(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    return body && typeof body === "object" ? body : {};
  }
  const form = await request.formData();
  const fields = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function tooLarge(request) {
  const length = Number(request.headers.get("content-length") || 0);
  return length > MAX_BODY_BYTES;
}

async function verifyTurnstile(token, ip, secret) {
  if (!secret) return true; // widget not deployed yet
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const result = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  ).catch(() => null);
  if (!result) return false;
  const data = await result.json().catch(() => ({ success: false }));
  return data.success === true;
}

async function forward(webhookUrl, params) {
  const upstream = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  }).catch(() => null);
  return Boolean(upstream && upstream.ok);
}

// ------------------------------------------------- consultation form

export async function handleLead(request, env) {
  if (!env.MAKE_FORM_WEBHOOK) {
    console.error("[form-proxy] MAKE_FORM_WEBHOOK not configured");
    return json({ ok: false, error: "Server configuration error" }, 500);
  }
  if (!originAllowed(request)) return json({ ok: false, error: "Forbidden" }, 403);
  if (tooLarge(request)) return json({ ok: false, error: "Payload too large" }, 413);

  let fields;
  try {
    fields = await readFields(request);
  } catch {
    return json({ ok: false, error: "Invalid body" }, 400);
  }

  // Honeypot (hp_company in index.astro). Answer 200 so the bot records a
  // success and moves on, but spend nothing upstream.
  if (clean(fields.hp_company, 100)) return json({ ok: true });

  const passedTurnstile = await verifyTurnstile(
    clean(fields["cf-turnstile-response"], 4000),
    request.headers.get("cf-connecting-ip"),
    env.TURNSTILE_SECRET_KEY,
  );
  if (!passedTurnstile) {
    return json({ ok: false, error: "Verification failed, please try again" }, 403);
  }

  const values = {};
  for (const [key, maxLength] of Object.entries(LEAD_FIELDS)) {
    values[key] = clean(fields[key], maxLength);
  }

  if (!values.name || !values.email || !values.situation) {
    return json({ ok: false, error: "Missing required fields" }, 400);
  }
  if (!EMAIL_PATTERN.test(values.email)) {
    return json({ ok: false, error: "Invalid email" }, 400);
  }
  if (!STATUS_VALUES.has(values.status)) {
    return json({ ok: false, error: "Invalid status" }, 400);
  }
  if (!REFERRAL_VALUES.has(values.referral_source)) {
    return json({ ok: false, error: "Invalid referral source" }, 400);
  }
  if (values.urgency && !URGENCY_VALUES.has(values.urgency)) values.urgency = "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.append(key, value);
  }

  const delivered = await forward(env.MAKE_FORM_WEBHOOK, params);
  if (!delivered) {
    console.error("[form-proxy] upstream rejected lead", { email: values.email });
    return json({ ok: false, error: "Upstream error" }, 502);
  }
  return json({ ok: true });
}

// ------------------------------------------------------ newsletter popup

export async function handleSubscribe(request, env) {
  if (!env.MAKE_NEWSLETTER_WEBHOOK) {
    console.error("[form-proxy] MAKE_NEWSLETTER_WEBHOOK not configured");
    return json({ ok: false, error: "Server configuration error" }, 500);
  }
  if (!originAllowed(request)) return json({ ok: false, error: "Forbidden" }, 403);
  if (tooLarge(request)) return json({ ok: false, error: "Payload too large" }, 413);

  let fields;
  try {
    fields = await readFields(request);
  } catch {
    return json({ ok: false, error: "Invalid body" }, 400);
  }

  // Honeypot field in NewsletterPopup.astro is named mgt_hp. It exists in the
  // markup but was never transmitted, because the popup builds its body by
  // hand. The site edit adds it to the payload so this check does something.
  if (clean(fields.mgt_hp, 100)) return json({ ok: true });

  const email = clean(fields.email, 200);
  if (!EMAIL_PATTERN.test(email)) {
    return json({ ok: false, error: "Invalid email" }, 400);
  }
  const source = clean(fields.source, 60) || "homepage_popup";

  const params = new URLSearchParams();
  params.append("email", email);
  params.append("source", source);

  const delivered = await forward(env.MAKE_NEWSLETTER_WEBHOOK, params);
  if (!delivered) {
    console.error("[form-proxy] upstream rejected subscribe");
    return json({ ok: false, error: "Upstream error" }, 502);
  }
  return json({ ok: true });
}
