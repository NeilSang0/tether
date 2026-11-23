// Runs the real worker against an in-memory KV. No network, no Cloudflare, no
// account. Proves the auth boundary, the routing and the no-meter rule.
import worker from "../src/worker/index.js";
import { APP_HTML, LOCKED_HTML } from "../src/worker/page.js";
import { DEFAULT_TOOLS, toolsFor } from "../src/config.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); } catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); return; }
  pass++; console.log(`ok    ${name}`);
};
const ta = async (name, fn) => {
  try { await fn(); } catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); return; }
  pass++; console.log(`ok    ${name}`);
};

function kv() {
  const m = new Map(), meta = new Map();
  // Counts the operations Cloudflare charges a daily quota for, so a test can prove an idle
  // poll stays free instead of taking the code's word for it.
  const ops = { get: 0, put: 0, del: 0, list: 0 };
  return {
    async get(k, type) { ops.get++; const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v, o = {}) { ops.put++; m.set(k, v); if (o.metadata) meta.set(k, o.metadata); },
    async delete(k) { ops.del++; m.delete(k); meta.delete(k); },
    async list({ prefix = "", limit = 100 } = {}) {
      ops.list++;
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name, metadata: meta.get(name) })) };
    },
    _m: m,
    _ops: ops,
  };
}
const OWNER = "a".repeat(64), MACHINE = "b".repeat(64);
const mkEnv = () => ({ OWNER_KEY: OWNER, MACHINE_KEY: MACHINE, TETHER_KV: kv(), TETHER_NAME: "desk", TETHER_PROJECTS: "repo,notes" });
const hit = (env, path, init = {}) => worker.fetch(new Request("https://x.workers.dev" + path, init), env);

