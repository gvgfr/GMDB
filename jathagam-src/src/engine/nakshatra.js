import { NAK_SPAN, PADA_SPAN, nakshatraLord } from './constants.js';
import { norm360 } from './astro.js';

/** Details for a sidereal longitude: sign, degree in sign, nakshatra, padam. */
export function describeLongitude(lon) {
  const l = norm360(lon);
  const sign = Math.floor(l / 30);
  const nak = Math.floor(l / NAK_SPAN);
  const pada = Math.floor((l % NAK_SPAN) / PADA_SPAN) + 1;
  return {
    lon: l,
    sign,
    degInSign: l - sign * 30,
    nakshatra: nak,
    pada,
    nakshatraLord: nakshatraLord(nak),
    fractionInNakshatra: (l % NAK_SPAN) / NAK_SPAN,
  };
}

/** Split degrees into whole degrees, minutes and seconds (rounded to the second). */
export function dms(deg) {
  let total = Math.round(deg * 3600);
  const d = Math.floor(total / 3600);
  total -= d * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return { d, m, s };
}
