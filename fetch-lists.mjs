#!/usr/bin/env node
// Fetches iNatur magazine list articles and matches cabin IDs against public/cabins-data.json.
// Usage: npm run fetch-lists
//
// Source: tips.inatur.no article HTML only. IDs come from
// https://www.inatur.no/hytte/{24-hex-id} after HTML-entity unescape.
// Match is by cabins[].id only — never by name. Unknown IDs are skipped and logged.
//
// Start set is SEED_URLS union URLs already in lists-data.json. Each fetched
// article can queue other tips.inatur.no article links, capped at 20 extra
// fetches. A newly discovered page is a list only if it matches ≥3 dump IDs.
// Seeds and already-known lists stay included. A one-off 404 keeps last week's entry.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const CABINS_PATH = 'public/cabins-data.json';
const OUTPUT_PATH = 'public/lists-data.json';
const LOG_PATH = 'public/lists-unmatched.json';

export const SEED_URLS = [
  'https://tips.inatur.no/fjellstyrene-statskog/15-mest-populaere-hytter-pa-inatur-i-2025/134880',
  'https://tips.inatur.no/fjellstyrene-statskog/vare-mest-populaere-hytter-i-2024/131802',
  'https://tips.inatur.no/fiske-jakt/de-mest-populaere-hyttene-pa-inatur-i-2023/100228',
  'https://tips.inatur.no/10-hytter-alle-vil-bo-pa/103509',
  'https://tips.inatur.no/10-hytteperler-til-under-500-natta/133120',
  'https://tips.inatur.no/fem-hytter-for-to/137489',
  'https://tips.inatur.no/hyttetips-for-den-norske-sommeren/133303',
];

export const MAX_EXTRA_FETCHES = 20;
export const MIN_MATCHED_CABIN_IDS = 3;

const CABIN_URL_RE = /https:\/\/www\.inatur\.no\/hytte\/([0-9a-fA-F]{24})/g;
const USER_AGENT = 'hytteoversikt-list-ingest/1.0';
const TIPS_ORIGIN = 'https://tips.inatur.no';

export function unescapeHtml(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function unescapeJsString(text) {
  return String(text)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

export function extractCabinIds(html) {
  const decoded = unescapeHtml(html);
  const ids = [];
  const seen = new Set();
  for (const match of decoded.matchAll(CABIN_URL_RE)) {
    const id = match[1].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function extractTitle(html) {
  const pageData = html.match(/\btitle:\s*'((?:\\.|[^'])*)'/);
  if (pageData) {
    const title = unescapeHtml(unescapeJsString(pageData[1])).replace(/\s+/g, ' ').trim();
    if (title) return title;
  }
  const og = html.match(/property="og:title"\s+content="([^"]*)"/);
  if (og) {
    const title = unescapeHtml(og[1]).replace(/\s+/g, ' ').trim();
    if (title) return title;
  }
  const tag = html.match(/<title>([^<]+)<\/title>/i);
  if (tag) return unescapeHtml(tag[1]).replace(/\s+/g, ' ').trim();
  return '';
}

export function extractPublishedAt(html) {
  const meta = html.match(/property="article:published_time"\s+content="([^"]+)"/);
  if (meta) return meta[1];
  const pageData = html.match(/\bpublished:\s*'([^']+)'/);
  return pageData ? pageData[1] : null;
}

export function normalizeListUrl(raw) {
  if (!raw) return null;
  const text = unescapeHtml(String(raw)).replace(/\\\//g, '/').trim();
  let url;
  try {
    url = new URL(text, TIPS_ORIGIN);
  } catch {
    return null;
  }
  if (url.hostname !== 'tips.inatur.no') return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!/\/\d+$/.test(path)) return null;
  return `${TIPS_ORIGIN}${path}`;
}

export function articleIdFromUrl(raw) {
  const url = normalizeListUrl(raw);
  if (!url) return null;
  const match = url.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

function preferArticleUrl(candidate, current) {
  const candidateShort = /\/a\/\d+$/.test(candidate);
  const currentShort = /\/a\/\d+$/.test(current);
  if (candidateShort !== currentShort) return !candidateShort;
  return candidate.length > current.length;
}

export function extractArticleLinks(html) {
  const decoded = unescapeHtml(html).replace(/\\\//g, '/');
  const byId = new Map();
  const consider = (raw) => {
    const url = normalizeListUrl(raw);
    const id = articleIdFromUrl(url);
    if (!url || !id) return;
    const prev = byId.get(id);
    if (!prev || preferArticleUrl(url, prev)) byId.set(id, url);
  };
  for (const match of decoded.matchAll(/https:\/\/tips\.inatur\.no\/[^\s"'<>\\]*/gi)) {
    consider(match[0]);
  }
  for (const match of decoded.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    consider(match[1]);
  }
  return [...byId.values()];
}

export function extractCanonicalUrl(html) {
  const canonical = html.match(/rel="canonical"\s+href="([^"]+)"/i);
  if (canonical) {
    const url = normalizeListUrl(canonical[1]);
    if (url) return url;
  }
  const og = html.match(/property="og:url"\s+content="([^"]+)"/i);
  if (og) {
    const url = normalizeListUrl(og[1]);
    if (url) return url;
  }
  return null;
}

export function loadExistingLists(path = OUTPUT_PATH) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data || !Array.isArray(data.lists)) return [];
    return data.lists.filter((list) => list && list.url);
  } catch {
    return [];
  }
}