// ---- the rule that matters most: nothing in here meters.
t("no model binding anywhere in the worker or its config", () => {
  for (const f of readdirSync(join(ROOT, "src/worker"))) {
    const s = readFileSync(join(ROOT, "src/worker", f), "utf8");
    assert(!/env\.AI\b/.test(s), `${f} references env.AI`);
    assert(!/@cf\//.test(s), `${f} names a Workers AI model`);
    assert(!/\[ai\]/.test(s), `${f} declares an AI binding`);
  }
  const cli = readFileSync(join(ROOT, "src/cli.mjs"), "utf8");
  assert(!/\[ai\]/.test(cli), "the generated wrangler.toml declares an AI binding");
  assert(!/\bai\b\s*=|ai_binding/.test(cli.split("writeToml")[1].slice(0, 1200)), "the toml template may bind AI");
});

t("the default tool policy is read-only and has no shell", () => {
  assert.deepEqual(DEFAULT_TOOLS, ["Read", "Glob", "Grep"]);
  const { tools } = toolsFor({ projects: [{ name: "p", path: "/tmp/p" }] }, "p");
  assert(!tools.some((x) => /^(Bash|Edit|Write|NotebookEdit)/.test(x)), tools.join(" "));
});

t("reading is scoped to the project, so no path outside it is readable", () => {
  const { tools } = toolsFor({ projects: [{ name: "p", path: "/tmp/p/", tools: ["Read", "Glob", "Grep"] }] }, "p");
  assert.deepEqual(tools, ["Read(/tmp/p/**)", "Glob(/tmp/p/**)", "Grep(/tmp/p/**)"]);
  assert(!tools.includes("Read"), "an unscoped Read would reach the whole disk");
});

t("extra read directories are each scoped, not merged into a bare grant", () => {
  const { tools } = toolsFor({ projects: [{ name: "p", path: "/tmp/p", tools: ["Read"], readDirs: ["/tmp/notes/"] }] }, "p");
  assert.deepEqual(tools, ["Read(/tmp/p/**)", "Read(/tmp/notes/**)"]);
});

t("a tool that takes no path is granted bare", () => {
  const { tools } = toolsFor({ projects: [{ name: "p", path: "/tmp/p", tools: ["Read", "WebSearch"] }] }, "p");
  assert(tools.includes("WebSearch"));
  assert(tools.includes("Read(/tmp/p/**)"));
});

t("opting a project into writing scopes Edit and Write to that path only", () => {
  const { tools } = toolsFor({ projects: [{ name: "p", path: "/tmp/p/", write: true }] }, "p");
  assert(tools.includes("Edit(/tmp/p/**)"), tools.join(" "));
  assert(tools.includes("Write(/tmp/p/**)"), tools.join(" "));
  assert(!tools.some((x) => x.startsWith("Bash")), "shell leaked in");
});

t("the listener disallows Bash unless a project asked for it", () => {
  const s = readFileSync(join(ROOT, "src/listen.mjs"), "utf8");
  assert(/--disallowedTools", "Bash"/.test(s), "Bash is not explicitly disallowed");
  assert(/--allowedTools", \.\.\.tools/.test(s), "the allowlist is not passed");
});

// ---- the auth boundary
await ta("the phone app is not served without the cookie", async () => {
  const r = await hit(mkEnv(), "/");
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/login");
});

await ta("every phone api refuses an unsigned caller", async () => {
  const env = mkEnv();
  for (const p of ["/api/state", "/api/ask"]) {
    const r = await hit(env, p, { method: p === "/api/ask" ? "POST" : "GET" });
    assert.equal(r.status, 401, p + " answered " + r.status);
  }
});

await ta("every machine api refuses a wrong key", async () => {
  const env = mkEnv();
  for (const k of [null, "", "c".repeat(64), MACHINE.slice(0, 63)]) {
    const r = await hit(env, "/api/m/queue", { headers: k === null ? {} : { "x-tether-key": k } });
    assert.equal(r.status, 401, `key ${JSON.stringify(k)} answered ${r.status}`);
  }
});

await ta("the wrong owner key does not set a cookie", async () => {
  const r = await hit(mkEnv(), "/login?k=" + "z".repeat(64));
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);
});

await ta("the right owner key sets a hardened cookie", async () => {
  const r = await hit(mkEnv(), "/login?k=" + OWNER);
  assert.equal(r.status, 303);
  const c = r.headers.get("set-cookie");
  for (const f of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert(c.includes(f), `cookie lacks ${f}: ${c}`);
  assert(/tether_s=[a-f0-9]{64}/.test(c), "the cookie is not a 64-hex token");
  assert(!c.includes(OWNER), "the cookie contains the raw key");
});

await ta("a cookie minted for one owner key does not open another worker", async () => {
  const good = await hit(mkEnv(), "/login?k=" + OWNER);
  const cookie = good.headers.get("set-cookie").split(";")[0];
  const other = { ...mkEnv(), OWNER_KEY: "d".repeat(64) };
  const r = await hit(other, "/api/state", { headers: { cookie } });
  assert.equal(r.status, 401);
});

// ---- the round trip
await ta("a question asked on the phone comes back answered to the phone", async () => {
  const env = mkEnv();
  const login = await hit(env, "/login?k=" + OWNER);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const asked = await hit(env, "/api/ask", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ text: "what is left on the deploy", project: "repo" }),
  }).then((r) => r.json());
  assert(asked.ok && asked.ask.id, JSON.stringify(asked));
  assert.equal(asked.ask.status, "queued");

  const q = await hit(env, "/api/m/queue", { headers: { "x-tether-key": MACHINE } }).then((r) => r.json());
  assert.equal(q.items.length, 1);
  assert.equal(q.items[0].text, "what is left on the deploy");
  assert.equal(q.items[0].project, "repo");

  await hit(env, "/api/m/update", {
    method: "POST", headers: { "x-tether-key": MACHINE, "content-type": "application/json" },
    body: JSON.stringify({ id: asked.ask.id, status: "done", answer: "Two files. **NEXT:** run the audit." }),
  });

  const st = await hit(env, "/api/state", { headers: { cookie } }).then((r) => r.json());
  assert.equal(st.asks[0].status, "done");
  assert.equal(st.asks[0].answer, "Two files. **NEXT:** run the audit.");
  assert(st.hb > 0, "the machine heartbeat was not recorded");
  assert.deepEqual(st.projects, ["repo", "notes"]);

  const q2 = await hit(env, "/api/m/queue", { headers: { "x-tether-key": MACHINE } }).then((r) => r.json());
  assert.equal(q2.items.length, 0, "an answered question was handed out again");
});

await ta("an answer for an unknown id is refused, not created", async () => {
  const env = mkEnv();
  const r = await hit(env, "/api/m/update", {
    method: "POST", headers: { "x-tether-key": MACHINE, "content-type": "application/json" },
    body: JSON.stringify({ id: "0000000000000-aaaaaa", status: "done", answer: "x" }),
  });
  assert.equal(r.status, 404);
  assert.equal(env.TETHER_KV._m.size, 0, "it wrote something anyway");
});

await ta("delete only accepts a well-formed id", async () => {
  const env = mkEnv();
  const cookie = (await hit(env, "/login?k=" + OWNER)).headers.get("set-cookie").split(";")[0];
  await hit(env, "/api/ask", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "keep me" }) });
  const before = env.TETHER_KV._m.size;
  await hit(env, "/api/ask?id=" + encodeURIComponent("../hb"), { method: "DELETE", headers: { cookie } });
  assert.equal(env.TETHER_KV._m.size, before, "a malformed id deleted something");
});

await ta("an empty question is refused", async () => {
  const env = mkEnv();
  const cookie = (await hit(env, "/login?k=" + OWNER)).headers.get("set-cookie").split(";")[0];
  const r = await hit(env, "/api/ask", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "   " }) });
  assert.equal(r.status, 400);
});

await ta("the worker refuses to run with no keys set", async () => {
  const r = await hit({ TETHER_KV: kv() }, "/api/state");
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /OWNER_KEY and MACHINE_KEY/);
});

