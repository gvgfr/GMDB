// Vimshottari dasa / bhukti.
import { DASA_ORDER, DASA_YEARS, nakshatraLord } from './constants.js';
import { describeLongitude } from './nakshatra.js';

// Length of a dasa "year" in days. 365.25 (Julian year) is the common choice in
// Tamil almanac software; some tools use 365.2425 or 360. Kept as an option.
export const DEFAULT_YEAR_DAYS = 365.25;
const DAY_MS = 86400000;

/**
 * @param {number} moonLon sidereal longitude of the Moon
 * @param {Date} birth UTC instant of birth
 * @param {{yearDays?: number, cycles?: number}} opts
 */
export function vimshottari(moonLon, birth, opts = {}) {
  const yearMs = (opts.yearDays || DEFAULT_YEAR_DAYS) * DAY_MS;
  const { nakshatra, fractionInNakshatra } = describeLongitude(moonLon);
  const firstLord = nakshatraLord(nakshatra);
  const firstYears = DASA_YEARS[firstLord];
  const elapsedYears = firstYears * fractionInNakshatra;
  const balanceYears = firstYears - elapsedYears;

  // The first mahadasa actually began before birth.
  let start = birth.getTime() - elapsedYears * yearMs;
  const startIdx = DASA_ORDER.indexOf(firstLord);
  const periods = [];
  const count = 9 * (opts.cycles || 1);
  for (let i = 0; i < count; i++) {
    const lord = DASA_ORDER[(startIdx + i) % 9];
    const years = DASA_YEARS[lord];
    const end = start + years * yearMs;
    const bhuktis = [];
    let bs = start;
    const li = DASA_ORDER.indexOf(lord);
    for (let j = 0; j < 9; j++) {
      const bl = DASA_ORDER[(li + j) % 9];
      const be = bs + ((years * DASA_YEARS[bl]) / 120) * yearMs;
      bhuktis.push({ lord: bl, start: new Date(bs), end: new Date(be) });
      bs = be;
    }
    periods.push({ lord, years, start: new Date(start), end: new Date(end), bhuktis });
    start = end;
  }
  return { firstLord, balanceYears, periods };
}

/** Split fractional years into {y, m, d} using 12 months of 30 days approximation
 *  on the remainder (the convention almanacs print). */
export function yearsToYMD(years) {
  const y = Math.floor(years);
  const remMonths = (years - y) * 12;
  const m = Math.floor(remMonths);
  const d = Math.floor((remMonths - m) * 30);
  return { y, m, d };
}

/** Find the dasa/bhukti active at `when`. */
export function activePeriod(dasa, when) {
  const t = when.getTime();
  for (const p of dasa.periods) {
    if (t >= p.start.getTime() && t < p.end.getTime()) {
      const b = p.bhuktis.find((x) => t >= x.start.getTime() && t < x.end.getTime());
      return { dasa: p, bhukti: b };
    }
  }
  return null;
}
