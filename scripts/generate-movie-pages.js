// Generates one static HTML file per movie in /m/ so link-preview crawlers
// (which never run this site's JS) see that movie's own poster/title in
// og:image/og:title instead of the generic site-wide card. Each page just
// redirects a human visitor straight into the real app. Re-run this on a
// schedule (see .github/workflows/generate-movie-pages.yml) since the movie
// list lives in a Sheet that's edited independently of deploys.
const fs = require("fs");
const path = require("path");

const API_URL = "https://script.google.com/macros/s/AKfycbz9ngvixIyBdUhi5caTheX74ppJyQtjFB_rvBbIfs4OS3nLJ-sY8vRLUDmSEZYbaEp2/exec";
const SITE_URL = "https://gvgfr.github.io/GMDB/";
const OUT_DIR = path.join(__dirname, "..", "m");
const FALLBACK_IMAGE = SITE_URL + "share-preview.png";

// Kept in sync by hand with slugifyMovie() in index.html — both must
// produce the same slug for the same title/year, or share links 404.
function slugify(title, year) {
  let base = String(title || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (year) base += "-" + String(year).trim();
  return base || "movie";
}

// Kept in sync by hand with the MASALA_TIERS boundaries in index.html.
function getTierFromScore(score) {
  const s = Number(score);
  if (s >= 85) return "Vera Level";
  if (s >= 75) return "Semma";
  if (s >= 65) return "Paakkalam";
  if (s >= 50) return "Parava illa";
  if (s > 0) return "Mokkai";
  return null;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function pageHtml(movie) {
  const title = movie.Title;
  const year = movie.Year || "";
  const score = movie.GauthamScore;
  const tier = getTierFromScore(score);
  const poster = movie.PosterURL || FALLBACK_IMAGE;
  const appUrl = SITE_URL + "index.html?movie=" + encodeURIComponent(title);
  const pageTitle = `${title}${year ? ` (${year})` : ""} — Masala Meter`;
  const description = score
    ? `${title} scores ${score}/100 on the Masala Meter${tier ? ` (${tier})` : ""}. Read the full review, where to stream, and similar picks.`
    : `Read the Masala Meter review for ${title}, find where to stream, and get similar-film picks.`;

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

// The Apps Script endpoint occasionally 404s/errors on a cold start;
// retry a few times before giving up so a scheduled run doesn't fail
// on a transient blip.
async function fetchMovies() {
  const attempts = 4;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(API_URL + "?action=movies");
      if (res.ok) return res.json();
      lastErr = new Error(`Failed to fetch movies: ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) await sleep(2 ** i * 1000);
  }
  throw lastErr;
}

async function main() {
  const data = await fetchMovies();
  const movies = data.filter(m => m.Title && m.GauthamScore !== "" && m.GauthamScore != null);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const seen = new Map();
  const files = new Set();
  for (const m of movies) {
    const base = slugify(m.Title, m.Year);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    const slug = count > 0 ? `${base}-${count + 1}` : base;
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.html`), pageHtml(m));
    files.add(`${slug}.html`);
  }

  for (const existing of fs.readdirSync(OUT_DIR)) {
    if (existing.endsWith(".html") && !files.has(existing)) {
      fs.unlinkSync(path.join(OUT_DIR, existing));
    }
  }

  console.log(`Generated ${files.size} movie pages in ${OUT_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
