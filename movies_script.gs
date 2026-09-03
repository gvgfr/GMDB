// =============================================
// CONFIGURATION — fill in your keys here
// =============================================
const TMDB_API_KEY =
const GEMINI_API_KEY =
const OMDB_API_KEY =
const SPOTIFY_CLIENT_ID =
const SPOTIFY_CLIENT_SECRET =




// Similar-movies cache columns (used by the "Discover More" endpoint below)
const SIMILAR_CACHE_COL = 36;
const SIMILAR_CACHE_DATE_COL = 37;

// Find a movie's row by title (case-insensitive), narrowing by year if given.
// Returns the row number, or null if not found. Used to cache/read
// "Discover More" results per movie instead of re-asking Gemini every view.
function findMovieRow_(sheet, title, year) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const titles = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const years = year ? sheet.getRange(2, 2, lastRow - 1, 1).getValues() : null;
  const wanted = String(title).trim().toLowerCase();
  for (let i = 0; i < titles.length; i++) {
    if (String(titles[i][0]).trim().toLowerCase() === wanted) {
      if (year && years && String(years[i][0]).trim() !== String(year).trim()) continue;
      return i + 2;
    }
  }
  return null;
}

// =============================================
// MAIN FUNCTION — triggered on cell edit
// =============================================
function fillMovieData(e) {
  if (!e) {
    Logger.log("Manual run detected");
    return;
  }

  // The installable "On edit" trigger fires for an edit on ANY sheet in the
  // workbook, not just this one — without this guard, typing into the Songs
  // tab would run this function against the Movies sheet using the Songs
  // sheet's edited row/column, silently reading/overwriting the wrong row.
  if (e.range.getSheet().getName() !== "Movies") return;

  // --- Bulk re-entrancy guard ---
  // During bulk jobs (bulk import / auto-add), the bulk function calls this directly.
  // The installable onEdit trigger ALSO fires on the same setValue edit, causing a race
  // that overwrites rows. A real trigger event carries fields like authMode/triggerUid;
  // our direct calls pass a hand-built {range:...} without them. If a bulk job is running
  // and THIS invocation came from the trigger, stand down — let the direct call handle it.
  const bulkRunning = PropertiesService.getScriptProperties().getProperty("BULK_RUNNING") === "true";
  const isTriggerEvent = !!(e && (e.authMode || e.triggerUid));
  if (bulkRunning && isTriggerEvent) {
    Logger.log("Bulk in progress — ignoring trigger fire to avoid double-processing.");
    return;
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");

  // --- Multi-row paste handling ---
  // Pasting several titles at once (e.g. 10 rows into column A) fires ONE
  // edit event whose range spans ALL pasted rows, not one event per row.
  // Without this, only the very first pasted row would ever get processed.
  // Loop through each row in the pasted range instead, one at a time.
  if (e.range.getNumRows() > 1 && e.range.getColumn() === 1 && !e.forceRescore) {
    const startRow = e.range.getRow();
    const numRows = e.range.getNumRows();
    SpreadsheetApp.getActive().toast(
      "Pasted " + numRows + " rows detected — filling each one (this will take a while, ~30-40s per movie).",
      "GMDB", 8
    );
    for (let r = startRow; r < startRow + numRows; r++) {
      if (r === 1) continue; // skip header
      const rowTitle = sheet.getRange(r, 1).getValue();
      if (rowTitle) {
        try {
          fillMovieData({ range: sheet.getRange(r, 1) });
        } catch (err) {
          Logger.log("Multi-paste fill failed for row " + r + ": " + err);
        }
        Utilities.sleep(1000);
      }
    }
    return;
  }

  const lastRow = e.range.getRow();

  SpreadsheetApp.getActive().toast("Fetching data for row " + lastRow);

  if (e.range.getColumn() !== 1) return;
  if (e.range.getRow() === 1) return;

  // Force to a string immediately — Google Sheets auto-converts a cell
  // containing only digits (e.g. a movie literally titled "29") into a
  // Number, which has no .trim() and crashes later code that assumes text.
  const title = String(sheet.getRange(lastRow, 1).getValue()).trim();
  if (!title) return;

  // --- Re-trigger / manual-edit guard ---
  // Programmatic writes normally should not fire onEdit, but this guard also
  // protects against installable-trigger edge cases. If a real user edits an
  // already-processed title cell, clear the old metadata and refill the row
  // instead of silently skipping or reusing the old TMDB ID.
  const existingDirector = sheet.getRange(lastRow, 3).getValue();
  const forceRescore = !!(e && e.forceRescore);
  const isUserTitleEdit = isTriggerEvent &&
    e.range.getColumn() === 1 &&
    e.range.getRow() !== 1 &&
    Object.prototype.hasOwnProperty.call(e, "value");

  if (existingDirector && !forceRescore) {
    if (isUserTitleEdit) {
      Logger.log("User changed processed row " + lastRow + "; clearing old metadata and refilling.");
      // Keep the newly typed title in column A, wipe stale metadata/old TMDB ID.
      sheet.getRange(lastRow, 2, 1, 34).clearContent();
    } else {
      Logger.log("Row " + lastRow + " already processed, skipping.");
      return;
    }
  }

  // --- Language keyword detection ---
  // If user types "Gilli Tamil", script searches "Gilli" and forces Tamil results
  const languageKeywords = {
    "tamil": "ta", "hindi": "hi", "telugu": "te",
    "malayalam": "ml", "kannada": "kn", "bengali": "bn", "marathi": "mr"
  };

  let cleanTitle = title.trim();
  let forcedLanguage = null;
  let forcedYear = null;

  // Detect a trailing 4-digit year (e.g. "Dilwale 2015") to pick the exact version
  const yearMatch = cleanTitle.match(/\s+(19|20)\d{2}$/);
  if (yearMatch) {
    forcedYear = yearMatch[0].trim();
    cleanTitle = cleanTitle.replace(/\s+(19|20)\d{2}$/, "").trim();
  }

  for (const [word, code] of Object.entries(languageKeywords)) {
    const regex = new RegExp("\\s+" + word + "$", "i");
    if (regex.test(cleanTitle)) {
      cleanTitle = cleanTitle.replace(regex, "").trim();
      forcedLanguage = code;
      break;
    }
  }

  // RE-SCORE SAFETY: after the first fill, column 1 holds the clean official
  // title WITHOUT the "Hindi"/"2012" hints. On a re-score we'd otherwise search
  // a bare title and grab the WRONG same-named film. Only use stored year/language
  // during forceRescore; for a normal user edit, old metadata belongs to the old movie.
  if (forceRescore && !forcedYear) {
    const storedYear = String(sheet.getRange(lastRow, 2).getValue()).trim();
    if (/^(19|20)\d{2}$/.test(storedYear)) forcedYear = storedYear;
  }
  if (forceRescore && !forcedLanguage) {
    const storedLangName = String(sheet.getRange(lastRow, 30).getValue()).trim().toLowerCase();
    const nameToCode = { tamil:"ta", hindi:"hi", telugu:"te", malayalam:"ml", kannada:"kn", bengali:"bn", marathi:"mr" };
    if (nameToCode[storedLangName]) forcedLanguage = nameToCode[storedLangName];
  }

  // --- EXACT-ID FAST PATH for RE-SCORE ONLY ---
  // Stored TMDB ID is perfect for re-scoring the same row, but dangerous for
  // normal user edits because it would keep fetching the old movie. Therefore
  // only trust column 35 when forceRescore is true.
  const TMDB_ID_COL = 35;
  let movie = null;
  const storedId = String(sheet.getRange(lastRow, TMDB_ID_COL).getValue()).trim();
  if (forceRescore && /^\d+$/.test(storedId)) {
    try {
      const byIdUrl = "https://api.themoviedb.org/3/movie/" + storedId +
        "?api_key=" + TMDB_API_KEY;
      const byId = JSON.parse(UrlFetchApp.fetch(byIdUrl).getContentText());
      if (byId && byId.id) {
        movie = byId; // exact film — has title, original_language, release_date, etc.
        Logger.log("Re-score using stored TMDB id " + storedId + " -> " + byId.title);
      }
    } catch (idErr) {
      Logger.log("Stored TMDB id fetch failed (" + storedId + "): " + idErr + " — falling back to search.");
    }
  }

  // --- TMDB Search (uses cleanTitle, e.g. "Gilli" not "Gilli Tamil") ---
  // Only runs if we didn't already resolve the film by stored ID.
  const searchUrl =
    "https://api.themoviedb.org/3/search/movie?api_key=" +
    TMDB_API_KEY +
    "&include_adult=false" +
    "&query=" +
    encodeURIComponent(cleanTitle);

  const searchResponse = movie ? { results: [] } : JSON.parse(
    UrlFetchApp.fetch(searchUrl).getContentText()
  );

  if (!movie && !searchResponse.results.length) return;

  const indianLanguages = ["ta", "hi", "te", "ml", "kn", "bn", "mr"];
  const queryLower = cleanTitle.toLowerCase().trim();

  // Helper: score a result by how well it matches (exact title + Indian language + popularity)
  function rankResults(results) {
    return results.slice().sort((a, b) => {
      // 1. Exact title match wins big
      const aExact = (a.title || "").toLowerCase().trim() === queryLower ? 1 : 0;
      const bExact = (b.title || "").toLowerCase().trim() === queryLower ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      // 2. Original-title exact match (handles transliteration)
      const aOrig = (a.original_title || "").toLowerCase().trim() === queryLower ? 1 : 0;
      const bOrig = (b.original_title || "").toLowerCase().trim() === queryLower ? 1 : 0;
      if (aOrig !== bOrig) return bOrig - aOrig;
      // 3. Then by popularity
      return b.popularity - a.popularity;
    });
  }

  // Best match: when we have BOTH year and language, require both — this pins
  // down the exact film on a re-score (e.g. the Hindi 2012 "Cocktail", not another).
  if (!movie && forcedYear && forcedLanguage) {
    const both = searchResponse.results.filter(m =>
      m.release_date && m.release_date.substring(0, 4) === forcedYear &&
      m.original_language === forcedLanguage);
    movie = rankResults(both)[0];
  }

  // Next: a specific year was given — prefer the movie matching that year
  if (!movie && forcedYear) {
    const yearMatches = searchResponse.results.filter(m => m.release_date && m.release_date.substring(0, 4) === forcedYear);
    movie = rankResults(yearMatches)[0];
  }

  // Otherwise: force language if known, else Indian languages — ranked by exact match
  if (!movie) {
    const langFiltered = searchResponse.results.filter(m => forcedLanguage
      ? m.original_language === forcedLanguage
      : indianLanguages.includes(m.original_language));
    movie = rankResults(langFiltered)[0];
  }

  // Fall back to best-ranked overall if no Indian match found
  if (!movie) {
    movie = rankResults(searchResponse.results)[0];
  }

  const movieId = movie.id;

  // Store the TMDB ID so future re-scores use the exact-ID fast path above.
  sheet.getRange(lastRow, TMDB_ID_COL).setValue(movieId);

  // --- Trailer ---
  const videosUrl =
    "https://api.themoviedb.org/3/movie/" +
    movieId +
    "/videos?api_key=" +
    TMDB_API_KEY;

  const videos = JSON.parse(UrlFetchApp.fetch(videosUrl).getContentText());

  const videoResults = videos.results || [];
  const trailer =
    videoResults.find(v =>
      v.site === "YouTube" && v.type === "Trailer" && v.official
    ) ||
    videoResults.find(v =>
      v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
    );

  const trailerUrl = trailer
    ? "https://www.youtube.com/watch?v=" + trailer.key
    : "https://www.youtube.com/results?search_query=" + encodeURIComponent(cleanTitle + " official trailer");

  // --- Streaming Providers ---
  const providerUrl =
    "https://api.themoviedb.org/3/movie/" +
    movieId +
    "/watch/providers?api_key=" +
    TMDB_API_KEY;

  const providerData = JSON.parse(UrlFetchApp.fetch(providerUrl).getContentText());

  let streaming = "";
  let streamType = "";
  if (providerData.results && providerData.results.US) {
    const us = providerData.results.US;
    // Priority: subscription (flatrate) > free > rent > buy
    if (us.flatrate && us.flatrate.length) {
      streaming = us.flatrate.map(p => p.provider_name).join(", ");
      streamType = "stream";
    } else if (us.free && us.free.length) {
      streaming = us.free.map(p => p.provider_name).join(", ");
      streamType = "free";
    } else if (us.ads && us.ads.length) {
      streaming = us.ads.map(p => p.provider_name).join(", ");
      streamType = "free";
    } else if (us.rent && us.rent.length) {
      streaming = us.rent.map(p => p.provider_name).join(", ");
      streamType = "rent";
    } else if (us.buy && us.buy.length) {
      streaming = us.buy.map(p => p.provider_name).join(", ");
      streamType = "buy";
    }
  }

  let streamingUK = "";
  let streamTypeUK = "";
  if (providerData.results && providerData.results.GB) {
    const gb = providerData.results.GB;
    // Priority: subscription (flatrate) > free > rent > buy
    if (gb.flatrate && gb.flatrate.length) {
      streamingUK = gb.flatrate.map(p => p.provider_name).join(", ");
      streamTypeUK = "stream";
    } else if (gb.free && gb.free.length) {
      streamingUK = gb.free.map(p => p.provider_name).join(", ");
      streamTypeUK = "free";
    } else if (gb.ads && gb.ads.length) {
      streamingUK = gb.ads.map(p => p.provider_name).join(", ");
      streamTypeUK = "free";
    } else if (gb.rent && gb.rent.length) {
      streamingUK = gb.rent.map(p => p.provider_name).join(", ");
      streamTypeUK = "rent";
    } else if (gb.buy && gb.buy.length) {
      streamingUK = gb.buy.map(p => p.provider_name).join(", ");
      streamTypeUK = "buy";
    }
  }

  // --- Movie Details ---
  const detailsUrl =
    "https://api.themoviedb.org/3/movie/" +
    movieId +
    "?api_key=" +
    TMDB_API_KEY;

  const details = JSON.parse(UrlFetchApp.fetch(detailsUrl).getContentText());
  const releaseDate = details.release_date || movie.release_date || "";
  const releaseYear = releaseDate ? releaseDate.substring(0, 4) : "";

  // --- ADULT / PORN CONTENT GUARD ---
  // Reject the film if TMDB flags it as adult, or if its title/genres signal
  // pornographic content. Prevents friends from adding porn to the database.
  const adultTitlePatterns = /\b(xxx|porn|erotic|erotica|adult film|hardcore|softcore|bhabhi\s*hot|uncut\s*adult|18\+|nsfw)\b/i;
  const isAdultFlagged = details.adult === true;
  const titleLooksAdult = adultTitlePatterns.test(String(details.title || "")) ||
                          adultTitlePatterns.test(String(details.original_title || ""));
  if (isAdultFlagged || titleLooksAdult) {
    Logger.log("BLOCKED adult content: " + (details.title || cleanTitle) + " (row " + lastRow + ")");
    // Wipe the row so nothing partial remains
    try {
      sheet.getRange(lastRow, 1, 1, 35).clearContent();
      sheet.getRange(lastRow, 1).setValue("[blocked: adult content not allowed]");
    } catch (wErr) { Logger.log("Adult-row cleanup failed: " + wErr); }
    SpreadsheetApp.getActive().toast("That title was blocked (adult content is not allowed).", "GMDB", 6);
    return;
  }

  // --- Credits ---
  const creditsUrl =
    "https://api.themoviedb.org/3/movie/" +
    movieId +
    "/credits?api_key=" +
    TMDB_API_KEY;

  const credits = JSON.parse(UrlFetchApp.fetch(creditsUrl).getContentText());

  const director = (credits.crew || []).find(p => p.job === "Director")?.name || "";
  const genre = (details.genres || []).map(g => g.name).join(", ");

  // Top cast photos (TMDB's own credits.cast, sorted by billing order) for
  // display on the website. Stored as JSON: [{name, photo}]. photo is ""
  // if TMDB has no profile image on file for that actor.
  const castPhotos = (credits.cast || [])
    .slice(0, 6)
    .map(p => ({
      name: p.name || "",
      photo: p.profile_path ? "https://image.tmdb.org/t/p/w185" + p.profile_path : ""
    }));
  const posterUrl = details.poster_path
    ? "https://image.tmdb.org/t/p/w500" + details.poster_path
    : "";

  // --- OMDB (use cleanTitle so "Gilli Tamil" doesn't confuse OMDB) ---
  let omdbUrl =
    "https://www.omdbapi.com/?apikey=" +
    OMDB_API_KEY +
    "&t=" +
    encodeURIComponent(cleanTitle);
  if (releaseYear) omdbUrl += "&y=" + encodeURIComponent(releaseYear);

  const omdbData = JSON.parse(UrlFetchApp.fetch(omdbUrl).getContentText());

  // Resolve a readable language name early so it can anchor Gemini's IMDb
  // search for generic titles (e.g. "Youth") that collide with same-named
  // films in other languages/countries.
  const langMapEarly = {ta:"Tamil", hi:"Hindi", ml:"Malayalam", te:"Telugu", kn:"Kannada", bn:"Bengali", mr:"Marathi", en:"English"};
  const filmLanguage = langMapEarly[movie.original_language] || movie.original_language || "";

  // --- Gemini AI Review (use cleanTitle + safe release year for accuracy) ---
  // If Gemini fails (quota, safety filter, invalid response after its own
  // retries), don't let that wipe out a row that otherwise has perfectly
  // good TMDB data already fetched above (director, genre, poster, rating,
  // streaming). This matters most for the website's "+ Add Movie" flow
  // (doPost), which is a fire-and-forget no-cors POST — there's no other
  // way for anyone to ever find out this failed, so the row would
  // otherwise sit as a bare, invisible stub (just the typed title) forever.
  //
  // Re-check the CURRENT director cell (not the earlier existingDirector
  // var, which can be stale — e.g. isUserTitleEdit already cleared columns
  // 2-35 above, so existingDirector's in-memory value no longer matches
  // what's actually in the sheet). If there's real existing data right
  // now, re-throw and abort exactly like before this fix — safest to leave
  // a good row completely untouched rather than risk overwriting it with
  // blanks below. Only fall back to a safe empty review when there's
  // genuinely nothing to lose.
  let aiReview;
  try {
    aiReview = getGeminiMovieReview(cleanTitle, releaseYear, filmLanguage);
  } catch (geminiErr) {
    const currentDirector = sheet.getRange(lastRow, 3).getValue();
    if (currentDirector) {
      throw geminiErr;
    }
    Logger.log("Gemini review failed for '" + cleanTitle + "' (row " + lastRow + "): " + geminiErr +
      " — saving TMDB data only; row needs a re-score (Fill next blank movie will pick it up).");
    aiReview = {
      consensusTier: "", gauthamScore: "", writingQuality: "", emotionalImpact: "",
      engagementPacing: "", performances: "", rewatchability: "", criticalConsensus: "",
      audienceReception: "", reviewSummary: "", storyline: "", trivia: "",
      reviewSources: "", scoreReasoning: "", confidence: "", ottInfo: "",
      cast: "", musicDirector: "", hitSongs: "", hitSongsDetails: [], takeaway: "",
      imdbRatingLive: "", imdbVotesLive: "", streamingLive: "", streamingLiveUK: "",
      letterboxdRatingLive: ""
    };
  }

  // --- Write all data to sheet ---
  // Use official TMDB title instead of what user typed
  const officialTitle = details.title || movie.title || cleanTitle;
  sheet.getRange(lastRow, 1).setValue(officialTitle);
  sheet.getRange(lastRow, 2).setValue(releaseYear);
  sheet.getRange(lastRow, 31).setValue(releaseDate); // full YYYY-MM-DD for precise sorting

  // Same protection as ratings/streaming: TMDB's credits/details endpoints
  // can occasionally return incomplete data on a given call even for a
  // movie that has this info. Never let a temporary gap silently erase
  // previously-confirmed Director/Genre/Poster — this is the exact field
  // (Director) involved in the original incident that started all of
  // today's fixes, so it's worth closing this properly.
  const existingDirectorVal = sheet.getRange(lastRow, 3).getValue();
  if (director || !existingDirectorVal) sheet.getRange(lastRow, 3).setValue(director);

  const existingGenre = sheet.getRange(lastRow, 4).getValue();
  if (genre || !existingGenre) sheet.getRange(lastRow, 4).setValue(genre);

  const existingPoster = sheet.getRange(lastRow, 5).getValue();
  if (posterUrl || !existingPoster) sheet.getRange(lastRow, 5).setValue(posterUrl);
  // TMDB genuinely returns 0 for movies with no votes yet on TMDB itself
  // (very new/niche releases) — same situation as IMDb's "N/A" above. Only
  // overwrite an existing real rating if TMDB actually has a nonzero value
  // this time, so a temporary 0 never erases a good number.
  const newTmdbRating = details.vote_average || 0;
  const existingTmdbRating = sheet.getRange(lastRow, 6).getValue();
  if (newTmdbRating || !existingTmdbRating) sheet.getRange(lastRow, 6).setValue(newTmdbRating);
  // OMDB is a third-party aggregator that syncs from IMDb on its own
  // schedule (not live) — it commonly lags days/weeks behind IMDb's actual
  // site for brand-new releases. This isn't just a "missing data" problem —
  // OMDB can confidently return a STALE-but-present number (e.g. an early
  // 7.1 rating that has since moved to 8.9 as more votes came in), and a
  // present-but-wrong value used to always beat Gemini's live search, so
  // re-scoring never actually corrected it. Fix: for RECENT releases
  // specifically (where this swing is common — ratings are volatile in the
  // first several weeks as the voter pool grows), trust the live search
  // over OMDB's cache. For older, more settled titles, OMDB's number is
  // very unlikely to still be wrong, so keep it as the primary source there.
  const omdbRating = (omdbData.imdbRating && omdbData.imdbRating !== "N/A") ? omdbData.imdbRating : "";
  const omdbVotes = (omdbData.imdbVotes && omdbData.imdbVotes !== "N/A") ? omdbData.imdbVotes : "";
  // Defensive cleanup in case Gemini doesn't perfectly follow the format
  // instructions — strip any "/10" suffix and trim whitespace regardless.
  const rawGeminiRating = String(aiReview.imdbRatingLive || "").replace(/\s*\/\s*10\s*$/, "").trim();
  const geminiRating = (rawGeminiRating && rawGeminiRating !== "N/A") ? rawGeminiRating : "";
  const geminiVotes = (aiReview.imdbVotesLive && aiReview.imdbVotesLive !== "N/A") ? String(aiReview.imdbVotesLive).trim() : "";

  const relTimeForImdb = new Date(releaseDate || "").getTime();
  const isRecentForImdb = !isNaN(relTimeForImdb) && relTimeForImdb >= (Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days
  const newImdbRating = (isRecentForImdb && geminiRating) ? geminiRating : (omdbRating || geminiRating);
  const newImdbVotes = (isRecentForImdb && geminiVotes) ? geminiVotes : (omdbVotes || geminiVotes);
  const existingImdbRating = sheet.getRange(lastRow, 7).getValue();
  const existingImdbVotes = sheet.getRange(lastRow, 8).getValue();
  if (newImdbRating || !existingImdbRating) sheet.getRange(lastRow, 7).setValue(newImdbRating);
  if (newImdbVotes || !existingImdbVotes) sheet.getRange(lastRow, 8).setValue(newImdbVotes);
  // --- Score-based tier override ---
  // Kept in sync by hand with the MASALA_TIERS boundaries in index.html.
  function getTierFromScore(score) {
    const s = Number(score);
    if (s >= 85) return "Vera Level";
    if (s >= 75) return "Semma";
    if (s >= 65) return "Paakkalam";
    if (s >= 50) return "Parava illa";
    return "Mokkai";
  }
  const roundedScore = Math.round(Number(aiReview.gauthamScore)) || "";
  // getTierFromScore() always returns SOME tier (falls through to "Mokkai"
  // for 0/NaN) — only meaningful when there's an actual score to back it;
  // otherwise this would write "Mokkai" next to a blank score (e.g. the
  // Gemini-failure fallback above), which is misleading and unnecessary
  // since a blank score already keeps the row off the site regardless.
  const correctedTier = roundedScore ? getTierFromScore(roundedScore) : "";

  sheet.getRange(lastRow, 9).setValue(correctedTier);
  sheet.getRange(lastRow, 10).setValue(roundedScore);
  sheet.getRange(lastRow, 11).setValue(stripCitationMarkers_(aiReview.reviewSummary));
  sheet.getRange(lastRow, 33).setValue(stripCitationMarkers_(aiReview.storyline));   // Storyline (synopsis)
  sheet.getRange(lastRow, 34).setValue(stripCitationMarkers_(aiReview.trivia));      // Trivia (facts)
  sheet.getRange(lastRow, 12).setValue(aiReview.reviewSources);
  sheet.getRange(lastRow, 13).setValue(stripCitationMarkers_(aiReview.scoreReasoning));
  sheet.getRange(lastRow, 14).setValue(aiReview.confidence);

  // Same protection as IMDb/TMDB ratings: a re-score can hit a brief TMDB
  // data gap or licensing blip and get an empty providers response even
  // though the movie hasn't actually left streaming. Only overwrite the
  // existing streaming info if we actually found something new this time;
  // never let "found nothing" silently erase previously-confirmed data.
  // (refreshStreamingStatus is the DEDICATED function for detecting a movie
  // actually leaving a platform over time — that one still clears freely,
  // since watching for removal is its whole purpose.)
  //
  // FALLBACK: if TMDB's own provider check found nothing, fall back to
  // Gemini's live Google Search result (same call already made for scoring,
  // no extra cost). TMDB's structured provider data (via JustWatch) can lag
  // several days behind real announcements for brand-new releases — Gemini's
  // live search can catch a real news article about a streaming release
  // before TMDB's database has synced it.
  //
  // HARD BLOCKLIST: confirmed India-exclusive platforms that Gemini has been
  // observed reporting as "US" availability by mistake — it finds real news
  // about the movie streaming in India and conflates that with the explicit
  // "in the US" instruction. JioHotstar specifically is verified NOT
  // available in the US at all (geo-blocked, India-only) via direct
  // research, not assumption. If Gemini names one of these, treat it the
  // same as if it had found nothing, rather than trusting the US claim.
  const INDIA_ONLY_PLATFORMS = /jiohotstar|^hotstar$|disney\+? ?hotstar/i;
  let geminiStreamingRaw = (aiReview.streamingLive && aiReview.streamingLive !== "N/A")
    ? stripCitationMarkers_(aiReview.streamingLive) : "";
  if (geminiStreamingRaw && INDIA_ONLY_PLATFORMS.test(geminiStreamingRaw)) {
    Logger.log("Rejected Gemini streaming claim '" + geminiStreamingRaw + "' for '" + officialTitle + "' — confirmed India-only platform, not trusted as US availability.");
    geminiStreamingRaw = "";
  }
  const geminiStreaming = geminiStreamingRaw;
  const effectiveStreaming = streaming || geminiStreaming;

  const existingStreaming = sheet.getRange(lastRow, 15).getValue();
  if (effectiveStreaming || !existingStreaming) {
    sheet.getRange(lastRow, 15).setValue(effectiveStreaming);
  }

  // --- UK streaming (col 41): same protect-existing-data pattern as the US
  // column above, with the same TMDB-empty -> Gemini live-search fallback
  // (TMDB/JustWatch provider data can lag real UK announcements too).
  const geminiStreamingUK = (aiReview.streamingLiveUK && aiReview.streamingLiveUK !== "N/A")
    ? stripCitationMarkers_(aiReview.streamingLiveUK) : "";
  const effectiveStreamingUK = streamingUK || geminiStreamingUK;

  const existingStreamingUK = sheet.getRange(lastRow, 41).getValue();
  if (effectiveStreamingUK || !existingStreamingUK) {
    sheet.getRange(lastRow, 41).setValue(effectiveStreamingUK);
  }

  // --- US theatrical status (col 43): gates the site's "Now in Theaters"
  // badge and "Likely in Theaters" showtimes link — see checkUSTheatricalRelease_
  // for why this needs a live search instead of trusting TMDB's release_date.
  // Only worth checking for a genuinely recent release; skip it entirely for
  // old catalog adds/re-scores where the badge could never show anyway (0-60
  // days covers both frontend consumers' eligibility windows with buffer).
  // Never overwrite an existing "Yes" — once confirmed, stays confirmed.
  const daysSinceRelease = isNaN(relTimeForImdb) ? null : (Date.now() - relTimeForImdb) / (24 * 60 * 60 * 1000);
  const existingUsTheatrical = sheet.getRange(lastRow, 43).getValue();
  if (!existingUsTheatrical && daysSinceRelease !== null && daysSinceRelease >= -7 && daysSinceRelease <= 60) {
    try {
      if (checkUSTheatricalRelease_(officialTitle, releaseYear, filmLanguage)) {
        sheet.getRange(lastRow, 43).setValue("Yes");
      }
    } catch (err) {
      Logger.log("US theatrical check failed for '" + officialTitle + "': " + err);
    }
  }

  // --- StreamingSince (col 32): stamp the date a film first appears on streaming ---
  // Only for recent releases (last 5 months), so old catalog titles aren't flagged "new".
  try {
    const sinceCell = sheet.getRange(lastRow, 32);
    // Trim + treat whitespace-only as empty — a stray space or leftover
    // invalid value from an earlier failed attempt would otherwise read as
    // "truthy" and permanently block re-stamping on every future re-score,
    // even though the cell looks empty in the sheet.
    const existingSinceRaw = sinceCell.getValue();
    const existingSince = String(existingSinceRaw || "").trim();
    const relTime = new Date(releaseDate || "").getTime();
    // BUG FIX: this only checked "not older than 5 months," never "has the
    // release date actually passed" — so a film with a future ReleaseDate
    // (always "recent" by that lone check) could get stamped as streaming
    // TODAY the moment TMDB/Gemini reported provider info early, ahead of
    // its real release (e.g. Babita Singh Reporting: ReleaseDate 2 days
    // out, but Amazon Prime Video already showing in TMDB/Gemini's search).
    const isRecent = !isNaN(relTime) && relTime <= Date.now() && relTime >= (Date.now() - 5 * 30 * 24 * 60 * 60 * 1000); // 5 months, matches the website's "New on Streaming" window
    // Use whichever confirms streaming — a fresh find from THIS run, or the
    // already-known value already protected in column 15. Without this,
    // a transient TMDB/Gemini gap on a re-score (common — same class of
    // issue we've hit before) would silently block the stamp forever, even
    // though the movie is genuinely already confirmed streaming from an
    // earlier successful run. This is exactly what happened with Thaai
    // Kizhavi: effectiveStreaming="" on this run, despite "Apple TV, Hulu"
    // already sitting correctly in the Streaming column.
    const currentlyStreaming = effectiveStreaming || existingStreaming;
    if (!existingSince) {
      Logger.log("StreamingSince check for row " + lastRow + " (" + officialTitle + "): effectiveStreaming=" + JSON.stringify(effectiveStreaming) + ", existingStreaming=" + JSON.stringify(existingStreaming) + ", isRecent=" + isRecent + ", releaseDate=" + releaseDate);
    }
    if (currentlyStreaming && !existingSince && isRecent) {
      sinceCell.setValue(new Date());
    }
    // No "clear stamp if !streaming" here anymore — a transient TMDB gap
    // during a re-score shouldn't erase a real streaming-arrival date.
    // refreshStreamingStatus is the function that legitimately clears this
    // when a movie actually leaves a platform.
  } catch (sinceErr) {
    Logger.log("StreamingSince stamp failed for row " + lastRow + ": " + sinceErr);
  }
  // Use accurate TMDB-based label where available, otherwise Gemini's
  // confirmed fallback. Same preserve-if-empty protection as above.
  const existingOttLabel = sheet.getRange(lastRow, 16).getValue();
  let ottLabel = "";
  if (streaming) {
    const typeLabel = { stream: "Stream", free: "Free", rent: "Rent", buy: "Buy" }[streamType] || "Available";
    ottLabel = typeLabel + " on " + streaming + " (US)";
    sheet.getRange(lastRow, 16).setValue(ottLabel);
  } else if (geminiStreaming) {
    // Gemini confirmed it but doesn't tell us rent/buy/subscription — use a
    // neutral label rather than guessing the exact type.
    ottLabel = "Available on " + geminiStreaming + " (US)";
    sheet.getRange(lastRow, 16).setValue(ottLabel);
  } else if (!existingOttLabel) {
    sheet.getRange(lastRow, 16).setValue(""); // genuinely never had one — fine to leave blank
  }
  // else: found nothing new, but a real label already exists — leave it alone.
  sheet.getRange(lastRow, 17).setValue(trailerUrl);
  const r = (v) => v ? Math.round(Number(v)) : "";
  sheet.getRange(lastRow, 18).setValue(r(aiReview.writingQuality));
  sheet.getRange(lastRow, 19).setValue(r(aiReview.emotionalImpact));
  sheet.getRange(lastRow, 20).setValue(r(aiReview.engagementPacing));
  sheet.getRange(lastRow, 21).setValue(r(aiReview.performances));
  sheet.getRange(lastRow, 22).setValue(r(aiReview.rewatchability));
  sheet.getRange(lastRow, 23).setValue(r(aiReview.criticalConsensus));
  sheet.getRange(lastRow, 24).setValue(r(aiReview.audienceReception));
  // Map language code to readable name and write to column 30 (AD)
  const langMap = {ta:"Tamil", hi:"Hindi", ml:"Malayalam", te:"Telugu", kn:"Kannada", bn:"Bengali", mr:"Marathi", en:"English"};
  const langName = langMap[movie.original_language] || movie.original_language || "";
  sheet.getRange(lastRow, 30).setValue(langName);
  sheet.getRange(lastRow, 26).setValue(aiReview.cast || "");
  sheet.getRange(lastRow, 27).setValue(aiReview.musicDirector || "");
  sheet.getRange(lastRow, 28).setValue(aiReview.hitSongs || "");
  sheet.getRange(lastRow, 29).setValue(stripCitationMarkers_(aiReview.takeaway));
  // HitSongsDetails (col 42): per-song "why it's a hit" + Masala Meter Song
  // Score, keyed to the titles in column 28 (HitSongs). Same
  // preserve-if-empty caution as cast photos below — a Gemini response that
  // skipped this array shouldn't erase a previously-good one.
  let hitSongsDetails = [];
  if (Array.isArray(aiReview.hitSongsDetails)) {
    hitSongsDetails = aiReview.hitSongsDetails
      .filter(d => d && d.title)
      .map(d => {
        const scoreNum = Math.round(Number(d.score) * 10) / 10;
        return {
          title: String(d.title).trim(),
          singers: stripCitationMarkers_(d.singers),
          whyHit: stripCitationMarkers_(d.whyHit),
          score: (scoreNum > 0 && scoreNum <= 10) ? scoreNum.toFixed(1) : "",
          raaga: String(d.raaga || "").trim(),
          trivia: stripCitationMarkers_(d.trivia || "")
        };
      });
  }
  const existingSongDetails = sheet.getRange(lastRow, 42).getValue();
  if (hitSongsDetails.length || !existingSongDetails) {
    sheet.getRange(lastRow, 42).setValue(JSON.stringify(hitSongsDetails));
  }
  // Same protection — don't overwrite existing cast photos with an empty
  // list if this particular TMDB credits call happened to return none.
  const existingCastPhotos = sheet.getRange(lastRow, 38).getValue();
  if (castPhotos.length || !existingCastPhotos) {
    sheet.getRange(lastRow, 38).setValue(JSON.stringify(castPhotos));
  }
  // --- Keep the sheet tidy: clip long text + fix this row's height to 21px ---
  try {
    // Clip wrapping for the whole row so long reviews don't expand the row
    sheet.getRange(lastRow, 1, 1, 35).setWrap(false);
    // Force a uniform compact row height
    sheet.setRowHeight(lastRow, 21);
  } catch (tidyErr) {
    Logger.log("Row tidy failed for row " + lastRow + ": " + tidyErr);
  }
}


// =============================================
// GEMINI AI REVIEW
// =============================================
function getGeminiMovieReview(title, year, filmLanguage) {

  const prompt = `
You are an Indian cinema expert and critic. This database focuses exclusively on Indian cinema.

Always prefer the Indian film when multiple films share the same title.
Prioritize: Tamil, Telugu, Malayalam, Kannada, Hindi, Marathi, Bengali.
English movies are ok if reviewed by New York Times or NPR.

For the movie "${title}" (${year}):

Use Google Search to find reviews, audience discussions, and critic opinions.

IMPORTANT: Indian cinema often has limited formal reviews. When formal reviews are scarce:
- Use audience word of mouth, Reddit r/Kollywood, r/BollyBlindsNGossip, r/tollywood
- Use YouTube comment sentiment on trailers
- Use box office performance as a signal of audience reception
- Never penalize a film just for lacking reviews

SCORING — evaluate each dimension from 0-100:

writingQuality: Story structure, screenplay, dialogue, originality
emotionalImpact: Does the film move you? Emotional depth and resonance
engagementPacing: Does it hold attention? Flow, editing, runtime justification
performances: Acting quality, chemistry, standout performances
rewatchability: Would you watch again? Replay value
criticalConsensus: What critics say (be generous if reviews are scarce)
audienceReception: Word of mouth, box office, audience ratings

CALIBRATION ANCHORS — use these as your scoring reference for Tamil cinema.
These are definitive benchmarks. Score all other movies relative to these.

MUST WATCH (90-100) — All-time great Tamil and Malayalam films:

MALAYALAM MUST WATCH:
Thondimuthalum Driksakshiyum (2017) = 94
Jallikattu (2019) = 93
Kumbalangi Nights (2019) = 92
Ayyapanum Koshiyum (2020) = 91
Nayattu (2021) = 91
Sudani From Nigeria (2018) = 91
Maheshinte Prathikaram (2016) = 91
Mayaanadhi (2017) = 90
Angamaly Diaries (2017) = 90

TAMIL MUST WATCH (IMDb 8.1+ films, all-time greats):
Nayakan (1987) = 97
Thevar Magan (1992) = 96
Kadaisi Vivasayi (2021) = 96
Resurrection (2018) = 96
Anbe Sivam (2003) = 95
Jai Bhim (2021) = 95
Mahanadi (1994) = 95
Moondram Pirai (1982) = 95
Pariyerum Perumal (2018) = 94
Soorarai Pottru (2020) = 94
96 (2018) = 93
Visaaranai (2015) = 93
Meiyazhagan (2024) = 93
Thalapathi (1991) = 93
Kaithi (2019) = 92
Asuran (2019) = 92
Sarpatta Parambarai (2021) = 92
Vada Chennai (2018) = 92
Karnan (2021) = 92
Super Deluxe (2019) = 92
Aruvi (2016) = 91
Vikram (2022) = 91
Maharaja (2024) = 91
Ratsasan (2018) = 91
Thani Oruvan (2015) = 91
Anniyan (2005) = 91
Mudhalvan (1999) = 91
Iruvar (1997) = 91
Papanasam (2015) = 91
Virumandi (2004) = 91
Pudhu Pettai (2006) = 91
Mandela (2021) = 91
Vikram Vedha (2017) = 90
Aaranya Kaandam (2010) = 90
Jigarthanda (2014) = 90
The Crow Egg (2014) = 90
Pithamagan (2003) = 90
Soodhu Kavvum (2013) = 90
Baasha (1995) = 90
Theeran Adhigaram Ondru (2017) = 90
Thillu Mullu (1981) = 90
Alai Payuthey (2000) = 90
Padayappa (1999) = 90
Apoorva Sagodharargal (1989) = 90
Dhuruvangal Pathinaaru (2016) = 90
Mouna Ragam (1986) = 90
Chithha (2023) = 90
Kannathil Muthamittal (2002) = 90
Bombay (1995) = 90
Kuruthipunal (1995) = 90
Michael Madana Kama Rajan (1990) = 90

STRONG RECOMMEND (75-89) — Very good Tamil/Malayalam films:
Maanadu (2021) Tamil = 82
Doctor (2021) Tamil = 78
PS1 (2022) Tamil = 80
Vendhu Thanindhathu Kaadu (2022) Tamil = 83
Sita Ramam (2022) Telugu/Tamil = 82
Gargi (2022) Tamil = 81
Merku Thodarchi Malai (2018) Tamil = 83
Thadam (2019) Tamil = 79
Game Over (2019) Tamil = 78
Love Today (2022) Tamil = 76
Maanagaram (2017) Tamil = 78
Peranbu (2019) Tamil = 85
Virus (2019) Malayalam = 89
Kappela (2020) Malayalam = 82
Unda (2019) Malayalam = 80
Vikrithi (2019) Malayalam = 78
Helen (2019) Malayalam = 79
Android Kunjappan (2019) Malayalam = 77
Uyare (2019) Malayalam = 76
Ishq (2019) Malayalam = 78
Trance (2020) Malayalam = 72

WORTH WATCHING (60-74) — Decent but flawed:
Maragatha Nanayam (2017) = 65
Aval (2017) = 68
Neruppu Da (2017) = 63
Mercury (2018) = 66
Pyaar Prema Kaadhal (2018) = 67
Sardar (2022) = 65

WORTH WATCHING (60-74) anchor for mixed-review commercial films:
Karuppu (2026) = 58 — Suriya mass film, good first half, weak second half, mixed reviews, "flawed but watchable"

SKIP (below 60) — Poor quality, disappointing films:
Beast (2022) = 42
Don (2022) = 48
Sura (2010) Vijay = 20 (IMDb 3.1 — one of worst Tamil films ever)
Aalwar (2007) Ajith = 22 (IMDb 3.0 — very poor)
Tirupathi (2006) Ajith = 25 (IMDb 3.2)
Parattai Engira Azhagu Sundaram (2007) Dhanush = 22 (IMDb 2.8 — worst)
Anbanavan Asaradhavan Adangadhavan (2017) STR = 20 (IMDb 2.2 — among worst ever)
Inga Enna Solluthu (2014) STR = 22 (IMDb 2.5)
Pakka (2018) = 15 (IMDb 1.7 — terrible)
Villu (2009) Vijay = 28 (IMDb 3.6)
Mappillai (2011) Dhanush = 28 (IMDb 3.5)
Jana (2004) Ajith = 25 (IMDb 3.3)
Alex Pandian (2013) Karthi = 28 (IMDb 3.1)
90 Ml (2019) = 28 (IMDb 3.3)
Aegan (2008) Ajith = 35 (IMDb 4.5)
Seema Raja (2018) Sivakarthikeyan = 35 (IMDb 4.3)
Mr. Local (2019) Sivakarthikeyan = 30 (IMDb 3.4)
Puli (2015) Vijay = 32 (IMDb 4.4)
Saamy Square (2018) Vikram = 35 (IMDb 4.4)

SCORING RULES:
IMPORTANT: Do NOT use IMDb ratings as a scoring guide for Indian films.
IMDb scores for Tamil/Indian films are heavily distorted by fan brigading,
hate voting by rival fan bases, and Western voters who don't understand Indian cinema.

HOW TO SCORE EACH VARIABLE — use these specific signals:

writingQuality (screenplay, story, dialogue, originality):
- Signals: top critics (e.g. Baradwaj Rangan, Sudhir Srinivasan) comment on script/writing, critic praise for story structure
- High score if: original concept, tight screenplay, meaningful dialogue
- Low score if: formulaic, plot holes, lazy writing, copy of another film

emotionalImpact (does the film move you, emotional depth):
- Signals: Critics mentioning emotional resonance, audience crying/moved reactions on Reddit
- High score if: genuine emotional moments, relatable characters, memorable scenes
- Low score if: forced emotions, melodrama without substance, unmemorable

engagementPacing (holds attention, editing, runtime justified):
- Signals: Critics mentioning pacing issues or praising tight editing
- High score if: no dull moments, runtime feels justified, good second half
- Low score if: slow second half, bloated runtime, unnecessary songs breaking momentum

performances (acting quality, chemistry, standout moments):
- Signals: Critic praise for specific actors, awards recognition, audience appreciation
- High score if: natural performances, strong chemistry, actor disappears into role
- Low score if: overacting, wooden performances, miscast actors

rewatchability (would you watch again, replay value):
- Signals: Is the film still discussed years later? Reddit threads revisiting it?
- High score if: timeless themes, quotable dialogue, music that stays with you
- Low score if: one-time watch, twist-dependent, dated after first viewing

criticalConsensus (what critics say overall):

Search for reviews from these critics BY NAME using Google Search.
These are India's most credible film critics — National Award winners and established journalists.
IMPORTANT: only cite a critic if you find an ACTUAL review by them for THIS film. Never
fabricate an opinion for a named critic — if you can't find their review, don't invent one;
fall back to the PUBLICATIONS or AUDIENCE tiers below instead.

TAMIL CRITICS:
- Baradwaj Rangan (Film Companion South, National Award winner) — weight ~20%
- Sudhir Srinivasan (The Hindu, Cinema Express, Galatta Plus) — weight ~20%
- Ashameera Aiyappan (Cinema Express, New Indian Express)
- S. Theodore Baskaran (Tamil film historian, National Award winner for Best Book on Cinema)
- Aditya Shrikrishna (Mint Lounge, The Hindu, Frontline — Chennai-based freelance)
- Lensmen Reviews / Aswin Bharadwaj (lensmenreviews.com — also covers current Tamil
  releases in detail; see MALAYALAM CRITICS section below for more on this source)

TELUGU CRITICS:
- Sangeetha Devi Dundoo (The Hindu, Hyderabad — primary Telugu critic, 25-year veteran) — weight ~25%
- Manoj Kumar.R (Indian Express — covers Telugu, Tamil, Malayalam, Kannada)
- If neither has a review, fall back to Cinema Express Telugu desk, 123telugu, or Deccan Chronicle Telugu coverage.

HINDI CRITICS:
- Anupama Chopra (Film Companion founder, Film Critics Guild chair) — weight ~20%
- Shubhra Gupta (The Indian Express) — weight ~20%
- Rajeev Masand (News18)
- Namrata Joshi (Outlook, The Hindu)
- Sucharita Tyagi (Film Companion, independent)
NOTE: Taran Adarsh (Bollywood Hungama) tends to be overly positive — use with caution, never as a primary source.

MALAYALAM CRITICS:
- C.S. Venkiteswaran (The Hindu, SiGNS Festival — respected scholar-critic) — weight ~20%
- Anna M.M. Vetticad (Firstpost — prominent Malayalam-rooted pan-Indian critic) — weight ~20%
- Sreehari Nair (Rediff — reviews Malayalam, Tamil, Hindi)
- Aswathy Gopalakrishnan (Silverscreen.in, MAMI festival programmer)
- Madhu Eravankara (Malayalam University, National Award winner)
- Lensmen Reviews / Aswin Bharadwaj (lensmenreviews.com — Kerala-based, craft-focused
  reviews of Malayalam, Tamil, Hindi and English releases; actively covers current 2026
  releases in detail, useful when the National-Award-tier critics above haven't covered
  a smaller or newer film yet)

KANNADA CRITICS: individually-bylined critics are less consistently documented for this
industry than Tamil/Telugu/Hindi/Malayalam. Prioritize these PUBLICATIONS instead of
searching for named individuals: Deccan Herald (Bengaluru), The Hindu (Bengaluru edition),
Vijaya Karnataka, Kannada Prabha.

BENGALI CRITICS:
- Shantanu Ray Chaudhuri (Penguin Random House editor; writes on cinema for Daily Eye, Silhouette, Outlook, Film Companion)
- Jayashree Chakravarti (writes on Hindi and Bangla cinema)
- If neither has a review, fall back to Anandabazar Patrika or The Telegraph (Calcutta) entertainment desks.

MARATHI CRITICS:
- Mihir Bhanage (Times of India — has reviewed Marathi films since 2014)
- If no review found, fall back to Loksatta or Maharashtra Times entertainment desks.

PUBLICATIONS (search these if named-critic reviews not found):
- The Hindu — highly credible
- Indian Express — credible
- Times of India — credible
- Cinema Express — Tamil/South specialist
- Behindwoods — Tamil specialist
- Film Companion — credible
- Outlook — credible
- NDTV — credible

AUDIENCE SOURCES (use only when critic reviews scarce):
- Reddit r/Kollywood — Tamil cinema audience
- Reddit r/MalayalamMovies — Malayalam cinema audience
- Reddit r/tollywood — Telugu cinema audience
- Reddit r/bollywood / r/BollyBlindsNGossip — Hindi cinema audience
- Letterboxd — see letterboxdRatingLive field below; useful as a structured audience
  signal specifically because Indian-cinema engagement there is more substantial than on
  Rotten Tomatoes' thin audience sample.

SOURCES TO AVOID — do NOT use or cite these for scoring:
- Wikipedia (plot summaries and "reception" sections are unreliable and often editorialized)
- IMDb ratings or vote counts (heavily manipulated by fan brigading for Indian films)
- Rotten Tomatoes (very few Indian film reviews, unreliable sample)
- Rediff (low quality, unreliable reviews) — EXCEPTION: Sreehari Nair specifically writes
  for Rediff and is a credible named Malayalam/Tamil/Hindi critic; his bylined reviews are
  fine to use, general unbylined Rediff content is not.
- Bollywood Hungama reviews (Taran Adarsh is overly positive)
- Random blogs or SEO content farms
- Movie ticket booking sites (BookMyShow ratings are inflated)
- YouTube reviewers and influencers

CRITIC SPLIT — flag genuine disagreement rather than silently averaging it away:
Indian critical reception is often more polarized than a single "consensus" score
suggests — some outlets love a film, others pan it, especially for divisive directors
or genre-bending films. If the named critics/publications you found meaningfully
disagree (e.g. one calls it a masterpiece, another calls it a mess — not just minor
differences in enthusiasm), say so explicitly in reviewSummary rather than averaging
it into one smooth-sounding paragraph. Name the actual split where you can (e.g.
"Baradwaj Rangan and Sudhir Srinivasan differed sharply — [X] praised the writing while
[Y] found the pacing a dealbreaker"). Only flag a REAL split with real evidence from
what you found; don't invent disagreement that isn't there.

CALIBRATION BY LANGUAGE — different Indian film industries reward different things, and
scoring should reflect what THAT industry's own audiences and critics value, not apply
one uniform (often Tamil-leaning) standard across all languages:
- Telugu mass entertainers are often judged on scale, star charisma, and emotional
  "mass" moments — don't penalize a Telugu blockbuster for lacking the understated
  realism that would be expected of, say, a Malayalam drama.
- Malayalam cinema is frequently judged on restraint, naturalism, and social
  observation — a quiet, slow-paced Malayalam film succeeding on those terms
  shouldn't score lower just because it lacks spectacle.
- Hindi mainstream cinema spans both mass-market masala and urban indie —
  judge each film against its own genre's conventions, not a single Bollywood norm.
- Tamil cinema often blends social commentary with mass entertainment — both a
  Vetrimaaran-style social drama and a Lokesh Kanagaraj action film can score well
  on their own terms.
Use this to interpret critic praise/criticism in context, not as a rigid rulebook —
the goal is judging each film by the standards its own industry and audience apply.

SEARCH PROCESS — follow this order strictly:

STEP 1: Search first for the NAMED critics for THIS film's specific language
  (${filmLanguage || "the film's language"}) from the lists above. Don't search all
  languages' critics for every film — go straight to the relevant industry's roster.
  Search query examples: "[movie name] Sudhir Srinivasan review", "[movie name] Sangeetha Devi Dundoo review", "[movie name] The Hindu review"

STEP 2: If no named-critic reviews found for that language, search the approved PUBLICATIONS
  (language-specific ones first, e.g. Cinema Express/Behindwoods for Tamil, Deccan Herald for Kannada):
  The Hindu, Indian Express, Times of India, Cinema Express, Behindwoods, Film Companion

STEP 3: If still no credible reviews found, use AUDIENCE signals:
  Reddit (language-appropriate subreddit), Letterboxd, box office performance

STEP 4: Only if all above fail, you may reference general audience consensus,
  but set confidence to "Low" and write "Limited critic coverage" in reviewSources.

CRITICAL — reviewSources field rules:
- ONLY cite sources you ACTUALLY found and read through search
- ONLY list sources from the approved critics/publications list
- If you only found banned sources (Rediff, Wikipedia, blogs), do NOT cite them — write "Limited critic coverage"
- Never cite a source you were told to avoid

CRITICAL — SCORE STABILITY:
- Anchor every score to the calibration examples above
- Before finalizing, ask: "Is this movie genuinely better than [Parava illa anchor] but worse than [Semma anchor]?"
- A commercial masala film with mixed reviews should score 50-65, NOT 70+
- If critics are divided or reviews are mediocre, lean LOWER not higher
- Do not let a film's box office success alone inflate the score — commercial success ≠ quality
- A star-vehicle mass film (Suriya/Vijay/Ajith) with an engaging first half but a weak/dragging second half and "mixed reviews" = 55-62 (Parava illa, lower end)
- Phrases in reviews like "flawed but watchable", "ambitious but uneven", "lost opportunity", "passable", "works in parts" = score 55-65
- Phrases like "masterpiece", "best of the year", "must watch", "stunning" = score 85+
- Karuppu (2026) is the reference for a mixed-review commercial film = 58

IMPORTANT:
- Only use the named critics and credible publications listed above
- If no formal reviews found, use box office run + Reddit word of mouth
- A 100+ day theatrical run = strong audience signal
- Weight critic reviews 70%, audience signals 30%

audienceReception (real audience response, not star fan votes):
- Signals: Box office run (100+ days = very strong), Reddit r/Kollywood word of mouth
- Word of mouth longevity — still talked about years later = high score
- Ignore IMDb vote counts — too manipulated for Indian films
- High score if: genuine word of mouth, recommended by regular moviegoers
- Low score if: only fans liked it, general audience indifferent

SCORE CALIBRATION:
- 90-100: Masterpiece. Comparable to Nayakan, Jai Bhim, Pariyerum Perumal
- 75-89: Excellent. Comparable to Ratsasan, Maanadu, PS1, Vendhu Thanindhathu Kaadu
- 60-74: Decent but flawed. Worth one watch
- Below 60: Skip. Comparable to Sura, AAA, Beast, Puli
- Most commercial masala films score 50-70 regardless of star power
- A 90+ score must be GENUINELY exceptional, not just entertaining
- Be generous when reviews are scarce — lean on box office and Reddit word of mouth

gauthamScore = weighted average:
writingQuality x 0.20
emotionalImpact x 0.20
engagementPacing x 0.15
performances x 0.15
rewatchability x 0.15
criticalConsensus x 0.10
audienceReception x 0.05

consensusTier is derived from gauthamScore:
85-100 = Vera Level
75-84 = Semma
65-74 = Paakkalam
50-64 = Parava illa
Below 50 = Mokkai

Return ONLY valid JSON. No markdown, no backticks, no explanation.

{
  "consensusTier": "",
  "gauthamScore": "",
  "writingQuality": "",
  "emotionalImpact": "",
  "engagementPacing": "",
  "performances": "",
  "rewatchability": "",
  "criticalConsensus": "",
  "audienceReception": "",
  "reviewSummary": "",
  "storyline": "",
  "trivia": "",
  "reviewSources": "",
  "scoreReasoning": "",
  "confidence": "",
  "ottInfo": "",
  "cast": "",
  "musicDirector": "",
  "hitSongs": "",
  "hitSongsDetails": [],
  "takeaway": "",
  "imdbRatingLive": "",
  "imdbVotesLive": "",
  "streamingLive": "",
  "streamingLiveUK": "",
  "letterboxdRatingLive": ""
}

reviewSummary: Write a CONCISE, captivating hook — 2-3 sentences, about 40-55 words. This is the first thing people read, so make it engaging and specific, not a full breakdown. Capture the essence and the critical verdict (is it worth watching and why) WITHOUT spoilers. Do NOT dump the full plot here (that goes in storyline) and do NOT list every strength/weakness (that's the score breakdown). Make someone want to watch — or know to skip. Write naturally and specifically about THIS film.

CRITICAL — the WORDING must match the actual verdict, not just the number. This
database sorts films into these score bands, and the review's TONE needs to
genuinely reflect which band it's in, not read like a recommendation regardless
of score:
  85-100 (Vera Level) — genuinely enthusiastic, a real recommendation
  75-84  (Semma) — positive with real caveats acknowledged
  65-74  (Paakkalam) — cautiously positive at best; "worth a watch if you're in
    the mood" rather than a genuine recommendation. Avoid glowing language —
    this band is decent, not good.
  50-64  (Parava illa) — MIXED/MEDIOCRE. This is NOT a recommendation. Write it
    so a reader understands "watchable but forgettable," "only for fans of X,"
    or "has some merit but doesn't add up to much" — not glowing language like
    "praised for," "compelling," "solid entertainer," or "effective blend."
    Those phrases oversell a 60s score and mislead the reader.
  Below 50 (Mokkai) — clearly negative; don't soften this with polite hedging.
A reader should be able to guess the rough score band from the review's tone
alone, without seeing the number. If your draft summary would read the same
whether the score was 68 or 78, rewrite it — the wording has to earn its band.

AVOID GENERIC, RECYCLED CRITICAL LANGUAGE. This is a PATTERN to avoid, not just
a list of banned words — swapping "pacing issues" for a synonym like "narrative
stumbles" or "narrative imperfections" is the SAME problem in different words,
and still counts as a violation of this rule. The actual rule: any criticism of
the writing, plot, or pacing must include a SPECIFIC, concrete detail in the
same breath — not a vague catch-all noun phrase standing alone.
  NOT ALLOWED (vague, could apply to any film): "narrative imperfections,"
    "narrative stumbles," "narrative inconsistencies," "narrative inconsistency,"
    "tonal inconsistency," "uneven pacing," "pacing issues," "predictable,"
    "conventional yet engaging," "elevated by earnest performances," "familiar
    but effective," "flawed screenplay," "loses steam," "drags in parts"
  REQUIRED INSTEAD: name the actual specific thing — which act or plot thread
    dragged and why, what specifically became predictable (the twist itself,
    a genre trope, a character arc), which particular scene or stretch of
    runtime the pacing problem occurred in. Draw this from what real
    critics/sources actually said about THIS film, not generic genre-critique
    boilerplate you could paste onto any film in the same tier.
  Self-check before finalizing: if you removed the film's title from your
  review, could this exact sentence describe a different film in the same
  genre? If yes, it's too generic — rewrite with the specific detail.
IMPORTANT - vary your language: do NOT lean on overused review clichés. Specifically avoid repeating words like "poignant", "tour de force", "rollercoaster", "edge of your seat", "leaves you wanting more", "cinematic experience", "visual treat". Use fresh, specific wording each time.

storyline: Write a spoiler-free plot synopsis of 3-4 sentences (about 60-90 words). Set up the premise, the main character(s), and the central conflict/journey — enough to intrigue, but NEVER reveal twists, the climax, or the ending. This is the "what's it about" for people who want the story before the verdict.

trivia: Write 3-5 interesting, factual bullet-style facts about the film, separated by " | " (pipe). Draw from: notable awards/nominations, box-office milestones, the director's background or other work, lead actors' careers or breakthroughs, music/soundtrack facts, production or casting stories, records set, or cultural impact. Keep each fact to one short sentence. Only include facts you are reasonably confident are true — do NOT invent. If little is known, give fewer facts rather than making them up. Example: "Won the National Film Award for Best Tamil Film. | Marked the directorial debut of the filmmaker. | The lead actor learned Tamil specifically for this role. | The soundtrack topped charts for six weeks."
reviewSources: list only sources actually found. Do not guess.
scoreReasoning: one sentence explaining the overall score. Same calibration rule as reviewSummary above — the tone must match the score band (a 50-64 "Parava illa" score needs mixed/mediocre language, not praise).
confidence:
  High = multiple critics reviewed and broadly agree
  Medium = some coverage, mixed or limited consensus
  Low = very limited coverage, used audience signals

For OTT: use Google Search, prefer JustWatch.
Return ottInfo as: Platform (Month Year) e.g. Netflix (August 2024)

cast: List the 3-4 LEAD actors only, comma separated. E.g. "Suriya, Trisha, RJ Balaji"

musicDirector: Name of the music composer. E.g. "Anirudh Ravichander"

hitSongs: List 1-3 ACTUAL SONG TITLES from the film, comma separated — e.g. "Vaa
Vaathi, Hayyoda". Nothing else goes in this field: the website treats every
entry here as a real song title and turns it into a clickable Spotify search
link, so a full sentence or description here produces a broken, nonsensical
link. If the film genuinely has no notable songs (e.g. a thriller with only
background score, no soundtrack singles), leave this field COMPLETELY EMPTY
("") — do not write "Background score by [composer]" or any other
descriptive text here, since that isn't a searchable song title either and
will look just as broken. The music director's name already has its own
separate field (musicDirector) — don't duplicate that here.

hitSongsDetails: A short per-song analysis for EVERY song listed in hitSongs
above (same titles, same order), as a JSON array of objects:
[{"title": "", "singers": "", "whyHit": "", "score": "", "raaga": "", "trivia": ""}]
- title: must exactly match one of the song titles in hitSongs.
- singers: the actual playback singer(s) who performed this specific song —
  not the music director/composer (that's already captured separately in
  musicDirector) and not the on-screen actor unless they genuinely sang it
  themselves. Comma-separate multiple singers (e.g. a duet). Leave blank
  ("") only if you genuinely can't find this, don't guess.
- whyHit: ONE sentence, MAXIMUM 20 WORDS, explaining that specific song's
  appeal through its melody, vocals, lyrics, rhythm, emotion, or replay
  value. Be specific to THIS song — not a generic "catchy tune, great
  vibes" that could describe any song.
- score: a single number 0.0-10.0 with one decimal place (e.g. "8.5"),
  computed as a weighted blend of melody (40%), vocals (25%), lyrics (20%),
  and replay value (15%). Judge each dimension using whatever's actually
  known about the song (chart/streaming performance, critic or audience
  commentary, its role in the film) — don't default to a flat number for
  every song.
- raaga: the specific Carnatic or Hindustani raga this song is genuinely
  composed in or based on, ONLY if actually documented/known. Leave blank
  ("") if the song isn't known to be based on a specific named raga — do
  NOT guess one just because the song sounds classical.
- trivia: 2-4 short, factual, interesting facts about THIS specific song,
  separated by " | " (pipe) — recording, chart performance, awards,
  notable covers/remixes, picturization, or cultural impact. Leave blank
  ("") rather than inventing facts you aren't confident about.
If hitSongs is empty (film has no notable songs), return an empty array
([]) here too.

takeaway: A single memorable one-line critic verdict that captures the essence of the film. Keep it punchy and specific; avoid clichéd words like "poignant", "must-watch", or "tour de force". Also avoid reaching for vague "inconsistency" language — "narrative inconsistencies," "narrative inconsistency," "tonal inconsistency," and similar phrases have become an overused crutch here, showing up across too many different films' takeaways. If a film's actual flaw is a clashing tone or a story that doesn't hold together, name the SPECIFIC thing that clashes or falls apart, not this generic label.
Write it in a SERIOUS critic tone but MATCH THE MOOD of the film.
- For an emotional film, be evocative
- For a thriller, be sharp
- For a disappointing film, be honest but not cruel
Keep it under 15 words. Make it quotable.
Examples:
- 96: "Love that lingers like an old song you cannot forget."
- Jai Bhim: "A gut-punch reminder of justice denied to the voiceless."
- Karuppu: "A strong first half squandered by a second that forgets its own momentum."
- Vikram: "A masterclass in commercial filmmaking with genuine emotional weight."

imdbRatingLive: Use Google Search to look up THIS SPECIFIC ${filmLanguage || "Indian"}
film's CURRENT rating directly from imdb.com — be careful with generic titles
that could match unrelated films of the same name in other languages/countries;
anchor your search to the language and year given above. Return ONLY the bare
number, e.g. "6.7" — NEVER include "/10" or any suffix. This is separate from the scoring rules above — those say not to
use IMDb ratings to CALIBRATE the Masala Meter, but this field is just for
accurately DISPLAYING IMDb's real number, since third-party rating databases
often lag behind IMDb's actual site for new releases. If the film has no rating
yet on IMDb, or you cannot confirm a current number, return "N/A" — do not
guess or estimate a number.

imdbVotesLive: The current IMDb vote count from the same imdb.com lookup, e.g.
"14,000". A reasonably confident approximate figure is fine (round to the
nearest hundred/thousand if the exact count isn't stated) — you don't need
pinpoint precision, just don't fabricate a number with no basis. Return "N/A"
only if you found nothing to go on at all.

streamingLive: Use Google Search to check whether THIS SPECIFIC ${filmLanguage || "Indian"}
film is CURRENTLY available to stream in the US right now — look for actual
news articles or official platform announcements (e.g. "now streaming on
Netflix", "OTT release date"), not just a general mention that it might come
to streaming eventually. TMDB's own structured provider data can lag several
days behind real announcements for brand-new releases, so this is a backup
check specifically for that gap.

Try several search angles before concluding nothing is available — a single
narrow query often misses a real, recent release:
1. the title + year + "streaming US"
2. the title + specific platform names (Netflix, Hulu, Prime Video, Disney+, Max)
3. the title + "JustWatch" (JustWatch aggregates real US availability, useful
   even without needing their own API)
4. the title + "OTT release date US"

Return ONLY the platform name if you can
confirm it (e.g. "Netflix", "Amazon Prime Video", "ZEE5") — do not guess.

IMPORTANT: many platforms that stream Indian films are India-exclusive and
NOT available in the US at all — JioHotstar (formerly Hotstar/Disney+
Hotstar) is confirmed geo-blocked outside India entirely, with no US access.
Finding real news that a film is "streaming on JioHotstar" almost always
means it's available in India, NOT the US — do not report it as US
availability just because you found genuine streaming news; that news is
likely about a different region.

BROADER CAUTION — this applies beyond just JioHotstar: several platforms
(Amazon Prime Video especially, but also Netflix to a lesser degree) operate
SEPARATE regional catalogs under the same brand name. A film can be
genuinely available on "Prime Video" in India while NOT being on Prime
Video in the US at all — these are different catalogs, not the same
service. If a source doesn't explicitly confirm the US specifically (e.g. a
general Indian entertainment site just saying "now on Prime Video" without
naming a region), do NOT assume that means the US catalog. Only report a
platform as confirmed if the source is clearly US-specific — a US
entertainment outlet, the platform's own US-facing site, or explicit
mention of "US," "American subscribers," etc. When genuinely unclear,
default to "N/A" rather than assuming the same brand means the same
regional availability.

CROSS-VERIFICATION — do not trust a single mention. Before confirming a
platform, check at least TWO of these credible sources and require they
AGREE: JustWatch (justwatch.com/us/...), Reelgood (reelgood.com), the
platform's own official US site (e.g. netflix.com, hulu.com), or a US
entertainment outlet's explicit coverage. If you only find ONE source and
it isn't clearly US-specific and authoritative (the platform's own US site
counts as sufficient on its own; a single vague blog post does not), treat
it as unconfirmed and return "N/A" rather than guessing from one weak
signal.

Return "N/A" if you cannot confirm current US streaming availability, if it's
still theater-only, or if you're not confident it's the correct film.

streamingLiveUK: Use Google Search to check whether THIS SPECIFIC ${filmLanguage || "Indian"}
film is CURRENTLY available to stream in the UK right now — look for actual
news articles or official platform announcements (e.g. "now streaming on
Netflix UK", "OTT release date UK"), not just a general mention that it might
come to streaming eventually. TMDB's own structured provider data can lag
several days behind real announcements for brand-new releases, so this is a
backup check specifically for that gap.

Try several search angles before concluding nothing is available — a single
narrow query often misses a real, recent release:
1. the title + year + "streaming UK"
2. the title + specific platform names (Netflix, Amazon Prime Video, Disney+,
   BBC iPlayer, ITVX, Channel 4, Sky, NOW)
3. the title + "JustWatch UK" (JustWatch aggregates real UK availability,
   useful even without needing their own API)
4. the title + "OTT release date UK"

Return ONLY the platform name if you can
confirm it (e.g. "Netflix", "Amazon Prime Video", "BBC iPlayer") — do not guess.

IMPORTANT: several platforms operate SEPARATE regional catalogs under the
same brand name — this is the same regional-catalog trap as the US field
above, just in the other direction. A film can be genuinely available on
"Prime Video" or "Netflix" in India or the US while NOT being on that same
service's UK catalog at all. If a source doesn't explicitly confirm the UK
specifically (e.g. a general Indian entertainment site just saying "now on
Prime Video" without naming a region), do NOT assume that means the UK
catalog. Only report a platform as confirmed if the source is clearly
UK-specific — a UK entertainment outlet, the platform's own UK-facing site,
or explicit mention of "UK," "British subscribers," etc. When genuinely
unclear, default to "N/A" rather than assuming the same brand means the same
regional availability.

UK-SPECIFIC PLATFORMS ARE VALID ANSWERS TOO — don't limit yourself to the
global streaming names. BBC iPlayer, ITVX, Channel 4 (My4), and Sky/NOW are
all legitimate, widely-used UK platforms, and some Indian films specifically
license to these rather than Netflix/Prime. Treat a confirmed UK-specific
platform exactly the same as a confirmed global one — either is a valid answer.

CROSS-VERIFICATION — do not trust a single mention. Before confirming a
platform, check at least TWO of these credible sources and require they
AGREE: JustWatch (justwatch.com/uk/...), Reelgood (reelgood.com), the
platform's own official UK site (e.g. netflix.com, bbc.co.uk/iplayer,
itv.com/itvx), or a UK entertainment outlet's explicit coverage. If you only
find ONE source and it isn't clearly UK-specific and authoritative (the
platform's own UK site counts as sufficient on its own; a single vague blog
post does not), treat it as unconfirmed and return "N/A" rather than
guessing from one weak signal.

Return "N/A" if you cannot confirm current UK streaming availability, if
it's still theater-only, or if you're not confident it's the correct film.

letterboxdRatingLive: Use Google Search to find this film's rating on
Letterboxd (letterboxd.com), e.g. "3.8" (Letterboxd uses a 5-star scale with
half-star precision). Letterboxd is a useful audience signal specifically for
Indian cinema because it has substantial genuine engagement from serious
film-watchers there, unlike Rotten Tomatoes' typically thin sample for Indian
films. Return ONLY the number (e.g. "3.8"), not "3.8/5" or "3.8 stars".
Return "N/A" if you cannot find a Letterboxd page for this specific film or
aren't confident it's the correct match.
`;

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    GEMINI_API_KEY;

  const payload = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    tools: [
      { google_search: {} }
    ],
    generationConfig: {
      temperature: 0.2
    }
  };

  // Gemini isn't perfectly deterministic — occasionally it responds with
  // plain prose instead of the requested JSON (e.g. starting with "The movie
  // ..." instead of "{"). That's not a quota issue or a sign the movie is
  // fake, just a one-off formatting slip. Retry once with the same prompt
  // before giving up, since a second attempt very likely succeeds. Same
  // reasoning applies to an empty/no-content candidate (safety filtering,
  // truncation, or just a one-off API hiccup) — that used to throw
  // immediately on attempt 1 with a message literally telling the user to
  // "try re-scoring again," instead of the code just doing that itself.
  let lastParseError = null;
  let lastRawText = "";
  let lastEmptyReason = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const bodyText = response.getContentText();
    // Detect quota / rate-limit / out-of-credit so callers can stop gracefully
    // instead of silently skipping rows during a big re-score. These are NOT
    // retried — retrying an exhausted quota just wastes another call.
    if (code === 429) {
      throw new Error("GEMINI_QUOTA: daily rate limit reached (429).");
    }
    // Out of prepay credit / billing disabled usually returns 400/402/403 with a
    // billing-related message. IMPORTANT: only scan bodyText for these keywords
    // when the HTTP code itself is already an error (>=400). A successful 200
    // response contains Gemini's own generated text, which can innocently
    // include words like "insufficient" (e.g. "insufficient search results")
    // and falsely trigger this check if scanned unconditionally.
    if (code === 402 || code === 403) {
      throw new Error("GEMINI_QUOTA: billing/credit issue (" + code + "): " + bodyText.slice(0, 140));
    }
    if (code >= 400) {
      if (/billing|quota|exceeded|balance|credit|RESOURCE_EXHAUSTED|PERMISSION_DENIED|insufficient/i.test(bodyText)) {
        throw new Error("GEMINI_QUOTA: billing/credit issue (" + code + "): " + bodyText.slice(0, 140));
      }
      throw new Error("GEMINI_HTTP_" + code + ": " + bodyText.slice(0, 120));
    }

    const data = JSON.parse(bodyText);
    if (!data.candidates || !data.candidates[0]) {
      // Some quota/safety errors return 200 with no candidates
      const errStr = JSON.stringify(data).slice(0, 200);
      if (/quota|rate|exhausted|RESOURCE_EXHAUSTED|billing|credit|balance/i.test(errStr)) {
        throw new Error("GEMINI_QUOTA: " + errStr);
      }
      throw new Error("GEMINI_NO_CANDIDATES: " + errStr);
    }
    // A candidate can come back with no parts at all — happens on safety
    // filtering, MAX_TOKENS truncation, or other non-STOP finish reasons.
    // Without this check, .parts[0] throws "Cannot read properties of
    // undefined (reading '0')" and the whole re-score fails opaquely.
    const cand = data.candidates[0];
    if (!cand.content || !cand.content.parts || !cand.content.parts[0]) {
      lastEmptyReason = cand.finishReason || "UNKNOWN";
      Logger.log("Gemini empty response on attempt " + attempt + " for '" + title + "': finishReason=" + lastEmptyReason);
      if (attempt < 2) continue; // retry once, same as a JSON-parse slip
      throw new Error("GEMINI_EMPTY_RESPONSE: finishReason=" + lastEmptyReason + " — response had no usable content after 2 attempts, likely safety filtering or truncation. Try re-scoring again.");
    }
    const text = data.candidates[0].content.parts[0].text;
    lastRawText = text;

    const cleanText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    try {
      return parseGeminiJsonObject_(cleanText);
    } catch (parseErr) {
      lastParseError = parseErr;
      Logger.log("Gemini JSON parse failed on attempt " + attempt + " for '" + title + "': " + parseErr);
      // loop again for attempt 2, if any left
    }
  }

  // Both attempts failed to parse — throw a clear, actionable error instead
  // of a cryptic raw SyntaxError, including a preview of what Gemini actually
  // said so it's obvious this wasn't a quota problem.
  throw new Error("GEMINI_INVALID_JSON: Gemini did not return valid JSON after 2 attempts. " +
    "Last response started with: \"" + lastRawText.slice(0, 150) + "\"");
}


