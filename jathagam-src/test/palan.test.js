import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeChart } from '../src/engine/index.js';
import { generatePalan, houseOf, dignity } from '../src/palan/index.js';

const refs = JSON.parse(readFileSync(new URL('./reference-charts.json', import.meta.url))).charts;
const fmt = (a, b) => `${a.toISOString().slice(0, 10)} - ${b.toISOString().slice(0, 10)}`;

describe('palan rules', () => {
  it('whole-sign houses counted from lagnam', () => {
    expect(houseOf(5, 5)).toBe(1);
    expect(houseOf(4, 5)).toBe(12);
    expect(houseOf(2, 11)).toBe(4);
  });
  it('dignity: uchcham, neecham, aatchi', () => {
    expect(dignity('sun', 0)).toBe('exalted');
    expect(dignity('sun', 6)).toBe('debilitated');
    expect(dignity('saturn', 10)).toBe('own');
    expect(dignity('jupiter', 9)).toBe('debilitated');
    expect(dignity('venus', 11)).toBe('exalted');
    expect(dignity('rahu', 1)).toBeNull();
  });
});

describe('palan text for reference charts', () => {
  for (const c of refs) {
    const chart = computeChart({ utc: new Date(c.utc), lat: c.lat, lon: c.lon });
    for (const lang of ['en', 'ta']) {
      it(`${c.name} (${lang})`, () => {
        const now = new Date(new Date(c.utc).getTime() + 30 * 365.25 * 86400000);
        const p = generatePalan(chart, lang, fmt, now);
        expect(p.sections).toHaveLength(4);
        const text = [p.note, p.excluded, ...p.sections.flatMap((s) => [s.title, ...s.items])].join('\n');
        expect(text).not.toMatch(/undefined|NaN|null|\[object/);
        expect(p.sections[3].items).toHaveLength(9);
        // Interpretations never assert death, lifespan or illness outcomes
        if (lang === 'en') {
          const body = p.sections.flatMap((s) => s.items).join(' ');
          expect(body).not.toMatch(/\b(death|die|dies|lifespan|longevity|disease|illness|accident)\b/i);
          expect(body).toMatch(/tradition/i);
        }
      });
    }
  }
});
