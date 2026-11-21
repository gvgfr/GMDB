// South Indian square chart: signs are fixed, Meenam at top-left, running
// clockwise. Grid positions (row, col) for sign index 0 = Mesham ... 11 = Meenam.
const CELLS = [
  [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3],
  [3, 2], [3, 1], [3, 0], [2, 0], [1, 0], [0, 0],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {object} o
 * @param {string} o.title   centre label (e.g. "Rasi")
 * @param {string[]} o.centerLines extra centre lines (name, date)
 * @param {string[][]} o.boxes  12 arrays of HTML-safe labels, by sign index
 * @param {number} o.lagnaSign  sign index holding the lagnam
 * @param {string[]} o.signNames names of the 12 signs (for the small corner label)
 * @param {string} o.ariaLabel
 */
export function southIndianChart(o) {
  let html = `<div class="si-chart" role="img" aria-label="${esc(o.ariaLabel)}">`;
  for (let s = 0; s < 12; s++) {
    const [r, c] = CELLS[s];
    const lag = s === o.lagnaSign ? ' is-lagna' : '';
    html += `<div class="si-box${lag}" style="grid-row:${r + 1};grid-column:${c + 1}">`;
    html += `<span class="si-sign">${esc(o.signNames[s])}</span>`;
    html += `<span class="si-items">${o.boxes[s].map((x) => `<span>${x}</span>`).join('')}</span>`;
    html += `</div>`;
  }
  html += `<div class="si-center"><strong>${esc(o.title)}</strong>${o.centerLines
    .map((l) => `<span>${esc(l)}</span>`)
    .join('')}</div></div>`;
  return html;
}
