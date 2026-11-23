# tether, the plugin

This folder is the directory-listable half of [tether](https://bindler.co/tether/).
It carries one skill and no code, because the Claude plugin directory accepts
programs only from Verified organizations and Bindler is not one. The tool
itself stays where it already lives, as a tarball served from bindler.co and run
with `npx`, and the skill in this folder teaches Claude how to drive it.

## Install it

    /plugin install tether --marketplace NeilSang0/tether

## What tether does

It puts a small web app on your phone that asks the Claude Code session on your
own machine a question, and shows you the answer. A Cloudflare Worker on your
own Cloudflare account carries the text between the two. The worker runs no
model of its own, so a message costs nothing per message: the thinking is a
`claude -p` session on your machine, billed exactly as if you had typed the same
words at your desk. Dictation runs in your phone's own browser through the Web
Speech API, so a voice note is transcribed on the handset and uploads nothing.

## What the skill does

It teaches Claude to install tether, to deploy the worker to your own Cloudflare
account, to add or scope a project so the phone can read one directory and no
other, to install or stop the background listener, and to read back the phone
address and the key when you have lost them. It runs the tool's own commands and
reads their output back to you, and it is written never to invent a path or a
figure.

## Access, in one paragraph, because this is the part worth reading

Reads are scoped to the project you name, as `Read(/your/project/**)` rather
than a bare `Read`, so a question from the phone cannot name a path outside it.
Shell is in `--disallowedTools` unless you opt a project in. Writing is off
until you turn it on. Two keys, 256 bits each, are generated on your machine at
deploy time and never leave it except to the worker you own.

## Source and licence

Full source, 26 tests and the security notes: the parent of this folder, and
<https://github.com/NeilSang0/tether>. MIT licensed. No account anywhere except
your own free Cloudflare one, no telemetry, and nothing that unlocks for money.
