#!/usr/bin/env node
// tether: ask the Claude Code session on your own machine a question from your
// phone. The worker is a mailbox; your machine does all the thinking.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { load, save, need, newKey, DIR, FILE, LOGDIR, DEFAULT_TOOLS } from "./config.mjs";
import { pollOnce, loop, findClaude, lastLog } from "./listen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKDIR = join(DIR, "worker");
const PKG = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
const LABEL = "co.tether.listener";
const PLIST = join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const UNIT = join(os.homedir(), ".config", "systemd", "user", "tether.service");

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: "inherit", encoding: "utf8", ...opts });
const cap = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

const wrangler = (args, opts = {}) => run("npx", ["--yes", "wrangler@latest", ...args], { cwd: WORKDIR, ...opts });
const wranglerCap = (args, opts = {}) => cap("npx", ["--yes", "wrangler@latest", ...args], { cwd: WORKDIR, ...opts });

function stageWorker(name, projects) {
  mkdirSync(WORKDIR, { recursive: true, mode: 0o700 });
  const src = join(HERE, "worker");
  mkdirSync(join(WORKDIR, "src"), { recursive: true });
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(WORKDIR, "src", f));
  return WORKDIR;
}

function writeToml({ name, kvId, appName, projects }) {
  const toml = `# Written by tether. Edit if you know why; "tether deploy" rewrites it.
name = "${name}"
main = "src/index.js"
compatibility_date = "2025-09-01"
workers_dev = true

# No AI binding, no queue, no durable object, no D1. This worker stores two
# small values in KV and forwards text. Keep it that way: a model binding here
# would start charging per message.

[[kv_namespaces]]
binding = "TETHER_KV"
id = "${kvId}"

[vars]
TETHER_NAME = "${appName}"
TETHER_PROJECTS = "${projects.join(",")}"
`;
  writeFileSync(join(WORKDIR, "wrangler.toml"), toml);
}

