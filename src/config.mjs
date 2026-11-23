// Config lives in ~/.tether/config.json at mode 600. It holds the two keys,
// the worker URL, and the project list. Nothing here is ever printed except on
// an explicit request from the person at the keyboard.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import os from "node:os";

// TETHER_HOME moves the config, keys and logs off the home directory. Useful on
// a machine where HOME is not where your credentials live, and used by the tests.
export const DIR = process.env.TETHER_HOME || join(os.homedir(), ".tether");
export const FILE = join(DIR, "config.json");
export const LOGDIR = join(DIR, "logs");

export const newKey = () => randomBytes(32).toString("hex");

export function load() {
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch (e) {
    throw new Error(`${FILE} is not valid JSON: ${e.message}`);
  }
}

export function save(cfg) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  chmodSync(FILE, 0o600);
  return FILE;
}

export function need() {
  const c = load();
  if (!c) throw new Error("No config yet. Run: tether deploy");
  for (const k of ["url", "ownerKey", "machineKey"]) {
    if (!c[k]) throw new Error(`Config is missing "${k}". Run: tether deploy`);
  }
  return c;
}

// The default tool policy. Read-only, no shell, no network writes.
// Everything beyond this is opt-in, per project, in the config file.
export const DEFAULT_TOOLS = ["Read", "Glob", "Grep"];

// Tools that take a path are granted scoped to the project, so a question from
// a phone cannot read a file outside the directory that opted in. Tools that
// take no path (WebSearch, for instance) are granted bare.
const SCOPED = new Set(["Read", "Glob", "Grep", "Edit", "Write", "NotebookEdit"]);

export function toolsFor(cfg, project) {
  const p = (cfg.projects || []).find((x) => x.name === project) || (cfg.projects || [])[0] || {};
  const base = p.path ? p.path.replace(/\/+$/, "") : null;
  const dirs = base ? [base, ...(p.readDirs || []).map((d) => d.replace(/\/+$/, ""))] : [];
  const t = [];
  for (const name of p.tools || cfg.tools || DEFAULT_TOOLS) {
    if (base && SCOPED.has(name)) for (const d of dirs) t.push(`${name}(${d}/**)`);
    else t.push(name);
  }
  if (p.write && base) for (const d of dirs) t.push(`Edit(${d}/**)`, `Write(${d}/**)`);
  return { project: p, tools: [...new Set(t)] };
}
