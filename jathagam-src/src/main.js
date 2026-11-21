import '@fontsource/noto-sans-tamil/400.css';
import '@fontsource/noto-sans-tamil/600.css';
import '@fontsource/noto-sans-tamil/700.css';
import './style.css';
import { DateTime } from 'luxon';
import { computeChart, localToUtc, zoneFor, offsetZone, activePeriod, yearsToYMD, dms } from './engine/index.js';
import { NAMES, UI, thithiName } from './i18n.js';
import { southIndianChart } from './ui/chart.js';
import { attachAutocomplete } from './ui/geocode.js';
import { generatePalan } from './palan/index.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const state = {
  lang: navigator.language?.startsWith('ta') ? 'ta' : 'en',
  place: null, // {label, lat, lon}
  last: null, // last computed {chart, meta}
  showPalan: false,
};
const t = (k) => UI[state.lang][k] ?? k;
// Matches the 640px breakpoint in style.css: palan sections start collapsed below it.
const isMobile = () => window.matchMedia('(max-width: 639px)').matches;
const nm = (table, i) => NAMES[table][state.lang][i];

// ---------------------------------------------------------------- i18n
function applyLang() {
  document.documentElement.lang = state.lang;
  document.body.dataset.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  $('lang-toggle').textContent = t('lang');
  if (state.last) renderResults(state.last);
}
$('lang-toggle').addEventListener('click', () => {
  state.lang = state.lang === 'ta' ? 'en' : 'ta';
  // Expand every dasa for printing (also when printing from the browser menu).
let closedForPrint = [];
window.addEventListener('beforeprint', () => {
  closedForPrint = [...document.querySelectorAll('details.dasa:not([open]), details.palan-sec:not([open])')];
  closedForPrint.forEach((d) => (d.open = true));
});
window.addEventListener('afterprint', () => closedForPrint.forEach((d) => (d.open = false)));

applyLang();
});

// ---------------------------------------------------------------- place
attachAutocomplete(
  $('f-place'),
  $('place-list'),
  (p) => {
    state.place = p;
    $('f-lat').value = p.lat.toFixed(4);
    $('f-lon').value = p.lon.toFixed(4);
    $('place-picked').textContent = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
    $('form-error').textContent = '';
  },
  () => {
    $('form-error').textContent = t('geoError');
    document.querySelector('details.more').open = true;
  }
);
$('f-place').addEventListener('input', () => {
  state.place = null;
  $('place-picked').textContent = '';
});

