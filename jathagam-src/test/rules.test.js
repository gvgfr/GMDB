// Unit tests for the traditional rules layered on top of the positions.
import { describe, it, expect } from 'vitest';
import { navamsaSign } from '../src/engine/vargas.js';
import { describeLongitude, dms } from '../src/engine/nakshatra.js';
import { vimshottari, activePeriod, yearsToYMD } from '../src/engine/dasa.js';
import { DASA_ORDER, nakshatraLord } from '../src/engine/constants.js';
import { thithiName, NAMES } from '../src/i18n.js';

describe('navamsam', () => {
  it('first navamsam of each sign follows fire/earth/air/water starts', () => {
    // Mesham->Mesham, Rishabam->Magaram, Mithunam->Thulam, Kadagam->Kadagam
    expect([0, 30, 60, 90].map(navamsaSign)).toEqual([0, 9, 6, 3]);
  });
  it('last navamsam of Meenam is Meenam; Simmam 4th navamsam is Kadagam', () => {
    expect(navamsaSign(359.9)).toBe(11);
    expect(navamsaSign(120 + 10.5)).toBe(3);
  });
  it('Vargottama: 0-3°20 Mesham is Mesham in both charts', () => expect(navamsaSign(1)).toBe(0));
});

describe('nakshatra and padam', () => {
  it('boundaries', () => {
    expect(describeLongitude(0)).toMatchObject({ nakshatra: 0, pada: 1, sign: 0 });
    expect(describeLongitude(13 + 20 / 60 - 1e-9)).toMatchObject({ nakshatra: 0, pada: 4 });
    expect(describeLongitude(13 + 20 / 60 + 1e-9)).toMatchObject({ nakshatra: 1, pada: 1 });
    expect(describeLongitude(359.99)).toMatchObject({ nakshatra: 26, pada: 4, sign: 11 });
  });
  it('Karthigai spans Mesham and Rishabam', () => {
    expect(describeLongitude(29).nakshatra).toBe(2);
    expect(describeLongitude(31).nakshatra).toBe(2);
  });
  it('lords follow the Vimshottari order', () => {
    expect(nakshatraLord(0)).toBe('ketu');
    expect(nakshatraLord(3)).toBe('moon'); // Rohini
    expect(nakshatraLord(26)).toBe('mercury'); // Revathi
  });
  it('dms rounding carries correctly', () => expect(dms(29.99999)).toEqual({ d: 30, m: 0, s: 0 }));
});

describe('vimshottari', () => {
  const birth = new Date('2000-01-01T00:00:00Z');
  it('Moon at the very start of Aswini gives a full Kethu dasa', () => {
    const d = vimshottari(0, birth);
    expect(d.firstLord).toBe('ketu');
    expect(d.balanceYears).toBeCloseTo(7, 9);
    expect(d.periods[0].start.getTime()).toBe(birth.getTime());
  });
  it('Moon half-way through Rohini leaves 5 years of Chandra dasa', () => {
    const d = vimshottari(40 + 20 / 3 / 1, birth); // Rohini 40°00'-53°20', midpoint 46°40'
    expect(d.firstLord).toBe('moon');
    expect(d.balanceYears).toBeCloseTo(5, 9);
  });
  it('sequence covers 120 years in order, bhuktis tile each dasa', () => {
    const d = vimshottari(100, birth);
    const span = (d.periods[8].end - d.periods[0].start) / (365.25 * 86400000);
    expect(span).toBeCloseTo(120, 6);
    const i0 = DASA_ORDER.indexOf(d.firstLord);
    d.periods.forEach((p, i) => {
      expect(p.lord).toBe(DASA_ORDER[(i0 + i) % 9]);
      expect(p.bhuktis[0].lord).toBe(p.lord);
      expect(p.bhuktis[0].start.getTime()).toBe(p.start.getTime());
      expect(Math.abs(p.bhuktis[8].end - p.end)).toBeLessThan(2);
    });
    expect(activePeriod(d, birth).dasa).toBe(d.periods[0]);
  });
  it('balance formatting', () => expect(yearsToYMD(5.5)).toEqual({ y: 5, m: 6, d: 0 }));
});

describe('names', () => {
  it('Tamil names, not Sanskrit, in both languages', () => {
    expect(NAMES.rasi.en[3]).toBe('Kadagam');
    expect(NAMES.nakshatra.en[2]).toBe('Karthigai');
    expect(NAMES.rasi.ta).toHaveLength(12);
    expect(NAMES.nakshatra.ta).toHaveLength(27);
    expect(NAMES.yogam.ta).toHaveLength(27);
    expect(NAMES.yogam.en).toHaveLength(27);
  });
  it('thithi naming at full and new moon', () => {
    expect(thithiName(14, 'en')).toBe('Pournami');
    expect(thithiName(29, 'ta')).toBe('அமாவாசை');
    expect(thithiName(15, 'en')).toBe('Prathamai');
  });
});
