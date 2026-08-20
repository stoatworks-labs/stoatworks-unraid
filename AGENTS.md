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
- **There are three independent opt-out flags, not one.** An app may own any
  combination of its Dockerfile, its workflow, and its template:

  | flag | what the generator stops doing | why an app would want it |
  | --- | --- | --- |
  | `hasOwnDocker` | Dockerfile, `.dockerignore`, compose, nginx | the image is a kind this generator cannot build |
  | `hasOwnWorkflow` | `.github/workflows/docker.yml` | the repo runs its own CI — tests, matrix, smoke test, release — and two workflows pushing the same tags race |
  | `hasOwnTemplate` | the generated `templates/<image>.xml`; the app's `unraid/<image>.xml` is copied verbatim instead | the Unraid integration needs Config blocks this generator cannot express (media paths, PUID/PGID, devices, env seeds) |

  `unfuckarr` sets all three and is the reference for what that looks like.
  **The verbatim copy still gets its `<TemplateURL>` rewritten** to the copy in
  *this* repo — dockerMan uses it for update checks and it must name the file
  CA actually distributes, so the app repo leaves the element empty.
- **The demo directories are committed, already built.** `nesolume/demo`,
  `srt-router/demo/dist`, `zero-eq/web/public` and the rest need no build stage.
  Adding one invents work with no inputs.
- **`.dockerignore` paths need leading slashes.** A bare `dist` also matches
  `demo/dist`, which is the entire payload of the srt-router demo image.
- **The generator and Dependabot will fight over action versions, and the
  generator wins silently.** The workflow it emits is a generated file, so
  Dependabot raises bumps against it *in each app repo*; those get merged; and
  the next `gen-docker.mjs` run reverts every one of them without saying so.
  Found 2026-08-20 with eight repos already ahead of the generator, and the
  fleet bumped unevenly — five were on `build-push-action@v7` while the rest
  sat on v6.

  The versions now live in **`fleet.json` → `actions`**, so there is one place
  to bump. Two rules follow:
  1. When a Dependabot PR bumps one of these in an app repo, bump it here too.
  2. Pin to the **highest major already adopted anywhere in the fleet**. Pinning
     lower reverts merged PRs exactly as the hard-coded versions did.

  Check before committing a regeneration:

  ```bash
  git -C <repo> diff -U0 .github/workflows/docker.yml | grep -E '^[+-].*uses:'
  ```

  A removed version higher than the added one is a downgrade — stop.

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
