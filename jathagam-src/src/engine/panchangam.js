// Panchangam elements for any instant. Reusable for "today's panchangam"
// (phase 2) — it only needs a UTC instant and a location.
import { grahaPositions, previousSunrise, norm360 } from './astro.js';
import { NAK_SPAN } from './constants.js';

/**
 * @param {Date} date UTC instant
 * @param {number} lat
 * @param {number} lon
 * @param {object} [pos] optional precomputed result of grahaPositions()
 */
export function panchangam(date, lat, lon, pos) {
  const p = pos || grahaPositions(date);
  const sun = p.planets.sun.lon;
  const moon = p.planets.moon.lon;
  const elong = norm360(moon - sun);

  // Thithi: 30 per lunar month, 12° each. Index 0-14 valarpirai, 15-29 theipirai.
  const thithi = Math.floor(elong / 12);
  const thithiFraction = (elong % 12) / 12;

  // Yogam: (sun + moon) in 27 parts of 13°20'
  const yogam = Math.floor(norm360(sun + moon) / NAK_SPAN);

  // Karanam: 60 half-thithis. 0 = Kimsthugnam, 1-56 = the 7 movable karanams
  // repeating, 57-59 = Sakuni, Chathushpadham, Nagavam.
  const half = Math.floor(elong / 6);
  let karanam;
  if (half === 0) karanam = 10; // Kimsthugnam
  else if (half >= 57) karanam = 7 + (half - 57); // 7 Sakuni, 8 Chathushpadham, 9 Nagavam
  else karanam = (half - 1) % 7; // 0 Bavam ... 6 Bhadrai (Vishti)

  const nakshatra = Math.floor(moon / NAK_SPAN);

  // Vaaram: the Tamil day runs sunrise to sunrise. Weekday of the most recent
  // sunrise, read in local mean time (sunrise is far from midnight, so LMT is safe).
  const sunrise = previousSunrise(date, lat, lon);
  const ref = sunrise || date;
  const lmt = new Date(ref.getTime() + (lon / 15) * 3600000);
  const vaaram = lmt.getUTCDay(); // 0 = Sunday (Nyayiru)
  const civil = new Date(date.getTime() + (lon / 15) * 3600000).getUTCDay();

  return {
    thithi, // 0..29
    paksha: thithi < 15 ? 'valarpirai' : 'theipirai',
    thithiFraction,
    vaaram,
    beforeSunrise: sunrise ? vaaram !== civil : false,
    sunrise,
    nakshatra,
    yogam,
    karanam,
  };
}
