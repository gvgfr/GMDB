// Divisional charts. Only the navamsam (D9) is used today; the table keeps the
// door open for others.
import { norm360 } from './astro.js';

/** Navamsam sign (0-11) of a sidereal longitude. Each 3°20' maps to one sign,
 *  counting continuously from Mesham, so fire signs start at Mesham, earth
 *  signs at Magaram, air at Thulam and water at Kadagam. */
export function navamsaSign(lon) {
  return Math.floor(norm360(lon) / (30 / 9)) % 12;
}

export const VARGAS = { D1: (lon) => Math.floor(norm360(lon) / 30), D9: navamsaSign };
