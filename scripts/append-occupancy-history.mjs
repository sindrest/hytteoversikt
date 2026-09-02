#!/usr/bin/env node
// After fetch-cabins, append one soldOut snapshot to public/occupancy-history.json.
// Skip if a snapshot for the same UTC date already exists. Keep 52 weeks.
// Usage:
//   node scripts/append-occupancy-history.mjs
//   node scripts/append-occupancy-history.mjs \
//     --dump public/cabins-data.json \
//     --history public/occupancy-history.json

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MAX_SNAPSHOTS = 52;
const DEFAULT_DUMP = 'public/cabins-data.json';
const DEFAULT_HISTORY = 'public/occupancy-history.json';

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

function utcDateKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid fetchedAt: ${iso}`);
  }
  return d.toISOString().slice(0, 10);
}

function loadDump(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || !Array.isArray(data.cabins)) {
    throw new Error(`${path} is not a valid cabins-data.json dump`);
  }
  if (!data.fetchedAt) {
    throw new Error(`${path} is missing fetchedAt`);
  }
  return data;
}

function loadHistory(path) {
  if (!existsSync(path)) {
    return { snapshots: [] };
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || !Array.isArray(data.snapshots)) {
    throw new Error(`${path} is not a valid occupancy-history.json`);
  }
  return data;
}

function soldOutIdsFromDump(dump) {
  return dump.cabins.filter((c) => c.soldOut).map((c) => c.id);
}

function writeGithubOutput(name, value) {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) return;
  writeFileSync(dest, `${name}=${value}\n`, { flag: 'a' });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dumpPath = args.dump || DEFAULT_DUMP;
  const historyPath = args.history || DEFAULT_HISTORY;

  const dump = loadDump(dumpPath);
  const history = loadHistory(historyPath);
  const fetchedAt = dump.fetchedAt;
  const dateKey = utcDateKey(fetchedAt);
  const soldOutIds = soldOutIdsFromDump(dump);

  const existing = history.snapshots.find((s) => utcDateKey(s.fetchedAt) === dateKey);
  if (existing) {
    console.log(
      `Skipped occupancy snapshot for ${dateKey} (already present); ` +
        `${history.snapshots.length}/${MAX_SNAPSHOTS} weeks kept.`
    );
    writeGithubOutput('occupancy_appended', 'false');
    writeGithubOutput('occupancy_snapshots', String(history.snapshots.length));
    writeGithubOutput('occupancy_sold_out', String(existing.soldOutIds?.length ?? 0));
    return;
  }

  history.snapshots.push({ fetchedAt, soldOutIds });
  history.snapshots.sort((a, b) => String(a.fetchedAt).localeCompare(String(b.fetchedAt)));
  if (history.snapshots.length > MAX_SNAPSHOTS) {
    history.snapshots = history.snapshots.slice(-MAX_SNAPSHOTS);
  }

  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
  const latest = history.snapshots[history.snapshots.length - 1];
  console.log(
    `Appended occupancy snapshot ${dateKey} (${soldOutIds.length} soldOut); ` +
      `${history.snapshots.length}/${MAX_SNAPSHOTS} weeks kept.`
  );
  writeGithubOutput('occupancy_appended', 'true');
  writeGithubOutput('occupancy_snapshots', String(history.snapshots.length));
  writeGithubOutput('occupancy_sold_out', String(latest.soldOutIds?.length ?? 0));
}

main();
