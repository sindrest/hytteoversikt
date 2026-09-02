#!/usr/bin/env node
// Fetches iNatur magazine list articles and matches cabin IDs against public/cabins-data.json.
// Usage: npm run fetch-lists
//
// Source: tips.inatur.no article HTML only. IDs come from
// https://www.inatur.no/hytte/{24-hex-id} after HTML-entity unescape.
// Match is by cabins[].id only — never by name. Unknown IDs are skipped and logged.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const CABINS_PATH = 'public/cabins-data.json';
const OUTPUT_PATH = 'public/lists-data.json';
const LOG_PATH = 'public/lists-unmatched.json';

const SEED_URLS = [
  'https://tips.inatur.no/fjellstyrene-statskog/15-mest-populaere-hytter-pa-inatur-i-2025/134880',
  'https://tips.inatur.no/fjellstyrene-statskog/vare-mest-populaere-hytter-i-2024/131802',
  'https://tips.inatur.no/fiske-jakt/de-mest-populaere-hyttene-pa-inatur-i-2023/100228',
  'https://tips.inatur.no/10-hytter-alle-vil-bo-pa/103509',
  'https://tips.inatur.no/10-hytteperler-til-under-500-natta/133120',
  'https://tips.inatur.no/fem-hytter-for-to/137489',
  'https://tips.inatur.no/hyttetips-for-den-norske-sommeren/133303',
];

const CABIN_URL_RE = /https:\/\/www\.inatur\.no\/hytte\/([0-9a-fA-F]{24})/g;
const USER_AGENT = 'hytteoversikt-list-ingest/1.0';

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
  const ids = new Set((data.cabins || []).map(c => String(c.id).toLowerCase()));
  if (!ids.size) throw new Error(`${CABINS_PATH} has no cabins[].id values`);
  return ids;
}

async function main() {
  const dumpIds = loadCabinIds();
  const lists = [];
  const unmatched = [];
  const skippedUrls = [];

  console.log('Henter iNatur-lister fra tips.inatur.no...\n');

  for (const url of SEED_URLS) {
    const { status, html } = await fetchArticle(url);
    if (status === 404) {
      console.log(`  SKIP 404  ${url}`);
      skippedUrls.push(url);
      continue;
    }

    const title = extractTitle(html);
    const publishedAt = extractPublishedAt(html);
    const extractedIds = extractCabinIds(html);
    const cabinIds = [];

    for (const id of extractedIds) {
      if (dumpIds.has(id)) {
        cabinIds.push(id);
        continue;
      }
      unmatched.push({ id, url, title });
      console.log(`  UNMATCHED  ${id}  (${title || url})`);
    }

    lists.push({ title, url, publishedAt, cabinIds });
    console.log(`  OK  ${cabinIds.length}/${extractedIds.length}  ${title}`);
  }

  const fetchedAt = new Date().toISOString();
  const data = { fetchedAt, lists };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n');
  writeFileSync(LOG_PATH, JSON.stringify({ fetchedAt, unmatched, skippedUrls }, null, 2) + '\n');

  const listed = new Set(lists.flatMap(l => l.cabinIds));
  console.log(`\nResultat:`);
  console.log(`  ${lists.length} lister`);
  console.log(`  ${listed.size} unike hytter på lister`);
  console.log(`  ${unmatched.length} umatchede IDer`);
  console.log(`  ${skippedUrls.length} URL-er hoppet over (404)`);
  console.log(`\nLagret til ${OUTPUT_PATH}`);
  console.log(`Umatchede IDer: ${LOG_PATH}`);
}

const isMain = process.argv[1] && process.argv[1].endsWith('fetch-lists.mjs');
if (isMain) {
  main().catch(e => {
    console.error('Feil:', e);
    process.exit(1);
  });
}