// =============================================
// GEMINI JSON PARSE HELPERS
// =============================================
function stripGeminiFences_(text) {
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

// Google Search grounding sometimes leaves citation markers like
// "[cite: 1, 9, 12]" or "[citation: ...]" embedded directly in the prose
// text of a JSON string field instead of stripping them out itself. Strip
// those out of any free-text review field before it's shown to users.
function stripCitationMarkers_(text) {
  return String(text || "")
    .replace(/\[\s*cite[^\]]*\]/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseGeminiJsonObject_(text) {
  const clean = stripGeminiFences_(text);
  try {
    return JSON.parse(clean);
  } catch (err) {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(clean.substring(start, end + 1));
    }
    throw err;
  }
}

function parseGeminiJsonArray_(text) {
  const clean = stripGeminiFences_(text);
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    const start = clean.indexOf("[");
    const end = clean.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const parsed = JSON.parse(clean.substring(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    }
    throw err;
  }
}


// =============================================
// REMOVE DUPLICATE MOVIES (keeps the first occurrence)
// =============================================
function removeDuplicateMovies() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getActive().toast("No movies to check.", "GMDB", 5);
    return;
  }
  const titles = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  // BUG FIX: title-only matching missed duplicates where TMDB's returned
  // title for the SAME film changed slightly between two separate auto-add
  // runs (e.g. "Toxic" vs "Toxic: A Fairy Tale for Greed" once TMDB added
  // the subtitle closer to release) — both rows got fully reviewed and
  // scored independently, showing as two different-looking "duplicates"
  // with two different scores. TMDB ID (col 35) never changes, so it
  // catches this case even when the title text doesn't match.
  const tmdbIds = sheet.getRange(2, 35, lastRow - 1, 1).getValues();

  const seenTitles = {};
  const seenIds = {};
  const rowsToDelete = [];

  for (let i = 0; i < titles.length; i++) {
    const t = String(titles[i][0]).trim().toLowerCase();
    if (!t) continue;
    const idRaw = String(tmdbIds[i][0]).trim();
    const idKey = /^\d+$/.test(idRaw) ? idRaw : null;

    if (seenTitles[t] || (idKey && seenIds[idKey])) {
      rowsToDelete.push(i + 2); // actual sheet row
    } else {
      seenTitles[t] = true;
      if (idKey) seenIds[idKey] = true;
    }
  }

  // Delete from bottom to top so row numbers do not shift
  rowsToDelete.reverse().forEach(row => sheet.deleteRow(row));

  SpreadsheetApp.getActive().toast(
    "Removed " + rowsToDelete.length + " duplicate(s).",
    "GMDB", 5
  );
}

