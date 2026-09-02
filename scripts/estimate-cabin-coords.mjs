#!/usr/bin/env node
// Estimate map pins for cabins that have no iNatur/ArcGIS coordinates.
// Uses only already-mapped cabin lat/lng in the same municipality (then county).
// Does not geocode names, addresses, providers, or stedsnavn.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const COORD_SOURCES = Object.freeze({
  EXACT: 'exact',
  MUNICIPALITY: 'municipality',
  COUNTY: 'county',
  NONE: 'none',
});

const MAX_OFFSET_KM = 3;
const KM_PER_DEG_LAT = 111.32;

export function hasExactCoords(cabin) {
  if (!cabin) return false;
  if (cabin.coordSource && cabin.coordSource !== COORD_SOURCES.EXACT) return false;
  return Number.isFinite(cabin.lat) && Number.isFinite(cabin.lng);
}

function meanLatLng(cabins) {
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const cabin of cabins) {
    lat += cabin.lat;
    lng += cabin.lng;
    n += 1;
  }
  if (!n) return null;
  return { lat: lat / n, lng: lng / n };
}

function indexExactByArea(exactCabins, key) {
  const groups = new Map();
  for (const cabin of exactCabins) {
    for (const name of cabin[key] || []) {
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(cabin);
    }
  }
  const centroids = new Map();
  for (const [name, list] of groups) {
    centroids.set(name, meanLatLng(list));
  }
  return centroids;
}

function firstMappedArea(names, centroids) {
  for (const name of names || []) {
    if (name && centroids.has(name)) return name;
  }
  return null;
}

// Compact ring around a shared centroid. Max ~3 km; never a line/trail.
export function offsetAroundCentroid(lat, lng, index, total) {
  if (total <= 1 || index < 0) return { lat, lng };
  const angle = (2 * Math.PI * index) / total;
  const radiusKm = Math.min(MAX_OFFSET_KM, 0.7 * Math.sqrt(total));
  const dLat = (radiusKm / KM_PER_DEG_LAT) * Math.cos(angle);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const kmPerDegLng = KM_PER_DEG_LAT * Math.max(cosLat, 0.2);
  const dLng = (radiusKm / kmPerDegLng) * Math.sin(angle);
  return { lat: lat + dLat, lng: lng + dLng };
}

export function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function summarizeCoordSources(cabins) {
  const counts = {
    exact: 0,
    municipality: 0,
    county: 0,
    none: 0,
  };
  for (const cabin of cabins) {
    const source = cabin.coordSource;
    if (Object.prototype.hasOwnProperty.call(counts, source)) {
      counts[source] += 1;
    }
  }
  return counts;
}

export function applyCoordEstimates(cabins) {
  const exactCabins = cabins.filter(hasExactCoords);
  const municipalityCentroids = indexExactByArea(exactCabins, 'municipalities');
  const countyCentroids = indexExactByArea(exactCabins, 'counties');

  const planned = cabins.map((cabin) => {
    if (hasExactCoords(cabin)) {
      return {
        cabin,
        coordSource: COORD_SOURCES.EXACT,
        lat: cabin.lat,
        lng: cabin.lng,
        groupKey: null,
      };
    }

    const municipality = firstMappedArea(cabin.municipalities, municipalityCentroids);
    if (municipality) {
      const centroid = municipalityCentroids.get(municipality);
      return {
        cabin,
        coordSource: COORD_SOURCES.MUNICIPALITY,
        lat: centroid.lat,
        lng: centroid.lng,
        groupKey: `municipality:${municipality}`,
      };
    }

    const county = firstMappedArea(cabin.counties, countyCentroids);
    if (county) {
      const centroid = countyCentroids.get(county);
      return {
        cabin,
        coordSource: COORD_SOURCES.COUNTY,
        lat: centroid.lat,
        lng: centroid.lng,
        groupKey: `county:${county}`,
      };
    }

    return {
      cabin,
      coordSource: COORD_SOURCES.NONE,
      lat: null,
      lng: null,
      groupKey: null,
    };
  });

  const groups = new Map();
  for (const item of planned) {
    if (!item.groupKey) continue;
    if (!groups.has(item.groupKey)) groups.set(item.groupKey, []);
    groups.get(item.groupKey).push(item);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => String(a.cabin.id).localeCompare(String(b.cabin.id)));
    list.forEach((item, index) => {
      const offset = offsetAroundCentroid(item.lat, item.lng, index, list.length);
      item.lat = offset.lat;
      item.lng = offset.lng;
    });
  }

  return planned.map((item) => ({
    ...item.cabin,
    lat: item.lat,
    lng: item.lng,
    coordSource: item.coordSource,
  }));
}

function main(argv) {
  const dumpPath = argv[0] || 'public/cabins-data.json';
  const data = JSON.parse(readFileSync(dumpPath, 'utf8'));
  if (!data || !Array.isArray(data.cabins)) {
    throw new Error(`${dumpPath} is not a valid cabins-data.json dump`);
  }

  data.cabins = applyCoordEstimates(data.cabins);
  const counts = summarizeCoordSources(data.cabins);
  data.countWithCoords = counts.exact;

  writeFileSync(dumpPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `coordSource ${dumpPath}: exact=${counts.exact} municipality=${counts.municipality} county=${counts.county} none=${counts.none}`
  );
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2));
}
