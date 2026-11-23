// One poll: take at most one queued question, answer it with a local Claude
// Code session under a declared tool allowlist, post the answer back.
//
// What this never does, by construction: run shell commands (Bash is in
// --disallowedTools unless the project opts in), write outside a project that
// has opted into writing, or call any paid service of its own. The only cost is
// the Claude session you already pay for and a KV read and write.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { need, toolsFor, LOGDIR } from "./config.mjs";

const LOCK = join(os.tmpdir(), "tether-listener.lock");
const CLAUDE_PATHS = [
  join(os.homedir(), ".local/bin/claude"),
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  join(os.homedir(), ".claude/local/claude"),
];

export function findClaude() {
  const hit = CLAUDE_PATHS.find((p) => existsSync(p));
  if (hit) return hit;
  const w = spawnSync("sh", ["-lc", "command -v claude"], { encoding: "utf8" });
  const p = (w.stdout || "").trim();
  return p || null;
}

function log(line) {
  try {
    mkdirSync(LOGDIR, { recursive: true, mode: 0o700 });
    appendFileSync(join(LOGDIR, "listener.log"), line);
  } catch {}
}

function heldLock() {
  if (!existsSync(LOCK)) return false;
  let age = Infinity;
  try { age = Date.now() - Number(readFileSync(LOCK, "utf8") || 0); } catch {}
  if (age < 20 * 60 * 1000) return true;
  try { unlinkSync(LOCK); } catch {}
  return false;
}

const PROMPT = (cfg, item, recent, p) => `You are the assistant on ${os.hostname().replace(/\.local$/, "")}, answering a question its owner just sent from their phone.

Their message:
"""
${item.text}
"""
${recent ? `\nRecent exchanges, for context:\n${recent}\n` : ""}
${p.context ? `\nStanding context for this project:\n${p.context}\n` : ""}
How to answer:
- You are running on the owner's own machine, in ${p.path || process.cwd()}. Read what you need before answering.
- Write for a phone screen: lead with the answer, short lines, "- " bullets where they help, **bold** sparingly. No headings, no tables. Under 250 words unless depth is asked for.
- Never invent anything. If you do not know, say what you do not know and what you would need to find out.
- You cannot send messages, post, buy anything, or run shell commands from here. If one is needed, say exactly what to run or send, and leave it to the owner at the desktop.
- End with "NEXT:" and the single most useful next step, when there is one.

Reply with only the message for the owner.`;

export async function pollOnce({ verbose = false } = {}) {
  const cfg = need();
  const H = { "x-tether-key": cfg.machineKey, "content-type": "application/json" };
  const api = (path, init) => fetch(cfg.url.replace(/\/$/, "") + path, { ...init, headers: H, signal: AbortSignal.timeout(20000) });

  if (heldLock()) { if (verbose) console.log("another answer is still running"); return "busy"; }

  const q = await api("/api/m/queue").then((r) => r.json()).catch((e) => ({ error: String(e.message || e) }));
  if (q?.error) { if (verbose) console.log("queue read failed:", q.error); return "error"; }
  const item = q?.items?.[0];
  if (!item) { if (verbose) console.log("nothing queued"); return "idle"; }

  writeFileSync(LOCK, String(Date.now()), { mode: 0o600 });
  const post = (body) =>
    api("/api/m/update", { method: "POST", body: JSON.stringify({ id: item.id, ...body }) })
      .then((r) => r.ok).catch(() => false);

  try {
    await post({ status: "doing" });

    const claude = findClaude();
    if (!claude) {
      await post({ status: "failed", answer: "The Claude Code CLI was not found on this machine. Install it and run: tether doctor" });
      return "nocli";
    }

    const { project: p, tools } = toolsFor(cfg, item.project);
    const cwd = p.path && existsSync(p.path) ? p.path : os.homedir();
    const recent = (q.recent || []).slice(0, 3).reverse()
      .map((r) => `Q: ${r.q}\nA: ${String(r.a || "").slice(0, 500)}`).join("\n\n");

    const args = [
      "-p", PROMPT(cfg, item, recent, p),
      "--output-format", "text",
      "--max-turns", String(p.maxTurns || cfg.maxTurns || 30),
      "--allowedTools", ...tools,
    ];
    if (!tools.some((t) => t === "Bash" || t.startsWith("Bash("))) args.push("--disallowedTools", "Bash");
    if (p.model || cfg.model) args.push("--model", p.model || cfg.model);
    for (const d of p.readDirs || []) args.push("--add-dir", d);

    if (verbose) console.log(`answering ${item.id} in ${cwd} with tools: ${tools.join(" ")}`);

    const res = spawnSync(claude, args, {
      cwd, encoding: "utf8", maxBuffer: 32e6,
      timeout: (p.timeoutMinutes || cfg.timeoutMinutes || 10) * 60 * 1000,
      killSignal: "SIGTERM",
      env: { ...process.env, HOME: os.homedir(), PATH: `${os.homedir()}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ""}`, TETHER: "1" },
    });

    const out = (res.stdout || "").trim();
    const ok = res.status === 0 && out.length > 0;
    log(`== ${new Date().toISOString()} ${item.id} exit=${res.status} tools=[${tools.join(" ")}] cwd=${cwd}\nQ: ${item.text}\n${out.slice(0, 4000)}\n${(res.stderr || "").slice(0, 800)}\n\n`);

    const answer = ok ? out
      : res.error?.code === "ETIMEDOUT" || res.signal
        ? "That one ran past its time limit on the machine and was stopped. Try narrowing the question."
        : "The session on the machine failed before it answered. The reason is in ~/.tether/logs/listener.log.";

    for (let i = 0; i < 4; i++) {
      if (await post({ status: ok ? "done" : "failed", answer })) break;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
    if (verbose) console.log(ok ? "answered" : "failed, answer posted");
    return ok ? "answered" : "failed";
  } finally {
    try { unlinkSync(LOCK); } catch {}
  }
}

export async function loop({ every = 20 } = {}) {
  console.log(`tether listening, every ${every}s. Ctrl-C to stop.`);
  for (;;) {
    try { await pollOnce({ verbose: true }); }
    catch (e) { console.error("poll error:", e.message); }
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}

export function lastLog(n = 40) {
  const f = join(LOGDIR, "listener.log");
  if (!existsSync(f)) return "(no log yet)";
  const t = readFileSync(f, "utf8").split("\n");
  return t.slice(-n).join("\n");
}