function putSecret(key, value, name) {
  const r = spawnSync("npx", ["--yes", "wrangler@latest", "secret", "put", key, "--name", name],
    { cwd: WORKDIR, input: value + "\n", encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0) {
    // Never echo the value; show only wrangler's own words.
    console.error(out.trim());
    throw new Error(`could not set ${key} on the worker`);
  }
  return true;
}

function cfAccount() {
  const r = wranglerCap(["whoami"]);
  const m = ((r.stdout || "") + (r.stderr || "")).match(/associated with the email ([^\s.]+@[^\s,]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- commands

async function cmdDeploy(args) {
  const appName = args.name || "tether";
  const workerName = (args.worker || appName).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const existing = load();

  console.log(`
tether deploys to YOUR Cloudflare account, on the free Workers plan.
What it creates there: one Worker and one KV namespace. Both sit far inside
the free tier for personal use, and the worker runs no model of its own, so
a message costs one KV read and one KV write. Nothing here bills per word.

You need: a Cloudflare account (free, no card) and the Claude Code CLI.
`);

  stageWorker(appName);

  // --dry-run stages the worker and bundles it without touching any account.
  if (args["dry-run"]) {
    writeToml({ name: workerName, kvId: "0".repeat(32), appName, projects: (existing?.projects || []).map((p) => p.name) });
    console.log(`Staged in ${WORKDIR}. Bundling without deploying...\n`);
    const d = wrangler(["deploy", "--dry-run", "--outdir", join(WORKDIR, "dist")]);
    process.exit(d.status === 0 ? 0 : 1);
  }

  const who = cfAccount();
  if (!who) {
    console.log("Not signed in to Cloudflare yet. A browser window will open.\n");
    if (wrangler(["login"]).status !== 0) {
      console.error("Cloudflare login did not complete. Run it again when ready.");
      process.exit(1);
    }
  } else {
    console.log(`Cloudflare account: ${who}\n`);
  }

  // KV namespace: reuse the one in the config if it is still there.
  let kvId = existing?.kvId;
  if (!kvId) {
    const r = wranglerCap(["kv", "namespace", "create", "TETHER_KV"]);
    const txt = (r.stdout || "") + (r.stderr || "");
    const m = txt.match(/id\s*=\s*"([a-f0-9]{32})"/) || txt.match(/"id":\s*"([a-f0-9]{32})"/);
    if (!m) {
      console.error(txt.trim());
      console.error("\nCould not create the KV namespace. Nothing was deployed.");
      process.exit(1);
    }
    kvId = m[1];
    console.log(`KV namespace created: ${kvId}`);
  } else {
    console.log(`Reusing KV namespace ${kvId}`);
  }

  const projects = (existing?.projects || []).map((p) => p.name);
  writeToml({ name: workerName, kvId, appName, projects });

  const ownerKey = existing?.ownerKey || newKey();
  const machineKey = existing?.machineKey || newKey();

  console.log("\nDeploying the worker...");
  const d = wranglerCap(["deploy"]);
  const dout = (d.stdout || "") + (d.stderr || "");
  if (d.status !== 0) {
    console.error(dout.trim());
    process.exit(1);
  }
  const urlMatch = dout.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/);
  const url = args.url || urlMatch?.[0];
  if (!url) {
    console.error(dout.trim());
    console.error("\nDeployed, but no workers.dev URL was printed. Pass it with --url=https://...");
    process.exit(1);
  }

  console.log("Setting the two keys as worker secrets (they are never printed by wrangler)...");
  putSecret("OWNER_KEY", ownerKey, workerName);
  putSecret("MACHINE_KEY", machineKey, workerName);

  const cfg = {
    version: PKG.version,
    url, workerName, kvId, appName,
    ownerKey, machineKey,
    tools: existing?.tools || DEFAULT_TOOLS,
    maxTurns: existing?.maxTurns || 30,
    timeoutMinutes: existing?.timeoutMinutes || 10,
    projects: existing?.projects || [{ name: "home", path: os.homedir(), write: false, tools: DEFAULT_TOOLS }],
  };
  save(cfg);

  console.log(`
Done.

  Phone      ${url}
  Your key   ${ownerKey}

Open that address on your phone, paste the key once, and add it to your home
screen. The sign-in lasts a year. The key is also in ${FILE} (mode 600);
"tether key" prints it again.

Next:
  tether project add <path>    let it read a project (read-only by default)
  tether listen                answer questions while this stays open
  tether install               keep answering in the background
`);
}

function cmdKey() {
  const c = need();
  console.log(`${c.url}\n${c.ownerKey}`);
}

function cmdProject(args, rest) {
  const c = need();
  const sub = rest[0];
  if (sub === "add") {
    const path = rest[1] ? join(process.cwd(), rest[1]).replace(/\/$/, "") : process.cwd();
    const real = existsSync(rest[1] || "") || existsSync(path) ? (existsSync(path) ? path : rest[1]) : null;
    if (!real) { console.error(`No such directory: ${rest[1] || path}`); process.exit(1); }
    const name = args.name || real.split("/").filter(Boolean).pop();
    c.projects = (c.projects || []).filter((p) => p.name !== name);
    c.projects.unshift({
      name, path: real,
      write: !!args.write,
      tools: args.tools ? String(args.tools).split(",") : DEFAULT_TOOLS,
      readDirs: [],
      context: args.context || "",
    });
    save(c);
    console.log(`Added "${name}" -> ${real}${args.write ? " (it may edit files there)" : " (read-only)"}`);
    console.log(`Run "tether deploy" to show it in the phone picker.`);
    return;
  }
  if (sub === "remove") {
    const n = (c.projects || []).length;
    c.projects = (c.projects || []).filter((p) => p.name !== rest[1]);
    save(c);
    console.log(c.projects.length === n ? `No project named "${rest[1]}"` : `Removed "${rest[1]}"`);
    return;
  }
  for (const p of c.projects || []) {
    console.log(`${p.name.padEnd(16)} ${p.write ? "read+write" : "read-only "}  ${p.path}`);
    console.log(`${"".padEnd(16)} tools: ${(p.tools || DEFAULT_TOOLS).join(" ")}`);
  }
  console.log(`\nEdit ${FILE} for anything finer. "tether project add --write ." allows edits in one project.`);
}

async function cmdStatus() {
  const c = need();
  const r = await fetch(c.url.replace(/\/$/, "") + "/api/m/queue", {
    headers: { "x-tether-key": c.machineKey }, signal: AbortSignal.timeout(15000),
  }).then((x) => x.json()).catch((e) => ({ error: e.message }));
  console.log(`worker   ${c.url}`);
  console.log(`reachable ${r.error ? "no: " + r.error : "yes"}`);
  if (!r.error) console.log(`queued   ${r.items?.length || 0} waiting now`);
  const mac = process.platform === "darwin";
  const installed = mac ? existsSync(PLIST) : existsSync(UNIT);
  console.log(`listener  ${installed ? "installed" : "not installed (run: tether install)"}`);
  if (installed && mac) {
    const l = cap("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`]);
    console.log(`           ${l.status === 0 ? "loaded in launchd" : "NOT loaded; run tether install again"}`);
  }
  console.log(`claude    ${findClaude() || "NOT FOUND"}`);
  console.log(`log       ${join(LOGDIR, "listener.log")}`);
}

function cmdDoctor() {
  const c = load();
  const ok = (b) => (b ? "ok  " : "MISS");
  console.log(`${ok(Number(process.versions.node.split(".")[0]) >= 18)} node ${process.versions.node} (needs 18+)`);
  console.log(`${ok(!!findClaude())} claude CLI ${findClaude() || ""}`);
  const npx = cap("npx", ["--version"]);
  console.log(`${ok(npx.status === 0)} npx ${(npx.stdout || "").trim()}`);
  console.log(`${ok(!!c)} config ${c ? FILE : "not deployed yet"}`);
  if (c) {
    console.log(`${ok(!!c.url)} worker url ${c.url || ""}`);
    console.log(`${ok((c.projects || []).length > 0)} projects ${(c.projects || []).length}`);
    const writers = (c.projects || []).filter((p) => p.write).map((p) => p.path);
    const shells = (c.projects || []).filter((p) => (p.tools || []).some((t) => t.startsWith("Bash")));
    console.log(`     write access: ${writers.length ? writers.join(", ") : "none"}`);
    console.log(`     shell access: ${shells.length ? shells.map((p) => p.name).join(", ") : "none"}`);
    if (shells.length) console.log("     warning: a project with Bash lets your phone run commands on this machine.");
  }
  console.log(`\n${lastLog(12)}`);
}

function cmdInstall() {
  const c = need();
  const node = process.execPath;
  const self = join(HERE, "cli.mjs");
  mkdirSync(LOGDIR, { recursive: true, mode: 0o700 });

  if (process.platform === "darwin") {
    mkdirSync(dirname(PLIST), { recursive: true });
    writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${node}</string><string>${self}</string><string>poll</string>
  </array>
  <key>StartInterval</key><integer>${c.pollSeconds || 30}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(LOGDIR, "launchd.log")}</string>
  <key>StandardErrorPath</key><string>${join(LOGDIR, "launchd.log")}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${os.homedir()}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>${os.homedir()}</string>${process.env.TETHER_HOME ? `
    <key>TETHER_HOME</key><string>${process.env.TETHER_HOME}</string>` : ""}
  </dict>
</dict></plist>
`);
    if (cap("plutil", ["-lint", PLIST]).status !== 0) { console.error("the generated plist is malformed"); process.exit(1); }
    cap("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);
    const b = cap("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST]);
    if (b.status !== 0) {
      console.error(((b.stdout || "") + (b.stderr || "")).trim());
      console.error(`\nlaunchd refused the job. Give your terminal Full Disk Access, or run "tether listen" in a window instead.`);
      process.exit(1);
    }
    console.log(`Installed. It checks for questions every ${c.pollSeconds || 30}s while the Mac is awake.`);
    console.log(`Remove with: tether uninstall`);
    return;
  }

  mkdirSync(dirname(UNIT), { recursive: true });
  writeFileSync(UNIT, `[Unit]
Description=tether listener

[Service]
Type=oneshot
ExecStart=${node} ${self} poll
Environment=PATH=${os.homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=${os.homedir()}
${process.env.TETHER_HOME ? `Environment=TETHER_HOME=${process.env.TETHER_HOME}\n` : ""}`);
  writeFileSync(UNIT.replace(/\.service$/, ".timer"), `[Unit]
Description=tether listener timer

[Timer]
OnBootSec=30
OnUnitActiveSec=${c.pollSeconds || 30}
AccuracySec=5

[Install]
WantedBy=timers.target
`);
  run("systemctl", ["--user", "daemon-reload"]);
  const e = run("systemctl", ["--user", "enable", "--now", "tether.timer"]);
  if (e.status !== 0) {
    console.error(`systemd refused the timer. Run "tether listen" in a window instead, or under your own supervisor.`);
    process.exit(1);
  }
  console.log(`Installed as a systemd user timer, every ${c.pollSeconds || 30}s.`);
  console.log(`If this machine is a laptop that logs out, run: loginctl enable-linger ${os.userInfo().username}`);
}

function cmdUninstall() {
  if (process.platform === "darwin") {
    cap("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);
    if (existsSync(PLIST)) unlinkSync(PLIST);
    console.log("Listener removed. The worker and your config are untouched.");
    console.log(`To take the worker down too: cd ${WORKDIR} && npx wrangler delete`);
    return;
  }
  run("systemctl", ["--user", "disable", "--now", "tether.timer"]);
  for (const f of [UNIT, UNIT.replace(/\.service$/, ".timer")]) if (existsSync(f)) unlinkSync(f);
  run("systemctl", ["--user", "daemon-reload"]);
  console.log("Listener removed.");
}

const HELP = `tether ${PKG.version}
Ask the Claude Code session on your own machine a question from your phone.

  tether deploy               put the mailbox on your own Cloudflare account
  tether deploy --dry-run     bundle it locally, touch no account
  tether project add <path>   let it read a project (add --write to allow edits)
  tether project              list what it can reach
  tether listen               answer questions while this window stays open
  tether install              answer them in the background from now on
  tether uninstall            stop doing that
  tether status               is the worker reachable, is the listener loaded
  tether doctor               check the machine and show what access is granted
  tether key                  print the phone address and key again
  tether poll                 one pass, used by the background job

Your machine does the thinking, on the Claude subscription you already have.
The worker only carries text. It runs no model, so it bills nothing per message.
`;

const argv = process.argv.slice(2);
const flags = {};
const rest = [];
for (const a of argv) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  else rest.push(a);
}
const cmd = rest.shift();

try {
  switch (cmd) {
    case "deploy": await cmdDeploy(flags); break;
    case "listen": await loop({ every: Number(flags.every) || load()?.pollSeconds || 20 }); break;
    case "poll": await pollOnce({ verbose: !!flags.verbose }); break;
    case "install": cmdInstall(); break;
    case "uninstall": cmdUninstall(); break;
    case "status": await cmdStatus(); break;
    case "doctor": cmdDoctor(); break;
    case "key": cmdKey(); break;
    case "project": case "projects": cmdProject(flags, rest); break;
    case "version": case "--version": console.log(PKG.version); break;
    default: console.log(HELP); if (cmd) process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
