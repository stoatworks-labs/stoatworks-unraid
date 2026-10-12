# stoatworks-unraid

> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. The generators are deterministic and their
> output is committed, so you can review every generated file in the app repos' history rather than
> it appearing at build time. GitHub Actions builds each image on every push, and that's the only
> evidence any of this works: the machine I wrote these files on has **no container runtime and
> no nginx**, so nothing here has ever been built, started or requested locally. A green CI run
> proves an image *builds*. It doesn't prove the app inside it serves correctly, and no container
> has been installed on a real Unraid server from these templates.

Container packaging for the Stoatworks web fleet: Dockerfiles and compose files
for each app, and Unraid Community Applications templates that install them.

**Scope: the things worth running on your own server.** That means the always-on
services (ATEM Overseer, RFutils, caspar-AV, srt-router, flock) and the browser
tools, which are static pages you'd self-host so they still work in a venue with
no internet. It's *not* the plugin browser demos or the public websites, on
purpose: a demo shows what an effect looks like and a marketing site is already
deployed, so neither is something anyone would install.

Nothing here is written by hand. Two data files describe the fleet and three
scripts turn them into the templates here and the files spread across the app
repos:

```
fleet.json    what each app is and how it builds
unraid.json   how each app is packaged for Unraid, and whether its repo is public

scripts/gen-docker.mjs      -> Dockerfile, .dockerignore, docker-compose.yml,
                               docker/nginx.conf, docker/stoatworks-headers.conf,
                               .github/workflows/docker.yml, and a "Run your
                               own copy" section in each browser tool's README.md
scripts/gen-templates.mjs   -> templates/*.xml, templates-private/*.xml
scripts/gen-launcher.mjs    -> launcher/ (a desktop tray app serving the site)
                               and .github/workflows/release-desktop.yml, for
                               every browser tool
scripts/headers-to-nginx.mjs   the _headers -> nginx translation
```

Between them they write or update 745 files across 28 app repos (counted on
2026-10-12): 165 from `gen-docker.mjs` (145 container files, plus the README of
each of the 20 browser tools) and 580 from `gen-launcher.mjs` (29 per browser
tool), not counting the icons it renders for a tray app that hasn't got any.

Regenerate everything:

```bash
node scripts/gen-docker.mjs && node scripts/gen-templates.mjs && node scripts/gen-launcher.mjs
```

## The tray apps