// =============================================
// CUSTOM MENU — appears in the sheet toolbar
// =============================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎬 GMDB")
    .addItem("Fill next blank movie (one)", "refreshOneBlankMovie")
    .addItem("Re-score selected movie (click a row first)", "rescoreOneMovie")
    .addItem("Re-score next 5 movies (batch)", "rescoreFiveMovies")
    .addItem("Re-score highlighted rows", "rescoreHighlightedRows")
    .addItem("Fill next missing storyline/trivia (one)", "backfillOneStorylineTrivia")
    .addSeparator()
    .addItem("Remove duplicate movies", "removeDuplicateMovies")
    .addItem("Remove low-scoring movies (below 65)", "removeLowScoringMovies")
    .addSeparator()
    .addItem("Auto-add new releases now", "autoAddNewReleases")
    .addItem("Add upcoming releases (next 7 days, no review yet)", "autoAddUpcomingReleases")
    .addItem("Find NEW movies now streaming (5mo, adds to catalog)", "autoAddNewlyStreaming")
    .addItem("Update streaming info (movies I already have)", "refreshStreamingStatus")
    .addSeparator()
    .addItem("Fix stuck auto-fill (clear flag)", "clearBulkRunningFlag")
    .addSeparator()
    .addItem("Backfill missing TMDB IDs", "backfillMissingTMDbID")
    .addItem("Backfill missing directors", "backfillMissingDirectors")
    .addSeparator()
    .addItem("♪ Fill next blank song (one)", "refreshOneBlankSong")
    .addItem("♪ Re-score selected song (click a row first)", "rescoreOneSong")
    .addItem("♪ Backfill song posters", "backfillSongPosters")
    .addItem("♪ Backfill song raaga & trivia", "backfillSongRaagaTrivia")
    .addToUi();
}

