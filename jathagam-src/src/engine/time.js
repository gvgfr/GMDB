// Local civil time -> UTC using the IANA zone for the birth place.
// Luxon resolves historical offsets (e.g. India's +6:30 war time 1942-45,
// US DST rule changes) from the tz database shipped with the browser.
import { DateTime } from 'luxon';
import tzlookup from '@photostructure/tz-lookup';

export function zoneFor(lat, lon) {
  return tzlookup(lat, lon);
}

/**
 * @param {{year:number, month:number, day:number, hour:number, minute:number}} local
 *        hour is 0-23
 * @param {string} zone IANA zone, or a fixed offset like "UTC+5:30"
 * @returns {{utc: Date, offsetMinutes: number, zone: string, valid: boolean, note?: string}}
 */
export function localToUtc(local, zone) {
  const dt = DateTime.fromObject(local, { zone });
  if (!dt.isValid) return { valid: false, note: dt.invalidExplanation || 'invalid', zone };
  // Detect local times that do not exist (spring-forward gap): Luxon shifts them.
  const gap = dt.hour !== local.hour || dt.minute !== local.minute;
  // Ambiguous times (fall-back overlap): the same wall time occurs twice.
  // Use the first occurrence (the daylight-saving offset), like Python's fold=0.
  const same = (x) => x.hour === local.hour && x.minute === local.minute;
  let chosen = dt;
  let ambiguous = false;
  if (!gap) {
    const earlier = DateTime.fromMillis(dt.toMillis() - 3600000, { zone });
    const later = DateTime.fromMillis(dt.toMillis() + 3600000, { zone });
    if (same(earlier)) {
      chosen = earlier;
      ambiguous = true;
    } else if (same(later)) ambiguous = true;
  }
  return {
    valid: true,
    utc: chosen.toUTC().toJSDate(),
    offsetMinutes: chosen.offset,
    zone,
    zoneAbbr: chosen.offsetNameShort,
    note: gap ? 'nonexistent' : ambiguous ? 'ambiguous' : undefined,
  };
}

/** Fixed-offset zone name accepted by Luxon, e.g. offsetZone(330) -> "UTC+5:30" */
export function offsetZone(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const a = Math.abs(minutes);
  return `UTC${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}