A browser tool is also worth having as a thing you double-click: a menu-bar
app that serves the same built site on a chosen interface and port, for the
venue with no internet and no server. `gen-launcher.mjs` writes one into each
static app's `launcher/`, on the fleet's
[av-launcher](https://github.com/stoatworks-labs/av-launcher) shell using its
`[serve] mode = "static"`. The site is bundled as a resource and served from
inside the app, so nothing is spawned beside it and there's no helper binary
for macOS to quarantine. The site's `_headers` ships with it and is honoured.

The shell (`src/`, `src-tauri/src/`, `src-tauri/crates/`) is copied file for
file from the av-launcher checkout, and the commit it came from is recorded in
each launcher's README; regenerating refreshes all of them at once. What
differs per app (`launcher.toml`, `tauri.conf.json`, `Info.plist`, the icons,
`scripts/prepare.sh` and the workflow) is generated from the same
`fleet.json` entry the Dockerfile comes from, so the container and the app
can't serve different directories or default to different ports.

`release-desktop.yml` builds macOS (arm64 and x86_64), Windows and Linux
installers when a `v*` tag is pushed, stamps the tag's version into the
bundle, and attaches them to the release. The macOS bundles leave CI ad-hoc
signed; the fleet's auto-sign watcher re-signs, notarises and re-uploads them.

Icons are rendered by `tauri icon` from the repo's own `public/icon-512.png`
(or `apple-touch-icon.png`), falling back to the Stoatworks mark, and only
when they're missing; pass `--icons` to redo them.

The README section sits between `<!-- selfhost:start -->` and
`<!-- selfhost:end -->` markers, the same arrangement as the fleet's downloads
and attributions blocks, so a regeneration replaces that section and nothing
else. It's written for the browser tools only: the services describe their own
containers in their own words, and a generated paragraph beside that would say
the same thing twice.

One browser tool is left out on purpose. **birddog-play-patcher** is a static
page plus a Cloudflare Worker that proxies `pkgs.tailscale.com` and GitHub's
MediaMTX release downloads, neither of which sends a CORS header, so the page
can't fetch either tarball itself. An nginx image would serve the page and lose
the proxy, and every package with Tailscale or the streaming gateway in it would
fail. Packaging it means a small server that runs `src/worker.js` under Node
(its own Dockerfile, with `hasOwnDocker`), and that hasn't been written yet.

## Installing on Unraid

Public apps are in `templates/`, and this repository is in the Community
Applications feed, so you can install them by searching. For a template the
feed hasn't picked up yet, and for anything in `templates-private/`, use
**Docker → Add Container → Template** and paste the raw URL of the XML file.

Private-repo apps publish private GHCR packages. Run this on the server once
before installing them:

```bash
docker login ghcr.io
```

## Three things that are easy to get wrong here

**Host networking is a correctness flag, not a preference.** `atem-overseer`,
`RFutils`, `srt-router` and `flock` discover devices over mDNS and broadcast.
Docker's bridge network doesn't reliably forward multicast, and when it fails
you don't get an error. Discovery just returns nothing, which reads as "there
are no devices on this network". Those templates ship `Network=host`. You can
switch them to bridge if you'd rather add devices by IP.

**`_headers` is the source of truth for headers, not `docker/nginx.conf`.**
Every static app carries a Cloudflare `_headers` file that the hosted build
uses. nginx can't read it, so `gen-docker.mjs` translates it. Edit `_headers`
and regenerate; a change made directly to `nginx.conf` is overwritten.

The translation isn't a straight copy. nginx's `add_header` doesn't inherit into
a `location` that sets any header of its own (the child list replaces the parent
list rather than merging), so a `/assets/*` block setting only `Cache-Control`
would silently drop every security header for precisely the files that carry the
application's JavaScript. So the base headers live in a snippet that every
generated location `include`s explicitly, and everything is emitted with
`always` so the headers survive 304s.

**GHCR package visibility follows the repo, and it's decided on first
publish.** Every repo packaged here is public, so `templates-private/` is empty,
but the machinery stays, because a public template pointing at a private
package produces a pull error for every user who clicks Install, and that reads
as a broken template rather than a permissions one. If an app ever starts life
private, make its repo public *before* its first workflow run: flipping the
repo afterwards doesn't retrospectively publish a package that was created
private.

## Registering with Community Applications

CA doesn't scan GitHub for template repos. The repository has to be added to
its feed, a one-time submission at `ca.unraid.net/submit`. That was done on
2026-08-06 and the feed has carried this repository since; every template
committed to `templates/` gets picked up by the next feed build with no further
submission. The feed is strict about two things, both found by templates
going missing rather than from any error message: a template with
neither `<Support>` nor `<Project>` is dropped, and category tokens are
validated against the feed's own list. `scripts/gen-templates.mjs` refuses to
write the first, and the tokens in use are the ones already in the feed.

The feed also reads `templates-private/`. A template there points at a
private GHCR package, so it's listed for everyone and installable by nobody,
which is why that directory should stay empty.

## Status

**In the CA feed, and every image builds.** As of 2026-09-07 the fleet is 31
apps and 32 templates (all nineteen public browser tools bar the patcher, plus
the services), and the Community Applications feed has carried this repository
since the 2026-08-06 submission. Twenty of the templates were listed at that
date. The rest were either not committed yet or had no `<Support>`/`<Project>`
element, both fixed that day, and appear at the next feed build.

**Every image builds.** As of 2026-08-06 the workflow in each packaged repo is
green on `main`, which is the only evidence any of this works: there's no
container runtime on the machine I wrote these files on, so every Dockerfile
here comes from reading each repo's build configuration rather than from a
successful local build. A green run proves an image *builds*. It doesn't prove
the app inside serves correctly, and **no container has yet been installed on a
real Unraid server from these templates**.

That first CI run earned its keep. It found two things nothing else would
have: a `react-dom` major bump in caspar-AV's console that had landed without
`react` moving with it, so a clean `npm ci` couldn't resolve the tree at all,
and a `pmse-to-wwb` image that served the repo's `site/` directory, which turned
out to be a landing page pointing somewhere else rather than the app. A
container build is the first clean-room install a repo ever gets.

The static images do at least check their own nginx config: the build runs
`nginx -t`, so a malformed generated config fails the build instead of
producing an image that crash-loops on deploy.