// Sweep out any films scoring below a floor (default 65). Useful for cleaning
// up low-scorers that slipped in, or that dropped below the bar after a re-score.
// Asks for confirmation and lists what it will remove before deleting.
function removeLowScoringMovies() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const FLOOR = 65;

  // Collect rows below the floor (scan bottom-up so deletes don't shift indices)
  const toRemove = [];
  for (let row = 2; row <= lastRow; row++) {
    const title = sheet.getRange(row, 1).getValue();
    const score = Number(sheet.getRange(row, 10).getValue());
    if (title && score > 0 && score < FLOOR) {
      toRemove.push({ row: row, title: title, score: score });
    }
  }

  if (!toRemove.length) {
    SpreadsheetApp.getUi().alert("No movies below " + FLOOR + " found. Catalog is clean!");
    return;
  }

  const list = toRemove.map(t => "• " + t.title + " (" + t.score + ")").join("\n");
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "Remove " + toRemove.length + " movie(s) below " + FLOOR + "?",
    list + "\n\nThis cannot be undone.",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) {
    SpreadsheetApp.getActive().toast("Cancelled — nothing removed.", "GMDB", 5);
    return;
  }

  // Delete bottom-up so row numbers stay valid
  toRemove.sort((a, b) => b.row - a.row).forEach(t => sheet.deleteRow(t.row));
  SpreadsheetApp.getActive().toast("Removed " + toRemove.length + " movie(s) below " + FLOOR + ".", "GMDB", 8);
}

// =============================================
// FILL / RE-SCORE ONE MOVIE AT A TIME
// Deliberately no bulk/auto-continuing versions of these. The previous
// incident happened because an unattended loop kept re-firing for hours
// and silently burned through quota. One row per click is slower, but it
// means you always see exactly what happened before running the next one.
// =============================================

// Fill just the next blank movie (finds the first row missing a director)
function refreshOneBlankMovie() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();

  for (let row = 2; row <= lastRow; row++) {
    const title = sheet.getRange(row, 1).getValue();
    const director = sheet.getRange(row, 3).getValue();
    const score = sheet.getRange(row, 10).getValue();
    // "Blank" = still missing either the director (an old-style stuck row)
    // or a score (e.g. a Coming Soon row that autoAddUpcomingReleases added
    // with metadata only, ahead of its actual release — this is what picks
    // those up and completes them into a real review once they're ready).
    if (title && (!director || !score)) {
      fillMovieData({ range: sheet.getRange(row, 1) });
      SpreadsheetApp.getActive().toast("Filled: " + title, "GMDB", 5);
      return;
    }
  }
  SpreadsheetApp.getActive().toast("No blank movies found!", "GMDB", 5);
}

// Re-score ONE movie: click any cell in that movie's row first, then run this.
// Uses forceRescore so a failed fetch never wipes existing good data.
function rescoreOneMovie() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const activeRange = SpreadsheetApp.getActiveRange();
  const row = activeRange ? activeRange.getRow() : 0;

  if (row < 2) {
    SpreadsheetApp.getUi().alert("Click a cell in the movie's row first, then run this again.");
    return;
  }

  const title = sheet.getRange(row, 1).getValue();
  if (!title) {
    SpreadsheetApp.getUi().alert("Row " + row + " has no title.");
    return;
  }

  try {
    fillMovieData({ range: sheet.getRange(row, 1), forceRescore: true });
    SpreadsheetApp.getActive().toast("Re-scored: " + title, "GMDB", 6);
  } catch (err) {
    SpreadsheetApp.getUi().alert("Re-score failed for row " + row + ":\n\n" + err);
  }
}

// Re-score 5 movies: if you HIGHLIGHT multiple rows first, re-scores exactly
// those (capped at 5). If you just click a single cell (or nothing), it
// falls back to sweeping sequentially through the catalog, remembering
// where it left off via PropertiesService between clicks. Either way, if a
// quota error hits mid-batch it stops immediately — nothing lost or skipped.
function rescoreFiveMovies() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const activeRange = SpreadsheetApp.getActiveRange();
  const props = PropertiesService.getScriptProperties();
  let rows = [];
  let usingSelection = false;

  // Only treat this as a deliberate "re-score exactly these rows" selection
  // if it's a genuinely small range (2-5 rows). A broad selection — like
  // clicking the column A header to select the whole Title column while
  // just browsing — would otherwise get misread as "please re-score these,"
  // silently hijacking the sequential pointer and always grabbing the same
  // first few rows instead of continuing where the last run left off.
  const isDeliberateSelection = activeRange && activeRange.getNumRows() > 1 && activeRange.getNumRows() <= 5;

  if (isDeliberateSelection) {
    usingSelection = true;
    const startRow = activeRange.getRow();
    const numRows = activeRange.getNumRows();
    for (let r = startRow; r < startRow + numRows && r <= lastRow; r++) {
      if (r >= 2 && sheet.getRange(r, 1).getValue()) rows.push(r);
    }
    rows = rows.slice(0, 5);
    if (!rows.length) {
      SpreadsheetApp.getUi().alert("No movies with a title found in the highlighted rows.");
      return;
    }
  } else {
    let startRow = parseInt(props.getProperty("RESCORE_NEXT_ROW") || "2", 10);
    if (startRow > lastRow) startRow = 2;
    let row = startRow;
    while (rows.length < 5 && row <= lastRow) {
      if (sheet.getRange(row, 1).getValue()) rows.push(row);
      row++;
    }
    props.setProperty("RESCORE_NEXT_ROW", String(row > lastRow ? 2 : row));
  }

  let done = 0;
  const results = [];

  for (const row of rows) {
    const title = sheet.getRange(row, 1).getValue();
    try {
      fillMovieData({ range: sheet.getRange(row, 1), forceRescore: true });
      results.push(title + " ✓");
      done++;
    } catch (err) {
      const msg = String(err);
      if (msg.indexOf("GEMINI_QUOTA") !== -1 || msg.indexOf("urlfetch") !== -1 || msg.indexOf("too many times") !== -1) {
        if (!usingSelection) props.setProperty("RESCORE_NEXT_ROW", String(row));
        SpreadsheetApp.getUi().alert(
          "Stopped early — hit a quota limit after re-scoring " + done + " movie(s):\n\n" +
          results.join("\n") + "\n\nError: " + err +
          (usingSelection ? "\n\nRe-highlight the remaining rows and try again later." : "\n\nTry again later; it'll resume from '" + title + "'.")
        );
        return;
      }
      results.push(title + " ✗ (" + err + ")");
      done++;
    }
    Utilities.sleep(1000);
  }

  SpreadsheetApp.getUi().alert(
    "Re-scored " + done + " movie(s):\n\n" + results.join("\n")
  );
}

// Re-score WHATEVER rows are currently highlighted — no size cap, since
// clicking this specific menu item is itself the explicit "yes, these
// exact rows" signal (unlike rescoreFiveMovies, which has to guess whether
// a selection was deliberate or just incidental browsing). Still has a
// time-based safety stop so a very large selection can't run past the
// 6-min Apps Script limit and leave something mid-write.
function rescoreHighlightedRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const activeRange = SpreadsheetApp.getActiveRange();

  if (!activeRange || activeRange.getRow() < 2) {
    SpreadsheetApp.getUi().alert("Highlight one or more movie rows first, then run this again.");
    return;
  }

  const startRow = activeRange.getRow();
  const numRows = activeRange.getNumRows();
  const lastRow = sheet.getLastRow();
  const rows = [];
  for (let r = startRow; r < startRow + numRows && r <= lastRow; r++) {
    if (r >= 2 && sheet.getRange(r, 1).getValue()) rows.push(r);
  }

  if (!rows.length) {
    SpreadsheetApp.getUi().alert("No movies with a title found in the highlighted rows.");
    return;
  }

  const startTime = Date.now();
  const MAX_RUNTIME = 4.5 * 60 * 1000; // stop well before the 6-min hard limit
  let done = 0;
  const results = [];
  let stoppedEarly = false;

  for (const row of rows) {
    if (Date.now() - startTime > MAX_RUNTIME) {
      stoppedEarly = true;
      break; // don't start another row — nothing left half-written
    }
    const title = sheet.getRange(row, 1).getValue();
    try {
      fillMovieData({ range: sheet.getRange(row, 1), forceRescore: true });
      results.push(title + " ✓");
      done++;
    } catch (err) {
      const msg = String(err);
      if (msg.indexOf("GEMINI_QUOTA") !== -1 || msg.indexOf("urlfetch") !== -1 || msg.indexOf("too many times") !== -1) {
        SpreadsheetApp.getUi().alert(
          "Stopped early — hit a quota limit after re-scoring " + done + " movie(s):\n\n" +
          results.join("\n") + "\n\nError: " + err +
          "\n\nRe-highlight the remaining rows and try again later."
        );
        return;
      }
      results.push(title + " ✗ (" + err + ")");
      done++;
    }
    Utilities.sleep(1000);
  }

  SpreadsheetApp.getUi().alert(
    "Re-scored " + done + " movie(s):\n\n" + results.join("\n") +
    (stoppedEarly ? "\n\n(Stopped early to stay under the time limit — re-highlight the rest and run again.)" : "")
  );
}


// =============================================
// WEB APP — POST endpoint (called by the website's "Add Movie" feature)
// =============================================
function doPost(e) {
  const raw = e && e.postData ? e.postData.contents : "{}";
  Logger.log(raw);

  const data = JSON.parse(raw);

  // Song-add request (from the Songs section's "Add a Song" fallback) —
  // routed separately from the movie-add flow below since a bare song
  // title can't be resolved via TMDB search at all (TMDB only indexes
  // films), so it needs its own Gemini-only identification pipeline.
  if (data.SongTitle) {
    addSongEntry_(
      String(data.SongTitle).trim(),
      String(data.SongMovieHint || "").trim(),
      String(data.SongPosterHint || "").trim()
    );
    return ContentService.createTextOutput("OK");
  }

  const title = String(data.Title || "").trim();
  if (!title) {
    return ContentService.createTextOutput("Missing Title");
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  const values = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    : [];

  // Check if title already exists (case-insensitive)
  let rowIndex = -1;
  const titleLower = title.toLowerCase();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === titleLower) {
      rowIndex = i + 2;
      break;
    }
  }

  // If not found, add it to a new row
  if (rowIndex === -1) {
    rowIndex = sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1).setValue(title);
  }

  fillMovieData({ range: sheet.getRange(rowIndex, 1) });

  return ContentService.createTextOutput("OK");
}

// =============================================
// SONGS — standalone song reviews, independent of the movie needing to
// already be in the Movies sheet. Lives in its own "Songs" tab (columns:
// Title | Movie | Year | MusicDirector | Singers | Language | Score |
// WhyHit | DateAdded | PosterURL) since a bare song title can't be resolved
// via TMDB (it only indexes films) — this uses a dedicated Gemini-only
// identification + scoring pipeline instead of reusing fillMovieData's
// TMDB-based flow. The poster is fetched separately via a plain TMDB title
// search once Gemini has resolved which film the song is from.
// =============================================

// Gemini fills the Movie field with a placeholder like "N/A" for a song
// that genuinely isn't from any film (a standalone instrumental album
// track, say) — searching TMDB for a movie literally titled "N/A" can
// spuriously match some unrelated real film and hand back a completely
// wrong poster. Treat these placeholders as "no movie" rather than a
// searchable title.
function isRealMovieTitle_(movie) {
  const m = String(movie || "").trim();
  if (!m) return false;
  const stripped = m.toLowerCase().replace(/[^a-z]/g, "");
  return ["na", "none", "unknown", "null", "nomovie", "notapplicable"].indexOf(stripped) === -1;
}

// Best-effort poster lookup for a song's parent film — a plain TMDB title
// search (not an exact-ID lookup like the main movie-add flow, since all we
// have here is Gemini's free-text movie/year guess). Returns "" on any miss
// so a poster-less song still gets its review saved rather than being lost.
function tmdbPosterForMovie_(title, year) {
  if (!title) return "";
  try {
    const base = "https://api.themoviedb.org/3/search/movie?api_key=" + TMDB_API_KEY +
      "&query=" + encodeURIComponent(title) + "&include_adult=false";

    // BUG FIX: this used to just take results[0] — TMDB's top hit by
    // popularity, not necessarily the right film. For anything but a
    // distinctive title (a generic phrase like "Cola Cola", say), an
    // unrelated same-named entry with NO poster can rank ahead of the real
    // film, which DOES have one — so a real, long-established movie (a
    // 1985 release, not just a too-new one) could still come back blank.
    // Scan every result instead: prefer one that both has a poster and
    // matches the given year, falling back to any poster'd result.
    const pickBest = (results) => {
      const withPoster = (results || []).filter(r => r.poster_path);
      if (!withPoster.length) return null;
      if (year) {
        const yearMatch = withPoster.find(r => (r.release_date || "").slice(0, 4) === String(year).trim());
        if (yearMatch) return yearMatch;
      }
      return withPoster[0];
    };

    let json = JSON.parse(UrlFetchApp.fetch(base + (year ? "&year=" + encodeURIComponent(year) : "")).getContentText());
    let match = pickBest(json.results);
    // A year-scoped search can come up empty for a very new/upcoming title
    // whose TMDB release date isn't finalized yet — retry unscoped rather
    // than giving up on the poster entirely.
    if (!match && year) {
      json = JSON.parse(UrlFetchApp.fetch(base).getContentText());
      match = pickBest(json.results);
    }
    return match ? "https://image.tmdb.org/t/p/w500" + match.poster_path : "";
  } catch (err) {
    return "";
  }
}

