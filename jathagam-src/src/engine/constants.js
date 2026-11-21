// Language-neutral keys. Display names live in src/i18n.js.
export const GRAHAS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu'];

// Sign lords (rasi adhipathi), index 0 = Mesham
export const SIGN_LORDS = [
  'mars', 'venus', 'mercury', 'moon', 'sun', 'mercury',
  'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter',
];

// Vimshottari order and years; nakshatra n is ruled by DASA_ORDER[n % 9]
export const DASA_ORDER = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];
export const DASA_YEARS = { ketu: 7, venus: 20, sun: 6, moon: 10, mars: 7, rahu: 18, jupiter: 16, saturn: 19, mercury: 17 };
export const nakshatraLord = (n) => DASA_ORDER[n % 9];

export const NAK_SPAN = 360 / 27; // 13°20'
export const PADA_SPAN = NAK_SPAN / 4; // 3°20'
