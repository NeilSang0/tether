---
name: tether
description: Set up, scope, diagnose or remove tether, the tool that lets a phone ask the Claude Code session on this machine a question. Use when the user asks to reach this machine from their phone, mentions tether, asks which directories the phone can read, wants the phone address or key again, says the phone shows the machine is not listening, or wants the background listener installed or stopped.
---

# tether

tether puts a small web app on the user's phone that asks the Claude Code
session on this machine a question and shows the answer. A Cloudflare Worker on
the user's own account carries the text. The worker runs no model: the thinking
is a `claude -p` session on this machine, billed as if the user had typed it at
the desk.

Everything below is the tool's own documented behaviour. Run the commands, read
the output back to the user, and never invent a figure or a path.

## Install it

There is no npm package and no account. `npx` takes the tarball URL as a package
spec:

```
npx -y https://bindler.co/tether/tether.tgz deploy
npx -y https://bindler.co/tether/tether.tgz project add ~/code/myrepo
npx -y https://bindler.co/tether/tether.tgz install
```

`deploy` creates the worker and a KV namespace on the user's Cloudflare account
and prints the phone address and the key. `install` writes the background
listener (launchd on macOS, a systemd user timer on Linux). After `install` the
short `tether <command>` form works.

It needs a free Cloudflare account. There is no card and no plan choice. Never
run a step that would create a paid Cloudflare plan, and never pick a plan on
the user's behalf.

## The access model, which is the thing to get right

By default the session can read inside **one** project and nothing else. The
grants are scoped to that path rather than bare:

```
Read(/your/project/**)  Glob(/your/project/**)  Grep(/your/project/**)
```

`Bash` is passed to `--disallowedTools`, so a question from a phone cannot run a
command on the machine. Writing is off until a named project opts in.

```
tether project                                  list what it can reach
tether project add ~/code/myrepo                read-only, scoped to that path
tether project add ~/code/myrepo --write        also allow Edit and Write there
tether project add ~/notes --tools=Read,Glob    narrower still
tether project remove home                      drop the home-directory default
```

`tether deploy` starts with the home directory so the first question works.
Narrowing it to a real project is two commands and worth doing immediately:
`tether project add <path>` then `tether project remove home`.

When the user asks for `--write` or wider tools, say in one line what that opens
before running it. Do not widen a grant that was not asked for.

## When the phone says the machine is not listening

Work down this list and report what each one answered:

1. `tether status` : is the worker reachable, is the listener loaded.
2. `tether doctor` : checks the machine and prints the access granted. It warns
   in plain words if any project has shell access.
3. The machine answers only while awake. A sleeping laptop answers nothing. The
   dot beside the title in the app is green when the machine checked in within
   four minutes.
4. `tether install` if the listener was never loaded, or `tether listen` to
   answer in the foreground while a window stays open.

Config is `~/.tether/config.json`, mode 600. Logs are in `~/.tether/logs/`.
`tether key` prints the phone address and key again. The key is a 256-bit
secret: print it for the user, never paste it into a file, a commit or a message.

## Limits to state plainly rather than work around

- One question at a time. A lock file makes a second wait, because two sessions
  in one repo fight.
- Ten minutes per question, then it is stopped and says so.
- It cannot act on the world: no sending, no posting, no buying, no committing.
  When something needs doing the answer names the command and leaves it to the
  user at the desk.
- iOS runs it as a web app. Add to Home Screen gives it an icon and a standalone
  window. There is no App Store build.

## Remove it

```
tether uninstall                              stop the background listener
cd ~/.tether/worker && npx wrangler delete    take the worker down
rm -rf ~/.tether                              keys, config, logs
```

## Before putting it on a machine that matters

Read `SECURITY.md` in the package. The short version: this is a door into the
user's own machine, protected by one key, and the defaults are read-only on
purpose.

MIT. Built by Bindler, https://bindler.co/tether/