// Backfill for songs whose poster lookup missed (added before the
// PosterURL column existed, or TMDB had nothing at the time) — run it from
// the 🎬 GMDB menu ("♪ Backfill song posters") on the spreadsheet, or from
// the Apps Script editor's function dropdown. Safe to re-run any time;
// only touches rows still blank.
function backfillSongPosters() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Songs");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("No 'Songs' sheet tab found.");
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getActive().toast("No songs to backfill.", "GMDB", 5);
    return;
  }
  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues(); // Title..PosterURL
  let updated = 0;
  for (let i = 0; i < data.length; i++) {
    const title = data[i][0], movie = data[i][1], year = data[i][2], posterUrl = data[i][9];
    if (!title || posterUrl || !isRealMovieTitle_(movie)) continue;
    const poster = tmdbPosterForMovie_(movie, year);
    if (poster) {
      sheet.getRange(i + 2, 10).setValue(poster);
      updated++;
    }
  }
  Logger.log("Backfilled posters for " + updated + " song(s).");
  SpreadsheetApp.getActive().toast("Backfilled posters for " + updated + " song(s).", "GMDB", 6);
}

// Backfill Raaga + Trivia for songs added before those columns existed.
// Unlike backfillSongPosters() (a cheap TMDB title search), this re-runs
// the full grounded Gemini review per song — much slower, so it's capped
// per run to stay well under Apps Script's execution time limit. Re-run
// the menu item to keep going; it always picks up where it left off.
//
// Trivia (not "raaga && trivia") is what marks a row as already handled —
// a real raaga is genuinely rare (most film songs aren't based on one), so
// gating on both fields would re-run Gemini forever on every song that
// legitimately has no raaga. Trivia almost always comes back with
// something for a real song, so it's the more reliable "already tried"
// signal.
function backfillSongRaagaTrivia() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Songs");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("No 'Songs' sheet tab found.");
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getActive().toast("No songs to backfill.", "GMDB", 5);
    return;
  }
  const MAX_PER_RUN = 15;
  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues(); // Title..Trivia
  const eligible = [];
  data.forEach((row, i) => {
    const title = row[0], score = row[6], trivia = row[11];
    if (title && score && !trivia) eligible.push(i);
  });

  let updated = 0;
  for (let k = 0; k < eligible.length && updated < MAX_PER_RUN; k++) {
    const i = eligible[k];
    const row = i + 2;
    const title = data[i][0], movie = data[i][1], raaga = data[i][10];
    try {
      const review = getGeminiSongReview_(String(title), movie ? String(movie) : "");
      if (review && review.found) {
        if (!raaga && review.raaga) sheet.getRange(row, 11).setValue(review.raaga);
        // A real song's trivia coming back genuinely empty is rare enough
        // that leaving the cell blank (and letting a future run retry it)
        // is a better tradeoff than writing a placeholder value into a
        // field the site displays verbatim.
        if (review.trivia) sheet.getRange(row, 12).setValue(stripCitationMarkers_(review.trivia));
        updated++;
      }
    } catch (err) {
      Logger.log("Raaga/trivia backfill failed for '" + title + "': " + err);
    }
    Utilities.sleep(500);
  }

  const remaining = eligible.length - updated;
  const msg = remaining > 0
    ? "Filled raaga/trivia for " + updated + " song(s). " + remaining + " more remain — run this again to continue."
    : "Filled raaga/trivia for " + updated + " song(s). All songs now have this data.";
  SpreadsheetApp.getActive().toast(msg, "GMDB", 8);
}

// =============================================
// SPOTIFY — real, searchable song index for the Add-a-Song suggestions
// dropdown (mirrors how TMDB backs the Add-Movie dropdown). Gemini
// identify (below) can only confirm one exact, complete title from its own
// memory — it has no index to search, so a few letters gets nothing. This
// is what actually lets someone type a few letters and see several real
// candidate songs, the way movie search already works.
// =============================================

// Client-Credentials OAuth (app-only, no user login) — cached in
// CacheService so we're not re-authenticating on every keystroke. Spotify
// tokens last ~1hr; refreshed a minute early to avoid edge-of-expiry 401s.
function getSpotifyToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("spotify_token");
  if (cached) return cached;

  const creds = Utilities.base64Encode(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET);
  const response = UrlFetchApp.fetch("https://accounts.spotify.com/api/token", {
    method: "post",
    headers: { "Authorization": "Basic " + creds },
    contentType: "application/x-www-form-urlencoded",
    payload: "grant_type=client_credentials",
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Spotify auth HTTP " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
  }
  const data = JSON.parse(response.getContentText());
  const ttl = Math.max(60, Number(data.expires_in || 3600) - 60);
  cache.put("spotify_token", data.access_token, ttl);
  return data.access_token;
}

// Real track search — returns several candidates, same shape purpose as
// the TMDB suggestions list for movies. market=IN just controls stream
// availability, not language/origin, so results aren't filtered to Indian
// film songs specifically — same philosophy as manual Add Movie already
// allowing any language and trusting the person to pick the right result.
function searchSpotifySongs_(query) {
  const token = getSpotifyToken_();
  const url = "https://api.spotify.com/v1/search?type=track&market=IN&limit=10&q=" + encodeURIComponent(query);
  const response = UrlFetchApp.fetch(url, {
    headers: { "Authorization": "Bearer " + token },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Spotify search HTTP " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
  }
  const data = JSON.parse(response.getContentText());
  const tracks = (data.tracks && data.tracks.items) || [];
  return tracks.map(t => ({
    title: t.name,
    // Indian film soundtrack albums on Spotify are almost always named
    // after the film itself, and the album cover is very often literally
    // the movie poster — this doubles as a poster source, not just a
    // movie-name guess (see SongPosterHint in doPost).
    movie: (t.album && t.album.name) || "",
    year: (t.album && t.album.release_date) ? t.album.release_date.slice(0, 4) : "",
    artists: (t.artists || []).map(a => a.name).join(", "),
    poster: (t.album && t.album.images && t.album.images[0]) ? t.album.images[0].url : "",
    spotifyUrl: (t.external_urls && t.external_urls.spotify) || ""
  }));
}

function addSongEntry_(songTitle, movieHint, posterHint) {
  if (!songTitle) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Songs");
  if (!sheet) {
    Logger.log("No 'Songs' sheet tab found — skipping song add for '" + songTitle + "'.");
    return;
  }

  const lastRow = sheet.getLastRow();
  const existingTitles = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0]).trim().toLowerCase())
    : [];
  if (existingTitles.indexOf(songTitle.toLowerCase()) !== -1) return; // already have it

  let review;
  try {
    review = getGeminiSongReview_(songTitle, movieHint);
  } catch (err) {
    Logger.log("Song review failed for '" + songTitle + "': " + err);
    return;
  }
  // Only write a row when Gemini could confidently identify a real film
  // song with a real score — an inconclusive result silently produces
  // nothing rather than a broken/empty entry, same philosophy as a
  // below-threshold movie candidate getting dropped instead of kept.
  if (!review || !review.found || !(Number(review.score) > 0)) {
    Logger.log("Song review inconclusive for '" + songTitle + "': " + JSON.stringify(review));
    return;
  }

  // Real film poster (TMDB) preferred when it's actually found; otherwise
  // fall back to the Spotify album art carried through from the
  // suggestions dropdown, which for a film soundtrack is very often
  // literally the movie poster anyway. Skip the TMDB lookup entirely when
  // there's no real movie to search for (see isRealMovieTitle_) — searching
  // for "N/A" can return an unrelated film's poster instead of nothing.
  const poster = (isRealMovieTitle_(review.movie) ? tmdbPosterForMovie_(review.movie, review.year) : "") || posterHint || "";

  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, 12).setValues([[
    review.title || songTitle,
    review.movie || "",
    review.year || "",
    review.musicDirector || "",
    stripCitationMarkers_(review.singers || ""),
    review.language || "",
    Number(review.score).toFixed(1),
    stripCitationMarkers_(review.whyHit || ""),
    new Date(),
    poster,
    review.raaga || "",
    stripCitationMarkers_(review.trivia || "")
  ]]);
}

// =============================================
// Triggered on cell edit — mirrors fillMovieData for the Movies sheet, so
// typing a song title into column A of the Songs sheet works the same way
// as typing a movie title does: runs it through the review pipeline and
// fills the rest of that same row in place, instead of only working
// through the website's "Get It Reviewed" flow.
//
// SETUP (one-time, in the Apps Script editor): Triggers (clock icon) →
// Add Trigger → function: fillSongData → event source: From spreadsheet →
// event type: On edit → Save. This is separate from the existing Movies
// trigger — both fire on every edit anywhere in the workbook, which is why
// each checks e.range.getSheet().getName() before doing anything.
// =============================================
function fillSongData(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== "Songs") return;

  const sheet = e.range.getSheet();

  // Pasting several song titles at once fires one edit event spanning all
  // the pasted rows — process each row separately, same as fillMovieData.
  if (e.range.getNumRows() > 1 && e.range.getColumn() === 1) {
    const startRow = e.range.getRow();
    const numRows = e.range.getNumRows();
    for (let r = startRow; r < startRow + numRows; r++) {
      if (r === 1) continue; // header
      const rowTitle = sheet.getRange(r, 1).getValue();
      if (rowTitle) {
        try {
          fillSongData({ range: sheet.getRange(r, 1) });
        } catch (err) {
          Logger.log("Song paste-fill failed for row " + r + ": " + err);
        }
        Utilities.sleep(500);
      }
    }
    return;
  }

  if (e.range.getColumn() !== 1) return;
  if (e.range.getRow() === 1) return;

  const row = e.range.getRow();
  const title = String(sheet.getRange(row, 1).getValue()).trim();
  if (!title) return;

  // addSongEntry_() (the website's add flow) writes all 10 columns of a row
  // in one setValues() call, which ALSO fires this same installable trigger
  // — by the time it fires the row already has a score, so this correctly
  // no-ops instead of double-reviewing it. Also skip a title that's already
  // scored on some OTHER row, so retyping the same song twice doesn't burn
  // a second Gemini call. forceRescore (set by the "Re-score selected song"
  // menu item) bypasses both — someone explicitly asking to re-score a row
  // should always run, not get silently skipped.
  const forceRescore = !!(e && e.forceRescore);
  const existingScore = sheet.getRange(row, 7).getValue();
  if (existingScore && !forceRescore) return;
  if (!forceRescore) {
    const lastRow = sheet.getLastRow();
    const otherTitles = lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map((r, i) => ({ t: String(r[0]).trim().toLowerCase(), row: i + 2 }))
      : [];
    const dupe = otherTitles.find(o => o.row !== row && o.t === title.toLowerCase());
    if (dupe && sheet.getRange(dupe.row, 7).getValue()) {
      SpreadsheetApp.getActive().toast("\"" + title + "\" is already scored on row " + dupe.row + ".", "GMDB", 6);
      return;
    }
  }

  SpreadsheetApp.getActive().toast("Reviewing song: " + title, "GMDB", 6);

  let review;
  try {
    review = getGeminiSongReview_(title);
  } catch (err) {
    Logger.log("Song review failed for '" + title + "': " + err);
    return;
  }
  if (!review || !review.found || !(Number(review.score) > 0)) {
    Logger.log("Song review inconclusive for '" + title + "': " + JSON.stringify(review));
    SpreadsheetApp.getActive().toast("Couldn't confidently identify/score \"" + title + "\".", "GMDB", 6);
    return;
  }

  // Same placeholder-movie guard as addSongEntry_ — searching TMDB for a
  // movie literally titled "N/A" can return a wrong, unrelated poster.
  const poster = isRealMovieTitle_(review.movie) ? tmdbPosterForMovie_(review.movie, review.year) : "";

  sheet.getRange(row, 1, 1, 12).setValues([[
    review.title || title,
    review.movie || "",
    review.year || "",
    review.musicDirector || "",
    stripCitationMarkers_(review.singers || ""),
    review.language || "",
    Number(review.score).toFixed(1),
    stripCitationMarkers_(review.whyHit || ""),
    new Date(),
    poster,
    review.raaga || "",
    stripCitationMarkers_(review.trivia || "")
  ]]);
}

// Fill the next song row that has a title but no score yet — same "next
// blank" pattern as refreshOneBlankMovie, for the 🎬 GMDB menu.
function refreshOneBlankSong() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Songs");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("No 'Songs' sheet tab found.");
    return;
  }
  const lastRow = sheet.getLastRow();
  for (let row = 2; row <= lastRow; row++) {
    const title = sheet.getRange(row, 1).getValue();
    const score = sheet.getRange(row, 7).getValue();
    if (title && !score) {
      fillSongData({ range: sheet.getRange(row, 1) });
      SpreadsheetApp.getActive().toast("Filled: " + title, "GMDB", 5);
      return;
    }
  }
  SpreadsheetApp.getActive().toast("No blank songs found!", "GMDB", 5);
}

// Re-score ONE song: click any cell in that song's row first, then run
// this — same pattern as rescoreOneMovie, for the 🎬 GMDB menu.
function rescoreOneSong() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Songs");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("No 'Songs' sheet tab found.");
    return;
  }
  const activeRange = SpreadsheetApp.getActiveRange();
  const row = activeRange ? activeRange.getRow() : 0;

  if (row < 2 || activeRange.getSheet().getName() !== "Songs") {
    SpreadsheetApp.getUi().alert("Click a cell in the song's row (on the Songs tab) first, then run this again.");
    return;
  }

  const title = sheet.getRange(row, 1).getValue();
  if (!title) {
    SpreadsheetApp.getUi().alert("Row " + row + " has no title.");
    return;
  }

  try {
    fillSongData({ range: sheet.getRange(row, 1), forceRescore: true });
    SpreadsheetApp.getActive().toast("Re-scored: " + title, "GMDB", 6);
  } catch (err) {
    SpreadsheetApp.getUi().alert("Re-score failed for row " + row + ":\n\n" + err);
  }
}

// Lightweight, dedicated Gemini call for a standalone song review — same
// weighted scoring methodology as hitSongsDetails in getGeminiMovieReview
// (melody 40%, vocals 25%, lyrics 20%, replay value 15%), but resolves the
// song's own movie/album via live search first instead of assuming one's
// already known, since this is invoked with just a bare song title.
//
// movieHint is optional — set when this request came via the frontend's
// identify-confirm step (identifyGeminiSong_ found a match and the person
// confirmed it). identifyGeminiSong_ doesn't use Google Search grounding
// (see its own comment for why), so it can occasionally confirm a song
// this GROUNDED call then can't independently verify on a bare, ambiguous
// title — passing along which film identify found narrows the search onto
// the same song instead of leaving this call to re-search cold.
function getGeminiSongReview_(songTitle, movieHint) {
  const hintClause = movieHint ? ` (likely from the film "${movieHint}")` : "";
  const prompt = `Using Google Search, identify the real Indian film song titled "${songTitle}"${hintClause} and review it.

STRICT RULES:
- Only proceed if you can confidently identify a REAL song from an Indian film (Tamil, Telugu, Hindi, Malayalam, Kannada, Bengali, Marathi, Punjabi, etc.) — not a generic/non-Indian song, not a guess.
- If you cannot confidently identify it, return exactly {"found": false} and nothing else.

If found, return ONLY valid JSON, no markdown, no backticks:
{
  "found": true,
  "title": "official song title",
  "movie": "the film it's from",
  "year": "YYYY",
  "musicDirector": "composer/music director name",
  "singers": "the actual playback singer(s) who performed it, comma-separated if more than one — not the music director and not the on-screen actor unless they genuinely sang it themselves. Leave blank if you genuinely can't find this, don't guess.",
  "language": "Tamil/Telugu/Hindi/Malayalam/Kannada/Bengali/Marathi/Punjabi/etc.",
  "score": "a single number 0.0-10.0 with one decimal place, computed as a weighted blend of melody (40%), vocals (25%), lyrics (20%), and replay value (15%) — judge each dimension using whatever's actually known about the song (chart/streaming performance, critic or audience commentary, its role in the film)",
  "whyHit": "ONE sentence, MAXIMUM 20 WORDS, explaining this song's specific appeal — be specific to THIS song, not a generic 'catchy tune, great vibes' description",
  "raaga": "the specific Carnatic or Hindustani raga this song is genuinely composed in or based on, if one is actually documented/known (common for Tamil, Telugu, Kannada, and classical-influenced Hindi film music) — e.g. 'Shanmukhapriya', 'Kalyani', 'Yaman'. Leave completely blank if the song isn't known to be based on a specific named raga — do NOT guess or name one just because the song sounds classical.",
  "trivia": "2-4 short, factual, interesting facts about THIS song specifically, separated by ' | ' (pipe) — e.g. its recording, chart performance, awards, notable covers/remixes, picturization, or cultural impact. Only include facts you're reasonably confident are true; give fewer facts (or leave blank) rather than inventing any."
}`;

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const bodyText = response.getContentText();
  if (code !== 200) throw new Error("Gemini song review HTTP " + code + ": " + bodyText.slice(0, 200));
  const data = JSON.parse(bodyText);
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content || !cand.content.parts || !cand.content.parts[0]) {
    throw new Error("Gemini song review: empty/filtered response for '" + songTitle + "'");
  }
  return parseGeminiJsonObject_(cand.content.parts[0].text || "");
}

// Lightweight identify-only counterpart to getGeminiSongReview_ — meant to
// be the FAST live-preview lookup (the frontend calls it on every
// keystroke), so unlike the full review this deliberately does NOT use
// Google Search grounding: the grounded round-trip itself (not the model's
// "thinking", which thinkingBudget:0 already rules out) is what made this
// reliably take 20-30s and look hung. Answering from the model's own
// knowledge instead is a few seconds at most. The tradeoff is it can miss a
// song released after the model's knowledge cutoff or too obscure to know
// off the top of its head — that's fine, since this is just a "does this
// look right?" preview: "Add It Anyway" falls through to the full,
// still-grounded getGeminiSongReview_, which can still resolve it.
function identifyGeminiSong_(songTitle) {
  const prompt = `Identify the real Indian film song titled "${songTitle}", using only what you already know.

STRICT RULES:
- Only answer if you're confident you know this specific song from memory — a real song from an Indian film (Tamil, Telugu, Hindi, Malayalam, Kannada, Bengali, Marathi, Punjabi, etc.), not a generic/non-Indian song, not a guess, not a plausible-sounding fabrication.
- If the title is ambiguous, could match multiple different songs, sounds like it might be a recent release you're not certain about, or you're not genuinely confident — return exactly {"found": false} and nothing else. A missed real song is fine here; a wrong or hallucinated match is not — false positives are far worse than saying you don't know.

If found, return ONLY valid JSON, no markdown, no backticks:
{
  "found": true,
  "title": "official song title",
  "movie": "the film it's from",
  "year": "YYYY",
  "musicDirector": "composer/music director name",
  "singers": "the actual playback singer(s) who performed it, comma-separated if more than one. Leave blank if you genuinely can't recall this, don't guess.",
  "language": "Tamil/Telugu/Hindi/Malayalam/Kannada/Bengali/Marathi/Punjabi/etc."
}`;

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    // thinkingBudget:0 — no grounding tool here to begin with (see comment
    // above), and disabling thinking too keeps this call as fast as
    // possible since it fires on every keystroke.
    generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const bodyText = response.getContentText();
  if (code !== 200) throw new Error("Gemini song identify HTTP " + code + ": " + bodyText.slice(0, 200));
  const data = JSON.parse(bodyText);
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content || !cand.content.parts || !cand.content.parts[0]) {
    throw new Error("Gemini song identify: empty/filtered response for '" + songTitle + "'");
  }
  return parseGeminiJsonObject_(cand.content.parts[0].text || "");
}


