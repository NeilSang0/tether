// tether worker: a mailbox between your phone and your own machine.
// Phone side  (signed cookie):  read answers, ask a question.
// Machine side (x-tether-key):  pull queued questions, post answers.
// Storage is one KV namespace: "hb" (machine heartbeat) and "ask:<id>" records.
// There is no model binding here and there never will be one: this worker does
// no inference, so it costs nothing per message beyond a KV read and write.
import { APP_HTML, LOCKED_HTML } from "./page.js";
import { ICON } from "./icon.js";

const enc = new TextEncoder();
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Length-independent compare is not possible without leaking length; keys are
// fixed-length hex, so a length mismatch is already a failure.
function same(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function isOwner(req, env) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)tether_s=([a-f0-9]{64})/);
  return !!m && same(m[1], await hmac(env.OWNER_KEY, "owner-v1"));
}
const isMachine = (req, env) => same(req.headers.get("x-tether-key"), env.MACHINE_KEY);

const SEC = {
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...SEC, "content-type": "application/json" } });
const html = (s, status = 200) => new Response(s, { status, headers: { ...SEC, "content-type": "text/html; charset=utf-8" } });

// Ids sort newest first: KV lists keys in ascending order.
const newId = () => String(9999999999999 - Date.now()).padStart(13, "0") + "-" + crypto.randomUUID().slice(0, 6);

async function listAsks(env, limit = 40) {
  const l = await env.TETHER_KV.list({ prefix: "ask:", limit });
  const vals = await Promise.all(l.keys.map((k) => env.TETHER_KV.get(k.name, "json")));
  return vals.filter(Boolean);
}

// Cloudflare's KV free plan allows 1,000 writes and 1,000 list operations a day, and both
// are per namespace. A listener that wrote a heartbeat and listed the keyspace on every poll
// would exhaust both inside six hours having answered nothing, so the queue is kept in two
// small keys instead: "q" is the ids waiting, "ctx" is the last few answered pairs. An idle
// poll then reads two keys and writes nothing, and a list operation happens only when the
// owner opens the page. Reads are 100,000 a day, which a 30 second poll cannot reach.
const Q_KEY = "q", CTX_KEY = "ctx", HB_EVERY = 300e3;

async function qRead(env) {
  const v = await env.TETHER_KV.get(Q_KEY, "json");
  return Array.isArray(v) ? v : [];
}
const qWrite = (env, ids) => env.TETHER_KV.put(Q_KEY, JSON.stringify(ids.slice(0, 200)));

