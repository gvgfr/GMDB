import { describe, it, expect } from 'vitest';
import { porutham, rasisForNakshatra, rajjuOf, GANAM, YONI, VASYAM } from '../src/engine/porutham.js';

const get = (r, k) => r.items.find((i) => i.key === k);

describe('porutham tables', () => {
  it('9 stars in each ganam, 2 stars per yoni animal', () => {
    for (const g of [0, 1, 2]) expect(GANAM.filter((x) => x === g)).toHaveLength(9);
    const counts = {};
    YONI.forEach((y) => (counts[y] = (counts[y] || 0) + 1));
    expect(Object.keys(counts)).toHaveLength(14);
    expect(Object.values(counts).every((c) => c === 2 || c === 1)).toBe(true);
  });
  it('rajju groups: 6 stars each, siro has 3', () => {
    const c = [0, 0, 0, 0, 0];
    for (let n = 0; n < 27; n++) c[rajjuOf(n)]++;
    expect(c).toEqual([6, 6, 6, 6, 3]);
    expect([4, 13, 22].map(rajjuOf)).toEqual([4, 4, 4]); // Mirugaseeridam, Chithirai, Avittam
    expect([3, 12, 21].map(rajjuOf)).toEqual([3, 3, 3]); // Rohini, Hastham, Thiruvonam
  });
  it('vasyam lists stay within 12 signs', () => {
    expect(VASYAM).toHaveLength(12);
    VASYAM.flat().forEach((s) => expect(s).toBeGreaterThanOrEqual(0));
  });
  it('rasis spanned by a nakshatra', () => {
    expect(rasisForNakshatra(0)).toEqual([{ rasi: 0, padams: [1, 2, 3, 4] }]); // Aswini
    expect(rasisForNakshatra(2)).toEqual([{ rasi: 0, padams: [1] }, { rasi: 1, padams: [2, 3, 4] }]); // Karthigai
    expect(rasisForNakshatra(26)).toEqual([{ rasi: 11, padams: [1, 2, 3, 4] }]); // Revathi
  });
});

describe('porutham rules', () => {
  it('Rohini girl, Thiruvonam boy: same kanta rajju fails', () => {
    const r = porutham({ nakshatra: 3, rasi: 1 }, { nakshatra: 21, rasi: 9 });
    expect(get(r, 'rajju').level).toBe('illai');
    expect(r.rajjuOk).toBe(false);
  });
  it('vedhai pairs fail in either direction', () => {
    expect(get(porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 17, rasi: 7 }), 'vedhai').level).toBe('illai');
    expect(get(porutham({ nakshatra: 17, rasi: 7 }, { nakshatra: 0, rasi: 0 }), 'vedhai').level).toBe('illai');
    expect(get(porutham({ nakshatra: 13, rasi: 5 }, { nakshatra: 22, rasi: 9 }), 'vedhai').level).toBe('illai');
  });
  it('dinam and mahendram from the inclusive star count', () => {
    // Aswini -> Rohini: count 4 -> dinam good (4), mahendram good (4)
    const r = porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 3, rasi: 1 });
    expect(get(r, 'dinam')).toMatchObject({ level: 'uthamam', detail: { count: 4 } });
    expect(get(r, 'mahendram').level).toBe('uthamam');
    expect(get(r, 'streeDeergham').level).toBe('illai');
    // Aswini -> Bharani: count 2 good dinam, count 3 bad
    expect(get(porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 1, rasi: 0 }), 'dinam').level).toBe('uthamam');
    expect(get(porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 2, rasi: 0 }), 'dinam').level).toBe('illai');
  });
  it('ganam: deva girl + manushya boy good, rakshasa with deva fails', () => {
    expect(get(porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 1, rasi: 0 }), 'ganam').level).toBe('uthamam');
    expect(get(porutham({ nakshatra: 1, rasi: 0 }, { nakshatra: 0, rasi: 0 }), 'ganam').level).toBe('madhyamam');
    expect(get(porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 2, rasi: 0 }), 'ganam').level).toBe('illai');
  });
  it('yoni enemies: Aswini (horse) with Hastham (buffalo)', () => {
    expect(get(porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 12, rasi: 5 }), 'yoni').level).toBe('illai');
    expect(get(porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 23, rasi: 10 }), 'yoni').level).toBe('uthamam');
  });
  it('rasi and lords: Mesham girl with Thulam boy (7th) is good; Sun-Saturn lords are enemies', () => {
    const r = porutham({ nakshatra: 0, rasi: 0 }, { nakshatra: 14, rasi: 6 });
    expect(get(r, 'rasi').level).toBe('uthamam');
    expect(get(porutham({ nakshatra: 10, rasi: 4 }, { nakshatra: 21, rasi: 9 }), 'rasiAdhipathi').level).toBe('illai');
  });
  it('score counts non-failing checks out of 10', () => {
    const r = porutham({ nakshatra: 5, rasi: 2 }, { nakshatra: 9, rasi: 4 });
    expect(r.total).toBe(10);
    expect(r.score).toBe(r.items.filter((i) => i.level !== 'illai').length);
    expect(r.items).toHaveLength(10);
  });
  it('every star pair produces valid results', () => {
    for (let g = 0; g < 27; g++)
      for (let b = 0; b < 27; b++) {
        const r = porutham({ nakshatra: g, rasi: rasisForNakshatra(g)[0].rasi }, { nakshatra: b, rasi: rasisForNakshatra(b)[0].rasi });
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(10);
      }
  });
});