// =============================================
// WEB APP — GET endpoint (health check)
// =============================================
// Escapes text for safe embedding into raw HTML/attributes — needed since
// the share preview page builds HTML directly from sheet data (movie
// titles, takeaways), and an unescaped quote or angle bracket in that text
// could otherwise break the page's markup.
function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// encodeURIComponent deliberately leaves !'()* unescaped, but most chat
// apps' link auto-detection treats a trailing "!" (or similar) as sentence
// punctuation and silently drops it from the clickable link — so a shared
// "?movie=Hi!" URL can arrive as "?movie=Hi" once pasted into
// iMessage/WhatsApp/SMS/etc. Escape those characters too so they survive
// intact. Kept in sync by hand with the identical helper in index.html and
// generate-movie-pages.js.
function encodeURIComponentStrict_(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function doGet(e) {
  // Server-side poster proxy for the website's Share feature. TMDB's image
  // CDN inconsistently includes the CORS header browsers need to actually
  // READ image bytes via fetch() (a known, longstanding issue on TMDB's
  // end — some cached images have it, some don't). A server-to-server
  // request from Apps Script has no such restriction (CORS is a browser-only
  // rule), so fetching it here and handing back the bytes as base64 is
  // 100% reliable instead of depending on TMDB's luck-of-the-draw caching.
  if (e && e.parameter && e.parameter.action === "posterProxy" && e.parameter.url) {
    try {
      const imgUrl = e.parameter.url;
      // Safety: only allow proxying TMDB's own image domain, never an
      // arbitrary URL someone might pass in.
      if (!/^https:\/\/image\.tmdb\.org\//.test(imgUrl)) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Invalid image URL" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      const resp = UrlFetchApp.fetch(imgUrl, { muteHttpExceptions: true });
      const blob = resp.getBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      const mimeType = blob.getContentType() || "image/jpeg";
      return ContentService
        .createTextOutput(JSON.stringify({ data: base64, mimeType: mimeType }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Generates a small, movie-specific HTML page with dynamic Open Graph tags
  // (correct poster + title for THAT film), then redirects a human visitor
  // into the real interactive site. Link-preview bots (iMessage, WhatsApp,
  // etc.) only read the raw <head> tags and don't execute JavaScript or
  // follow the redirect, so they see the correct per-movie preview instead
  // of the site's generic branded card. This replaces manually attaching
  // the poster as a separate file — the link preview itself now carries it.
  if (e && e.parameter && e.parameter.action === "share" && e.parameter.title) {
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const titleCol = headers.indexOf("Title");
      const posterCol = headers.indexOf("PosterURL");
      const yearCol = headers.indexOf("Year");
      const takeawayCol = headers.indexOf("Takeaway");
      const wantTitle = String(e.parameter.title).trim().toLowerCase();

      let match = null;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][titleCol] || "").trim().toLowerCase() === wantTitle) {
          match = data[i];
          break;
        }
      }

      const SITE = "https://gvgfr.github.io/GMDB/";
      const redirectUrl = SITE + "?movie=" + encodeURIComponentStrict_(e.parameter.title);

      // Movie not found — redirect straight through, no special preview.
      if (!match) {
        return HtmlService.createHtmlOutput(
          `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}">
          <script>window.location.href="${redirectUrl}";</script></head><body></body></html>`
        );
      }

      const mTitle = match[titleCol] || "";
      const mYear = match[yearCol] || "";
      const mPoster = match[posterCol] || "";
      const mTakeaway = match[takeawayCol] || "Read the review on Masala Meter.";
      const pageTitle = mTitle + (mYear ? " (" + mYear + ")" : "") + " — Masala Meter";

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml_(pageTitle)}</title>
  <meta property="og:title" content="${escapeHtml_(pageTitle)}"/>
  <meta property="og:description" content="${escapeHtml_(mTakeaway)}"/>
  ${mPoster ? `<meta property="og:image" content="${escapeHtml_(mPoster)}"/>` : ""}
  <meta property="og:url" content="${redirectUrl}"/>
  <meta property="og:type" content="website"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeHtml_(pageTitle)}"/>
  <meta name="twitter:description" content="${escapeHtml_(mTakeaway)}"/>
  ${mPoster ? `<meta name="twitter:image" content="${escapeHtml_(mPoster)}"/>` : ""}
  <meta http-equiv="refresh" content="0;url=${redirectUrl}">
  <script>window.location.href="${redirectUrl}";</script>
</head>
<body>
  <p>Redirecting to <a href="${redirectUrl}">${escapeHtml_(pageTitle)}</a> on Masala Meter…</p>
</body>
</html>`;

      return HtmlService.createHtmlOutput(html);
    } catch (err) {
      // Something went wrong generating the preview — still get the person
      // to the real site rather than showing them a broken page.
      const SITE = "https://gvgfr.github.io/GMDB/";
      const fallbackUrl = SITE + "?movie=" + encodeURIComponentStrict_(e.parameter.title);
      return HtmlService.createHtmlOutput(
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${fallbackUrl}"></head><body></body></html>`
      );
    }
  }

  // Return movies as JSON for the website
  if (e && e.parameter && e.parameter.action === "movies") {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    // Exclude internal-only caching columns (SimilarCache / SimilarCacheDate)
    // from the public feed — they're large and not meant for the frontend.
    const internalCols = [SIMILAR_CACHE_COL - 1, SIMILAR_CACHE_DATE_COL - 1];
    const movies = data.slice(1).map(row => {
      const movie = {};
      headers.forEach((h, i) => {
        if (internalCols.indexOf(i) !== -1) return;
        movie[h] = row[i];
      });
      return movie;
    }).filter(m => m.Title);
    return ContentService
      .createTextOutput(JSON.stringify(movies))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return standalone song reviews as JSON for the website's Songs section.
  // Lives in its own "Songs" sheet tab — separate from Movies since a song
  // isn't tied to any movie already being in the catalog. Tab may not exist
  // yet on a fresh copy of the sheet, so tolerate that and return [].
  if (e && e.parameter && e.parameter.action === "songs") {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Songs");
    if (!sheet) {
      return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    }
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const songs = data.slice(1).map(row => {
      const song = {};
      headers.forEach((h, i) => { song[h] = row[i]; });
      return song;
    }).filter(s => s.Title);
    return ContentService
      .createTextOutput(JSON.stringify(songs))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Real, searchable song suggestions (Spotify) for the Add-a-Song
  // dropdown — several candidates for a few typed letters, the same way
  // action=search backs the Add-Movie dropdown via TMDB. Primary path;
  // identifySong below is the fallback for anything not on Spotify.
  if (e && e.parameter && e.parameter.action === "searchSongs" && e.parameter.q) {
    try {
      const results = searchSpotifySongs_(String(e.parameter.q).trim());
      return ContentService
        .createTextOutput(JSON.stringify(results))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      Logger.log("searchSongs failed for '" + e.parameter.q + "': " + err);
      return ContentService
        .createTextOutput("[]")
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Identify (not score) a song for the Add-a-Song confirm step — fallback
  // for when Spotify's search (above) comes up empty: lets Gemini try to
  // recognize it from memory before falling all the way through to
  // "Add It Anyway" with no confirmation at all.
  if (e && e.parameter && e.parameter.action === "identifySong" && e.parameter.q) {
    try {
      const result = identifyGeminiSong_(String(e.parameter.q).trim());
      if (result && result.found) {
        result.poster = tmdbPosterForMovie_(result.movie, result.year);
      }
      return ContentService
        .createTextOutput(JSON.stringify(result || { found: false }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      Logger.log("identifySong failed for '" + e.parameter.q + "': " + err);
      return ContentService
        .createTextOutput(JSON.stringify({ found: false }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Search TMDB for movie suggestions (for Add Movie autocomplete)
  if (e && e.parameter && e.parameter.action === "search" && e.parameter.q) {
    const query = e.parameter.q;
    try {
      const indianLangs = ["ta", "hi", "te", "ml", "kn", "bn", "mr"];

      // 1) Search movies by title
      const movieUrl = "https://api.themoviedb.org/3/search/movie?api_key=" +
        TMDB_API_KEY + "&query=" + encodeURIComponent(query) + "&include_adult=false";
      const movieJson = JSON.parse(UrlFetchApp.fetch(movieUrl).getContentText());
      let movieHits = (movieJson.results || []);

      // 2) Search people (actors / directors) — if found, pull their films
      let personHits = [];
      try {
        const personUrl = "https://api.themoviedb.org/3/search/person?api_key=" +
          TMDB_API_KEY + "&query=" + encodeURIComponent(query) + "&include_adult=false";
        const personJson = JSON.parse(UrlFetchApp.fetch(personUrl).getContentText());
        const topPerson = (personJson.results || [])[0];
        if (topPerson && topPerson.id) {
          const creditsUrl = "https://api.themoviedb.org/3/person/" + topPerson.id +
            "/movie_credits?api_key=" + TMDB_API_KEY;
          const credits = JSON.parse(UrlFetchApp.fetch(creditsUrl).getContentText());
          // Combine acting roles + directing/crew jobs
          const cast = credits.cast || [];
          const crew = (credits.crew || []).filter(c => c.job === "Director");
          personHits = cast.concat(crew);
        }
      } catch (pErr) {
        Logger.log("Person search failed: " + pErr);
      }

      // Merge, dedupe by movie id, prefer Indian-language + popularity.
      // (Manual Add Movie allows any language — friends can add English films
      //  too. Only the AUTO-ADD feature is restricted to Indian cinema.)
      const combined = movieHits.concat(personHits);
      const seen = {};
      const deduped = combined.filter(m => {
        if (!m.id || seen[m.id]) return false;
        seen[m.id] = true;
        return true;
      });

      const results = deduped
        .sort((a, b) => {
          const aIndian = indianLangs.includes(a.original_language) ? 1 : 0;
          const bIndian = indianLangs.includes(b.original_language) ? 1 : 0;
          if (aIndian !== bIndian) return bIndian - aIndian;
          // Within the same group, newer + more popular first
          const aYear = a.release_date ? parseInt(a.release_date.substring(0,4)) : 0;
          const bYear = b.release_date ? parseInt(b.release_date.substring(0,4)) : 0;
          const popDiff = (b.popularity || 0) - (a.popularity || 0);
          if (Math.abs(popDiff) > 1) return popDiff;
          return bYear - aYear;
        })
        .slice(0, 20)
        .map(m => ({
          title: m.title,
          year: m.release_date ? m.release_date.substring(0, 4) : "",
          poster: m.poster_path ? "https://image.tmdb.org/t/p/w92" + m.poster_path : "",
          lang: m.original_language
        }));
      return ContentService
        .createTextOutput(JSON.stringify(results))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // TMDB recommendations for a given movie title (for "Discover More")
  if (e && e.parameter && e.parameter.action === "recommend" && e.parameter.title) {
    try {
      const t = e.parameter.title;
      const yr = e.parameter.year || "";
      const lang = e.parameter.lang || "";
      const director = e.parameter.director || "";
      const genre = e.parameter.genre || "";

      // CACHE CHECK: "Discover More" fires on every single page view with no
      // rate limiting, making it the single biggest source of Gemini calls.
      // Cache the result per-movie in the sheet and reuse it for CACHE_DAYS
      // instead of asking Gemini fresh every time.
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
      const CACHE_DAYS = 30;
      const cacheRow = findMovieRow_(sheet, t, yr);
      if (cacheRow) {
        const cachedJson = sheet.getRange(cacheRow, SIMILAR_CACHE_COL).getValue();
        const cachedDate = sheet.getRange(cacheRow, SIMILAR_CACHE_DATE_COL).getValue();
        if (cachedJson && cachedDate) {
          const ageMs = Date.now() - new Date(cachedDate).getTime();
          if (ageMs < CACHE_DAYS * 24 * 60 * 60 * 1000) {
            return ContentService.createTextOutput(cachedJson).setMimeType(ContentService.MimeType.JSON);
          }
        }
      }

      // STEP 1: Ask Gemini for similar Indian films (it knows Indian cinema deeply)
      let geminiRecs = [];
      try {
        geminiRecs = getGeminiSimilarMovies(t, yr, lang, director, genre);
      } catch (gErr) {
        // Gemini unavailable (out of credit / quota). TMDB alone is weak for
        // Indian films, so tell the site it's a temporary service issue.
        if (String(gErr).indexOf("GEMINI_QUOTA") !== -1) {
          return ContentService
            .createTextOutput(JSON.stringify({ status: "unavailable" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        geminiRecs = [];
      }

      // STEP 2: Enrich each with a TMDB poster where possible, but DON'T drop a
      // suggestion just because TMDB lookup fails — keep Gemini's pick regardless.
      const verified = [];
      const seen = {};
      geminiRecs.forEach(g => {
        if (verified.length >= 6) return;
        if (!g || !g.title) return;
        if (g.title.toLowerCase() === t.toLowerCase()) return; // skip the film itself
        let entry = {
          title: g.title,
          year: g.year || "",
          poster: "",
          lang: lang || "",
          reason: g.reason || ""
        };
        try {
          const sUrl = "https://api.themoviedb.org/3/search/movie?api_key=" +
            TMDB_API_KEY + "&include_adult=false&query=" + encodeURIComponent(g.title);
          const sRes = JSON.parse(UrlFetchApp.fetch(sUrl).getContentText());
          let match = null;
          if (g.year) match = (sRes.results || []).filter(m => m.release_date && m.release_date.substring(0,4) === String(g.year))[0];
          if (!match) match = (sRes.results || []).sort((a,b)=>b.popularity-a.popularity)[0];
          if (match) {
            if (seen[match.id]) return; // dedupe
            seen[match.id] = true;
            entry.title = match.title;
            entry.year = match.release_date ? match.release_date.substring(0,4) : (g.year || "");
            entry.poster = match.poster_path ? "https://image.tmdb.org/t/p/w185" + match.poster_path : "";
            entry.lang = match.original_language;
          }
        } catch (verr) { /* keep the Gemini entry without a poster */ }
        verified.push(entry);
      });

      if (verified.length > 0) {
        const verifiedJson = JSON.stringify(verified);
        if (cacheRow) {
          sheet.getRange(cacheRow, SIMILAR_CACHE_COL).setValue(verifiedJson);
          sheet.getRange(cacheRow, SIMILAR_CACHE_DATE_COL).setValue(new Date());
        }
        return ContentService.createTextOutput(verifiedJson).setMimeType(ContentService.MimeType.JSON);
      }

      // STEP 3: Fallback to TMDB recommendations if Gemini gave nothing usable
      const sUrl = "https://api.themoviedb.org/3/search/movie?api_key=" +
        TMDB_API_KEY + "&include_adult=false&query=" + encodeURIComponent(t);
      const sRes = JSON.parse(UrlFetchApp.fetch(sUrl).getContentText());
      let base = null;
      if (yr) base = (sRes.results || []).filter(m => m.release_date && m.release_date.substring(0,4) === yr)[0];
      if (!base) base = (sRes.results || []).sort((a,b)=>b.popularity-a.popularity)[0];
      if (!base) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);

      const indianLangs = ["ta","hi","te","ml","kn","bn","mr","pa"];
      let pool = [];
      try {
        const recRes = JSON.parse(UrlFetchApp.fetch("https://api.themoviedb.org/3/movie/" + base.id + "/recommendations?api_key=" + TMDB_API_KEY).getContentText());
        pool = pool.concat(recRes.results || []);
      } catch (e1) {}
      try {
        const simRes = JSON.parse(UrlFetchApp.fetch("https://api.themoviedb.org/3/movie/" + base.id + "/similar?api_key=" + TMDB_API_KEY).getContentText());
        pool = pool.concat(simRes.results || []);
      } catch (e2) {}

      const seen2 = {};
      const recs = pool
        .filter(m => indianLangs.includes(m.original_language) && m.id !== base.id)
        .filter(m => { if (seen2[m.id]) return false; seen2[m.id] = true; return true; })
        .sort((a,b) => b.popularity - a.popularity)
        .slice(0, 8)
        .map(m => ({
          title: m.title,
          year: m.release_date ? m.release_date.substring(0,4) : "",
          poster: m.poster_path ? "https://image.tmdb.org/t/p/w185" + m.poster_path : "",
          lang: m.original_language
        }));
      const recsJson = JSON.stringify(recs);
      if (cacheRow) {
        sheet.getRange(cacheRow, SIMILAR_CACHE_COL).setValue(recsJson);
        sheet.getRange(cacheRow, SIMILAR_CACHE_DATE_COL).setValue(new Date());
      }
      return ContentService.createTextOutput(recsJson).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Health check
  Logger.log("DOGET HIT");
  return ContentService.createTextOutput("WEB APP WORKS");
}


// =============================================
// AUTO-ADD NEW INDIAN RELEASES (weekly)
// Discovers recent Indian-language films from TMDB,
// scores them, and keeps only those scoring 65+.
// Set up a weekly time-based trigger on this function.
// =============================================
function autoAddNewReleases() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("BULK_RUNNING", "true");
  try {
    autoAddNewReleasesCore();
  } finally {
    props.deleteProperty("BULK_RUNNING");
  }
}

function autoAddNewReleasesCore() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const indianLangs = ["ta", "hi", "te", "ml", "kn"];
  const SCORE_THRESHOLD = 50;

  // Date window: movies released in the last 14 days (sized for an every-3-days run,
  // with buffer so nothing slips through between runs).
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 14);
  const fmt = d => d.toISOString().substring(0, 10);
  const dateFrom = fmt(past);
  const dateTo = fmt(today);

  // Existing titles (lowercased) to avoid duplicates
  const existing = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
    .getValues().map(r => String(r[0]).trim().toLowerCase());
  // BUG FIX: title-only matching missed a movie already in the sheet if
  // TMDB's returned title for it changed slightly since it was added (e.g.
  // a subtitle added closer to release) — this function's own discover
  // call would then see it as a "new" candidate under the new title string
  // and add a second row, fully reviewed and scored independently from the
  // first (see removeDuplicateMovies for the exact case this caused).
  // TMDB ID (col 35) is stable regardless of title text, so check that too.
  const existingIds = sheet.getRange(2, 35, Math.max(sheet.getLastRow() - 1, 1), 1)
    .getValues().map(r => String(r[0]).trim()).filter(id => /^\d+$/.test(id));

  // REJECTED-TITLE MEMORY: without this, a movie that scored below 65 gets
  // its row deleted with no trace, so the NEXT run re-discovers and
  // re-evaluates the SAME rejected movie again — wasting quota and never
  // reaching other, unscreened candidates further down the list. Remember
  // rejections for 20 days (a bit longer than the 14-day discovery window)
  // so repeat runs make real progress instead of re-checking known rejects.
  const props = PropertiesService.getScriptProperties();
  const REJECT_TTL_DAYS = 20;
  let rejectedCache = {};
  try {
    rejectedCache = JSON.parse(props.getProperty("AUTOADD_REJECTED") || "{}");
  } catch (e) { rejectedCache = {}; }
  const cutoff = Date.now() - REJECT_TTL_DAYS * 24 * 60 * 60 * 1000;
  Object.keys(rejectedCache).forEach(k => {
    if (rejectedCache[k] < cutoff) delete rejectedCache[k]; // prune old entries
  });
  const recentlyRejected = Object.keys(rejectedCache);

  // Gather candidate movies from TMDB Discover, one request per Indian language
  let candidates = [];
  indianLangs.forEach(lang => {
    try {
      // No vote_count filter — brand-new Indian releases rarely accumulate
      // 5+ TMDB votes within their first two weeks, so that filter was
      // excluding nearly everything. Quality control happens downstream:
      // a candidate only gets kept if Gemini scores it 65+ AND confirms
      // the correct language, so low-quality/junk entries get filtered
      // there instead, after we actually have real data on them.
      // without_genres=99 excludes TMDB's Documentary genre — stand-up
      // comedy specials are almost always tagged under it too (TMDB has no
      // separate "stand-up" category), so this is the one filter worth
      // applying at discovery time rather than leaving to Gemini's
      // downstream scoring: a documentary/special isn't a quality problem,
      // it's the wrong TYPE of content for a narrative-film site entirely,
      // and there's no reason to burn a full review on one.
      const url = "https://api.themoviedb.org/3/discover/movie?api_key=" + TMDB_API_KEY +
        "&include_adult=false&with_original_language=" + lang +
        "&without_genres=99" +
        "&primary_release_date.gte=" + dateFrom +
        "&primary_release_date.lte=" + dateTo +
        "&sort_by=popularity.desc";
      const res = JSON.parse(UrlFetchApp.fetch(url).getContentText());
      (res.results || []).forEach(m => {
        candidates.push({
          id: m.id,
          title: m.title,
          year: m.release_date ? m.release_date.substring(0, 4) : "",
          popularity: m.popularity,
          lang: lang
        });
      });
    } catch (err) {
      Logger.log("Discover failed for " + lang + ": " + err);
    }
  });

  // Sort by popularity, dedupe by title, drop ones already in the sheet
  candidates.sort((a, b) => b.popularity - a.popularity);
  const seen = {};
  candidates = candidates.filter(c => {
    const key = c.title.toLowerCase().trim();
    const idKey = String(c.id);
    if (seen[key] || seen["id:" + idKey]) return false;
    seen[key] = true;
    seen["id:" + idKey] = true;
    if (existing.indexOf(key) !== -1) return false;
    if (existingIds.indexOf(idKey) !== -1) return false; // same film, title text just changed since it was added
    if (recentlyRejected.indexOf(key) !== -1) return false;
    return true;
  });

  // MAX_PER_RUN is a soft cap; the REAL safety net is the time check below.
  // A hard Apps Script execution kill (6-min limit) is NOT a catchable JS
  // exception — try/catch cannot clean up after it. The only way to avoid
  // an orphaned half-filled row is to stop BEFORE starting a new candidate
  // whenever we're getting close to the limit, so nothing is ever mid-write
  // when the platform forcibly terminates the script.
  const MAX_PER_RUN = 10;
  candidates = candidates.slice(0, MAX_PER_RUN);

  const added = [];
  const skipped = [];
  const startTime = Date.now();
  const MAX_RUNTIME = 4.5 * 60 * 1000; // stop well before the 6-min hard limit
  let stoppedEarly = false;

  for (const c of candidates) {
    if (Date.now() - startTime > MAX_RUNTIME) {
      stoppedEarly = true;
      break; // do NOT start another candidate — leaves nothing half-written
    }
    let newRow = null;
    try {
      // Map language code to keyword so fillMovieData's re-search stays in-language
      // (prevents grabbing a same-titled foreign film).
      const langWord = { ta:"Tamil", hi:"Hindi", te:"Telugu", ml:"Malayalam", kn:"Kannada", bn:"Bengali", mr:"Marathi" }[c.lang] || "";
      const indianLangNames = ["tamil","hindi","telugu","malayalam","kannada","bengali","marathi"];

      newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 1).setValue(c.title + (langWord ? " " + langWord : "") + " " + c.year);
      SpreadsheetApp.flush();

      // Process the row (fetch TMDB details, OMDB, Gemini score)
      fillMovieData({ range: sheet.getRange(newRow, 1) });
      SpreadsheetApp.flush();
      Utilities.sleep(1000); // pace Gemini calls between candidates in this loop

      // Read the resulting score (column 10) and language (column 30).
      // Re-read the actual row in case fillMovieData shifted anything.
      SpreadsheetApp.flush();
      const score = Number(sheet.getRange(newRow, 10).getValue());
      const storedLang = String(sheet.getRange(newRow, 30).getValue()).toLowerCase();
      const finalTitle = sheet.getRange(newRow, 1).getValue();
      const langOk = storedLang === "" || indianLangNames.indexOf(storedLang) !== -1;

      // Keep ONLY if it genuinely meets the threshold AND is Indian.
      // A missing/zero score also fails (don't keep unscored rows).
      const keep = (score >= SCORE_THRESHOLD) && langOk && score > 0;
      Logger.log("Auto-add candidate '" + finalTitle + "' score=" + score + " lang=" + storedLang + " keep=" + keep);

      if (keep) {
        added.push(finalTitle + " (" + score + ")");
      } else {
        // Below threshold, wrong language, or unscored — remove the row,
        // and remember the rejection so future runs don't re-check it.
        sheet.deleteRow(newRow);
        SpreadsheetApp.flush();
        rejectedCache[c.title.toLowerCase().trim()] = Date.now();
        // Save IMMEDIATELY, not just once at the end — if this run later
        // gets cut off by Apps Script's 6-min hard kill, everything rejected
        // BEFORE that point is still safely recorded, not lost.
        try {
          props.setProperty("AUTOADD_REJECTED", JSON.stringify(rejectedCache));
        } catch (cacheErr) {
          Logger.log("Could not save rejected-title cache: " + cacheErr);
        }
        skipped.push(c.title + " (" + (score || "no score") + ")");
      }
    } catch (err) {
      Logger.log("Auto-add failed for " + c.title + ": " + err);
      // Do not leave a half-filled candidate row behind.
      if (newRow && newRow <= sheet.getLastRow()) {
        try { sheet.deleteRow(newRow); } catch (delErr) { Logger.log("Auto-add cleanup failed: " + delErr); }
      }
    }
  }

  // Email a summary — only when something was actually added (avoids daily noise)
  const email = "gauthamv77@gmail.com";
  if (added.length) {
    let body = "Masala Meter — Auto-Add Report\n\n";
    body += "Window: " + dateFrom + " to " + dateTo + "\n\n";
    body += "ADDED (scored " + SCORE_THRESHOLD + "+):\n" + added.map(a => "  ✓ " + a).join("\n") + "\n\n";
    if (skipped.length) {
      body += "Checked but skipped (below " + SCORE_THRESHOLD + "):\n" + skipped.map(s => "  ✗ " + s).join("\n") + "\n\n";
    }
    body += "Candidates this run: " + candidates.length + " (max " + MAX_PER_RUN + " per run).\n";
    try {
      MailApp.sendEmail(email, "Masala Meter — " + added.length + " new movie(s) added", body);
    } catch (err) {
      Logger.log("Email failed: " + err);
    }
  }

  // Persist the pruned + updated rejected-title cache for next run
  try {
    props.setProperty("AUTOADD_REJECTED", JSON.stringify(rejectedCache));
  } catch (e) {
    Logger.log("Could not save rejected-title cache: " + e);
  }

  SpreadsheetApp.getActive().toast(
    "Auto-add done: " + added.length + " added, " + skipped.length + " skipped." +
    (stoppedEarly ? " (Stopped early to stay under the time limit — run again to screen more.)" : "")
  );
}

// =============================================
// AUTO-ADD UPCOMING RELEASES (not out yet)
// Discovers Indian-language films with a CONFIRMED release date in the next
// 7 days and adds them with metadata only — title, year, director, genre,
// poster, ReleaseDate, TMDbID. No Gemini call: there's nothing to review
// yet for a film that hasn't released. The website shows these under its
// "Coming Soon" filter (any row with a future ReleaseDate).
//
// GauthamScore is deliberately left blank. refreshOneBlankMovie() already
// treats "title but no score" as unfinished, so once the film actually
// releases, running that (or a normal re-score) picks the row back up and
// completes it into a real review — at which point it naturally starts
// showing under "Now in Theaters" too, since that's purely ReleaseDate-based.
// =============================================
function autoAddUpcomingReleases() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("BULK_RUNNING", "true");
  try {
    autoAddUpcomingReleasesCore();
  } finally {
    props.deleteProperty("BULK_RUNNING");
  }
}

function autoAddUpcomingReleasesCore() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const indianLangs = ["ta", "hi", "te", "ml", "kn"];
  const WINDOW_DAYS = 7;

  const today = new Date();
  const future = new Date();
  future.setDate(today.getDate() + WINDOW_DAYS);
  const fmt = d => d.toISOString().substring(0, 10);
  const dateFrom = fmt(today);
  const dateTo = fmt(future);

  const existing = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
    .getValues().map(r => String(r[0]).trim().toLowerCase());
  // BUG FIX: title-only matching missed a movie already tracked if TMDB's
  // returned title for it changed since it was added (e.g. a subtitle
  // added closer to release) — see removeDuplicateMovies for the exact
  // case this caused. TMDB ID (col 35) is stable regardless of title text.
  const existingIds = sheet.getRange(2, 35, Math.max(sheet.getLastRow() - 1, 1), 1)
    .getValues().map(r => String(r[0]).trim()).filter(id => /^\d+$/.test(id));

  let candidates = [];
  indianLangs.forEach(lang => {
    try {
      // without_genres=99 excludes TMDB's Documentary genre — stand-up
      // comedy specials are almost always tagged under it too (TMDB has no
      // separate "stand-up" category), so this is the one filter worth
      // applying at discovery time rather than leaving to Gemini's
      // downstream scoring: a documentary/special isn't a quality problem,
      // it's the wrong TYPE of content for a narrative-film site entirely,
      // and there's no reason to burn a full review on one.
      const url = "https://api.themoviedb.org/3/discover/movie?api_key=" + TMDB_API_KEY +
        "&include_adult=false&with_original_language=" + lang +
        "&without_genres=99" +
        "&primary_release_date.gte=" + dateFrom +
        "&primary_release_date.lte=" + dateTo +
        "&sort_by=popularity.desc";
      const res = JSON.parse(UrlFetchApp.fetch(url).getContentText());
      (res.results || []).forEach(m => {
        candidates.push({ id: m.id, title: m.title, lang: lang });
      });
    } catch (err) {
      Logger.log("Upcoming discover failed for " + lang + ": " + err);
    }
  });

  const seen = {};
  candidates = candidates.filter(c => {
    const key = c.title.toLowerCase().trim();
    const idKey = String(c.id);
    if (seen[key] || seen["id:" + idKey]) return false;
    seen[key] = true;
    seen["id:" + idKey] = true;
    if (existing.indexOf(key) !== -1) return false; // already tracked (Coming Soon or otherwise)
    if (existingIds.indexOf(idKey) !== -1) return false;
    return true;
  });

  const MAX_PER_RUN = 15;
  candidates = candidates.slice(0, MAX_PER_RUN);

  const added = [];
  const startTime = Date.now();
  const MAX_RUNTIME = 4.5 * 60 * 1000; // stop well before the 6-min hard limit
  let stoppedEarly = false;

  // Same adult-content guard as fillMovieData — an upcoming title shouldn't
  // slip in unreviewed just because this path skips the usual full pipeline.
  const adultTitlePatterns = /\b(xxx|porn|erotic|erotica|adult film|hardcore|softcore|bhabhi\s*hot|uncut\s*adult|18\+|nsfw)\b/i;

  for (const c of candidates) {
    if (Date.now() - startTime > MAX_RUNTIME) {
      stoppedEarly = true;
      break; // don't start another candidate — leaves nothing half-written
    }
    try {
      const detailsUrl = "https://api.themoviedb.org/3/movie/" + c.id + "?api_key=" + TMDB_API_KEY;
      const details = JSON.parse(UrlFetchApp.fetch(detailsUrl).getContentText());

      if (details.adult === true ||
          adultTitlePatterns.test(String(details.title || "")) ||
          adultTitlePatterns.test(String(details.original_title || ""))) {
        continue;
      }

      const creditsUrl = "https://api.themoviedb.org/3/movie/" + c.id + "/credits?api_key=" + TMDB_API_KEY;
      const credits = JSON.parse(UrlFetchApp.fetch(creditsUrl).getContentText());
      const director = (credits.crew || []).find(p => p.job === "Director")?.name || "";
      const genre = (details.genres || []).map(g => g.name).join(", ");
      const posterUrl = details.poster_path ? "https://image.tmdb.org/t/p/w500" + details.poster_path : "";
      const releaseDate = details.release_date || "";
      const releaseYear = releaseDate ? releaseDate.substring(0, 4) : "";
      const officialTitle = details.title || c.title;

      const newRow = sheet.getLastRow() + 1;
      // Write everything in one pass — the BULK_RUNNING flag (set by the
      // wrapper above) keeps the onEdit trigger from also firing a full
      // fillMovieData pass on this same row while we do this lighter one.
      sheet.getRange(newRow, 1).setValue(officialTitle);
      sheet.getRange(newRow, 2).setValue(releaseYear);
      if (director) sheet.getRange(newRow, 3).setValue(director);
      if (genre) sheet.getRange(newRow, 4).setValue(genre);
      if (posterUrl) sheet.getRange(newRow, 5).setValue(posterUrl);
      sheet.getRange(newRow, 31).setValue(releaseDate); // ReleaseDate — drives "Coming Soon" on the site
      sheet.getRange(newRow, 35).setValue(c.id); // TMDbID, so the eventual fill/re-score uses the exact-ID fast path
      SpreadsheetApp.flush();

      added.push(officialTitle + " (" + releaseDate + ")");
    } catch (err) {
      Logger.log("Upcoming auto-add failed for " + c.title + ": " + err);
    }
  }

  SpreadsheetApp.getUi().alert(
    "Upcoming-releases sweep done.\n\n" +
    "Added " + added.length + " movie(s) releasing in the next " + WINDOW_DAYS + " days:\n" +
    (added.length ? added.map(a => "  " + a).join("\n") : "  (none)") +
    (stoppedEarly ? "\n\n(Stopped early to stay under the time limit — run again to screen more.)" : "") +
    "\n\nThese rows have no review yet — \"Fill next blank movie\" (or a re-score) will complete them once they've actually released."
  );
}

// =============================================
// AUTO-ADD: movies released in the last 5 months that HAVE NOW
// BECOME AVAILABLE ON STREAMING (regardless of when exactly they
// released, unlike autoAddNewReleasesCore's narrow 14-day window).
// Catches the case where a film released theatrically, wasn't caught
// by the 14-day scan, and only becomes streamable weeks/months later
// (e.g. a festival premiere that hits Prime/Netflix long after its
// theatrical run) — it would otherwise require a manual add forever.
//
// Two-stage design for efficiency: a 5-month window surfaces far more
// candidates than 14 days, so first do a CHEAP "is this streaming yet"
// check (1 TMDB call) before committing to the EXPENSIVE full add+score
// cycle (7-8 calls + Gemini). Candidates confirmed not-yet-streaming are
// cached for a few days so repeat runs don't keep re-checking them.
// =============================================
function autoAddNewlyStreaming() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("BULK_RUNNING", "true");
  try {
    autoAddNewlyStreamingCore();
  } finally {
    props.deleteProperty("BULK_RUNNING");
  }
}

function autoAddNewlyStreamingCore() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const indianLangs = ["ta", "hi", "te", "ml", "kn"];
  const SCORE_THRESHOLD = 50;
  const WINDOW_DAYS = 5 * 30;

  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - WINDOW_DAYS);
  const fmt = d => d.toISOString().substring(0, 10);
  const dateFrom = fmt(past);
  const dateTo = fmt(today);

  const existing = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
    .getValues().map(r => String(r[0]).trim().toLowerCase());
  // BUG FIX: title-only matching missed a movie already tracked if TMDB's
  // returned title for it changed since it was added (e.g. a subtitle
  // added closer to release) — see removeDuplicateMovies for the exact
  // case this caused. TMDB ID (col 35) is stable regardless of title text.
  const existingIds = sheet.getRange(2, 35, Math.max(sheet.getLastRow() - 1, 1), 1)
    .getValues().map(r => String(r[0]).trim()).filter(id => /^\d+$/.test(id));

  const props = PropertiesService.getScriptProperties();

  const REJECT_TTL_DAYS = 20;
  let rejectedCache = {};
  try { rejectedCache = JSON.parse(props.getProperty("AUTOADD_REJECTED") || "{}"); } catch (e) { rejectedCache = {}; }
  const rejectCutoff = Date.now() - REJECT_TTL_DAYS * 24 * 60 * 60 * 1000;
  Object.keys(rejectedCache).forEach(k => { if (rejectedCache[k] < rejectCutoff) delete rejectedCache[k]; });

  const NOT_STREAMING_TTL_DAYS = 5;
  let notStreamingCache = {};
  try { notStreamingCache = JSON.parse(props.getProperty("AUTOADD_NOT_STREAMING_YET") || "{}"); } catch (e) { notStreamingCache = {}; }
  const nsCutoff = Date.now() - NOT_STREAMING_TTL_DAYS * 24 * 60 * 60 * 1000;
  Object.keys(notStreamingCache).forEach(k => { if (notStreamingCache[k] < nsCutoff) delete notStreamingCache[k]; });

  let candidates = [];
  indianLangs.forEach(lang => {
    try {
      // without_genres=99 excludes TMDB's Documentary genre — stand-up
      // comedy specials are almost always tagged under it too (TMDB has no
      // separate "stand-up" category), so this is the one filter worth
      // applying at discovery time rather than leaving to Gemini's
      // downstream scoring: a documentary/special isn't a quality problem,
      // it's the wrong TYPE of content for a narrative-film site entirely,
      // and there's no reason to burn a full review on one.
      const url = "https://api.themoviedb.org/3/discover/movie?api_key=" + TMDB_API_KEY +
        "&include_adult=false&with_original_language=" + lang +
        "&without_genres=99" +
        "&primary_release_date.gte=" + dateFrom +
        "&primary_release_date.lte=" + dateTo +
        "&sort_by=popularity.desc";
      const res = JSON.parse(UrlFetchApp.fetch(url).getContentText());
      (res.results || []).forEach(m => {
        candidates.push({ id: m.id, title: m.title, year: m.release_date ? m.release_date.substring(0, 4) : "", popularity: m.popularity, lang: lang });
      });
    } catch (err) {
      Logger.log("Discover failed for " + lang + ": " + err);
    }
  });

  candidates.sort((a, b) => b.popularity - a.popularity);
  const seen = {};
  // Diagnostic counters — surfaced in the summary alert below so it's
  // possible to tell "nothing new to find" apart from "found candidates
  // but they're all pre-filtered for a specific reason" without having to
  // dig through the execution log.
  let skippedAlreadyTracked = 0;
  let skippedRejected = 0;
  let skippedRecentlyCheckedNotStreaming = 0;
  const totalDiscovered = candidates.length;
  candidates = candidates.filter(c => {
    const key = c.title.toLowerCase().trim();
    const idKey = String(c.id);
    if (seen[key] || seen["id:" + idKey]) return false; // duplicate within this run's own TMDB results
    seen[key] = true;
    seen["id:" + idKey] = true;
    if (existing.indexOf(key) !== -1 || existingIds.indexOf(idKey) !== -1) { skippedAlreadyTracked++; return false; }
    if (rejectedCache[key]) { skippedRejected++; return false; }
    if (notStreamingCache[key]) { skippedRecentlyCheckedNotStreaming++; return false; }
    return true;
  });

  const startTime = Date.now();
  const MAX_RUNTIME = 4.5 * 60 * 1000;
  // Lower than before (was 40) — each check can now also involve a Gemini
  // call when TMDB finds nothing, which takes several seconds instead of
  // under 1. Fewer checks per run, but each one is more accurate.
  const MAX_STREAMING_CHECKS = 15;
  const MAX_ADDS_PER_RUN = 10;
  let stoppedEarly = false;
  let streamingChecked = 0;
  const added = [];
  const skipped = [];
  const stillWaiting = [];

  for (const c of candidates) {
    if (Date.now() - startTime > MAX_RUNTIME) { stoppedEarly = true; break; }
    if (streamingChecked >= MAX_STREAMING_CHECKS) break;
    if (added.length >= MAX_ADDS_PER_RUN) break;

    streamingChecked++;
    const key = c.title.toLowerCase().trim();

    let isStreaming = false;
    try {
      const provUrl = "https://api.themoviedb.org/3/movie/" + c.id + "/watch/providers?api_key=" + TMDB_API_KEY;
      const provData = JSON.parse(UrlFetchApp.fetch(provUrl).getContentText());
      if (provData.results && provData.results.US) {
        const us = provData.results.US;
        isStreaming = !!((us.flatrate && us.flatrate.length) || (us.free && us.free.length) ||
          (us.ads && us.ads.length) || (us.rent && us.rent.length) || (us.buy && us.buy.length));
      }
    } catch (provErr) {
      Logger.log("Provider check failed for " + c.title + ": " + provErr);
    }

    // For a brand-new candidate, there's no "previously had data" to compare
    // against like refreshStreamingStatus has — every candidate starts from
    // zero, so we can't cheaply tell "genuinely not streaming yet" apart
    // from "TMDB just hasn't synced." Ask Gemini's lightweight check as a
    // second opinion whenever TMDB alone comes back empty.
    if (!isStreaming) {
      const langNameForCheck = { ta:"Tamil", hi:"Hindi", te:"Telugu", ml:"Malayalam", kn:"Kannada", bn:"Bengali", mr:"Marathi" }[c.lang] || "";
      const confirmed = checkStreamingViaGemini_(c.title, c.year, langNameForCheck);
      Utilities.sleep(1000); // pace Gemini calls — a tight loop of these was the likely cause of the July 2 rate-limit burst
      if (confirmed) isStreaming = true;
    }

    if (!isStreaming) {
      notStreamingCache[key] = Date.now();
      stillWaiting.push(c.title);
      continue;
    }

    let newRow = null;
    try {
      const langWord = { ta:"Tamil", hi:"Hindi", te:"Telugu", ml:"Malayalam", kn:"Kannada", bn:"Bengali", mr:"Marathi" }[c.lang] || "";
      const indianLangNames = ["tamil","hindi","telugu","malayalam","kannada","bengali","marathi"];

      newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 1).setValue(c.title + (langWord ? " " + langWord : "") + " " + c.year);
      SpreadsheetApp.flush();

      fillMovieData({ range: sheet.getRange(newRow, 1) });
      SpreadsheetApp.flush();
      Utilities.sleep(1000); // pace Gemini calls between candidates in this loop

      const score = Number(sheet.getRange(newRow, 10).getValue());
      const storedLang = String(sheet.getRange(newRow, 30).getValue()).toLowerCase();
      const finalTitle = sheet.getRange(newRow, 1).getValue();
      const langOk = storedLang === "" || indianLangNames.indexOf(storedLang) !== -1;
      const keep = (score >= SCORE_THRESHOLD) && langOk && score > 0;

      if (keep) {
        added.push(finalTitle + " (" + score + ")");
      } else {
        sheet.deleteRow(newRow);
        SpreadsheetApp.flush();
        rejectedCache[key] = Date.now();
        try { props.setProperty("AUTOADD_REJECTED", JSON.stringify(rejectedCache)); } catch (e) {}
        skipped.push(c.title + " (" + (score || "no score") + ")");
      }
    } catch (err) {
      Logger.log("Auto-add (newly streaming) failed for " + c.title + ": " + err);
      if (newRow && newRow <= sheet.getLastRow()) {
        try { sheet.deleteRow(newRow); } catch (delErr) {}
      }
    }
  }

  try { props.setProperty("AUTOADD_NOT_STREAMING_YET", JSON.stringify(notStreamingCache)); } catch (e) {}

  SpreadsheetApp.getUi().alert(
    "Newly-streaming sweep done.\n\n" +
    "Discovered " + totalDiscovered + " Indian release(s) from the last 5 months.\n" +
    "  Already in your sheet: " + skippedAlreadyTracked + "\n" +
    "  Rejected in a past run (low score/wrong language, 20-day memory): " + skippedRejected + "\n" +
    "  Checked recently, not streaming yet (5-day memory): " + skippedRecentlyCheckedNotStreaming + "\n" +
    "  Actually checked this run: " + streamingChecked + "\n\n" +
    "Added: " + added.length + (added.length ? "\n  " + added.join("\n  ") : "") + "\n\n" +
    "Not yet streaming (will re-check in a few days): " + stillWaiting.length +
    (skipped.length ? "\n\nSkipped (scored below " + SCORE_THRESHOLD + "): " + skipped.length : "") +
    (stoppedEarly ? "\n\n(Stopped early to stay under the time limit — run again to screen more.)" : "")
  );
}


// =============================================
// GEMINI: "If you liked this, you may also like..."
// Returns similar Indian films with reasons.
// Priority: balanced (theme + quality + language),
// same language first then other Indian languages.
// =============================================
// Lightweight, DEDICATED Gemini check — much smaller/cheaper than the full
// scoring prompt (getGeminiMovieReview) since this only needs a yes/no plus
// platform name, not a full review. Used by refreshStreamingStatus ONLY as
// a confirmation step right before it's about to conclude a movie left
// streaming — TMDB's own data can lag, and this catches the case where
// TMDB briefly reports nothing but the movie genuinely never left.
function checkStreamingViaGemini_(title, year, filmLanguage) {
  const prompt = `Using Google Search, check whether the ${filmLanguage || "Indian"} film "${title}" (${year}) is CURRENTLY available to stream in the US right now. Look for real news articles or official platform announcements, not speculation.

SEARCH STRATEGY — try several angles, not just one query, before giving up:
1. "${title}" ${year} streaming US
2. "${title}" Netflix OR Hulu OR "Prime Video" OR "Disney+" OR Max release
3. "${title}" JustWatch (JustWatch aggregates real US availability, useful even without their API)
4. "${title}" OTT release date US

IMPORTANT: JioHotstar (formerly Hotstar/Disney+ Hotstar) is confirmed geo-blocked outside India entirely — finding news that a film streams there almost always means India availability, NOT the US. Do not report it as a US confirmation. Also beware Amazon Prime Video specifically — it has SEPARATE regional catalogs, so "on Prime Video" in a general source often means Prime Video India, not the US. Only confirm a platform if the source is clearly US-specific. Require at least two credible sources to agree (e.g. JustWatch, Reelgood, or the platform's own US site) — a single vague mention isn't enough; return "N/A" if you can't cross-verify.
Return ONLY the platform name if you can confirm it (e.g. "Netflix"), or exactly "N/A" if you cannot confirm current US streaming availability. Return ONLY that single word or phrase, nothing else — no explanation, no punctuation.`;

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1 }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const bodyText = response.getContentText();
    if (code !== 200) return ""; // any error — treat as "couldn't confirm," don't block
    const data = JSON.parse(bodyText);
    if (!data.candidates || !data.candidates[0]) return "";
    const cand = data.candidates[0];
    if (!cand.content || !cand.content.parts || !cand.content.parts[0]) return ""; // empty/filtered response — treat as "couldn't confirm"
    const text = (data.candidates[0].content.parts[0].text || "").trim();
    if (!text || /^n\/a$/i.test(text)) return "";
    const cleaned = stripCitationMarkers_(text).replace(/["'.]/g, "").trim();
    // Same hard blocklist as the main streamingLive field — JioHotstar is
    // verified India-only, not trusted as a genuine US confirmation even
    // when Gemini names it.
    if (/jiohotstar|^hotstar$|disney\+? ?hotstar/i.test(cleaned)) {
      Logger.log("checkStreamingViaGemini_ rejected '" + cleaned + "' for '" + title + "' — confirmed India-only platform.");
      return "";
    }
    return cleaned;
  } catch (err) {
    Logger.log("checkStreamingViaGemini_ failed for " + title + ": " + err);
    return "";
  }
}

// =============================================
// GEMINI: US theatrical release confirmation
// Gates the site's "Now in Theaters" badge / "Likely in Theaters" showtimes
// link. TMDB's release_date is just wherever a film released FIRST — for
// Indian films that's almost always India, not the US — and TMDB's
// per-country release_dates data is too sparse for Tamil/Telugu/etc. films
// to trust (niche US distributors like Ayngaran, Pen Marudhar, AGS Cinemas,
// and Sathya Jyothi Films rarely report to TMDB at all). A plain
// "released recently" check would therefore falsely claim a US theatrical
// run for films that never got one. This does a live search instead.
// =============================================
function checkUSTheatricalRelease_(title, year, filmLanguage) {
  const prompt = `Using Google Search, check whether the ${filmLanguage || "Indian"} film "${title}" (${year}) is CURRENTLY playing in US theaters right now (wide or limited release, including specialty Indian-cinema distributors).

SEARCH STRATEGY — try several angles, not just one query:
1. "${title}" ${year} US theaters release
2. "${title}" Fandango OR AMC OR Cinemark OR Regal
3. "${title}" Ayngaran OR "Pen Marudhar" OR "AGS Cinemas" OR "Sathya Jyothi Films" showtimes USA
4. "${title}" USA theatrical release date

IMPORTANT: only confirm YES if you find a real ticketing site (Fandango, AMC, Cinemark, Regal, Atom Tickets) or a specialty Indian-cinema US distributor explicitly listing THIS film with US showtimes right now. A film releasing in India, the UK, or elsewhere does NOT count on its own — it must be confirmed for US theaters specifically. If you can't confirm it, say NO rather than guessing.

Return ONLY the single word "YES" or "NO" — nothing else, no explanation, no punctuation.`;

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1 }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const bodyText = response.getContentText();
    if (code !== 200) return false; // any error — treat as "couldn't confirm"
    const data = JSON.parse(bodyText);
    if (!data.candidates || !data.candidates[0]) return false;
    const cand = data.candidates[0];
    if (!cand.content || !cand.content.parts || !cand.content.parts[0]) return false;
    const text = stripCitationMarkers_(cand.content.parts[0].text || "").trim();
    return /^yes$/i.test(text);
  } catch (err) {
    Logger.log("checkUSTheatricalRelease_ failed for " + title + ": " + err);
    return false;
  }
}

function getGeminiSimilarMovies(title, year, lang, director, genre) {
  const langNames = { ta: "Tamil", hi: "Hindi", te: "Telugu", ml: "Malayalam", kn: "Kannada", bn: "Bengali", mr: "Marathi", pa: "Punjabi" };
  const langName = langNames[lang] || lang || "";

  const context = [
    "Title: " + title,
    year ? "Year: " + year : "",
    langName ? "Language: " + langName : "",
    director ? "Director: " + director : "",
    genre ? "Genre: " + genre : ""
  ].filter(Boolean).join("\n");

  const prompt = `You are an expert on Indian cinema giving "if you liked this, you may also like" recommendations.

THE FILM IN QUESTION:
${context}

TASK: Recommend 8 OTHER Indian films that a fan of the above film would genuinely enjoy.

HOW TO CHOOSE (balanced judgment, in this spirit):
- Match the FEEL and THEMES of the film (e.g. a smart cat-and-mouse thriller, a heartfelt family drama, a coming-of-age story, a mass action entertainer). The recommendations should give a similar viewing experience, not just share a genre tag.
- Match the QUALITY BAR. If the film is acclaimed, suggest other well-made films, not random same-genre movies.
- Consider director sensibility, tone, narrative style, and era where relevant.

LANGUAGE PRIORITY:
- Prefer films in the SAME language (${langName || "the film's language"}) FIRST — aim for about half the list.
- Then include strong picks from OTHER Indian languages (cross-language gems a fan would love).

STRICT RULES:
- Only REAL, released Indian films. No web series, no fakes, no upcoming/unreleased titles.
- Do NOT include the film itself, or its own sequels/prequels/remakes.
- Each recommendation must be a film a fan of the original would actually enjoy — choose with care, not just surface genre.
- Prefer reasonably well-known films that exist on TMDB.

Return ONLY a JSON array, no markdown, no preamble, in this exact format:
[
  { "title": "Movie Name", "year": "YYYY", "reason": "one short phrase why it's similar" }
]`;

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4 }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const bodyText = response.getContentText();
    // If Gemini is unavailable due to quota/credit, signal it so the caller can
    // show an honest "temporarily unavailable" message instead of "none found".
    // Only scan bodyText for these keywords on an actual error code (>=400) —
    // a successful response's own generated text can innocently contain
    // trigger words and cause a false positive if scanned unconditionally.
    if (code === 429 || code === 402 || code === 403) {
      throw new Error("GEMINI_QUOTA");
    }
    if (code >= 400 && /billing|quota|exceeded|balance|credit|RESOURCE_EXHAUSTED|insufficient/i.test(bodyText)) {
      throw new Error("GEMINI_QUOTA");
    }
    const data = JSON.parse(bodyText);
    if (!data.candidates || !data.candidates[0]) return [];
    const cand = data.candidates[0];
    if (!cand.content || !cand.content.parts || !cand.content.parts[0]) return []; // empty/filtered response
    const text = data.candidates[0].content.parts[0].text;
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return parseGeminiJsonArray_(cleanText);
  } catch (err) {
    Logger.log("Gemini similar failed: " + err);
    if (String(err).indexOf("GEMINI_QUOTA") !== -1) throw err; // bubble up credit issue
    return [];
  }
}


// =============================================
// BACKFILL RELEASE DATES (fast)
// Fills column 31 (ReleaseDate, YYYY-MM-DD) for existing movies
// by looking up each title on TMDB. Skips Gemini scoring, so it's quick.
// Processes in batches to avoid the 6-minute timeout — run again to continue.
// =============================================
function backfillReleaseDates() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 5 * 60 * 1000; // 5 min safety
  let processed = 0;
  let filled = 0;

  for (let row = 2; row <= lastRow; row++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      SpreadsheetApp.getActive().toast("Backfilled " + filled + " dates. Run again to continue.");
      return;
    }

    const existing = sheet.getRange(row, 31).getValue();
    if (existing && /^\d{4}-\d{2}-\d{2}/.test(String(existing))) continue; // already has a full date

    const title = String(sheet.getRange(row, 1).getValue()).trim();
    const year = String(sheet.getRange(row, 2).getValue()).trim();
    if (!title) continue;

    processed++;
    try {
      // Strip any trailing year from the title for a clean search
      const cleanTitle = title.replace(/\s+(19|20)\d{2}$/, "").trim();
      let url = "https://api.themoviedb.org/3/search/movie?api_key=" + TMDB_API_KEY +
        "&include_adult=false&query=" + encodeURIComponent(cleanTitle);
      if (year) url += "&primary_release_year=" + encodeURIComponent(year);

      const res = JSON.parse(UrlFetchApp.fetch(url).getContentText());
      const results = res.results || [];
      if (!results.length) continue;

      // Prefer exact title + matching year, else most popular
      const queryLower = cleanTitle.toLowerCase();
      let match = results.find(m => (m.title||"").toLowerCase() === queryLower &&
        m.release_date && m.release_date.substring(0,4) === year);
      if (!match) match = results.filter(m => m.release_date && m.release_date.substring(0,4) === year)
        .sort((a,b)=>b.popularity-a.popularity)[0];
      if (!match) match = results.sort((a,b)=>b.popularity-a.popularity)[0];

      if (match && match.release_date) {
        sheet.getRange(row, 31).setValue(match.release_date);
        filled++;
      }
    } catch (err) {
      Logger.log("Backfill failed for " + title + ": " + err);
    }

    Utilities.sleep(120); // gentle on the API
  }

  SpreadsheetApp.getActive().toast("Backfill complete: " + filled + " release dates filled.");
}