async function createAsk(env, text, project) {
  const id = newId();
  const rec = { id, text, project: project || null, status: "queued", answer: null, at: Date.now(), doneAt: null };
  await env.TETHER_KV.put("ask:" + id, JSON.stringify(rec), { metadata: { status: "queued" }, expirationTtl: 60 * 60 * 24 * 30 });
  const ids = await qRead(env);
  if (!ids.includes(id)) await qWrite(env, [...ids, id]);
  return rec;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (!env.OWNER_KEY || !env.MACHINE_KEY) {
      return json({ error: "OWNER_KEY and MACHINE_KEY are not set on this worker. Run: tether deploy" }, 500);
    }

    if (p === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
    if (p === "/icon.png") {
      return new Response(Uint8Array.from(atob(ICON), (c) => c.charCodeAt(0)), { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
    }
    if (p === "/manifest.webmanifest") {
      return new Response(JSON.stringify({
        name: env.TETHER_NAME || "tether", short_name: env.TETHER_NAME || "tether",
        start_url: "/", scope: "/", display: "standalone",
        background_color: "#101a20", theme_color: "#101a20",
        icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }],
      }), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
    }

    // Login: /login?k=<owner key>, or paste the key into the form.
    if (p === "/login") {
      let k = url.searchParams.get("k");
      if (req.method === "POST") k = String((await req.formData()).get("k") || "").trim();
      if (k && same(k, env.OWNER_KEY)) {
        const tok = await hmac(env.OWNER_KEY, "owner-v1");
        return new Response(null, { status: 303, headers: { ...SEC, location: "/", "set-cookie": `tether_s=${tok}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict` } });
      }
      return html(LOCKED_HTML.replace("{{msg}}", k ? "That key did not work." : ""), k ? 401 : 200);
    }
    if (p === "/logout") {
      return new Response(null, { status: 303, headers: { ...SEC, location: "/login", "set-cookie": "tether_s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict" } });
    }

    // Machine side.
    if (p.startsWith("/api/m/")) {
      if (!isMachine(req, env)) return json({ error: "unauthorized" }, 401);

      if (p === "/api/m/queue" && req.method === "GET") {
        const [ids, ctx, hb] = await Promise.all([qRead(env), env.TETHER_KV.get(CTX_KEY, "json"), env.TETHER_KV.get("hb")]);
        // The heartbeat is throttled, not written every poll: see the note above Q_KEY.
        if (Date.now() - Number(hb || 0) > HB_EVERY) await env.TETHER_KV.put("hb", String(Date.now()));
        const first = ids.length ? await env.TETHER_KV.get("ask:" + ids[0], "json") : null;
        const items = first && first.status === "queued" ? [first] : [];
        // A record that expired or was already answered leaves a dead id behind; drop it so the
        // next poll looks at the real head of the queue.
        if (ids.length && !items.length) await qWrite(env, ids.slice(1));
        return json({ items, recent: Array.isArray(ctx) ? ctx : [] });
      }

      if (p === "/api/m/update" && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        const key = "ask:" + String(b.id || "");
        const cur = await env.TETHER_KV.get(key, "json");
        if (!cur) return json({ error: "not found" }, 404);
        const status = ["doing", "done", "failed"].includes(b.status) ? b.status : "done";
        const next = {
          ...cur, status,
          answer: b.answer != null ? String(b.answer).slice(0, 16000) : cur.answer,
          doneAt: status === "doing" ? null : Date.now(),
        };
        await env.TETHER_KV.put(key, JSON.stringify(next), { metadata: { status }, expirationTtl: 60 * 60 * 24 * 30 });
        if (status !== "doing") {
          const ids = (await qRead(env)).filter((x) => x !== cur.id);
          await qWrite(env, ids);
          if (status === "done") {
            const ctx = await env.TETHER_KV.get(CTX_KEY, "json");
            const pairs = [{ q: next.text, a: next.answer }, ...(Array.isArray(ctx) ? ctx : [])].slice(0, 4);
            await env.TETHER_KV.put(CTX_KEY, JSON.stringify(pairs));
          }
        }
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    }

    // Phone side.
    const owner = await isOwner(req, env);
    if (p === "/") {
      return owner ? html(APP_HTML.replace(/\{\{name\}\}/g, (env.TETHER_NAME || "tether").slice(0, 24))) : new Response(null, { status: 303, headers: { ...SEC, location: "/login" } });
    }
    if (!owner) return json({ error: "unauthorized" }, 401);

    if (p === "/api/state" && req.method === "GET") {
      const [hb, asks] = await Promise.all([env.TETHER_KV.get("hb"), listAsks(env, 40)]);
      return json({ hb: Number(hb || 0), asks, now: Date.now(), projects: String(env.TETHER_PROJECTS || "").split(",").filter(Boolean) });
    }
    if (p === "/api/ask" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const text = String(b.text || "").trim().slice(0, 6000);
      if (!text) return json({ error: "empty" }, 400);
      return json({ ok: true, ask: await createAsk(env, text, b.project ? String(b.project).slice(0, 80) : null) });
    }
    if (p === "/api/ask" && req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (id && /^[0-9]{13}-[a-f0-9]{6}$/.test(id)) {
        await env.TETHER_KV.delete("ask:" + id);
        const ids = await qRead(env);
        if (ids.includes(id)) await qWrite(env, ids.filter((x) => x !== id));
      }
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  },
};
