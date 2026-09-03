#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  SEED_URLS,
  MAX_EXTRA_FETCHES,
  MIN_MATCHED_CABIN_IDS,
  acceptList,
  articleIdFromUrl,
  buildStartUrls,
  enqueueDiscoveredLinks,
  extractArticleLinks,
  extractCabinIds,
  extractCanonicalUrl,
  listsNewestFirst,
  normalizeListUrl,
} from '../fetch-lists.mjs';

assert.equal(MAX_EXTRA_FETCHES, 20);
assert.equal(MIN_MATCHED_CABIN_IDS, 3);
assert.equal(SEED_URLS.length, 7);

{
  assert.equal(
    normalizeListUrl('https://tips.inatur.no/fem-hytter-for-to/137489?lab_viewport=oembed#primaryimage'),
    'https://tips.inatur.no/fem-hytter-for-to/137489'
  );
  assert.equal(
    normalizeListUrl('/fjellstyrene-trondelag/ukjente-hytteperler-hos-fjellstyrene-i-trondelag/137148'),
    'https://tips.inatur.no/fjellstyrene-trondelag/ukjente-hytteperler-hos-fjellstyrene-i-trondelag/137148'
  );
  assert.equal(normalizeListUrl('https://tips.inatur.no/tag/hytter'), null);
  assert.equal(normalizeListUrl('https://tips.inatur.no/cookies'), null);
  assert.equal(normalizeListUrl('https://tips.inatur.no'), null);
  assert.equal(articleIdFromUrl('https://tips.inatur.no/a/137489'), '137489');
  assert.equal(articleIdFromUrl(SEED_URLS[5]), '137489');
}

{
  const html = `
    <link rel="canonical" href="https://tips.inatur.no/fem-hytter-for-to/137489">
    <a href="/fjellstyrene-trondelag/ukjente-hytteperler-hos-fjellstyrene-i-trondelag/137148">list</a>
    <a href="https://tips.inatur.no/a/137148">alias</a>
    <a href="https://tips.inatur.no/a/136425">short</a>
    <a href="https://tips.inatur.no/tag/hytter">tag</a>
    <a href="https://tips.inatur.no/cookies">cookies</a>
    <a href="https://www.inatur.no/hytte/50f6ab1fe4b0b1d864388a15">cabin</a>
  `;
  const links = extractArticleLinks(html);
  assert.deepEqual(new Set(links), new Set([
    'https://tips.inatur.no/fem-hytter-for-to/137489',
    'https://tips.inatur.no/fjellstyrene-trondelag/ukjente-hytteperler-hos-fjellstyrene-i-trondelag/137148',
    'https://tips.inatur.no/a/136425',
  ]));
  assert.equal(extractCanonicalUrl(html), 'https://tips.inatur.no/fem-hytter-for-to/137489');
}

{
  const existing = [
    { url: SEED_URLS[0], title: 'seed' },
    { url: 'https://tips.inatur.no/discovered-list/999001', title: 'known extra' },
  ];
  const start = buildStartUrls(SEED_URLS, existing);
  assert.equal(start.length, 8);
  assert.deepEqual(start.slice(0, 7), SEED_URLS.map((url) => normalizeListUrl(url)));
  assert.equal(start[7], 'https://tips.inatur.no/discovered-list/999001');
  assert.ok(acceptList(true, 0));
  assert.ok(acceptList(false, 3));
  assert.equal(acceptList(false, 2), false);
}

{
  const html = `
    <a href="/one/111111">one</a>
    <a href="/two/222222">two</a>
    <a href="${SEED_URLS[0]}">seed</a>
  `;
  const seenIds = new Set([articleIdFromUrl(SEED_URLS[0])]);
  const first = enqueueDiscoveredLinks(html, seenIds, 0, 1);
  assert.deepEqual(first.queued, ['https://tips.inatur.no/one/111111']);
  assert.equal(first.extraQueued, 1);
  const second = enqueueDiscoveredLinks(html, seenIds, first.extraQueued, 1);
  assert.deepEqual(second.queued, []);
  assert.equal(second.extraQueued, 1);
}

{
  const ids = extractCabinIds(`
    <a href="https://www.inatur.no/hytte/50f6ab1fe4b0b1d864388a15">a</a>
    <a href="https://www.inatur.no/hytte/5418288ae4b08d9e585e80b9">b</a>
    <a href="https://www.inatur.no/hytte/50f6ab1fe4b0b1d864388a15">dup</a>
  `);
  assert.deepEqual(ids, ['50f6ab1fe4b0b1d864388a15', '5418288ae4b08d9e585e80b9']);
}

{
  const previous = {
    title: 'Kept',
    url: 'https://tips.inatur.no/kept-list/123456',
    publishedAt: '2025-01-01T00:00:00.000Z',
    cabinIds: ['50f6ab1fe4b0b1d864388a15'],
  };
  const resultById = new Map([['123456', previous]]);
  const skippedUrls = [];
  const status = 404;
  skippedUrls.push(previous.url);
  assert.equal(status, 404);
  assert.equal(resultById.get('123456'), previous);
  assert.deepEqual(skippedUrls, [previous.url]);
}

{
  const sorted = listsNewestFirst([
    { url: 'old', publishedAt: '2024-01-01T00:00:00.000Z' },
    { url: 'new', publishedAt: '2026-08-20T09:54:40.000Z' },
    { url: 'mid', publishedAt: '2025-06-18T21:01:00.000Z' },
    { url: 'none', publishedAt: null },
  ]);
  assert.deepEqual(sorted.map((list) => list.url), ['new', 'mid', 'old', 'none']);
}

console.log('fetch-lists tests passed');