export function buildStartUrls(seedUrls, existingLists) {
  const urls = [];
  const seenIds = new Set();
  for (const raw of [...seedUrls, ...existingLists.map((list) => list.url)]) {
    const url = normalizeListUrl(raw);
    const id = articleIdFromUrl(url);
    if (!url || !id || seenIds.has(id)) continue;
    seenIds.add(id);
    urls.push(url);
  }
  return urls;
}

export function acceptList(isKnown, matchedCount) {
  return isKnown || matchedCount >= MIN_MATCHED_CABIN_IDS;
}

export function listsNewestFirst(lists) {
  return [...lists].sort((a, b) => {
    const aAt = a.publishedAt;
    const bAt = b.publishedAt;
    if (aAt && bAt && aAt !== bAt) return aAt < bAt ? 1 : -1;
    if (aAt && !bAt) return -1;
    if (!aAt && bAt) return 1;
    return 0;
  });
}

export function enqueueDiscoveredLinks(html, seenIds, extraQueued, maxExtra = MAX_EXTRA_FETCHES) {
  const queued = [];
  let extras = extraQueued;
  for (const link of extractArticleLinks(html)) {
    const id = articleIdFromUrl(link);
    if (!id || seenIds.has(id)) continue;
    if (extras >= maxExtra) continue;
    seenIds.add(id);
    extras += 1;
    queued.push(link);
  }
  return { queued, extraQueued: extras };
}

async function fetchArticle(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (res.status === 404) return { status: 404, html: null };
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return { status: res.status, html: await res.text() };
}

function loadCabinIds() {
  const data = JSON.parse(readFileSync(CABINS_PATH, 'utf8'));
  const ids = new Set((data.cabins || []).map((c) => String(c.id).toLowerCase()));
  if (!ids.size) throw new Error(`${CABINS_PATH} has no cabins[].id values`);
  return ids;
}

function previousByArticleId(lists) {
  const byId = new Map();
  for (const list of lists) {
    const id = articleIdFromUrl(list.url);
    if (id) byId.set(id, list);
  }
  return byId;
}

async function main() {
  const dumpIds = loadCabinIds();
  const existing = loadExistingLists();
  const startUrls = buildStartUrls(SEED_URLS, existing);
  const startIds = new Set(startUrls.map(articleIdFromUrl));
  const resultById = previousByArticleId(existing);
  const unmatched = [];
  const skippedUrls = [];

  const seenIds = new Set(startIds);
  const queue = [...startUrls];
  let extraQueued = 0;

  console.log('Henter iNatur-lister fra tips.inatur.no...\n');

  for (let i = 0; i < queue.length; i++) {
    const url = queue[i];
    const articleId = articleIdFromUrl(url);
    const isKnown = startIds.has(articleId);
    const { status, html } = await fetchArticle(url);

    if (status === 404) {
      skippedUrls.push(url);
      if (articleId && resultById.has(articleId)) {
        console.log(`  KEEP 404  ${url}`);
      } else {
        console.log(`  SKIP 404  ${url}`);
      }
      continue;
    }

    const discovered = enqueueDiscoveredLinks(html, seenIds, extraQueued);
    extraQueued = discovered.extraQueued;
    queue.push(...discovered.queued);

    const title = extractTitle(html);
    const publishedAt = extractPublishedAt(html);
    const pageUrl = extractCanonicalUrl(html) || url;
    const extractedIds = extractCabinIds(html);
    const cabinIds = [];

    for (const id of extractedIds) {
      if (dumpIds.has(id)) {
        cabinIds.push(id);
        continue;
      }
      unmatched.push({ id, url: pageUrl, title });
      console.log(`  UNMATCHED  ${id}  (${title || pageUrl})`);
    }

    if (!acceptList(isKnown, cabinIds.length)) {
      console.log(`  SKIP not-a-list  ${cabinIds.length}/${extractedIds.length}  ${title || pageUrl}`);
      continue;
    }

    const key = articleIdFromUrl(pageUrl) || articleId;
    resultById.set(key, { title, url: pageUrl, publishedAt, cabinIds });
    console.log(`  OK  ${cabinIds.length}/${extractedIds.length}  ${title}`);
  }

  const lists = listsNewestFirst([...resultById.values()]);
  const fetchedAt = new Date().toISOString();
  const data = { fetchedAt, lists };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n');
  writeFileSync(LOG_PATH, JSON.stringify({ fetchedAt, unmatched, skippedUrls }, null, 2) + '\n');

  const listed = new Set(lists.flatMap((l) => l.cabinIds));
  console.log(`\nResultat:`);
  console.log(`  ${lists.length} lister`);
  console.log(`  ${listed.size} unike hytter på lister`);
  console.log(`  ${unmatched.length} umatchede IDer`);
  console.log(`  ${skippedUrls.length} URL-er hoppet over (404)`);
  console.log(`  ${extraQueued} ekstra artikkel-fetch`);
  console.log(`\nLagret til ${OUTPUT_PATH}`);
  console.log(`Umatchede IDer: ${LOG_PATH}`);
}

const isMain = process.argv[1] && process.argv[1].endsWith('fetch-lists.mjs');
if (isMain) {
  main().catch((e) => {
    console.error('Feil:', e);
    process.exit(1);
  });
}
