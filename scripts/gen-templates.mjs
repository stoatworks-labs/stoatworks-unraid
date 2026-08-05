#!/usr/bin/env node
// Generate Unraid Community Applications templates from fleet.json + unraid.json.
//
// Usage: node scripts/gen-templates.mjs
//
// Public apps land in templates/ and are what a CA repository serves.
// Private-repo apps land in templates-private/ — their GHCR packages are private,
// so a public template for them would only ever produce a pull error for anyone
// who is not you. Install those with Add Container after `docker login ghcr.io`.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// Where the fleet is checked out, used only to test whether an icon file exists.
const PROJECTS = process.env.PROJECTS_DIR || join(process.env.HOME, 'Projects');

const fleet = JSON.parse(readFileSync(join(ROOT, 'fleet.json'), 'utf8'));
const unraid = JSON.parse(readFileSync(join(ROOT, 'unraid.json'), 'utf8'));
const REGISTRY = fleet.registry;

// The repo that hosts these templates. CA fetches TemplateURL to check for
// updates, so it has to be the raw URL of the file it is reading.
const TEMPLATE_REPO = 'https://raw.githubusercontent.com/stoatworks-labs/stoatworks-unraid/main';

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Flatten fleet.json into one entry per published image. */
function imageEntries() {
  const out = [];
  for (const app of fleet.apps) {
    out.push({
      image: app.image,
      checkoutDir: app.repo,
      title: app.title,
      desc: app.desc,
      category: app.category,
      note: app.note,
      kind: app.kind,
      port: app.kind.startsWith('static') ? 80 : app.port,
      extraPorts: app.extraPorts || [],
      hostNetwork: !!app.hostNetwork,
      configPath: app.configPath,
      dataPath: app.dataPath,
      portEnv: app.portEnv,
    });

    for (const v of app.variants || []) {
      out.push({
        image: v.image,
        checkoutDir: app.repo,
        title: v.title,
        desc: v.desc,
        category: app.category,
        kind: app.kind,
        port: 80,
        extraPorts: [],
        hostNetwork: false,
      });
    }

    if (app.extraImage) {
      const e = app.extraImage;
      out.push({
        image: e.image,
        checkoutDir: app.repo,
        title: e.title,
        desc: e.desc,
        category: app.category,
        kind: e.kind,
        port: 80,
        extraPorts: [],
        hostNetwork: false,
      });
    }
  }
  return out;
}

function configBlock({ name, target, def, mode, description, type, required = 'false' }) {
  return `  <Config Name="${xmlEscape(name)}" Target="${xmlEscape(target)}" Default="${xmlEscape(
    def,
  )}" Mode="${mode}" Description="${xmlEscape(
    description,
  )}" Type="${type}" Display="always" Required="${required}" Mask="false">${xmlEscape(def)}</Config>`;
}

