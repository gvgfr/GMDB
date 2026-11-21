// Thirumana porutham: the ten traditional Tamil compatibility checks between a
// bride (girl) and groom (boy), from their janma nakshatram and rasi.
// Counts are inclusive and run from the girl's star/sign to the boy's, as in
// Tamil almanacs. Rules differ between families and almanacs; the variants
// chosen here are the commonly printed ones and are listed in the README.
import { SIGN_LORDS } from './constants.js';

// Result levels
export const UTHAMAM = 'uthamam'; // good
export const MADHYAMAM = 'madhyamam'; // acceptable
export const ILLAI = 'illai'; // no match

const count27 = (from, to) => ((to - from + 27) % 27) + 1;
const count12 = (from, to) => ((to - from + 12) % 12) + 1;

// Ganam: 0 deva, 1 manushya, 2 rakshasa
export const GANAM = [0, 1, 2, 1, 0, 1, 0, 0, 2, 2, 1, 1, 0, 2, 0, 2, 0, 2, 2, 1, 1, 0, 2, 2, 1, 1, 0];

// Yoni animal per nakshatra
export const YONI = [
  'horse', 'elephant', 'goat', 'serpent', 'serpent', 'dog', 'cat', 'goat', 'cat',
  'rat', 'rat', 'cow', 'buffalo', 'tiger', 'buffalo', 'tiger', 'deer', 'deer',
  'dog', 'monkey', 'mongoose', 'monkey', 'lion', 'horse', 'lion', 'cow', 'elephant',
];
const YONI_ENEMY = [
  ['horse', 'buffalo'], ['elephant', 'lion'], ['goat', 'monkey'], ['serpent', 'mongoose'],
  ['dog', 'deer'], ['cat', 'rat'], ['cow', 'tiger'],
];

// Rajju: 0 pada (foot), 1 ooru (thigh), 2 naabhi (navel), 3 kanta (neck), 4 siro (head)
// Within each block of 9 stars the pattern runs 0,1,2,3,4,3,2,1,0.
const RAJJU_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1, 0];
export const rajjuOf = (n) => RAJJU_PATTERN[n % 9];

// Vedhai pairs (mutually afflicting stars). Mirugaseeridam, Chithirai and
// Avittam afflict one another.
const VEDHAI = [
  [0, 17], [1, 16], [2, 15], [3, 14], [5, 21], [6, 20], [7, 19], [8, 18],
  [9, 26], [10, 25], [11, 24], [12, 23], [4, 13], [4, 22], [13, 22],
];

// Vasyam: signs each sign is attracted to (Tamil almanac table)
export const VASYAM = [
  [4, 7], [3, 6], [5], [7, 8], [6], [1, 11], [9], [3, 5], [11], [0, 10], [0], [9],
];

// Natural friendships of the sign lords
const FRIENDS = {
  sun: ['moon', 'mars', 'jupiter'], moon: ['sun', 'mercury'], mars: ['sun', 'moon', 'jupiter'],
  mercury: ['sun', 'venus'], jupiter: ['sun', 'moon', 'mars'], venus: ['mercury', 'saturn'],
  saturn: ['mercury', 'venus'],
};
const ENEMIES = {
  sun: ['venus', 'saturn'], moon: [], mars: ['mercury'], mercury: ['moon'],
  jupiter: ['mercury', 'venus'], venus: ['sun', 'moon'], saturn: ['sun', 'moon', 'mars'],
};
const relation = (a, b) => (a === b || FRIENDS[a].includes(b) ? 'friend' : ENEMIES[a].includes(b) ? 'enemy' : 'neutral');

/**
 * @param {{nakshatra:number, rasi:number}} girl
 * @param {{nakshatra:number, rasi:number}} boy
 * @returns {{items: {key:string, level:string, detail:object}[], score:number, total:number, rajjuOk:boolean, vedhaiOk:boolean}}
 */
