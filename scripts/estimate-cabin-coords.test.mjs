#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  applyCoordEstimates,
  distanceKm,
  hasExactCoords,
  offsetAroundCentroid,
  summarizeCoordSources,
} from './estimate-cabin-coords.mjs';

function cabin(partial) {
  return {
    id: 'id',
    name: 'Name',
    provider: 'Provider AS',
    stedsnavn: null,
    municipalities: [],
    counties: [],
    lat: null,
    lng: null,
    ...partial,
  };
}

{
  const exact = cabin({
    id: 'e1',
    lat: 61.0,
    lng: 8.0,
    municipalities: ['Vinje'],
    counties: ['Telemark'],
  });
  const out = applyCoordEstimates([exact])[0];
  assert.equal(out.coordSource, 'exact');
  assert.equal(out.lat, 61.0);
  assert.equal(out.lng, 8.0);
  assert.equal(hasExactCoords(out), true);
}

{
  const mapped = [
    cabin({ id: 'a', lat: 60.0, lng: 8.0, municipalities: ['Vinje'], counties: ['Telemark'] }),
    cabin({ id: 'b', lat: 62.0, lng: 10.0, municipalities: ['Vinje'], counties: ['Telemark'] }),
  ];
  const unmapped = cabin({
    id: 'u1',
    name: 'Unmapped cabin',
    provider: 'Should not be geocoded',
    municipalities: ['Vinje'],
    counties: ['Telemark'],
  });
  const out = applyCoordEstimates([...mapped, unmapped]);
  const estimated = out.find((c) => c.id === 'u1');
  assert.equal(estimated.coordSource, 'municipality');
  assert.equal(estimated.lat, 61.0);
  assert.equal(estimated.lng, 9.0);
}

{
  const mapped = [
    cabin({ id: 'a', lat: 60.0, lng: 8.0, municipalities: ['Ål'], counties: ['Viken'] }),
    cabin({ id: 'b', lat: 62.0, lng: 10.0, municipalities: ['Gol'], counties: ['Viken'] }),
  ];
  const unmapped = cabin({
    id: 'u2',
    municipalities: ['Hemnes'],
    counties: ['Viken'],
  });
  const estimated = applyCoordEstimates([...mapped, unmapped]).find((c) => c.id === 'u2');
  assert.equal(estimated.coordSource, 'county');
  assert.equal(estimated.lat, 61.0);
  assert.equal(estimated.lng, 9.0);
}

{
  const unmapped = cabin({
    id: 'u3',
    municipalities: ['Nowhere'],
    counties: ['Unknown'],
  });
  const estimated = applyCoordEstimates([unmapped])[0];
  assert.equal(estimated.coordSource, 'none');
  assert.equal(estimated.lat, null);
  assert.equal(estimated.lng, null);
}

{
  const mapped = cabin({
    id: 'm',
    lat: 61.2,
    lng: 8.4,
    municipalities: ['Trysil'],
    counties: ['Innlandet'],
  });
  const unmapped = ['u-c', 'u-a', 'u-b'].map((id) =>
    cabin({ id, municipalities: ['Trysil'], counties: ['Innlandet'] })
  );
  const first = applyCoordEstimates([mapped, ...unmapped]);
  const second = applyCoordEstimates([mapped, ...unmapped]);
  const firstEst = first.filter((c) => c.coordSource === 'municipality').sort((a, b) => a.id.localeCompare(b.id));
  const secondEst = second.filter((c) => c.coordSource === 'municipality').sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    firstEst.map((c) => [c.id, c.lat, c.lng]),
    secondEst.map((c) => [c.id, c.lat, c.lng])
  );

  const centroid = { lat: 61.2, lng: 8.4 };
  for (const item of firstEst) {
    const km = distanceKm(centroid, item);
    assert.ok(km > 0.2, `offset too small: ${km}`);
    assert.ok(km <= 3.05, `offset exceeds 3 km: ${km}`);
  }

  const positions = new Set(firstEst.map((c) => `${c.lat},${c.lng}`));
  assert.equal(positions.size, 3);
}

{
  const ring = [0, 1, 2].map((i) => offsetAroundCentroid(61, 8, i, 3));
  for (const point of ring) {
    assert.ok(distanceKm({ lat: 61, lng: 8 }, point) <= 3);
  }
}

{
  const alreadyEstimated = cabin({
    id: 'prev',
    lat: 61.5,
    lng: 9.5,
    coordSource: 'municipality',
    municipalities: ['Vinje'],
    counties: ['Telemark'],
  });
  const exact = cabin({
    id: 'e',
    lat: 60.0,
    lng: 8.0,
    municipalities: ['Vinje'],
    counties: ['Telemark'],
  });
  const out = applyCoordEstimates([alreadyEstimated, exact]).find((c) => c.id === 'prev');
  assert.equal(out.coordSource, 'municipality');
  assert.equal(out.lat, 60.0);
  assert.equal(out.lng, 8.0);
}

{
  const cabins = applyCoordEstimates([
    cabin({ id: 'e', lat: 60, lng: 8, municipalities: ['A'], counties: ['X'] }),
    cabin({ id: 'm', municipalities: ['A'], counties: ['X'] }),
    cabin({ id: 'c', municipalities: ['B'], counties: ['X'] }),
    cabin({ id: 'n', municipalities: ['C'], counties: ['Y'] }),
  ]);
  assert.deepEqual(summarizeCoordSources(cabins), {
    exact: 1,
    municipality: 1,
    county: 1,
    none: 1,
  });
}

console.log('estimate-cabin-coords tests passed');