await ta("robots and headers keep it out of indexes", async () => {
  const env = mkEnv();
  assert.match(await (await hit(env, "/robots.txt")).text(), /Disallow: \/$/m);
  const l = await hit(env, "/login");
  assert.equal(l.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(l.headers.get("cache-control"), "private, no-store");
  assert.equal(l.headers.get("x-frame-options"), "DENY");
  assert.match(l.headers.get("content-security-policy"), /default-src 'none'/);
});

// ---- the page
t("the delivered phone script is valid JavaScript", () => {
  const js = APP_HTML.slice(APP_HTML.indexOf("<script>") + 8, APP_HTML.lastIndexOf("</script>"));
  new vm.Script(js);
  assert(js.includes("function send"), "the script lost its body");
});
t("the page loads nothing from a third party", () => {
  for (const [n, h] of [["app", APP_HTML], ["locked", LOCKED_HTML]]) {
    assert(!/https?:\/\//.test(h.replace(/https:\/\/x\.workers\.dev/g, "")), `${n} page fetches something remote`);
  }
});
t("answers are escaped before any markup is added back", () => {
  const js = APP_HTML.slice(APP_HTML.indexOf("function esc"), APP_HTML.indexOf("function ago"));
  const fmt = new Function(js + "; return fmt;")();
  assert.equal(fmt('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(fmt("**b**"), "<strong>b</strong>");
  assert(fmt("`a<b>`").includes("<code>a&lt;b&gt;</code>"));
});
t("dictation happens on the phone, not on a server", () => {
  assert(/SpeechRecognition/.test(APP_HTML), "no on-device dictation");
  assert(!/transcrib|whisper|\/api\/(voice|audio)/i.test(APP_HTML), "the page uploads audio somewhere");
});

// ---- Cloudflare's KV free plan: 1,000 writes and 1,000 list operations a day, per namespace.
// A listener polling every 30 seconds hits a poll 2,880 times a day, so anything the poll
// writes or lists unconditionally takes the whole quota before a single question is asked.
// These three tests are the reason the queue lives in two keys instead of the keyspace.
await ta("an idle poll writes nothing and lists nothing", async () => {
  const env = mkEnv();
  const mk = { headers: { "x-tether-key": MACHINE } };
  await hit(env, "/api/m/queue", mk);          // first poll writes the heartbeat once
  const after = { ...env.TETHER_KV._ops };
  for (let i = 0; i < 20; i++) await hit(env, "/api/m/queue", mk);
  const o = env.TETHER_KV._ops;
  assert.equal(o.put - after.put, 0, `20 idle polls wrote ${o.put - after.put} times`);
  assert.equal(o.list, 0, `the poll performed ${o.list} list operations`);
});

await ta("2,880 idle polls a day stay inside the free write and list quota", async () => {
  const env = mkEnv();
  const mk = { headers: { "x-tether-key": MACHINE } };
  let now = Date.now();
  const real = Date.now;
  try {
    Date.now = () => now;
    for (let i = 0; i < 2880; i++) { await hit(env, "/api/m/queue", mk); now += 30e3; }
  } finally { Date.now = real; }
  const o = env.TETHER_KV._ops;
  assert(o.put <= 1000, `a day of polling wrote ${o.put} times, the free plan allows 1000`);
  assert(o.list === 0, `a day of polling listed ${o.list} times`);
  assert(o.put >= 240, `the heartbeat stopped being written at all (${o.put} writes)`);
});

await ta("an answered question leaves nothing in the queue key", async () => {
  const env = mkEnv();
  const ck = (await hit(env, "/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "k=" + OWNER }))
    .headers.get("set-cookie").split(";")[0];
  const auth = { headers: { cookie: ck, "content-type": "application/json" } };
  const mk = { headers: { "x-tether-key": MACHINE } };
  const { ask } = await (await hit(env, "/api/ask", { method: "POST", ...auth, body: JSON.stringify({ text: "what is in a.txt" }) })).json();
  assert.deepEqual(await env.TETHER_KV.get("q", "json"), [ask.id], "the id was not queued");
  const q1 = await (await hit(env, "/api/m/queue", mk)).json();
  assert.equal(q1.items.length, 1, "the poll did not see the queued question");
  await hit(env, "/api/m/update", { method: "POST", headers: { "x-tether-key": MACHINE, "content-type": "application/json" }, body: JSON.stringify({ id: ask.id, status: "done", answer: "one line" }) });
  assert.deepEqual(await env.TETHER_KV.get("q", "json"), [], "the answered id stayed in the queue");
  const q2 = await (await hit(env, "/api/m/queue", mk)).json();
  assert.equal(q2.items.length, 0, "the poll re-served an answered question");
  assert.deepEqual(q2.recent, [{ q: "what is in a.txt", a: "one line" }], "the answer did not reach the next question's context");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
