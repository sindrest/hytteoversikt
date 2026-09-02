#!/usr/bin/env node
// Fetches all cabin data from iNatur and saves to public/cabins-data.json
// Usage: npm run fetch-cabins
//
// Coordinates come only from the ArcGIS overlay. Cabins without geometry get
// a municipality (then county) centroid estimate — never geocoded names,
// addresses, providers, or stedsnavn.

import { applyCoordEstimates, summarizeCoordSources } from './scripts/estimate-cabin-coords.mjs';

const SEARCH_URL = 'https://www.inatur.no/internal/search';
const GEO_URL = 'https://inatur.geodataonline.no/arcgis/rest/services/inatur/Open-Inatur/MapServer/0/query';
const PAGE_SIZE = 12;
const CONCURRENCY = 6;

async function fetchCoordinates() {
  console.log('Henter koordinater fra ArcGIS...');
  const params = new URLSearchParams({
    f: 'json',
    where: "type='overnatting' AND aktivt=1",
    outFields: 'tilbudsid,stedsnavn',
    outSR: '4326',
    returnGeometry: 'true',
    resultRecordCount: '5000',
  });
  const res = await fetch(`${GEO_URL}?${params}`);
  const json = await res.json();
  const map = {};
  for (const f of json.features || []) {
    map[f.attributes.tilbudsid] = {
      lng: f.geometry.x,
      lat: f.geometry.y,
      stedsnavn: f.attributes.stedsnavn,
    };
  }
  console.log(`  → ${Object.keys(map).length} koordinater hentet`);
  return map;
}

async function fetchSearchPage(page) {
  const filter = JSON.stringify([{ felt: 'type', sokeord: 'hyttetilbud' }]);
  const params = new URLSearchParams({ f: filter, ledig: 'false', p: String(page) });
  const res = await fetch(`${SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`Side ${page}: HTTP ${res.status}`);
  return res.json();
}

async function fetchAllCabins() {
  console.log('Henter hyttedata fra iNatur søk...');

  // First page to get total count
  const first = await fetchSearchPage(0);
  const total = first.paginering.totaltAntallElementer;
  const totalPages = first.paginering.totaltAntallSider;
  console.log(`  → ${total} hytter over ${totalPages} sider`);

  const allResults = [...first.resultat];

  // Fetch remaining pages with concurrency limit
  const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);

  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => fetchSearchPage(p)));
    for (const r of results) {
      allResults.push(...r.resultat);
    }
    const fetched = Math.min(i + CONCURRENCY, remaining.length) + 1;
    process.stdout.write(`\r  → ${fetched}/${totalPages} sider hentet`);
  }
  console.log();
  console.log(`  → ${allResults.length} hytter totalt`);
  return allResults;
}

function mergeCabins(searchResults, coordMap) {
  return searchResults.map(h => {
    const geo = coordMap[h.id] || {};
    return {
      id: h.id,
      name: h.tittel,
      description: h.kortBeskrivelse || '',
      url: `https://www.inatur.no${h.url}`,
      image: h.bilde ? `https:${h.bilde}` : null,
      lat: geo.lat || null,
      lng: geo.lng || null,
      stedsnavn: geo.stedsnavn || null,
      beds: h.antallSenger || 0,
      priceFrom: h.fraPris || 0,
      counties: h.fylker || [],
      municipalities: h.kommuner || [],
      soldOut: h.utsolgt || false,
      amenities: h.amenities || [],
      provider: h.tilbydernavn || '',
      winterDistanceKm: h.winterDistanceFromRoadInKilometers,
      summerDistanceKm: h.summerDistanceFromRoadInKilometers,
    };
  });
}

async function main() {
  const startTime = Date.now();

  const [coordMap, searchResults] = await Promise.all([
    fetchCoordinates(),
    fetchAllCabins(),
  ]);

  const cabins = applyCoordEstimates(mergeCabins(searchResults, coordMap));
  const counts = summarizeCoordSources(cabins);

  console.log(`\nResultat:`);
  console.log(`  ${cabins.length} hytter totalt`);
  console.log(`  ${counts.exact} nøyaktige koordinater (iNatur/ArcGIS)`);
  console.log(`  ${counts.municipality} estimert fra kommune`);
  console.log(`  ${counts.county} estimert fra fylke`);
  console.log(`  ${counts.none} uten kartpunkt`);

  const data = {
    fetchedAt: new Date().toISOString(),
    count: cabins.length,
    countWithCoords: counts.exact,
    cabins,
  };

  const { mkdirSync, writeFileSync } = await import('fs');
  const { dirname } = await import('path');
  const OUTPUT_PATH = 'public/cabins-data.json';
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
  console.log(`\nLagret til ${OUTPUT_PATH} (${(JSON.stringify(data).length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Ferdig på ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

main().catch(e => {
  console.error('Feil:', e);
  process.exit(1);
});
