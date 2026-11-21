// Public engine API. The UI calls only these functions.
//
// Extension points (phase 2):
//   - opts.system: 'thirukanitha' (computed, default) | 'vakya' — add an engine
//     in SYSTEMS with the same signature as thirukanitha().
//   - porutham: build on chart.summary (rasi, nakshatra) of two charts.
//   - today's panchangam / rahu kalam: panchangam(date, lat, lon) + astro.js sunrise.
import { grahaPositions, lagnam } from './astro.js';
import { describeLongitude } from './nakshatra.js';
import { navamsaSign } from './vargas.js';
import { vimshottari } from './dasa.js';
import { panchangam } from './panchangam.js';
import { SIGN_LORDS, GRAHAS } from './constants.js';

function thirukanitha(date, lat, lon, opts) {
  const pos = grahaPositions(date, { node: opts.node, ayanamsa: opts.ayanamsa });
  const lagnaLon = lagnam(date, lat, lon, { ayanamsa: opts.ayanamsa });
  return { pos, lagnaLon };
}

export const SYSTEMS = {
  thirukanitha,
  vakya: () => {
    throw new Error('Vakya panchangam system is not implemented yet');
  },
};

/**
 * Compute a full birth chart.
 * @param {{utc: Date, lat: number, lon: number}} birth
 * @param {{node?: 'mean'|'true', ayanamsa?: string, system?: string, yearDays?: number}} [opts]
 */
export function computeChart(birth, opts = {}) {
  const o = { node: 'mean', ayanamsa: 'lahiri', system: 'thirukanitha', ...opts };
  const { utc, lat, lon } = birth;
  const { pos, lagnaLon } = SYSTEMS[o.system](utc, lat, lon, o);

  const planets = GRAHAS.map((key) => {
    const p = pos.planets[key];
    const d = describeLongitude(p.lon);
    return { key, ...d, speed: p.speed, retro: p.retro, navamsa: navamsaSign(p.lon) };
  });
  const lag = { key: 'lagnam', ...describeLongitude(lagnaLon), navamsa: navamsaSign(lagnaLon) };
  const moon = planets.find((p) => p.key === 'moon');

  return {
    input: { ...birth, options: o },
    ayanamsa: pos.ayanamsa,
    lagnam: lag,
    planets,
    summary: {
      rasi: moon.sign,
      rasiLord: SIGN_LORDS[moon.sign],
      nakshatra: moon.nakshatra,
      pada: moon.pada,
      nakshatraLord: moon.nakshatraLord,
      lagnam: lag.sign,
      lagnaLord: SIGN_LORDS[lag.sign],
    },
    dasa: vimshottari(moon.lon, utc, { yearDays: o.yearDays }),
    panchangam: panchangam(utc, lat, lon, pos),
  };
}

export { panchangam } from './panchangam.js';
export { localToUtc, zoneFor, offsetZone } from './time.js';
export { activePeriod, yearsToYMD } from './dasa.js';
export { dms } from './nakshatra.js';
