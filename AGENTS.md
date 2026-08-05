# AGENTS.md — stoatworks-unraid

Container packaging for the Stoatworks web fleet. Everything in the app repos
that relates to Docker or Unraid is generated from here.

## The rule that matters

**Never hand-edit a generated file.** `Dockerfile`, `.dockerignore`,
`docker-compose.yml`, `docker/nginx.conf`, `docker/stoatworks-headers.conf` and
`.github/workflows/docker.yml` in the app repos are all outputs. Every one
carries a banner saying so. Change `fleet.json` or the generator, then:

```bash
node scripts/gen-docker.mjs && node scripts/gen-templates.mjs
```

`--dry-run` lists what would be written; `--only repo,repo` narrows it.

## What lives where

- `fleet.json` — one entry per app: kind, build command, output directory,
  ports, whether it needs host networking. The `$comment` block at the top
  documents every field. If a build command is wrong, it is wrong *here*.
- `unraid.json` — repo visibility, host port assignments, template metadata.
- `scripts/headers-to-nginx.mjs` — the `_headers` translation, with the nginx
  `add_header` inheritance trap written up in the header comment.

## Things previously got wrong, so check them

- **`atem-scopes` builds with `static:build`, not `build`.** `npm run build` in
  that repo is `electron-vite build` and produces the desktop app. Using it
  yields an image serving a stale or absent `dist/`.
- **`caspar-av/web/` is not tracked in git.** It is built from `console/` by
  Vite. The Dockerfile needs its Node stage or the server serves nothing.
- **`flock` had a hand-written Dockerfile before this existed** and keeps it —
  `hasOwnDocker: true`. It knows things the generator does not, notably that
  Debian's ffmpeg may not link libsrt. Do not replace it with generated output.
- **The demo directories are committed, already built.** `nesolume/demo`,
  `srt-router/demo/dist`, `zero-eq/web/public` and the rest need no build stage.
  Adding one invents work with no inputs.
- **`.dockerignore` paths need leading slashes.** A bare `dist` also matches
  `demo/dist`, which is the entire payload of the srt-router demo image.
- **zsh does not word-split unquoted variables.** A `for d in $REPOS` loop over
  a plain string silently iterates once with the whole string as one word. Use
  an array.

## Verification

There is no container runtime on the development Mac, so nothing here has been
built locally. The per-repo GitHub Actions workflow is the only real check.
Static images run `nginx -t` during the build so a bad generated config fails
loudly rather than crash-looping after deploy.

Private repos bill Actions minutes, so their workflows have no `pull_request`
trigger — use `workflow_dispatch` to test a build before merging.