export function porutham(girl, boy) {
  const n = count27(girl.nakshatra, boy.nakshatra);
  const r = count12(girl.rasi, boy.rasi);
  const items = [];
  const add = (key, level, detail = {}) => items.push({ key, level, detail });

  // 1. Dinam: star count from girl to boy; remainder after dividing by 9
  //    of 2, 4, 6, 8 or 0 is good.
  add('dinam', [2, 4, 6, 8, 0].includes(n % 9) ? UTHAMAM : ILLAI, { count: n });

  // 2. Ganam
  const gg = GANAM[girl.nakshatra];
  const bg = GANAM[boy.nakshatra];
  let gl;
  if (gg === bg) gl = UTHAMAM;
  else if (gg === 0 && bg === 1) gl = UTHAMAM;
  else if (gg === 1 && bg === 0) gl = MADHYAMAM;
  else gl = ILLAI; // any rakshasa / non-rakshasa combination
  add('ganam', gl, { girl: gg, boy: bg });

  // 3. Mahendram: boy's star is the 4th, 7th, 10th ... 25th from the girl's
  add('mahendram', [4, 7, 10, 13, 16, 19, 22, 25].includes(n) ? UTHAMAM : ILLAI, { count: n });

  // 4. Stree deergham: boy's star well beyond the girl's
  add('streeDeergham', n > 13 ? UTHAMAM : n > 7 ? MADHYAMAM : ILLAI, { count: n });

  // 5. Yoni
  const gy = YONI[girl.nakshatra];
  const by = YONI[boy.nakshatra];
  const enemy = YONI_ENEMY.some(([a, b]) => (a === gy && b === by) || (a === by && b === gy));
  add('yoni', enemy ? ILLAI : gy === by ? UTHAMAM : MADHYAMAM, { girl: gy, boy: by });

  // 6. Rasi: boy's sign counted from the girl's
  add('rasi', r === 1 || r === 7 ? UTHAMAM : [9, 10, 11, 12].includes(r) ? MADHYAMAM : ILLAI, { count: r });

  // 7. Rasi adhipathi: friendship of the two sign lords
  const gl2 = SIGN_LORDS[girl.rasi];
  const bl2 = SIGN_LORDS[boy.rasi];
  const rel = [relation(gl2, bl2), relation(bl2, gl2)];
  add('rasiAdhipathi', rel.includes('enemy') ? ILLAI : rel.every((x) => x === 'friend') ? UTHAMAM : MADHYAMAM, {
    girl: gl2,
    boy: bl2,
  });

  // 8. Vasyam
  const vasya = VASYAM[girl.rasi].includes(boy.rasi) || VASYAM[boy.rasi].includes(girl.rasi);
  add('vasyam', vasya ? UTHAMAM : ILLAI);

  // 9. Rajju: the two stars must not share a rajju
  const gr = rajjuOf(girl.nakshatra);
  const br = rajjuOf(boy.nakshatra);
  add('rajju', gr !== br ? UTHAMAM : ILLAI, { girl: gr, boy: br });

  // 10. Vedhai
  const a = Math.min(girl.nakshatra, boy.nakshatra);
  const b = Math.max(girl.nakshatra, boy.nakshatra);
  const vedhai = VEDHAI.some(([x, y]) => x === a && y === b);
  add('vedhai', vedhai ? ILLAI : UTHAMAM);

  const score = items.filter((i) => i.level !== ILLAI).length;
  return {
    items,
    score,
    total: 10,
    rajjuOk: items.find((i) => i.key === 'rajju').level !== ILLAI,
    vedhaiOk: items.find((i) => i.key === 'vedhai').level !== ILLAI,
  };
}

/** Signs a nakshatra spans (1 or 2), with the padams in each. */
export function rasisForNakshatra(n) {
  const out = [];
  for (let p = 1; p <= 4; p++) {
    const rasi = Math.floor((n * 4 + p - 1) / 9);
    const e = out.find((x) => x.rasi === rasi);
    if (e) e.padams.push(p);
    else out.push({ rasi, padams: [p] });
  }
  return out;
}
