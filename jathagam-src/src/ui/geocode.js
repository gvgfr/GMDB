// Place autocomplete with the Open-Meteo geocoding API (free, no key, CORS).
// Only the typed place name is sent; nothing else leaves the browser.
const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

export async function searchPlaces(query, signal) {
  const url = `${ENDPOINT}?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/**
 * Wire an <input> + <ul role=listbox> pair into an accessible autocomplete.
 * @param {HTMLInputElement} input
 * @param {HTMLUListElement} list
 * @param {(place:{label:string,lat:number,lon:number})=>void} onPick
 * @param {(err:Error)=>void} onError
 */
export function attachAutocomplete(input, list, onPick, onError) {
  let timer = 0;
  let ctrl = null;
  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const render = () => {
    list.innerHTML = '';
    items.forEach((p, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.id = `${list.id}-opt-${i}`;
      li.textContent = p.label;
      const sub = document.createElement('small');
      sub.textContent = ` ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
      li.append(sub);
      li.setAttribute('aria-selected', String(i === active));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(i);
      });
      list.append(li);
    });
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const pick = (i) => {
    const p = items[i];
    if (!p) return;
    input.value = p.label;
    close();
    onPick(p);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      items = [];
      render();
      return;
    }
    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        items = await searchPlaces(q, ctrl.signal);
        active = -1;
        render();
      } catch (e) {
        if (e.name !== 'AbortError') onError(e);
      }
    }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') active = Math.min(items.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active < 0 ? 0 : active);
      return;
    } else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    render();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
