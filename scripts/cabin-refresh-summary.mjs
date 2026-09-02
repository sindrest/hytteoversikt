#!/usr/bin/env node
// Compare two cabins-data.json dumps and write a PR body for the weekday refresh Action.
// Usage:
//   node scripts/cabin-refresh-summary.mjs \
//     --prev /tmp/cabins-data.prev.json \
//     --next public/cabins-data.json \
//     --out /tmp/cabin-refresh-pr-body.md
//
// If only fetchedAt changed, restores --next from --prev so the Action
// does not open a no-op PR. Sets GitHub Actions outputs when GITHUB_OUTPUT is set.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    out[key] = value;
    i++;
  }
  return out;
}

function loadDump(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || !Array.isArray(data.cabins)) {
    throw new Error(`${path} is not a valid cabins-data.json dump`);
  }
  return data;
}

function stats(data) {
  const total = Number.isFinite(data.count) ? data.count : data.cabins.length;
  const withCoords = Number.isFinite(data.countWithCoords)
    ? data.countWithCoords
    : data.cabins.filter((c) => c.lat && c.lng).length;
  return {
    fetchedAt: data.fetchedAt || 'unknown',
    total,
    withCoords,
    missing: total - withCoords,
  };
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

function stripFetchedAt({ fetchedAt, ...rest }) {
  return rest;
}

function isMaterialChange(prev, next) {
  return JSON.stringify(stripFetchedAt(prev)) !== JSON.stringify(stripFetchedAt(next));
}

function missingCabins(data) {
  return (data.cabins || []).filter((c) => !c.lat || !c.lng);
}

function buildBody(prev, next) {
  const a = stats(prev);
  const b = stats(next);
  const missing = missingCabins(next);

  let body = `Refresh the static iNatur cabin dump in \`public/cabins-data.json\`. Opened automatically by the weekday refresh workflow (no push to \`main\`).

## Before / after

| | fetchedAt | total | with coords | missing coords |
|---|---|---|---|---|
| **previous** | ${a.fetchedAt} | ${a.total} | ${a.withCoords} | ${a.missing} |
| **this refresh** | ${b.fetchedAt} | ${b.total} | ${b.withCoords} | ${b.missing} |

Net change: **${signed(b.total - a.total)} cabins**, ${signed(b.withCoords - a.withCoords)} with coordinates, **${signed(b.missing - a.missing)} still missing coordinates**.

## Missing coordinates

**${b.missing} cabins still have no coordinates** after this refresh (${a.missing} → ${b.missing}). Those listings are in the dump but cannot be placed on the map until iNatur/ArcGIS provides geometry.
`;

  if (missing.length) {
    const rows = missing
      .map((c) => `- ${c.name || '(unnamed)'} (\`${c.id}\`)`)
      .join('\n');
    body += `\n<details>\n<summary>${missing.length} cabins missing coordinates</summary>\n\n${rows}\n</details>\n`;
  }

  body += `\n## Source\n\nGenerated with \`npm run fetch-cabins\` (iNatur search + ArcGIS \`Open-Inatur\` overlay). Only \`public/cabins-data.json\` is updated.\n`;
  return body;
}

function writeGithubOutput(name, value) {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) return;
  writeFileSync(dest, `${name}=${value}\n`, { flag: 'a' });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.prev || !args.next || !args.out) {
    throw new Error('Required: --prev <path> --next <path> --out <path>');
  }

  const prev = loadDump(args.prev);
  const next = loadDump(args.next);
  const prevStats = stats(prev);
  const nextStats = stats(next);

  if (nextStats.total === 0) {
    throw new Error('Refreshed dump has 0 cabins; refusing to open a PR');
  }
  if (prevStats.total > 0 && nextStats.total < Math.floor(prevStats.total * 0.5)) {
    throw new Error(
      `Refreshed dump dropped from ${prevStats.total} to ${nextStats.total} cabins; refusing to open a PR`
    );
  }

  writeFileSync(args.out, buildBody(prev, next));

  const material = isMaterialChange(prev, next);
  if (!material) {
    copyFileSync(args.prev, args.next);
    console.log('No material cabin changes (only fetchedAt); restored previous dump.');
  } else {
    console.log('Material cabin changes detected; leaving refreshed dump in place.');
  }

  console.log(
    `previous=${prevStats.total} (${prevStats.withCoords} coords, ${prevStats.missing} missing) → ` +
      `new=${nextStats.total} (${nextStats.withCoords} coords, ${nextStats.missing} missing)`
  );

  writeGithubOutput('material_change', material ? 'true' : 'false');
  writeGithubOutput('previous_count', String(prevStats.total));
  writeGithubOutput('new_count', String(nextStats.total));
  writeGithubOutput('with_coords', String(nextStats.withCoords));
  writeGithubOutput('missing_coords', String(nextStats.missing));
}

main();