// ---------------------------------------------------------------- submit
$('birth-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('form-error');
  err.textContent = '';
  const f = e.target;
  const [y, mo, d] = (f.date.value || '').split('-').map(Number);
  let hh = Number(f.hh.value);
  const mm = Number(f.mm.value);
  if (!y || !mo || !d || f.hh.value === '' || f.mm.value === '' || hh < 1 || hh > 12 || mm < 0 || mm > 59) {
    err.textContent = t('badTime');
    return;
  }
  hh = (hh % 12) + (f.ampm.value === 'pm' ? 12 : 0);

  const lat = parseFloat(f.lat.value);
  const lon = parseFloat(f.lon.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    err.textContent = t('noPlace');
    return;
  }

  const zone = f.tz.value === 'auto' ? zoneFor(lat, lon) : offsetZone(Number(f.tz.value));
  const conv = localToUtc({ year: y, month: mo, day: d, hour: hh, minute: mm }, zone);
  if (!conv.valid) {
    err.textContent = t('badTime');
    return;
  }
  const chart = computeChart({ utc: conv.utc, lat, lon }, { node: f.node.value });
  state.last = {
    chart,
    meta: {
      name: f.name.value.trim(),
      place: state.place?.label || f.place.value.trim(),
      lat,
      lon,
      zone,
      conv,
    },
  };
  state.showPalan = false;
  renderResults(state.last);
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------- render
const fmtDeg = (deg) => {
  const { d, m, s } = dms(deg);
  return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″`;
};
const fmtOffset = (min) => {
  const s = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  return `UTC${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
};

function renderResults({ chart, meta }) {
  const L = state.lang;
  const zone = meta.zone;
  const dt = (date, fmt) => DateTime.fromJSDate(date, { zone }).setLocale(L === 'ta' ? 'ta-IN' : 'en-GB').toFormat(fmt);
  const local = DateTime.fromJSDate(meta.conv.utc, { zone });
  const dateLine = local.toFormat('dd-MM-yyyy, hh:mm a');
  const s = chart.summary;
  const gName = (k) => NAMES.graha[L][k];
  const gLabel = (k) => (L === 'en' ? `${gName(k)} <span class="gloss">(${NAMES.grahaGloss[k]})</span>` : gName(k));

  // --- verification strip
  const note = meta.conv.note === 'nonexistent' ? t('gap') : meta.conv.note === 'ambiguous' ? t('ambiguous') : '';
  const verify = `
    <div class="card verify">
      <h2>${t('verify')}</h2>
      <dl class="kv">
        <dt>${t('pob')}</dt><dd>${esc(meta.place || '—')}</dd>
        <dt>${t('coords')}</dt><dd>${meta.lat.toFixed(4)}°, ${meta.lon.toFixed(4)}°</dd>
        <dt>${t('timezone')}</dt><dd>${esc(zone)} (${fmtOffset(meta.conv.offsetMinutes)})</dd>
        <dt>${t('localTime')}</dt><dd>${local.toFormat('yyyy-MM-dd HH:mm')}</dd>
        <dt>${t('utcTime')}</dt><dd>${DateTime.fromJSDate(meta.conv.utc, { zone: 'utc' }).toFormat('yyyy-MM-dd HH:mm')} UTC</dd>
        <dt>${t('ayanamsa')}</dt><dd>${fmtDeg(chart.ayanamsa)}</dd>
      </dl>
      ${note ? `<p class="warn">${note}</p>` : ''}
    </div>`;

  // --- summary
  const summary = `
    <div class="card summary">
      <h2>${meta.name ? esc(meta.name) : t('summary')}</h2>
      <p class="sub">${dateLine} · ${esc(meta.place || `${meta.lat.toFixed(2)}, ${meta.lon.toFixed(2)}`)}</p>
      <div class="tiles">
        <div class="tile"><span>${t('rasi')}</span><strong>${nm('rasi', s.rasi)}</strong></div>
        <div class="tile"><span>${t('nakshatra')}</span><strong>${nm('nakshatra', s.nakshatra)}</strong><em>${t('pada')} ${s.pada}</em></div>
        <div class="tile"><span>${t('lagnam')}</span><strong>${nm('rasi', s.lagnam)}</strong></div>
        <div class="tile"><span>${t('rasiLord')}</span><strong>${gName(s.rasiLord)}</strong></div>
        <div class="tile"><span>${t('nakLord')}</span><strong>${gName(s.nakshatraLord)}</strong></div>
      </div>
    </div>`;

  // --- charts
  const retroMark = L === 'ta' ? '(வ)' : '(R)';
  const boxes = (signOf) => {
    const b = Array.from({ length: 12 }, () => []);
    b[signOf(chart.lagnam)].push(`<b class="lag">${NAMES.grahaShort[L].lagnam}</b>`);
    for (const p of chart.planets) {
      b[signOf(p)].push(`${NAMES.grahaShort[L][p.key]}${p.retro && p.key !== 'rahu' && p.key !== 'ketu' ? `<sup>${retroMark}</sup>` : ''}`);
    }
    return b;
  };
  const centre = [meta.name, dateLine].filter(Boolean);
  const rasiChart = southIndianChart({
    title: t('rasiChart'),
    centerLines: centre,
    boxes: boxes((p) => p.sign),
    lagnaSign: chart.lagnam.sign,
    signNames: NAMES.rasi[L],
    ariaLabel: t('rasiChart'),
  });
  const navChart = southIndianChart({
    title: t('navamsaChart'),
    centerLines: centre,
    boxes: boxes((p) => p.navamsa),
    lagnaSign: chart.lagnam.navamsa,
    signNames: NAMES.rasi[L],
    ariaLabel: t('navamsaChart'),
  });
  const charts = `
    <div class="charts">
      <div class="card chart-card"><h2>${t('rasiChart')}</h2>${rasiChart}</div>
      <div class="card chart-card"><h2>${t('navamsaChart')}</h2>${navChart}</div>
    </div>`;

  // --- planet table
  const rows = [chart.lagnam, ...chart.planets]
    .map(
      (p) => `<tr>
        <th scope="row">${gLabel(p.key)}</th>
        <td>${nm('rasi', p.sign)}</td>
        <td class="num">${fmtDeg(p.degInSign)}</td>
        <td>${nm('nakshatra', p.nakshatra)}</td>
        <td class="num">${p.pada}</td>
        <td>${p.retro ? `<span class="retro">${t('retro')}</span>` : ''}</td>
      </tr>`
    )
    .join('');
  const table = `
    <div class="card">
      <h2>${t('planets')}</h2>
      <div class="table-wrap"><table class="planets">
        <thead><tr><th>${t('graha')}</th><th>${t('rasi')}</th><th>${t('degree')}</th><th>${t('nakshatra')}</th><th>${t('pada')}</th><th>${t('retro')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="hint">${chart.input.options.node === 'true' ? t('trueNode') : t('meanNode')} · ${t('ayanamsa')} ${fmtDeg(chart.ayanamsa)}</p>
    </div>`;

  // --- dasa
  const now = new Date();
  const act = activePeriod(chart.dasa, now);
  const bal = yearsToYMD(chart.dasa.balanceYears);
  const dfmt = 'dd-MM-yyyy';
  const dasaRows = chart.dasa.periods
    .map((p, i) => {
      const isCur = act && act.dasa === p;
      const bh = p.bhuktis
        .map((b) => {
          const cur = act && act.bhukti === b;
          return `<li class="${cur ? 'current' : ''}"><span>${gName(p.lord)} – ${gName(b.lord)}</span><span class="num">${dt(b.start, dfmt)} → ${dt(b.end, dfmt)}</span>${cur ? `<em class="badge">${t('current')}</em>` : ''}</li>`;
        })
        .join('');
      return `<details class="dasa ${isCur ? 'current' : ''}" ${isCur ? 'open' : ''}>
        <summary><span class="dl">${gName(p.lord)}${i === 0 ? ' *' : ''}</span><span class="num">${dt(p.start, dfmt)} → ${dt(p.end, dfmt)}</span><span class="yrs">${p.years} ${t('years')}</span>${isCur ? `<em class="badge">${t('current')}</em>` : ''}</summary>
        <ol class="bhukti">${bh}</ol>
      </details>`;
    })
    .join('');
  const dasa = `
    <div class="card">
      <h2>${t('dasa')}</h2>
      <p class="balance">* ${t('balance')}: <strong>${gName(chart.dasa.firstLord)}</strong> ${bal.y} ${t('years')} ${bal.m} ${t('months')} ${bal.d} ${t('days')}</p>
      <div class="dasa-list">${dasaRows}</div>
    </div>`;

  // --- panchangam
  const pc = chart.panchangam;
  const pak = NAMES.paksha[L][pc.paksha];
  const panch = `
    <div class="card">
      <h2>${t('panchangam')}</h2>
      <dl class="kv">
        <dt>${t('thithi')}</dt><dd>${pak} ${thithiName(pc.thithi, L)}</dd>
        <dt>${t('vaaram')}</dt><dd>${nm('vaaram', pc.vaaram)}${pc.beforeSunrise ? ` <small>(${t('beforeSunrise')})</small>` : ''}</dd>
        <dt>${t('nakshatra')}</dt><dd>${nm('nakshatra', pc.nakshatra)}</dd>
        <dt>${t('yogam')}</dt><dd>${nm('yogam', pc.yogam)}</dd>
        <dt>${t('karanam')}</dt><dd>${nm('karanam', pc.karanam)}</dd>
        ${pc.sunrise ? `<dt>${t('sunrise')}</dt><dd>${dt(pc.sunrise, 'dd-MM-yyyy hh:mm a')}</dd>` : ''}
      </dl>
    </div>`;

  const actions = `<div class="actions no-print">
      <button type="button" class="btn-primary" id="btn-print">${t('print')}</button>
      <button type="button" class="btn-palan" id="btn-palan" aria-expanded="${state.showPalan}" aria-controls="palan">${state.showPalan ? t('palanHide') : t('palanShow')}</button>
      <button type="button" class="btn-ghost dark" id="btn-edit">${t('edit')}</button>
    </div>`;

  // --- palan (traditional readings), shown on demand
  let palan = '';
  if (state.showPalan) {
    const pl = generatePalan(chart, L, (a, b) => `${dt(a, dfmt)} → ${dt(b, dfmt)}`);
    palan = `
    <div class="card palan" id="palan">
      <h2>${t('palan')}</h2>
      <p class="warn">${esc(pl.note)}</p>
      ${pl.sections
        .map(
          (sec, i) => `<details class="palan-sec" ${!isMobile() || i === 0 ? 'open' : ''}>
        <summary><h3>${esc(sec.title)}</h3></summary>
        <ul>${sec.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </details>`
        )
        .join('')}
      <p class="hint">${esc(pl.excluded)}</p>
    </div>`;
  }

  const res = $('results');
  res.innerHTML = actions + summary + palan + charts + verify + table + panch + dasa;
  res.hidden = false;
  $('btn-print').addEventListener('click', () => window.print());
  $('btn-palan').addEventListener('click', () => {
    state.showPalan = !state.showPalan;
    renderResults(state.last);
    if (state.showPalan) $('palan').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('btn-edit').addEventListener('click', () => $('birth-form').scrollIntoView({ behavior: 'smooth' }));
}

// Expand every dasa for printing (also when printing from the browser menu).
let closedForPrint = [];
window.addEventListener('beforeprint', () => {
  closedForPrint = [...document.querySelectorAll('details.dasa:not([open]), details.palan-sec:not([open])')];
  closedForPrint.forEach((d) => (d.open = true));
});
window.addEventListener('afterprint', () => closedForPrint.forEach((d) => (d.open = false)));

applyLang();
