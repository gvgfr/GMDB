#!/usr/bin/env python3
"""Generate reference sidereal (Lahiri) positions with the Swiss Ephemeris.

Swiss Ephemeris is the engine inside Jagannatha Hora, so its SIDM_LAHIRI output
is the de-facto reference for Indian astrology software.

Usage:
  python gen_reference.py charts  EPHE_DIR > ../test/reference-charts.json
  python gen_reference.py random  EPHE_DIR N SEED > ../test/reference-sweep.json

Requires: pip install pyswisseph  (plus the sepl_18/semo_18 .se1 files in
EPHE_DIR for full precision; without them Moshier mode, ~1" accurate, is used).

Local time -> UTC is done independently of the app, with Python's zoneinfo.
"""
import json
import random
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import swisseph as swe

PLANETS = {
    "sun": swe.SUN, "moon": swe.MOON, "mars": swe.MARS, "mercury": swe.MERCURY,
    "jupiter": swe.JUPITER, "venus": swe.VENUS, "saturn": swe.SATURN,
}

# name, local date-time, IANA zone, lat, lon
CHARTS = [
    ("Chennai 1943 (pre-1955 India, WWII war time +6:30)",
     "1943-08-15 10:30", "Asia/Kolkata", 13.0827, 80.2707),
    ("Madurai 1931 (pre-1955 India)",
     "1931-03-02 05:10", "Asia/Kolkata", 9.9252, 78.1198),
    ("New York 1990 (US daylight saving time)",
     "1990-07-04 21:45", "America/New_York", 40.7128, -74.0060),
    ("Chicago 2008 (US DST, first day of 2008 rules)",
     "2008-03-09 03:30", "America/Chicago", 41.8781, -87.6298),
    ("Coimbatore 1975",
     "1975-11-28 23:55", "Asia/Kolkata", 11.0168, 76.9558),
    ("Singapore 2001",
     "2001-01-01 00:05", "Asia/Singapore", 1.3521, 103.8198),
    ("London 2016 (BST)",
     "2016-06-21 14:20", "Europe/London", 51.5074, -0.1278),
]


def positions(jd_ut, lat, lon, flags):
    swe.set_sid_mode(swe.SIDM_LAHIRI)
    fl = flags | swe.FLG_SIDEREAL | swe.FLG_SPEED
    out = {}
    for name, p in PLANETS.items():
        xx, _ = swe.calc_ut(jd_ut, p, fl)
        out[name] = {"lon": xx[0], "speed": xx[3]}
    for name, p in (("rahu_mean", swe.MEAN_NODE), ("rahu_true", swe.TRUE_NODE)):
        xx, _ = swe.calc_ut(jd_ut, p, fl)
        out[name] = {"lon": xx[0], "speed": xx[3]}
    cusps, ascmc = swe.houses_ex(jd_ut, lat, lon, b"P", swe.FLG_SIDEREAL)
    out["lagnam"] = ascmc[0]
    out["ayanamsa_mean"] = swe.get_ayanamsa_ex_ut(jd_ut, flags | swe.FLG_NONUT)[1]
    out["ayanamsa_true"] = swe.get_ayanamsa_ex_ut(jd_ut, flags)[1]
    return out


def jd_from_utc(dt):
    return swe.julday(dt.year, dt.month, dt.day,
                      dt.hour + dt.minute / 60 + dt.second / 3600)


def main():
    mode, ephe = sys.argv[1], sys.argv[2]
    swe.set_ephe_path(ephe)
    flags = swe.FLG_SWIEPH
    if mode == "charts":
        res = []
        for name, local, zone, lat, lon in CHARTS:
            dt = datetime.strptime(local, "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo(zone))
            utc = dt.astimezone(timezone.utc)
            jd = jd_from_utc(utc)
            res.append({
                "name": name, "local": local, "zone": zone, "lat": lat, "lon": lon,
                "utcOffsetMinutes": int(dt.utcoffset().total_seconds() // 60),
                "utc": utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "jdUT": jd,
                "ref": positions(jd, lat, lon, flags),
            })
        meta = {"generator": "Swiss Ephemeris " + swe.version + " via pyswisseph",
                "ayanamsa": "SIDM_LAHIRI", "houses": "ascendant from swe.houses_ex"}
        print(json.dumps({"meta": meta, "charts": res}, indent=1))
    else:
        n, seed = int(sys.argv[3]), int(sys.argv[4])
        rnd = random.Random(seed)
        res = []
        for _ in range(n):
            jd = rnd.uniform(swe.julday(1900, 1, 1, 0), swe.julday(2050, 1, 1, 0))
            lat, lon = rnd.uniform(-60, 60), rnd.uniform(-180, 180)
            res.append({"jdUT": jd, "lat": lat, "lon": lon, "ref": positions(jd, lat, lon, flags)})
        print(json.dumps(res, separators=(",", ":")))


if __name__ == "__main__":
    main()
