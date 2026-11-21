// Palan: rule-based traditional readings for one chart, in Tamil or English.
// Every statement is phrased as what tradition says, never as a certainty.
import { SIGN_LORDS } from '../engine/constants.js';
import { activePeriod } from '../engine/dasa.js';
import { NAMES } from '../i18n.js';
import { KARAKA, HOUSE, SIGN_TRAITS, NAK_TRAITS, DASA_THEME, EXALTATION, BENEFICS, UPACHAYA } from './texts.js';

/** House (1-12, whole-sign from lagnam) of a sign index. */
export const houseOf = (sign, lagnaSign) => ((sign - lagnaSign + 12) % 12) + 1;

const ord = (n) => {
  const s = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${s}`;
};

export function dignity(key, sign) {
  if (!(key in EXALTATION)) return null;
  if (EXALTATION[key] === sign) return 'exalted';
  if ((EXALTATION[key] + 6) % 12 === sign) return 'debilitated';
  if (SIGN_LORDS[sign] === key) return 'own';
  return null;
}

const T = {
  en: {
    note: 'These readings are traditional jothidam meanings applied to this chart. They are cultural beliefs, not scientifically proven predictions. Please don’t base major decisions on them alone.',
    excluded: 'Not covered on purpose: health, lifespan and dosham verdicts. For these, please consult a doctor or a trusted elder or astrologer who knows the whole family context.',
    sec: { nature: 'Nature and temperament', dasa: 'Current period (dasa / bhukti)', areas: 'Areas of life', planets: 'Planet by planet' },
    lagnam: (s, tr) => `Lagnam in ${s}: tradition describes the personality as ${tr}.`,
    rasi: (s, tr) => `Moon in ${s} (your rasi): the mind and emotions are traditionally described as ${tr}.`,
    nak: (n, p, tr, lord) => `Born in ${n} nakshatram, padam ${p}: traditionally ${tr}. Its lord ${lord} colours the outlook.`,
    dasaNow: (l, r, th) => `You are in ${l} mahadasa (${r}). This period is traditionally associated with ${th}.`,
    dasaHouse: (l, h, th) => `${l} sits in your ${ord(h)} house, so these themes are expected to touch ${th}.`,
    bhukti: (b, r, th, h, hth) => `Current bhukti: ${b} (${r}) — traditionally brings ${th}, with focus on the ${ord(h)} house (${hth}).`,
    next: (l, r, th) => `Next mahadasa: ${l} (${r}) — traditionally ${th}.`,
    noDasa: 'The current date is outside the computed 120-year dasa sequence.',
    area: (h, sign, lord, lh, lth) => `Your ${ord(h)} house is ${sign}, ruled by ${lord}, placed in your ${ord(lh)} house. Tradition links this area with ${lth}.`,
    occupants: (list) => `Planets here: ${list}.`,
    karaka: (p, h, th) => `${p}, the natural significator, is in your ${ord(h)} house (${th}).`,
    areas: { career: 'Career (10th house)', marriage: 'Marriage and partnership (7th house)', education: 'Education and intellect (5th house)', wealth: 'Wealth and income (2nd and 11th houses)', family: 'Home, mother and family (4th house)' },
    place: (p, k, h, th) => `${p} (${k}) is in your ${ord(h)} house — ${th}.`,
    benefic: 'Tradition sees this as supportive: its qualities are expected to flow into these areas.',
    malefic: 'Tradition sees this as an area of effort and testing, where results come through persistence.',
    upachaya: (h) => `Malefics in the ${ord(h)} house are traditionally considered favourable — they give the drive to overcome and grow.`,
    exalted: (p, s) => `${p} is exalted (uchcham) in ${s} — traditionally its strongest state.`,
    own: (p, s) => `${p} is in its own sign (aatchi), ${s} — traditionally a strong state.`,
    debilitated: (p, s) => `${p} is debilitated (neecham) in ${s} — tradition says its results come with delay or after effort.`,
    retro: (p) => `${p} is vakram (retrograde) — traditionally its matters are revisited or come later.`,
  },
  ta: {
    note: 'இவை இந்த ஜாதகத்திற்குப் பொருத்தப்பட்ட பாரம்பரிய ஜோதிடப் பலன்கள். இவை கலாச்சார நம்பிக்கைகள்; அறிவியல் ரீதியாக நிரூபிக்கப்பட்ட கணிப்புகள் அல்ல. முக்கிய முடிவுகளை இவற்றை மட்டும் வைத்து எடுக்க வேண்டாம்.',
    excluded: 'வேண்டுமென்றே சேர்க்கப்படாதவை: உடல்நலம், ஆயுள், தோஷ தீர்ப்புகள். இவற்றுக்கு மருத்துவரையோ, குடும்பச் சூழலை அறிந்த நம்பகமான பெரியவரையோ ஜோதிடரையோ அணுகவும்.',
    sec: { nature: 'குணமும் இயல்பும்', dasa: 'நடப்பு காலம் (தசை / புக்தி)', areas: 'வாழ்க்கைப் பகுதிகள்', planets: 'கிரக வாரியாக' },
    lagnam: (s, tr) => `லக்னம் ${s}: பாரம்பரியமாக குணம் — ${tr}.`,
    rasi: (s, tr) => `சந்திரன் ${s} ராசியில் (உங்கள் ராசி): மனமும் உணர்வுகளும் பாரம்பரியமாக — ${tr}.`,
    nak: (n, p, tr, lord) => `${n} நட்சத்திரம், ${p}-ஆம் பாதம்: பாரம்பரியமாக ${tr}. நட்சத்திர அதிபதி ${lord} கண்ணோட்டத்தை வடிவமைக்கிறார்.`,
    dasaNow: (l, r, th) => `நீங்கள் ${l} மகா தசையில் இருக்கிறீர்கள் (${r}). இந்தக் காலம் பாரம்பரியமாக ${th} ஆகியவற்றுடன் தொடர்புடையது.`,
    dasaHouse: (l, h, th) => `${l} உங்கள் ${h}-ஆம் வீட்டில் உள்ளதால், இந்தப் பலன்கள் ${th} ஆகியவற்றைத் தொடும் என்பது நம்பிக்கை.`,
    bhukti: (b, r, th, h, hth) => `நடப்பு புக்தி: ${b} (${r}) — பாரம்பரியமாக ${th}; ${h}-ஆம் வீட்டு விஷயங்களில் (${hth}) கவனம்.`,
    next: (l, r, th) => `அடுத்த மகா தசை: ${l} (${r}) — பாரம்பரியமாக ${th}.`,
    noDasa: 'இன்றைய தேதி கணிக்கப்பட்ட 120 ஆண்டு தசா வரிசைக்கு வெளியே உள்ளது.',
    area: (h, sign, lord, lh, lth) => `${h}-ஆம் வீடு ${sign}, அதிபதி ${lord}, உங்கள் ${lh}-ஆம் வீட்டில் உள்ளார். பாரம்பரியமாக இந்தப் பகுதி ${lth} ஆகியவற்றுடன் இணைகிறது.`,
    occupants: (list) => `இங்குள்ள கிரகங்கள்: ${list}.`,
    karaka: (p, h, th) => `காரக கிரகம் ${p} உங்கள் ${h}-ஆம் வீட்டில் (${th}) உள்ளது.`,
    areas: { career: 'தொழில் (10-ஆம் வீடு)', marriage: 'திருமணம், கூட்டாண்மை (7-ஆம் வீடு)', education: 'கல்வி, அறிவு (5-ஆம் வீடு)', wealth: 'செல்வம், வருமானம் (2, 11-ஆம் வீடுகள்)', family: 'வீடு, தாய், குடும்பம் (4-ஆம் வீடு)' },
    place: (p, k, h, th) => `${p} (${k}) உங்கள் ${h}-ஆம் வீட்டில் — ${th}.`,
    benefic: 'பாரம்பரியமாக இது சாதகமாகக் கருதப்படுகிறது — இதன் குணங்கள் இந்த விஷயங்களில் வெளிப்படும் என்பது நம்பிக்கை.',
    malefic: 'பாரம்பரியமாக இது முயற்சியும் சோதனையும் உள்ள பகுதி — விடாமுயற்சியால் பலன் கிடைக்கும் என்பது நம்பிக்கை.',
    upachaya: (h) => `${h}-ஆம் வீட்டில் பாவ கிரகங்கள் இருப்பது பாரம்பரியமாக நல்லதாகக் கருதப்படுகிறது — தடைகளை வென்று வளர உந்துதல் தரும்.`,
    exalted: (p, s) => `${p} ${s} ராசியில் உச்சம் — பாரம்பரியமாக மிக வலுவான நிலை.`,
    own: (p, s) => `${p} சொந்த ராசியான ${s} ராசியில் ஆட்சி — பாரம்பரியமாக வலுவான நிலை.`,
    debilitated: (p, s) => `${p} ${s} ராசியில் நீசம் — பாரம்பரியமாக இதன் பலன்கள் தாமதமாகவோ முயற்சிக்குப் பின்னரோ கிடைக்கும்.`,
    retro: (p) => `${p} வக்ரம் — பாரம்பரியமாக இதன் விஷயங்கள் மீண்டும் கவனத்துக்கு வரும் அல்லது தாமதமாகக் கிடைக்கும்.`,
  },
};

/**
 * @param {object} chart result of computeChart()
 * @param {'ta'|'en'} lang
 * @param {(start: Date, end: Date) => string} fmtRange date range formatter
 * @param {Date} [now]
 * @returns {{note: string, excluded: string, sections: {title: string, items: string[]}[]}}
 */
export function generatePalan(chart, lang, fmtRange, now = new Date()) {
  const t = T[lang];
  const g = (k) => NAMES.graha[lang][k];
  const sign = (i) => NAMES.rasi[lang][i];
  const lag = chart.lagnam.sign;
  const by = Object.fromEntries(chart.planets.map((p) => [p.key, p]));
  const hOf = (key) => houseOf(by[key].sign, lag);
  const occupants = (h) => chart.planets.filter((p) => houseOf(p.sign, lag) === h);

  // --- nature
  const s = chart.summary;
  const nature = [
    t.lagnam(sign(lag), SIGN_TRAITS[lag][lang]),
    t.rasi(sign(s.rasi), SIGN_TRAITS[s.rasi][lang]),
    t.nak(NAMES.nakshatra[lang][s.nakshatra], s.pada, NAK_TRAITS[s.nakshatra][lang], g(s.nakshatraLord)),
  ];

  // --- dasa
  const dasa = [];
  const act = activePeriod(chart.dasa, now);
  if (act) {
    const L = act.dasa.lord;
    dasa.push(t.dasaNow(g(L), fmtRange(act.dasa.start, act.dasa.end), DASA_THEME[L][lang]));
    dasa.push(t.dasaHouse(g(L), hOf(L), HOUSE[hOf(L)][lang]));
    if (act.bhukti) {
      const B = act.bhukti.lord;
      dasa.push(t.bhukti(g(B), fmtRange(act.bhukti.start, act.bhukti.end), DASA_THEME[B][lang], hOf(B), HOUSE[hOf(B)][lang]));
    }
    const i = chart.dasa.periods.indexOf(act.dasa);
    const nx = chart.dasa.periods[i + 1];
    if (nx) dasa.push(t.next(g(nx.lord), fmtRange(nx.start, nx.end), DASA_THEME[nx.lord][lang]));
  } else dasa.push(t.noDasa);

  // --- life areas
  const area = (name, houses, karakas) => {
    const items = [];
    for (const h of houses) {
      const sg = (lag + h - 1) % 12;
      const lord = SIGN_LORDS[sg];
      const lh = hOf(lord);
      items.push(t.area(h, sign(sg), g(lord), lh, HOUSE[lh][lang]));
      const occ = occupants(h);
      if (occ.length) items.push(t.occupants(occ.map((p) => `${g(p.key)} (${KARAKA[p.key][lang]})`).join('; ')));
    }
    for (const k of karakas) items.push(t.karaka(g(k), hOf(k), HOUSE[hOf(k)][lang]));
    return `${name} — ${items.join(' ')}`;
  };
  const areas = [
    area(t.areas.career, [10], ['sun', 'saturn']),
    area(t.areas.marriage, [7], ['venus']),
    area(t.areas.education, [5], ['mercury', 'jupiter']),
    area(t.areas.wealth, [2, 11], ['jupiter']),
    area(t.areas.family, [4], ['moon']),
  ];

  // --- planet by planet
  const planets = chart.planets.map((p) => {
    const h = houseOf(p.sign, lag);
    const parts = [t.place(g(p.key), KARAKA[p.key][lang], h, HOUSE[h][lang])];
    if (BENEFICS.has(p.key)) parts.push(t.benefic);
    else if (UPACHAYA.has(h)) parts.push(t.upachaya(h));
    else parts.push(t.malefic);
    const d = dignity(p.key, p.sign);
    if (d) parts.push(t[d](g(p.key), sign(p.sign)));
    if (p.retro && p.key !== 'rahu' && p.key !== 'ketu') parts.push(t.retro(g(p.key)));
    return parts.join(' ');
  });

  return {
    note: t.note,
    excluded: t.excluded,
    sections: [
      { title: t.sec.nature, items: nature },
      { title: t.sec.dasa, items: dasa },
      { title: t.sec.areas, items: areas },
      { title: t.sec.planets, items: planets },
    ],
  };
}