// =============================================
// SAFETY: clear a stuck BULK_RUNNING flag
// If a bulk job was force-stopped (hard stop) the flag might stay set,
// which would keep the onEdit trigger disabled. Run this to clear it.
// =============================================
function clearBulkRunningFlag() {
  PropertiesService.getScriptProperties().deleteProperty("BULK_RUNNING");
  SpreadsheetApp.getActive().toast("BULK_RUNNING flag cleared. Normal auto-fill restored.");
}


// =============================================
// TIDY ALL ROWS — clip text + set every data row to 21px
// One-time cleanup for rows added before auto-tidy existed.
// =============================================
function tidyAllRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { SpreadsheetApp.getActive().toast("No data rows to tidy."); return; }

  // Clip all data cells so long text never expands rows
  sheet.getRange(2, 1, lastRow - 1, 34).setWrap(false);

  // Set every data row to a uniform 21px height
  for (let row = 2; row <= lastRow; row++) {
    sheet.setRowHeight(row, 21);
  }
  SpreadsheetApp.getActive().toast("Tidied " + (lastRow - 1) + " rows to 21px height.");
}


// =============================================
// REFRESH STREAMING STATUS — change detection for "New on Streaming"
// Re-checks existing movies' US streaming availability. When a film that had
// NO streaming gains a provider, stamps col 32 (StreamingSince) with today.
// Designed to run on a weekly trigger. Batched to respect the 6-min limit.
// =============================================
function refreshStreamingStatus() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const props = PropertiesService.getScriptProperties();
  let startRow = parseInt(props.getProperty("STREAM_REFRESH_ROW") || "2", 10);
  if (startRow > lastRow) startRow = 2; // wrap around

  const startTime = Date.now();
  const CUTOFF_MS = 5 * 60 * 1000; // stop before the 6-min Apps Script limit
  let row = startRow;
  let checked = 0, newlyAdded = 0;

  for (; row <= lastRow; row++) {
    if (Date.now() - startTime > CUTOFF_MS) break;

    const title = sheet.getRange(row, 1).getValue();
    if (!title) continue;

    // Use stored TMDB ID when available; otherwise fall back to title search.
    try {
      let tmdbId = String(sheet.getRange(row, 35).getValue()).trim();
      if (!/^\d+$/.test(tmdbId)) {
        const searchUrl = "https://api.themoviedb.org/3/search/movie?api_key=" +
          TMDB_API_KEY + "&include_adult=false&query=" + encodeURIComponent(String(title));
        const sRes = JSON.parse(UrlFetchApp.fetch(searchUrl).getContentText());
        const hit = (sRes.results || [])[0];
        if (!hit) continue;
        tmdbId = String(hit.id);
      }

      const provUrl = "https://api.themoviedb.org/3/movie/" + tmdbId +
        "/watch/providers?api_key=" + TMDB_API_KEY;
      const provData = JSON.parse(UrlFetchApp.fetch(provUrl).getContentText());

      // BUG FIX: this was only checking flatrate/free/ads, silently missing
      // rent/buy-only availability (e.g. Amazon Video, Google Play, YouTube
      // rentals) — a common case for newer titles not yet on a subscription
      // service. fillMovieData already checks all five categories; this
      // function's separate copy of the same logic didn't match, which is
      // exactly why a manual re-score could find streaming info that this
      // refresh function then failed to detect on its own.
      // streamType tracked the same way as fillMovieData's own provider
      // detection (ads folds into "free") so the OTTInfo label below reads
      // identically regardless of which code path found it.
      let streaming = "";
      let streamType = "";
      if (provData.results && provData.results.US) {
        const us = provData.results.US;
        if (us.flatrate && us.flatrate.length) { streaming = us.flatrate.map(p => p.provider_name).join(", "); streamType = "stream"; }
        else if (us.free && us.free.length) { streaming = us.free.map(p => p.provider_name).join(", "); streamType = "free"; }
        else if (us.ads && us.ads.length) { streaming = us.ads.map(p => p.provider_name).join(", "); streamType = "free"; }
        else if (us.rent && us.rent.length) { streaming = us.rent.map(p => p.provider_name).join(", "); streamType = "rent"; }
        else if (us.buy && us.buy.length) { streaming = us.buy.map(p => p.provider_name).join(", "); streamType = "buy"; }
      }

      // GAP FIX: this function only ever checked US availability — UK
      // (col 41, StreamingUK) was set once by fillMovieData at add-time and
      // then NEVER rechecked by this periodic refresh, so it went stale
      // forever even as US availability kept getting updated on every run.
      // Same watch/providers response already covers GB, no extra API call.
      let streamingUK = "";
      if (provData.results && provData.results.GB) {
        const gb = provData.results.GB;
        if (gb.flatrate && gb.flatrate.length) streamingUK = gb.flatrate.map(p => p.provider_name).join(", ");
        else if (gb.free && gb.free.length) streamingUK = gb.free.map(p => p.provider_name).join(", ");
        else if (gb.ads && gb.ads.length) streamingUK = gb.ads.map(p => p.provider_name).join(", ");
        else if (gb.rent && gb.rent.length) streamingUK = gb.rent.map(p => p.provider_name).join(", ");
        else if (gb.buy && gb.buy.length) streamingUK = gb.buy.map(p => p.provider_name).join(", ");
      }
      const existingStreamingUK = sheet.getRange(row, 41).getValue();
      if (streamingUK || !existingStreamingUK) {
        sheet.getRange(row, 41).setValue(streamingUK);
      }

      const prevStreaming = sheet.getRange(row, 15).getValue();
      const sinceCell = sheet.getRange(row, 32);
      const prevSince = sinceCell.getValue();

      // Before concluding "this movie left streaming" (TMDB found nothing,
      // but we previously had data), ask Gemini's lightweight live-search
      // check as a second opinion. TMDB's provider data (via JustWatch) can
      // lag several days behind real releases — this catches the case where
      // a re-score already confirmed via Gemini that it's still streaming,
      // but TMDB still hasn't synced, which would otherwise cause this
      // function to incorrectly clear data that fillMovieData just set.
      // Only triggered for this specific edge case, not every row, so it
      // doesn't meaningfully slow down the normal sweep.
      if (!streaming && prevStreaming) {
        const yr = sheet.getRange(row, 2).getValue();
        const lg = sheet.getRange(row, 30).getValue();
        const confirmed = checkStreamingViaGemini_(String(title), String(yr), String(lg));
        Utilities.sleep(1000); // pace Gemini calls between rows in this loop
        if (confirmed) {
          streaming = confirmed; // treat as if TMDB had found it — same downstream logic applies
        }
      }

      // Same protection as fillMovieData: only overwrite if we actually
      // found something this time. A transient TMDB/JustWatch data gap
      // shouldn't wipe out previously-confirmed streaming info. This DOES
      // still allow genuine removals to clear the stamp below — that's
      // this function's actual job — just not from a single empty check
      // that might just be a momentary data hiccup rather than a real exit.
      if (streaming || !prevStreaming) {
        sheet.getRange(row, 15).setValue(streaming);
      }

      // BUG FIX: this function was updating the raw Streaming column (15)
      // above but never touching OTTInfo (col 16) — the human-readable
      // label ("Stream on Netflix (US)") that card ribbons and the "Where
      // to Watch" panel actually display with priority over column 15. A
      // platform change (e.g. Netflix -> Amazon) or a genuine removal
      // would update column 15 correctly but leave the visible label
      // frozen at whatever fillMovieData originally wrote, months earlier
      // — this was the actual cause of "streaming info doesn't update."
      // Same protect-existing condition as column 15 just above, and the
      // same label format fillMovieData uses (typeLabel falls back to
      // "Available" for the Gemini-fallback case, where streamType is
      // still "" since only the TMDB branch above sets it).
      if (streaming) {
        const typeLabel = { stream: "Stream", free: "Free", rent: "Rent", buy: "Buy" }[streamType] || "Available";
        sheet.getRange(row, 16).setValue(typeLabel + " on " + streaming + " (US)");
      } else if (!prevStreaming) {
        sheet.getRange(row, 16).setValue("");
      }

      // Is this a recent release (within the last 5 months)? Only those
      // qualify as "new on streaming" — old catalog titles shouldn't be stamped.
      // Same bug fix as fillMovieData's copy of this check: also require the
      // release has actually happened, not just "not older than 5 months" —
      // otherwise a future-dated ReleaseDate can get stamped as streaming
      // today the moment TMDB/Gemini reports provider info early.
      const relRaw = sheet.getRange(row, 31).getValue(); // ReleaseDate
      const relTime = new Date(relRaw).getTime();
      const isRecent = !isNaN(relTime) && relTime <= Date.now() && relTime >= (Date.now() - 5 * 30 * 24 * 60 * 60 * 1000); // 5 months, matches the website's "New on Streaming" window

      // STAMP: if there's streaming right now, it's a recent release, and
      // the stamp itself is simply missing — set it. This does NOT require
      // *this specific run* to have witnessed the text go from blank to
      // filled — that stricter condition meant this function could never
      // fix a row where the streaming text was already filled (e.g. by a
      // manual re-score) but the stamp itself never got set. Matches
      // fillMovieData's own (already correct) stamping logic.
      if (streaming && !prevSince && isRecent) {
        sinceCell.setValue(new Date());
        newlyAdded++;
      }
      // NOTE: deliberately no "clear the stamp if !streaming" branch here
      // anymore. It used to clear col 32 whenever THIS run alone failed to
      // reconfirm streaming (!streaming && prevStreaming) — but that's the
      // exact same momentary TMDB/Gemini miss that col 15 right above
      // correctly shrugs off without touching the data (streaming || !prevStreaming
      // never overwrites a real value with empty). Treating one run's gap as
      // "confirmed removal" for the stamp while NOT treating it that way for
      // the streaming text itself was inconsistent, and wiped real
      // StreamingSince dates for movies that never actually left streaming
      // (e.g. Thaai Kizhavi: Apple TV/Hulu never left col 15, but this
      // branch cleared col 32 anyway on a single miss). A real removal
      // still isn't lost forever — re-running this refresh, or a manual
      // re-score, will simply never re-set a stamp that's already blank.

      // --- US theatrical re-check (col 43) ---
      // A film added right at release might not be listed on ticketing
      // sites yet when fillMovieData first checked. Give it more chances
      // on each later run of this sweep, but only while it's still a real
      // "Now in Theaters" candidate — recent, not yet confirmed, and not
      // yet streaming (once it's streaming the theatrical badge no longer
      // applies regardless, and once it's aged past 60 days the badge
      // could never show either way, so don't waste a Gemini call).
      const existingUsTheatrical = sheet.getRange(row, 43).getValue();
      const daysSinceRelease = isNaN(relTime) ? null : (Date.now() - relTime) / (24 * 60 * 60 * 1000);
      if (!existingUsTheatrical && !streaming && daysSinceRelease !== null && daysSinceRelease >= 0 && daysSinceRelease <= 60) {
        const yr2 = sheet.getRange(row, 2).getValue();
        const lg2 = sheet.getRange(row, 30).getValue();
        if (checkUSTheatricalRelease_(String(title), String(yr2), String(lg2))) {
          sheet.getRange(row, 43).setValue("Yes");
        }
        Utilities.sleep(1000); // pace Gemini calls between rows in this loop
      }

      checked++;
    } catch (err) {
      Logger.log("Refresh failed for '" + title + "' row " + row + ": " + err);
    }

    // Save progress after EVERY row, not just once when the loop exits
    // cleanly. Google's hard 6-min kill (see CUTOFF_MS above) can strike
    // between our own timing checks with no warning — without this, a run
    // that gets force-killed loses its resume position entirely and the
    // next click restarts from the same old spot, silently re-doing (or
    // worse, never actually covering) rows it already processed.
    props.setProperty("STREAM_REFRESH_ROW", (row + 1 > lastRow ? "2" : String(row + 1)));
  }

  SpreadsheetApp.getUi().alert(
    "Streaming refresh done.\n\n" +
    "This run covered rows " + startRow + " to " + (row - 1) + ".\n" +
    "Checked: " + checked + "\n" +
    "Newly on streaming: " + newlyAdded + "\n\n" +
    "Next run resumes at row " + (row > lastRow ? 2 : row) + " of " + lastRow + " total."
  );
}

