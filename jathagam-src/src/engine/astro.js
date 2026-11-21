// Core astronomy: sidereal (Lahiri) planetary longitudes, lunar nodes and lagnam.
// Built on astronomy-engine (MIT); the ayanamsa and the sidereal conversion are
// implemented here so the output is comparable with Swiss Ephemeris SIDM_LAHIRI.
import * as A from 'astronomy-engine';

const DEG = Math.PI / 180;
export const norm360 = (x) => ((x % 360) + 360) % 360;

// ---------------------------------------------------------------------------
// Lahiri (Chitrapaksha) ayanamsa
// Definition used by the Indian Calendar Reform Committee / Swiss Ephemeris:
//   ayanamsa = 23°15'00.658" at 1956-09-22 0h TT (JD 2435553.5), minus the
//   0.004658035° nutation component that SE removes to give a *mean* value,
//   then carried forward/backward with the general precession in longitude.
// We use the IAU 2006 (Capitaine et al. 2003) expression for p_A.
// ---------------------------------------------------------------------------
const LAHIRI_T0_JD = 2435553.5;
const LAHIRI_AYAN_T0 = 23.250182778 - 0.004658035;
const J2000 = 2451545.0;

function generalPrecessionArcsec(jdTT) {
  const T = (jdTT - J2000) / 36525;
  return (
    5028.796195 * T +
    1.1054348 * T * T +
    0.00007964 * T ** 3 -
    0.000023857 * T ** 4 -
    0.0000000383 * T ** 5
  );
}
const P_T0 = generalPrecessionArcsec(LAHIRI_T0_JD);

/** Mean Lahiri ayanamsa (no nutation) in degrees, for a Julian Day (TT). */
export function lahiriAyanamsaMean(jdTT) {
  return LAHIRI_AYAN_T0 + (generalPrecessionArcsec(jdTT) - P_T0) / 3600;
}

// Registry so further ayanamsas (Raman, KP, ...) or a Vakya engine can be added
// without touching callers.
export const AYANAMSAS = { lahiri: lahiriAyanamsaMean };

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
/** astronomy-engine time from a JS Date (UTC). */
export const makeTime = (date) => A.MakeTime(date);
/** Julian Day (TT) of an AstroTime. */
export const jdTT = (time) => time.tt + J2000;
/** Julian Day (UT) of an AstroTime. */
export const jdUT = (time) => time.ut + J2000;

/** Tilt / nutation information: dpsi in degrees, true obliquity in degrees. */
function tilt(time) {
  const t = A.e_tilt(time);
  return { dpsiDeg: t.dpsi / 3600, tobl: t.tobl, mobl: t.mobl };
}

// ---------------------------------------------------------------------------
// Tropical longitudes referred to the MEAN equinox of date.
// sidereal = (true-of-date longitude - nutation) - mean ayanamsa
//          = true-of-date longitude - (mean ayanamsa + nutation)  ("true ayanamsa")
// which is the convention Swiss Ephemeris uses for sidereal positions.
// ---------------------------------------------------------------------------
function eclipticOfDate(vecEQJ, time) {
  const rot = A.Rotation_EQJ_ECT(time);
  const v = A.RotateVector(rot, vecEQJ);
  const s = A.SphereFromVector(v);
  return { lon: s.lon, lat: s.lat, dist: s.dist };
}

const BODY = {
  sun: A.Body.Sun,
  moon: A.Body.Moon,
  mars: A.Body.Mars,
  mercury: A.Body.Mercury,
  jupiter: A.Body.Jupiter,
  venus: A.Body.Venus,
  saturn: A.Body.Saturn,
};

function tropicalMeanLon(key, time) {
  const vec = A.GeoVector(BODY[key], time, true); // apparent: light-time + aberration
  const ecl = eclipticOfDate(vec, time);
  return norm360(ecl.lon - tilt(time).dpsiDeg);
}

// Mean lunar node (ascending), mean equinox of date. Meeus, Astronomical
// Algorithms 2nd ed., eq. 47.7 (Chapront ELP-2000/82 expression).
function meanNodeTropical(time) {
  const T = time.tt / 36525;
  return norm360(
    125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T ** 3 / 467441 - T ** 4 / 60616000
  );
}

