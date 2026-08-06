# stoatworks-unraid

> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. The generators are deterministic and their
> output is committed, so every generated file is reviewable in the app repos' history rather than
> produced at build time. Each image is built by GitHub Actions on every push, which is the only
> evidence any of this works: the machine these files were written on has **no container runtime and
> no nginx**, so nothing here has ever been built, started or requested locally. A green CI run proves
> an image *builds*; it does not prove the app inside it serves correctly, and no container has been
> installed on a real Unraid server from these templates.

Container packaging for the Stoatworks web fleet: Dockerfiles and compose files
for each app, and Unraid Community Applications templates that install them.

**Scope: the things worth running on your own server.** That is the always-on
services — ATEM Overseer, RFutils, caspar-AV, srt-router, flock — and the
browser tools, which are static pages you would self-host so they still work in
a venue with no internet. It is deliberately *not* the plugin browser demos or
the public websites: a demo shows what an effect looks like and a marketing
site is already deployed, so neither is something anyone would install.

Nothing here is written by hand. Two data files describe the fleet and two
scripts turn them into the 74 files spread across the app repos:

```
fleet.json    what each app is and how it builds
unraid.json   how each app is packaged for Unraid, and whether its repo is public

scripts/gen-docker.mjs      -> Dockerfile, .dockerignore, docker-compose.yml,
                               docker/nginx.conf, .github/workflows/docker.yml
scripts/gen-templates.mjs   -> templates/*.xml, templates-private/*.xml
scripts/headers-to-nginx.mjs   the _headers -> nginx translation
```

Regenerate everything:

```bash
node scripts/gen-docker.mjs && node scripts/gen-templates.mjs
```

## Installing on Unraid

Public apps are in `templates/`. Once this repo is registered with Community
Applications they are installable by search. Until then, and for anything in
`templates-private/`, use **Docker → Add Container → Template** and paste the
raw URL of the XML file.

Private-repo apps publish private GHCR packages. Run this on the server once
before installing them:

```bash
docker login ghcr.io
```

## Three things that are easy to get wrong here

**Host networking is a correctness flag, not a preference.** `atem-overseer`,
`RFutils`, `srt-router` and `flock` discover devices over mDNS and broadcast.
Docker's bridge network does not reliably forward multicast, and the failure
mode is not an error — discovery simply returns nothing, which reads as "there
are no devices on this network". Those templates ship `Network=host`. You can
switch them to bridge if you would rather add devices by IP.

**`_headers` is the source of truth for headers, not `docker/nginx.conf`.**
Every static app carries a Cloudflare `_headers` file that the hosted build
uses. nginx cannot read it, so `gen-docker.mjs` translates it. Edit `_headers`
and regenerate; a change made directly to `nginx.conf` is overwritten.

The translation is not a copy. nginx's `add_header` does not inherit into a
`location` that sets any header of its own — the child list replaces the parent
list rather than merging — so a `/assets/*` block setting only `Cache-Control`
would silently drop every security header for exactly the files that carry the
application's JavaScript. The base headers therefore live in a snippet that
every generated location `include`s explicitly, and everything is emitted with
`always` so the headers survive 304s.

**GHCR package visibility follows the repo, and it is decided on first
publish.** Every repo packaged here is public, so `templates-private/` is empty
— but the machinery stays, because a public template pointing at a private
package produces a pull error for every user who clicks Install, and that reads
as a broken template rather than a permissions one. If an app ever starts life
private, make its repo public *before* its first workflow run: flipping the
repo afterwards does not retrospectively publish a package that was created
private.

## Registering with Community Applications

CA does not scan GitHub for template repos — the repository has to be added to
its feed, which is a moderated submission on the Unraid forums rather than
anything that can be done from here. Until that is done, the templates work
fine by URL.

## Status

**Every image builds.** As of 2026-08-06 the workflow in each packaged repo is
green on `main`, which is the only evidence any of this works: there is no
container runtime on the machine these files were authored on, so every
Dockerfile here is derived from reading each repo's build configuration rather
than from a successful local build. A green run proves an image *builds*. It
does not prove the app inside serves correctly, and **no container has yet been
installed on a real Unraid server from these templates**.

That first CI run was worth having. It found two things nothing else would
have: a `react-dom` major bump in caspar-AV's console that had landed without
`react` moving with it, so a clean `npm ci` could not resolve the tree at all;
and a `pmse-to-wwb` image that served the repo's `site/` directory, which turns
out to be a landing page pointing elsewhere rather than the app. A container
build is the first clean-room install a repo ever gets.

The static images do at least check their own nginx config: the build runs
`nginx -t`, so a malformed generated config fails the build instead of
producing an image that crash-loops on deploy.
