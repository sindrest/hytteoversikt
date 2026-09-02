#!/usr/bin/env node
// Compare two cabins-data.json dumps and write a PR body for the weekday refresh Action.
// Usage:
//   node scripts/cabin-refresh-summary.mjs \
//     --prev /tmp/cabins-data.prev.json \
//     --next public/cabins-data.json \
//     --occupancy public/occupancy-history.json \
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

function coordSourceOf(cabin) {
  if (cabin?.coordSource) return cabin.coordSource;
  return cabin?.lat && cabin?.lng ? 'exact' : 'none';
}

function coordSourceCounts(data) {
  const counts = { exact: 0, municipality: 0, county: 0, none: 0 };
  for (const cabin of data.cabins || []) {
    const source = coordSourceOf(cabin);
    if (Object.prototype.hasOwnProperty.call(counts, source)) {
      counts[source] += 1;
    }
  }
  return counts;
}

function stats(data) {
  const total = Number.isFinite(data.count) ? data.count : data.cabins.length;
  const sources = coordSourceCounts(data);
  const withCoords = Number.isFinite(data.countWithCoords) ? data.countWithCoords : sources.exact;
  return {
    fetchedAt: data.fetchedAt || 'unknown',
    total,
    withCoords,
    missing: sources.municipality + sources.county + sources.none,
    sources,
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

function estimatedCabins(data) {
  return (data.cabins || []).filter((c) => coordSourceOf(c) !== 'exact');
}

function occupancyStats(history) {
  const snapshots = history?.snapshots || [];
  const latest = snapshots[snapshots.length - 1];
  return {
    count: snapshots.length,
    latestFetchedAt: latest?.fetchedAt || 'none',
    latestSoldOut: latest?.soldOutIds?.length ?? 0,
  };
}

function buildBody(prev, next, occupancy) {
  const a = stats(prev);
  const b = stats(next);
  const estimated = estimatedCabins(next);
  const occ = occupancyStats(occupancy);

  let body = `Refresh the static iNatur cabin dump in \`public/cabins-data.json\` and append one occupancy snapshot to \`public/occupancy-history.json\`. Opened automatically by the weekday refresh workflow (no push to \`main\`).

## Before / after

| | fetchedAt | total | exact | municipality | county | none |
|---|---|---|---|---|---|---|
| **previous** | ${a.fetchedAt} | ${a.total} | ${a.sources.exact} | ${a.sources.municipality} | ${a.sources.county} | ${a.sources.none} |
| **this refresh** | ${b.fetchedAt} | ${b.total} | ${b.sources.exact} | ${b.sources.municipality} | ${b.sources.county} | ${b.sources.none} |

Net change: **${signed(b.total - a.total)} cabins**, ${signed(b.withCoords - a.withCoords)} exact iNatur/ArcGIS coordinates.

## Occupancy history

| snapshots | latest fetchedAt | soldOut in latest |
|---|---|---|
| ${occ.count} | ${occ.latestFetchedAt} | ${occ.latestSoldOut} |

One snapshot per UTC date from the new dump's \`soldOut\` (\`utsolgt\`). Same-date reruns are skipped. Oldest weeks are dropped after 52.

## Coordinate sources

Pins without iNatur/ArcGIS geometry are municipality (then county) centroids of already-mapped cabins. No geocoder. \`countWithCoords\` is exact only.

**${b.sources.municipality} municipality**, **${b.sources.county} county**, **${b.sources.none} none** after this refresh.
`;

  if (estimated.length) {
    const rows = estimated
      .map((c) => `- ${c.name || '(unnamed)'} (\`${c.id}\`) — ${coordSourceOf(c)}`)
      .join('\n');
    body += `\n<details>\n<summary>${estimated.length} cabins without exact coordinates</summary>\n\n${rows}\n</details>\n`;
  }

  body += `\n## Source\n\nGenerated with \`npm run fetch-cabins\` (iNatur search + ArcGIS \`Open-Inatur\` overlay, plus municipality/county centroid estimates) and \`npm run append-occupancy\`. The PR includes \`public/cabins-data.json\` and \`public/occupancy-history.json\`.\n`;
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
  const occupancy = args.occupancy
    ? JSON.parse(readFileSync(args.occupancy, 'utf8'))
    : { snapshots: [] };
  if (args.occupancy && !Array.isArray(occupancy.snapshots)) {
    throw new Error(`${args.occupancy} is not a valid occupancy-history.json`);
  }
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

  writeFileSync(args.out, buildBody(prev, next, occupancy));

  const material = isMaterialChange(prev, next);
  if (!material) {
    copyFileSync(args.prev, args.next);
    console.log('No material cabin changes (only fetchedAt); restored previous dump.');
  } else {
    console.log('Material cabin changes detected; leaving refreshed dump in place.');
  }

  console.log(
    `previous=${prevStats.total} (exact ${prevStats.sources.exact} / muni ${prevStats.sources.municipality} / county ${prevStats.sources.county} / none ${prevStats.sources.none}) → ` +
      `new=${nextStats.total} (exact ${nextStats.sources.exact} / muni ${nextStats.sources.municipality} / county ${nextStats.sources.county} / none ${nextStats.sources.none})`
  );

  writeGithubOutput('material_change', material ? 'true' : 'false');
  writeGithubOutput('previous_count', String(prevStats.total));
  writeGithubOutput('new_count', String(nextStats.total));
  writeGithubOutput('with_coords', String(nextStats.withCoords));
  writeGithubOutput('missing_coords', String(nextStats.missing));
}

main();