// True (osculating) lunar node: the line where the instantaneous plane of the
// Moon's geocentric orbit (r x v) meets the ecliptic of date. All three samples
// are rotated with the *same* (time t) frame so the velocity is not polluted by
// frame rotation.
function trueNodeTropical(time) {
  const h = 1 / 24; // 1 hour, in days
  const rot = A.Rotation_EQJ_ECT(time); // J2000 equator -> true ecliptic/equinox of date
  const pos = (t) => {
    const v = A.RotateVector(rot, A.GeoMoon(A.MakeTime(t)));
    return [v.x, v.y, v.z];
  };
  const r = pos(time.ut);
  const rp = pos(time.ut + h);
  const rm = pos(time.ut - h);
  const v = [0, 1, 2].map((i) => (rp[i] - rm[i]) / (2 * h));
  const Lx = r[1] * v[2] - r[2] * v[1];
  const Ly = r[2] * v[0] - r[0] * v[2];
  // ascending node direction = z x L = (-Ly, Lx, 0)
  const lonTrue = Math.atan2(Lx, -Ly) / DEG;
  return norm360(lonTrue - tilt(time).dpsiDeg);
}

/**
 * Sidereal longitudes of the nine grahas.
 * @param {Date} date UTC instant
 * @param {{node?: 'mean'|'true', ayanamsa?: string}} opts
 * @returns {{ayanamsa:number, planets: Record<string,{lon:number, speed:number, retro:boolean}>}}
 */
export function grahaPositions(date, opts = {}) {
  const nodeType = opts.node === 'true' ? 'true' : 'mean';
  const ayanFn = AYANAMSAS[opts.ayanamsa || 'lahiri'];
  const time = makeTime(date);
  const ayan = ayanFn(jdTT(time));

  const sidAt = (key, t) => {
    const tt = A.MakeTime(t);
    const ay = ayanFn(jdTT(tt));
    let trop;
    if (key === 'rahu') trop = nodeType === 'true' ? trueNodeTropical(tt) : meanNodeTropical(tt);
    else trop = tropicalMeanLon(key, tt);
    return norm360(trop - ay);
  };

  const dt = 0.25 / 24; // 15 minutes
  const out = {};
  for (const key of [...Object.keys(BODY), 'rahu']) {
    const lon = sidAt(key, time.ut);
    const l1 = sidAt(key, time.ut - dt);
    const l2 = sidAt(key, time.ut + dt);
    let d = l2 - l1;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const speed = d / (2 * dt); // degrees/day
    out[key] = { lon, speed, retro: speed < 0 };
  }
  const r = out.rahu;
  out.ketu = { lon: norm360(r.lon + 180), speed: r.speed, retro: r.retro };
  return { ayanamsa: ayan, planets: out };
}

/**
 * Sidereal ascendant (lagnam).
 * @param {Date} date UTC instant
 * @param {number} lat geographic latitude (deg, north +)
 * @param {number} lon geographic longitude (deg, east +)
 */
export function lagnam(date, lat, lon, opts = {}) {
  const ayanFn = AYANAMSAS[opts.ayanamsa || 'lahiri'];
  const time = makeTime(date);
  const { dpsiDeg, tobl } = tilt(time);
  const gast = A.SiderealTime(time); // apparent sidereal time at Greenwich, hours
  const ramc = norm360(gast * 15 + lon) * DEG;
  const eps = tobl * DEG;
  const phi = lat * DEG;
  const ascTrue = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / DEG;
  // tropical (true equinox) -> sidereal: subtract the true ayanamsa
  return norm360(ascTrue - (ayanFn(jdTT(time)) + dpsiDeg));
}

/** Most recent sunrise at or before `date` (UTC), or null (polar day/night). */
export function previousSunrise(date, lat, lon) {
  const obs = new A.Observer(lat, lon, 0);
  let t = A.SearchRiseSet(A.Body.Sun, obs, +1, new Date(date.getTime() - 1.5 * 86400000), 1.5);
  if (!t || t.date > date) return null;
  for (;;) {
    const next = A.SearchRiseSet(A.Body.Sun, obs, +1, new Date(t.date.getTime() + 3600000), 1.2);
    if (!next || next.date > date) return t.date;
    t = next;
  }
}

/** Sunrise on/after `date` (UTC) within limitDays, or null. */
export function nextSunrise(date, lat, lon, limitDays = 1.2) {
  const t = A.SearchRiseSet(A.Body.Sun, new A.Observer(lat, lon, 0), +1, date, limitDays);
  return t ? t.date : null;
}
