#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildBody, listRefreshStats } from './cabin-refresh-summary.mjs';

const cabin = (id) => ({
  id,
  name: `Cabin ${id}`,
  lat: 61,
  lng: 8,
  coordSource: 'exact',
});

const prev = {
  fetchedAt: '2026-08-01T00:00:00.000Z',
  count: 2,
  countWithCoords: 2,
  cabins: [cabin('a'), cabin('b')],
};
const next = {
  fetchedAt: '2026-09-01T00:00:00.000Z',
  count: 2,
  countWithCoords: 2,
  cabins: [cabin('a'), cabin('b')],
};
const occupancy = { snapshots: [{ fetchedAt: '2026-09-01T00:00:00.000Z', soldOutIds: ['a'] }] };

{
  const stats = listRefreshStats(
    { lists: [{ url: 'https://tips.inatur.no/old/1' }] },
    {
      lists: [
        { url: 'https://tips.inatur.no/old/1' },
        { url: 'https://tips.inatur.no/new/2' },
      ],
    },
    { skippedUrls: ['https://tips.inatur.no/missing/3'] },
    'ok'
  );
  assert.equal(stats.count, 2);
  assert.deepEqual(stats.newUrls, ['https://tips.inatur.no/new/2']);
  assert.deepEqual(stats.notFoundUrls, ['https://tips.inatur.no/missing/3']);
  assert.deepEqual(stats.droppedUrls, []);
}

{
  const body = buildBody(
    prev,
    next,
    occupancy,
    listRefreshStats(
      { lists: [{ url: 'https://tips.inatur.no/old/1' }] },
      {
        lists: [
          { url: 'https://tips.inatur.no/old/1' },
          { url: 'https://tips.inatur.no/new/2' },
        ],
      },
      { skippedUrls: ['https://tips.inatur.no/missing/3'] },
      'ok'
    )
  );
  assert.match(body, /## Magazine lists/);
  assert.match(body, /\| 2 \| 1 \| 1 \| 0 \|/);
  assert.match(body, /New URLs/);
  assert.match(body, /https:\/\/tips\.inatur\.no\/new\/2/);
  assert.match(body, /404s \(entry kept if already known\)/);
  assert.match(body, /npm run fetch-lists/);
  assert.match(body, /public\/lists-data\.json/);
}

{
  const body = buildBody(
    prev,
    next,
    occupancy,
    listRefreshStats(
      { lists: [{ url: 'https://tips.inatur.no/old/1' }] },
      { lists: [{ url: 'https://tips.inatur.no/old/1' }] },
      { skippedUrls: [] },
      'failed'
    )
  );
  assert.match(body, /List ingest failed/);
  assert.match(body, /\*\*1\*\* lists/);
  assert.doesNotMatch(body, /New URLs/);
}

console.log('cabin-refresh-summary tests passed');
