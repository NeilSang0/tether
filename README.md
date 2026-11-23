# tether

Ask the Claude Code session on your own machine a question from your phone.

You are away from your desk. You want to know what is left on a deploy, what a
file actually says, or what the next step on a branch is. `tether` gives you a
small web app on your phone that asks your own machine and shows you the answer.

Your machine does the thinking, in your repo, on the Claude Code subscription
you already pay for. A Cloudflare Worker carries the text and nothing else.

```
npx -y https://bindler.co/tether/tether.tgz deploy
npx -y https://bindler.co/tether/tether.tgz project add ~/code/myrepo
npx -y https://bindler.co/tether/tether.tgz install
```

That is the whole install. There is no npm package to add and no account to make:
`npx` takes a tarball URL as a package spec, and `tether install` writes the
background job using the copy it already unpacked, so the long URL is typed
three times and never again. A version-pinned copy sits beside it at
`https://bindler.co/tether/tether-1.0.0.tgz` if you would rather hold a version
still.

Then open the address it prints on your phone, paste the key once, and add it to
your home screen.

## Or install it inside Claude Code

This repository is also a Claude Code plugin marketplace, so a session can set
tether up, scope which directories your phone may read, and diagnose it for you.
Needs Claude Code 2.1.275 or later.

```
/plugin marketplace add NeilSang0/tether
/plugin install tether --marketplace NeilSang0/tether
```

The plugin carries one skill. It runs the same `npx` commands above and prints
the access it granted; it does not replace them and it installs nothing by
itself.

## What it costs

Nothing per message, which is the point of the design.

The worker runs **no model of its own**. There is no AI binding, no inference
call, no transcription service, and the test suite fails if one ever appears in
the worker or in the config it generates. Dictation runs in your phone's own
browser, so a voice note uploads nothing and calls nothing.

The thinking is a `claude -p` session on your machine, billed exactly as it
would be if you had typed the same thing at your desk.

It needs a free Cloudflare account. No card, no plan choice.

### Staying inside the free KV limits

Worth stating precisely, because this is the part that is easy to get wrong.
Cloudflare's free KV plan allows **1,000 writes and 1,000 list operations a
day**, per namespace, against 100,000 reads. A listener polling every 30
seconds wakes 2,880 times a day, so a design that stamped a heartbeat and
listed the keyspace on each poll would burn both quotas inside six hours
having answered nothing.

So the queue does not live in the keyspace. Two small keys hold it: `q` is the
ids waiting, `ctx` is the last few answered pairs. An **idle poll reads two
keys and writes nothing**, the heartbeat is stamped at most once every five
minutes, and a list operation happens only when you open the page. A day of
idle polling costs about 260 writes and zero lists; a question costs four
writes. Two tests in `test/check.mjs` run 2,880 polls through the real worker
and fail if either number moves.

On the free plan an exceeded quota returns an error rather than a charge, so
getting this wrong would have been a silent breakage rather than a bill. It is
still worth not getting wrong.

## How it works

```
  phone  ──►  Cloudflare Worker  ──►  your machine  ──►  claude -p
   PWA         (mailbox: KV)           (listener)         (your repo)
     ◄──────────  answer  ◄──────────────────┘
```

1. The phone posts a question. The worker stores it in KV as `queued`.
2. Your machine polls every 30 seconds, takes **one** question, marks it `doing`.
3. It runs `claude -p` in the project directory, under a tool allowlist you set.
4. It posts the answer back. Your phone picks it up within a few seconds.

Nothing is pushed to your phone, so there is no notification service to pay for
or sign up to. The app polls while it is open, every 4 seconds while something
is working and every 20 when nothing is.

The worker never holds your code, your repo, or a model key. It holds the text
of your questions and answers for 30 days, then they expire.

## Access, which is the part to read twice

By default the session can **read inside one project** and nothing else. The
tools are granted scoped to that directory, not bare:

```
Read(/your/project/**)  Glob(/your/project/**)  Grep(/your/project/**)
```

That scoping is the part that matters. An unscoped `Read` would let a question
from your phone open any file on the disk by naming its path. There is a test
that asks it to read a file one level above the project and checks the contents
never come back.

`Bash` is passed to `--disallowedTools` explicitly, so your phone cannot run
commands on your machine. Writing is off. Both stay off until you turn them on
for a named project:

```
tether project add ~/code/myrepo --write        # may edit files under that path
tether project add ~/notes --tools=Read,Glob    # read-only, narrower
```

`tether doctor` prints exactly what is granted, and warns in plain words if any
project has shell access.

Give it a project, not your home directory. `tether deploy` starts with your
home directory so the first question works, and narrowing it is one command:

```
tether project add ~/code/myrepo
tether project remove home
```

## Commands

| | |
|---|---|
| `tether deploy` | create the worker and KV namespace on your Cloudflare account |
| `tether project add <path>` | let it reach a project. `--write` allows edits |
| `tether project` | list what it can reach and with which tools |
| `tether listen` | answer questions while the window stays open |
| `tether install` | answer them in the background (launchd on macOS, systemd user timer on Linux) |
| `tether uninstall` | stop that |
| `tether status` | is the worker reachable, is the listener loaded |
| `tether doctor` | check the machine, print the access granted |
| `tether key` | print the phone address and key again |

Config is `~/.tether/config.json`, mode 600. Logs are `~/.tether/logs/`.

## Limits worth knowing before you install it

- **One question at a time.** A lock file means a second question waits. This is
  deliberate: two Claude sessions in one repo fight.
- **It answers only while the machine is awake.** A sleeping laptop answers
  nothing, and the app says so instead of spinning. The dot by the title is
  green when the machine checked in within four minutes.
- **It cannot act on the world.** No sending, no posting, no buying, no
  committing. If something needs doing, the answer tells you what to run and
  leaves it to you at the desktop. That is a design decision, not a gap.
- **Ten minutes per question**, then it is stopped and told so.
- **iOS runs it as a web app**, not a native one. Add to Home Screen gives it an
  icon and a standalone window. There is no App Store build.

## Removing it

```
tether uninstall                              # stop the background listener
cd ~/.tether/worker && npx wrangler delete    # take the worker down
rm -rf ~/.tether                              # keys, config, logs
```

## Security

Read [SECURITY.md](SECURITY.md) before you put this on a machine that matters.
The short version: this is a door into your own machine, protected by one
256-bit key, and the defaults are read-only on purpose.

## Why this is free

Bindler sells regulatory workbooks and an API. It does not sell developer tools,
and this one exists because the people who would find it useful are the same
people who call the Bindler MCP server, which gets more traffic than the
website. Giving this away is cheaper than advertising and more honest than a
lead form. There is nothing to upsell inside it, no telemetry, and no account.

MIT. Built by [Bindler](https://bindler.co), Dubai.
