// Generates one static HTML file per song in /s/ so link-preview crawlers
// (which never run this site's JS) see that song's own movie poster/title
// in og:image/og:title instead of the generic site-wide card — same
// purpose as generate-movie-pages.js, just for the Songs section instead
// of movie reviews. Re-run this on a schedule (see
// .github/workflows/generate-movie-pages.yml) since both the Movies and
// Songs sheets are edited independently of deploys.
const fs = require("fs");
const path = require("path");

const API_URL = "https://script.google.com/macros/s/AKfycbz9ngvixIyBdUhi5caTheX74ppJyQtjFB_rvBbIfs4OS3nLJ-sY8vRLUDmSEZYbaEp2/exec";
const SITE_URL = "https://gvgfr.github.io/GMDB/";
const OUT_DIR = path.join(__dirname, "..", "s");
const FALLBACK_IMAGE = SITE_URL + "share-preview.png";

// Kept in sync by hand with slugifySong() in index.html — both must
// produce the same slug for the same title/movie, or song share links 404.
// Title + movie (not just title) since the same song title can recur
// across different films (covers/remakes).
function slugify(title, movie) {
  let base = String(title || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (movie) {
    const movieSlug = String(movie).toLowerCase()
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (movieSlug) base += "-" + movieSlug;
  }
  return base || "song";
}

// Kept in sync by hand with the identical helper in index.html and
// movies_script.gs — see generate-movie-pages.js for why this exists.
function encodeURIComponentStrict(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function pageHtml(song) {
  const title = song.Title;
  const movie = song.Movie || "";
  const year = song.Year || "";
  const score = song.Score;
  const poster = song.PosterURL || FALLBACK_IMAGE;
  const appUrl = SITE_URL + "index.html?song=" + encodeURIComponentStrict(title);
  const pageTitle = `${title}${movie ? ` — ${movie}` : ""} — Masala Meter`;
  const description = score
    ? `${title}${movie ? ` from ${movie}` : ""} scores ${score}/10 on the Masala Meter${song.WhyHit ? `. ${song.WhyHit}` : "."}`
    : `Read the Masala Meter review for ${title}${movie ? ` from ${movie}` : ""}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}"/>
<title>${escapeHtml(pageTitle)}</title>
<link rel="canonical" href="${escapeHtml(appUrl)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${escapeHtml(appUrl)}"/>
<meta property="og:title" content="${escapeHtml(pageTitle)}"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
<meta property="og:image" content="${escapeHtml(poster)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(pageTitle)}"/>
<meta name="twitter:description" content="${escapeHtml(description)}"/>
<meta name="twitter:image" content="${escapeHtml(poster)}"/>
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body>
<p>Redirecting to <a href="${escapeHtml(appUrl)}">${escapeHtml(pageTitle)}</a>…</p>
</body>
</html>
`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Same retry-on-cold-start pattern as generate-movie-pages.js.
async function fetchJson(url) {
  const attempts = 4;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      lastErr = new Error(`Failed to fetch ${url}: ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) await sleep(2 ** i * 1000);
  }
  throw lastErr;
}

// Combines movie-linked songs (HitSongsDetails on each movie) with
// standalone Songs-sheet entries, same dedupe-by-normalized-title logic as
// getAllSongs() in index.html — kept in sync by hand with that function.
function combineSongs(movies, standaloneSongs) {
  const norm = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const fromMovies = [];
  movies.forEach(m => {
    if (!m.HitSongsDetails) return;
    let details = [];
    try { details = JSON.parse(m.HitSongsDetails); } catch (e) { return; }
    details.forEach(d => {
      if (!d || !d.title || !(Number(d.score) > 0)) return;
      fromMovies.push({
        Title: d.title, WhyHit: d.whyHit || "", Score: Number(d.score),
        Movie: m.Title || "", Year: m.Year || "", PosterURL: m.PosterURL || ""
      });
    });
  });
  const seen = new Set(fromMovies.map(s => norm(s.Title)));
  const fromStandalone = (standaloneSongs || [])
    .filter(s => s.Title && Number(s.Score) > 0 && !seen.has(norm(s.Title)))
    .map(s => ({
      Title: s.Title, WhyHit: s.WhyHit || "", Score: Number(s.Score),
      Movie: s.Movie || "", Year: s.Year || "", PosterURL: s.PosterURL || ""
    }));
  return [...fromMovies, ...fromStandalone];
}

async function main() {
  const [movies, standaloneSongs] = await Promise.all([
    fetchJson(API_URL + "?action=movies"),
    fetchJson(API_URL + "?action=songs")
  ]);
  // Only pages for songs that actually have a poster are worth generating —
  // without one there's nothing better than the generic site-wide card
  // anyway, so skip straight to the ?song= fallback for those.
  const songs = combineSongs(movies, standaloneSongs).filter(s => s.PosterURL);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const seen = new Map();
  const files = new Set();
  for (const s of songs) {
    const base = slugify(s.Title, s.Movie);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    const slug = count > 0 ? `${base}-${count + 1}` : base;
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.html`), pageHtml(s));
    files.add(`${slug}.html`);
  }

  for (const existing of fs.readdirSync(OUT_DIR)) {
    if (existing.endsWith(".html") && !files.has(existing)) {
      fs.unlinkSync(path.join(OUT_DIR, existing));
    }
  }

  console.log(`Generated ${files.size} song pages in ${OUT_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
