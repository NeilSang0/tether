# Security model

`tether` puts a door on your machine. It is worth understanding the door before
you install it.

## What an attacker would have to hold

Two independent 256-bit keys, generated with `crypto.randomBytes(32)` and stored
as Cloudflare Worker secrets:

- `OWNER_KEY` lets a phone ask questions and read answers. It is exchanged once
  for a cookie: `HMAC-SHA256(OWNER_KEY, "owner-v1")`, set `HttpOnly`, `Secure`,
  `SameSite=Strict`, with a one-year life. The raw key is never in the cookie,
  so reading the cookie does not give up the key.
- `MACHINE_KEY` lets a machine take questions and post answers. It is sent as
  `x-tether-key` and only your listener has it.

Neither key is ever printed by `wrangler` or logged. `tether key` prints the
owner key on request, because at some point you have to type it into a phone.

Both comparisons run over the full string without an early return. Keys are
fixed-length hex, so a length mismatch is already a failure and not a leak.

Guessing one is 2^256 work against a Cloudflare edge. Losing one is the real
risk, and the answer to that is `tether deploy` again, which rotates nothing by
itself: delete `~/.tether/config.json` first and it issues new keys, which
invalidates every phone cookie.

## What someone with the owner key gets

Whatever you granted. With the defaults, that is read access through
`Read`, `Glob` and `Grep` **inside one directory**, which on a developer machine
is still a serious amount: source, config filenames, notes, anything a `grep`
would find. Treat the owner key like the password to that directory.

The scoping is enforced in the grant itself, as `Read(<path>/**)` rather than a
bare `Read`. That distinction is the whole boundary: a bare grant lets a
question name any absolute path on the machine and get the contents back. There
is a test that tries exactly that against a canary file above the project and
asserts the canary never appears in the answer.

With `--write`, they can also change files under that one path. With `Bash` in
a project's `tools`, they can run commands as you. `tether doctor` says so out
loud for exactly this reason.

## What it cannot do, by construction

- **No shell by default.** `Bash` is in `--disallowedTools` unless a project's
  `tools` list opts in, and the test suite asserts that.
- **No writing outside a project.** `Edit` and `Write` are granted as
  `Edit(<path>/**)`, scoped to the one directory that opted in.
- **No network side effects.** The session is not given tools to send, post or
  purchase, and the prompt tells it to hand those back to you.
- **No model in the worker.** There is no AI binding and no inference call, so a
  stolen key cannot run up a bill on your Cloudflare account. The worst it can
  do there is consume free-tier KV operations.

## What the worker can see

The text of your questions and answers, for 30 days, after which KV expires
them. It never receives your code, your repository, or any model credential.
Cloudflare can see that text the same way any host can see what passes through
it. If that is not acceptable for the question you are about to ask, do not ask
it from a phone.

## Hardening the deployment

- `Disallow: /` in `robots.txt`, `x-robots-tag: noindex, nofollow` on every
  response, `cache-control: private, no-store`, `x-frame-options: DENY`, and a
  `content-security-policy` of `default-src 'none'` with no external origin
  allowed. The app loads nothing from a third party; the test suite checks that.
- Answers are HTML-escaped before the formatter adds back code spans and bold,
  so an answer cannot inject markup into your phone. There is a test for it.
- Deletion accepts only a well-formed id, so a crafted id cannot reach another
  key in the namespace. There is a test for that too.
- Put a Cloudflare Access policy in front of the worker if you want a second
  factor. The worker does not need to know about it.

## Reporting something

Open an issue, or mail the address on https://bindler.co. If it is exploitable,
say so in the first line and leave the detail for a reply.