// =============================================
// BACKFILL MISSING DIRECTORS (fast, no Gemini calls)
// Re-fetches ONLY the director for rows where column 3 is blank
// but a TMDB ID (col 35) is already stored. Cheap and safe to re-run.
// =============================================
function backfillMissingDirectors() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 5 * 60 * 1000;
  let filled = 0, checked = 0;

  for (let row = 2; row <= lastRow; row++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      SpreadsheetApp.getActive().toast("Backfilled " + filled + " directors. Run again to continue.");
      return;
    }

    const title = sheet.getRange(row, 1).getValue();
    const director = sheet.getRange(row, 3).getValue();
    const tmdbId = String(sheet.getRange(row, 35).getValue()).trim();

    if (!title || director || !/^\d+$/.test(tmdbId)) continue;

    checked++;
    try {
      const creditsUrl = "https://api.themoviedb.org/3/movie/" + tmdbId + "/credits?api_key=" + TMDB_API_KEY;
      const credits = JSON.parse(UrlFetchApp.fetch(creditsUrl).getContentText());
      const foundDirector = (credits.crew || []).find(p => p.job === "Director")?.name || "";
      if (foundDirector) {
        sheet.getRange(row, 3).setValue(foundDirector);
        filled++;
      }
    } catch (err) {
      Logger.log("Director backfill failed for row " + row + " (" + title + "): " + err);
    }
    Utilities.sleep(150);
  }

  SpreadsheetApp.getActive().toast("Director backfill: checked " + checked + ", filled " + filled + ".", "GMDB", 6);
}

// =============================================
// BACKFILL ONE MISSING STORYLINE / TRIVIA (single row)
// Finds the next row missing Storyline (col 33) or Trivia (col 34),
// calls Gemini for just that one movie, and writes back ONLY those two
// fields. No bulk/auto-continuing version — same reasoning as above.
// =============================================
function backfillOneStorylineTrivia() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();

  for (let row = 2; row <= lastRow; row++) {
    const title = sheet.getRange(row, 1).getValue();
    if (!title) continue;
    const storyline = sheet.getRange(row, 33).getValue();
    const trivia = sheet.getRange(row, 34).getValue();
    if (storyline && trivia) continue;

    const year = sheet.getRange(row, 2).getValue();
    try {
      const aiReview = getGeminiMovieReview(String(title), String(year));
      if (!storyline && aiReview.storyline) sheet.getRange(row, 33).setValue(aiReview.storyline);
      if (!trivia && aiReview.trivia) sheet.getRange(row, 34).setValue(aiReview.trivia);
      SpreadsheetApp.getActive().toast("Filled storyline/trivia: " + title, "GMDB", 6);
    } catch (err) {
      SpreadsheetApp.getUi().alert("Failed for '" + title + "':\n\n" + err);
    }
    return;
  }

  SpreadsheetApp.getActive().toast("No missing storyline/trivia found!", "GMDB", 5);
}

// =============================================
// BACKFILL MISSING TMDB IDs (fast, no Gemini calls)
// Re-searches TMDB ONLY for rows where TMDbID (col 35) is blank,
// using stored Year (col 2) + Language (col 30) to disambiguate.
// Writes back ONLY the TMDbID column.
// =============================================
function backfillMissingTMDbID() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Movies");
  const lastRow = sheet.getLastRow();
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 5 * 60 * 1000;
  const TMDB_ID_COL = 35;
  let filled = 0, checked = 0;

  const indianLanguages = ["ta", "hi", "te", "ml", "kn", "bn", "mr"];
  const nameToCode = { tamil:"ta", hindi:"hi", telugu:"te", malayalam:"ml", kannada:"kn", bengali:"bn", marathi:"mr" };

  function rankResults(results, queryLower) {
    return results.slice().sort((a, b) => {
      const aExact = (a.title || "").toLowerCase().trim() === queryLower ? 1 : 0;
      const bExact = (b.title || "").toLowerCase().trim() === queryLower ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return b.popularity - a.popularity;
    });
  }

  for (let row = 2; row <= lastRow; row++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      SpreadsheetApp.getActive().toast("Backfilled " + filled + " TMDB IDs. Run again to continue.", "GMDB", 8);
      return;
    }

    const title = String(sheet.getRange(row, 1).getValue()).trim();
    const existingId = String(sheet.getRange(row, TMDB_ID_COL).getValue()).trim();
    if (!title || /^\d+$/.test(existingId)) continue;

    checked++;
    try {
      const forcedYear = String(sheet.getRange(row, 2).getValue()).trim();
      const storedLangName = String(sheet.getRange(row, 30).getValue()).trim().toLowerCase();
      const forcedLanguage = nameToCode[storedLangName] || null;
      const queryLower = title.toLowerCase();

      const searchUrl = "https://api.themoviedb.org/3/search/movie?api_key=" + TMDB_API_KEY +
        "&include_adult=false&query=" + encodeURIComponent(title);
      const res = JSON.parse(UrlFetchApp.fetch(searchUrl).getContentText());
      let results = res.results || [];
      if (!results.length) continue;

      let movie = null;
      if (forcedYear && forcedLanguage) {
        const both = results.filter(m => m.release_date && m.release_date.substring(0,4) === forcedYear && m.original_language === forcedLanguage);
        movie = rankResults(both, queryLower)[0];
      }
      if (!movie && forcedYear) {
        const yearMatches = results.filter(m => m.release_date && m.release_date.substring(0,4) === forcedYear);
        movie = rankResults(yearMatches, queryLower)[0];
      }
      if (!movie) {
        const langFiltered = results.filter(m => forcedLanguage ? m.original_language === forcedLanguage : indianLanguages.includes(m.original_language));
        movie = rankResults(langFiltered, queryLower)[0];
      }
      if (!movie) movie = rankResults(results, queryLower)[0];

      if (movie && movie.id) {
        sheet.getRange(row, TMDB_ID_COL).setValue(movie.id);
        filled++;
      }
    } catch (err) {
      Logger.log("TMDbID backfill failed for row " + row + " (" + title + "): " + err);
    }
    Utilities.sleep(150);
  }

  SpreadsheetApp.getActive().toast("TMDbID backfill: checked " + checked + ", filled " + filled + ".", "GMDB", 8);
}