function template(entry, meta) {
  const isPrivate = meta.visibility === 'private';
  const repo = meta.repo;

  const support = repo ? `${unraid.supportBase}/${repo}/issues` : '';
  const project = repo ? `${unraid.supportBase}/${repo}` : '';

  // An icon is emitted only when the file actually exists in the checkout.
  // Two ways to get this wrong, both of which render as a broken image in the
  // CA grid rather than as an error anyone would notice: pointing at a path no
  // repo has (none of them currently ship docs/icon.png), and pointing at a
  // private repo, where raw.githubusercontent 404s regardless of the path.
  // No icon makes CA fall back to its own placeholder, which looks deliberate.
  const iconRel = 'docs/icon.png';
  const hasIcon =
    !!entry.checkoutDir && !isPrivate && existsSync(join(PROJECTS, entry.checkoutDir, iconRel));
  const icon = hasIcon ? `${unraid.iconBase}/${repo}/main/${iconRel}` : '';

  const overview = [
    entry.desc,
    entry.note ? `\n\nNote: ${entry.note}` : '',
    // Only the apps whose own note does not already explain bridge mode get the
    // generic paragraph. Where a note spells out which module does the
    // discovering, appending this as well says the same thing twice in one
    // Overview box.
    entry.hostNetwork && !/bridge/i.test(entry.note ?? '')
      ? `\n\nThis container uses host networking because it discovers devices over mDNS/broadcast, which Docker's bridge network does not reliably forward. In bridge mode discovery finds nothing rather than reporting an error.`
      : '',
    isPrivate
      ? `\n\nThis image is published from a private repository, so its GHCR package is private too. Run 'docker login ghcr.io' on the server before installing.`
      : '',
  ].join('');

  const configs = [];

  if (!entry.hostNetwork) {
    configs.push(
      configBlock({
        name: 'WebUI Port',
        target: String(entry.port),
        def: String(meta.hostPort ?? entry.port),
        mode: 'tcp',
        description: 'Host port for the web interface.',
        type: 'Port',
        required: 'true',
      }),
    );
    for (const p of entry.extraPorts) {
      configs.push(
        configBlock({
          name: p.what.replace(/\b\w/g, (c) => c.toUpperCase()),
          target: String(p.port),
          def: String(p.port),
          mode: p.proto || 'tcp',
          description: `${p.what} (${(p.proto || 'tcp').toUpperCase()}).`,
          type: 'Port',
        }),
      );
    }
  }

  if (entry.configPath) {
    configs.push(
      configBlock({
        name: 'Config',
        target: entry.configPath,
        def: `/mnt/user/appdata/${entry.image}/config`,
        mode: 'rw',
        description: 'Configuration files.',
        type: 'Path',
        required: 'true',
      }),
    );
  }

  if (entry.dataPath) {
    configs.push(
      configBlock({
        name: 'Data',
        target: entry.dataPath,
        def: `/mnt/user/appdata/${entry.image}/data`,
        mode: 'rw',
        description: 'Persistent application data.',
        type: 'Path',
        required: 'true',
      }),
    );
  }

  if (entry.portEnv) {
    configs.push(
      configBlock({
        name: 'Listen Port',
        target: entry.portEnv,
        def: String(entry.port),
        mode: '',
        description: 'Port the server binds to inside the container.',
        type: 'Variable',
      }),
    );
  }

  // On host networking the WebUI cannot use a [PORT:x] substitution, because
  // there is no port mapping for Unraid to substitute from — the container is
  // on the host's own stack. The literal port is correct there and only there.
  const webui = entry.hostNetwork
    ? `http://[IP]:${entry.port}/`
    : `http://[IP]:[PORT:${entry.port}]/`;

  return `<?xml version="1.0"?>
<!--
  Generated by stoatworks-unraid/scripts/gen-templates.mjs.
  Edit fleet.json / unraid.json and regenerate — direct edits are overwritten.
-->
<Container version="2">
  <Name>${xmlEscape(entry.image)}</Name>
  <Repository>${REGISTRY}/${entry.image}:latest</Repository>
  <Registry>https://github.com/orgs/stoatworks-labs/packages</Registry>
  <Network>${entry.hostNetwork ? 'host' : 'bridge'}</Network>
  <MyIP/>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <Support>${support}</Support>
  <Project>${project}</Project>
  <Overview>${xmlEscape(overview)}</Overview>
  <Category>${xmlEscape(entry.category || 'Tools:Utilities:')}</Category>
  <WebUI>${webui}</WebUI>
  <TemplateURL>${TEMPLATE_REPO}/templates/${entry.image}.xml</TemplateURL>
  <Icon>${icon}</Icon>
  <ExtraParams/>
  <PostArgs/>
  <CPUset/>
  <DateInstalled/>
  <DonateText/>
  <DonateLink/>
  <Requires/>
${configs.join('\n')}
</Container>
`;
}

// ---------------------------------------------------------------------------

rmSync(join(ROOT, 'templates'), { recursive: true, force: true });
rmSync(join(ROOT, 'templates-private'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'templates'), { recursive: true });
mkdirSync(join(ROOT, 'templates-private'), { recursive: true });

const summary = { public: [], private: [], skipped: [] };

for (const entry of imageEntries()) {
  const meta = unraid.apps[entry.image];
  if (!meta) {
    summary.skipped.push(`${entry.image}: no entry in unraid.json`);
    continue;
  }
  if (meta.visibility === 'none') {
    summary.skipped.push(
      `${entry.image}: no git remote, so no published image — Dockerfile only, no template`,
    );
    continue;
  }

  const dir = meta.visibility === 'private' ? 'templates-private' : 'templates';
  writeFileSync(join(ROOT, dir, `${entry.image}.xml`), template(entry, meta));
  summary[meta.visibility === 'private' ? 'private' : 'public'].push(entry.image);
}

console.log(`templates/          ${summary.public.length} public`);
for (const s of summary.public) console.log('  ' + s);
console.log(`templates-private/  ${summary.private.length} private`);
for (const s of summary.private) console.log('  ' + s);
if (summary.skipped.length) {
  console.log(`skipped             ${summary.skipped.length}`);
  for (const s of summary.skipped) console.log('  ' + s);
}
