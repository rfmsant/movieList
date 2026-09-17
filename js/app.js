// --- Ask-Claude Worker config -------------------------------------------
// WORKER_URL is filled in after you deploy the Cloudflare Worker in
// /worker (see README.md). APP_SECRET must match the APP_SECRET secret set
// on that Worker — it's not truly private (anyone can read it from this
// file) but it stops casual strangers who find the site from burning your
// API budget without at least looking at the page source.
const WORKER_URL = "https://white-resonance-78cf.movies-787.workers.dev";
const APP_SECRET = "Fblq3PlqmlKQ3ntT7MyRnyCkDGofLYhX";

// Firebase is loaded dynamically so a blocked/offline network (ad-blockers,
// no connectivity, etc.) degrades gracefully to "browsing works, watched
// status just isn't saved" instead of a blank white screen.
let watchedApi = {
  isWatched: () => false,
  setWatched: async () => {},
  toggleWatched: async () => {},
  onWatchedChange: () => () => {},
  ensureWatchedLoaded: async () => ({}),
  getAnalysis: async () => null,
  saveAnalysis: async () => {},
  PROFILE: resolveProfileName(),
};
let firebaseOk = false;

function resolveProfileName() {
  const params = new URLSearchParams(location.search);
  const keys = [...params.keys()].filter(Boolean);
  const raw = (keys[0] || "rui").toLowerCase();
  const clean = raw.replace(/[^a-z0-9_-]/g, "").slice(0, 30);
  return clean || "rui";
}

function isWatched(id) { return watchedApi.isWatched(id); }
function setWatched(id, val) { return watchedApi.setWatched(id, val); }
function toggleWatched(id) { return watchedApi.toggleWatched(id); }

let films = [];
let filmsById = new Map();
let oscars = [];
let oscarsByCeremony = new Map();

const app = document.getElementById("app");
const overlay = document.getElementById("detail-overlay");
const panel = document.getElementById("detail-panel");

init();

async function init() {
  const [filmsRes, oscarsRes] = await Promise.all([
    fetch("data/films.json"),
    fetch("data/oscars.json"),
  ]);
  films = await filmsRes.json();
  oscars = await oscarsRes.json();
  filmsById = new Map(films.map((f) => [f.id, f]));
  oscarsByCeremony = new Map(oscars.map((c) => [String(c.ceremony), c]));

  window.addEventListener("hashchange", render);
  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") closeDetail();
  });
  document.getElementById("random-btn").addEventListener("click", openRandomPicker);

  const tag = document.getElementById("profile-tag");
  tag.textContent = `👤 ${watchedApi.PROFILE}`;

  // First paint immediately with whatever local watched-state we have
  // (none, until Firebase connects) so the UI never sits blank.
  render();

  try {
    const mod = await import("./firebase-config.js");
    watchedApi = mod;
    tag.textContent = `👤 ${watchedApi.PROFILE}`;
    await watchedApi.ensureWatchedLoaded();
    firebaseOk = true;
    watchedApi.onWatchedChange(() => render());
    render();
  } catch (e) {
    console.warn("Firebase unavailable — watched status will not be saved.", e);
    showToast("Offline: your watched list won't sync right now.");
  }
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 4000);
}

// ---------------------------------------------------------------- routing
function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  return { name: parts[0] || "home", arg: parts[1] };
}

function setActiveTab(name) {
  document.querySelectorAll(".tabs a").forEach((a) => {
    a.classList.toggle("active", a.dataset.tab === name);
  });
}

function render() {
  const { name, arg } = route();
  setActiveTab(name === "home" ? "" : name);
  if (name === "classics") return renderClassics();
  if (name === "oscars" && arg) return renderCeremony(arg);
  if (name === "oscars") return renderOscarsList();
  if (name === "stats") return renderStats();
  return renderHome();
}

// ---------------------------------------------------------------- helpers
function watchedCount(list) {
  return list.filter((f) => isWatched(f.id)).length;
}

function posterImg(f, cls) {
  if (f.poster) {
    return `<img src="${escapeAttr(f.poster)}" alt="" loading="lazy" class="${cls || ""}">`;
  }
  return `<div class="no-poster ${cls || ""}">${escapeHtml(f.title)}</div>`;
}

function escapeHtml(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function filmCard(f) {
  const watched = isWatched(f.id);
  const oscarWins = f.oscar_wins && f.oscar_wins.length;
  return `
  <div class="card" data-film="${f.id}">
    <div class="poster-wrap">
      ${posterImg(f)}
      <div class="watch-toggle ${watched ? "watched" : ""}" data-toggle="${f.id}" title="${watched ? "Mark as unwatched" : "Mark as watched"}">✓</div>
      ${oscarWins ? `<div class="oscar-badge">🏆 ${f.oscar_wins.length}</div>` : ""}
    </div>
    <div class="meta">
      <p class="title">${escapeHtml(f.title)}</p>
      <p class="year">${f.year || "—"}</p>
    </div>
  </div>`;
}

function attachCardHandlers(root) {
  root.querySelectorAll("[data-film]").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.film));
  });
  root.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleWatched(el.dataset.toggle);
    });
  });
}

// ---------------------------------------------------------------- home
function renderHome() {
  const total = films.length;
  const watched = watchedCount(films);
  const bp = films.filter((f) => (f.oscar_wins || []).some((w) => w.category === "Best Picture"));
  const bpWatched = watchedCount(bp);
  const shareUrl = `${location.origin}${location.pathname}?friendname`;

  app.innerHTML = `
    <h1 class="page-title">Welcome back${watchedApi.PROFILE !== "rui" ? `, ${escapeHtml(watchedApi.PROFILE)}` : ""}</h1>
    <p class="subtle">${watched} of ${total} films watched so far. Keep going.</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${watched}/${total}</div><div class="stat-label">All films</div></div>
      <div class="stat-card"><div class="stat-num">${bpWatched}/${bp.length}</div><div class="stat-label">Best Picture winners</div></div>
    </div>
    <div class="share-box">
      Each person has their own watched-list. Share <code>${escapeHtml(shareUrl)}</code> (swap in their name) and they'll get their own list, on the same site.
    </div>
    <h2 class="section-title">Jump in</h2>
    <div class="chip-row">
      <a href="#/classics" class="chip">📚 Browse the classics</a>
      <a href="#/oscars" class="chip">🏆 Browse the Oscars</a>
      <div class="chip" id="home-random">🎲 Surprise me</div>
    </div>
    <h2 class="section-title">Recently added</h2>
    <div class="grid">${films.slice(0, 12).map(filmCard).join("")}</div>
  `;
  attachCardHandlers(app);
  document.getElementById("home-random").addEventListener("click", openRandomPicker);
}

// ---------------------------------------------------------------- classics
let classicsState = { q: "", decade: "", genre: "", filter: "all" };

function decadeOf(year) {
  if (!year) return null;
  return Math.floor(year / 10) * 10;
}

function renderClassics() {
  const decades = [...new Set(films.map((f) => decadeOf(f.year)).filter(Boolean))].sort((a, b) => a - b);
  const genres = [...new Set(films.flatMap((f) => f.genres || []))].sort();

  app.innerHTML = `
    <h1 class="page-title">Classics</h1>
    <p class="subtle">The essential canon — 1,158 films from the "1001 Movies" list, plus every other Oscar-winning film. Tap the ✓ on a poster to mark it watched without opening it.</p>
    <div class="controls">
      <input type="search" id="q" placeholder="Search title..." value="${escapeAttr(classicsState.q)}">
      <select id="decade"><option value="">All decades</option>${decades.map((d) => `<option value="${d}" ${classicsState.decade == d ? "selected" : ""}>${d}s</option>`).join("")}</select>
      <select id="genre"><option value="">All genres</option>${genres.map((g) => `<option value="${escapeAttr(g)}" ${classicsState.genre === g ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}</select>
    </div>
    <div class="chip-row">
      <div class="chip ${classicsState.filter === "all" ? "active" : ""}" data-f="all">All</div>
      <div class="chip ${classicsState.filter === "unwatched" ? "active" : ""}" data-f="unwatched">Unwatched</div>
      <div class="chip ${classicsState.filter === "watched" ? "active" : ""}" data-f="watched">Watched</div>
      <div class="chip ${classicsState.filter === "1001" ? "active" : ""}" data-f="1001">1001 list only</div>
      <div class="chip ${classicsState.filter === "oscars" ? "active" : ""}" data-f="oscars">Oscar winners only</div>
    </div>
    <div id="results"></div>
  `;

  document.getElementById("q").addEventListener("input", (e) => { classicsState.q = e.target.value; renderClassicsResults(); });
  document.getElementById("decade").addEventListener("change", (e) => { classicsState.decade = e.target.value; renderClassicsResults(); });
  document.getElementById("genre").addEventListener("change", (e) => { classicsState.genre = e.target.value; renderClassicsResults(); });
  app.querySelectorAll(".chip[data-f]").forEach((c) => c.addEventListener("click", () => {
    classicsState.filter = c.dataset.f;
    renderClassics();
  }));

  renderClassicsResults();
}

function renderClassicsResults() {
  const q = classicsState.q.trim().toLowerCase();
  let list = films.filter((f) => {
    if (q && !f.title.toLowerCase().includes(q)) return false;
    if (classicsState.decade && decadeOf(f.year) != classicsState.decade) return false;
    if (classicsState.genre && !(f.genres || []).includes(classicsState.genre)) return false;
    if (classicsState.filter === "unwatched" && isWatched(f.id)) return false;
    if (classicsState.filter === "watched" && !isWatched(f.id)) return false;
    if (classicsState.filter === "1001" && !f.in_1001_list) return false;
    if (classicsState.filter === "oscars" && !(f.oscar_wins || []).length) return false;
    return true;
  });
  const results = document.getElementById("results");
  results.innerHTML = `
    <p class="result-count">${list.length} film${list.length === 1 ? "" : "s"}</p>
    <div class="grid">${list.slice(0, 400).map(filmCard).join("")}</div>
    ${list.length > 400 ? `<p class="subtle" style="margin-top:12px">Showing first 400 — narrow your search to see more precisely.</p>` : ""}
    ${list.length === 0 ? `<div class="empty-state">No films match those filters.</div>` : ""}
  `;
  attachCardHandlers(results);
}

// ---------------------------------------------------------------- oscars
function renderOscarsList() {
  const sorted = [...oscars].sort((a, b) => b.ceremony - a.ceremony);
  app.innerHTML = `
    <h1 class="page-title">Academy Awards</h1>
    <p class="subtle">Every competitive category winner, from the 1st ceremony (1929, honoring "Wings") to the 98th (2026).</p>
    <div class="ceremony-list">
      ${sorted.map((c) => {
        const bp = (c.categories.find((cat) => cat.category === "Best Picture") || {}).winners || [];
        const bpFilm = bp[0]?.film_title || "—";
        return `
        <a href="#/oscars/${c.ceremony}" class="ceremony-row">
          <div class="cer-num">${ordinal(c.ceremony)}</div>
          <div class="cer-info">
            <div class="cer-picture">${escapeHtml(bpFilm)}</div>
            <div class="cer-year">${c.year_ceremony} ceremony · films from ${c.year_film}</div>
          </div>
        </a>`;
      }).join("")}
    </div>
  `;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function renderCeremony(ceremonyNum) {
  const c = oscarsByCeremony.get(String(ceremonyNum));
  if (!c) { app.innerHTML = `<div class="empty-state">Ceremony not found.</div>`; return; }
  app.innerHTML = `
    <p class="subtle"><a href="#/oscars">← All ceremonies</a></p>
    <h1 class="page-title">${ordinal(c.ceremony)} Academy Awards</h1>
    <p class="subtle">${c.year_ceremony} ceremony, honoring films released in ${c.year_film}</p>
    ${c.categories.map((cat) => `
      <div class="category-block">
        <div class="category-name">${escapeHtml(cat.category)}</div>
        ${cat.winners.map((w) => {
          const f = w.film_id ? filmsById.get(w.film_id) : null;
          const thumb = f && f.poster ? `<img class="thumb" src="${escapeAttr(f.poster)}" loading="lazy">` : `<div class="thumb"></div>`;
          return `
          <div class="winner-row" ${w.film_id ? `data-film="${w.film_id}"` : ""}>
            ${thumb}
            <div class="wtext">
              <div class="wname">${escapeHtml(w.winner_name)}</div>
              <div class="wfilm">${escapeHtml(w.film_title || "")}</div>
            </div>
            ${w.film_id ? `<div class="watch-toggle ${isWatched(w.film_id) ? "watched" : ""}" data-toggle="${w.film_id}" style="position:static;flex-shrink:0" title="Mark watched">✓</div>` : ""}
          </div>`;
        }).join("")}
      </div>
    `).join("")}
  `;
  attachCardHandlers(app);
}

// ---------------------------------------------------------------- stats
function renderStats() {
  const total = films.length;
  const watched = watchedCount(films);
  const oneThousandOne = films.filter((f) => f.in_1001_list);
  const bp = films.filter((f) => (f.oscar_wins || []).some((w) => w.category === "Best Picture"));

  app.innerHTML = `
    <h1 class="page-title">Your progress</h1>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${watched}</div><div class="stat-label">Films watched</div></div>
      <div class="stat-card"><div class="stat-num">${total - watched}</div><div class="stat-label">Still to watch</div></div>
      <div class="stat-card"><div class="stat-num">${watchedCount(oneThousandOne)}/${oneThousandOne.length}</div><div class="stat-label">1001 list</div></div>
      <div class="stat-card"><div class="stat-num">${watchedCount(bp)}/${bp.length}</div><div class="stat-label">Best Picture winners</div></div>
    </div>
    <h2 class="section-title">Recently watched</h2>
    <div class="grid">${films.filter((f) => isWatched(f.id)).slice(0, 24).map(filmCard).join("") || '<div class="empty-state">Nothing marked watched yet — go browse the classics.</div>'}</div>
  `;
  attachCardHandlers(app);
}

// ---------------------------------------------------------------- random picker
function openRandomPicker() {
  const decades = [...new Set(films.map((f) => decadeOf(f.year)).filter(Boolean))].sort((a, b) => a - b);
  const genres = [...new Set(films.flatMap((f) => f.genres || []))].sort();

  panel.innerHTML = `
    <div class="detail-close"><button id="close-detail">✕</button></div>
    <div class="detail-body random-picker" style="padding-top:6px">
      <h2>🎲 Surprise me</h2>
      <p class="subtle">Pick a filter or leave it on "Any" for a totally random classic.</p>
      <div class="controls">
        <select id="rp-decade"><option value="">Any decade</option>${decades.map((d) => `<option value="${d}">${d}s</option>`).join("")}</select>
        <select id="rp-genre"><option value="">Any genre</option>${genres.map((g) => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join("")}</select>
      </div>
      <div class="chip-row">
        <div class="chip active" data-w="any" id="rp-w-any">Any</div>
        <div class="chip" data-w="unwatched" id="rp-w-unwatched">Unwatched only</div>
      </div>
      <button class="go-btn" id="rp-go">Pick a film</button>
      <p class="empty-state" id="rp-empty" style="display:none">No films match those filters — try loosening them.</p>
    </div>
  `;
  overlay.classList.remove("hidden");
  document.getElementById("close-detail").addEventListener("click", closeDetail);

  let wantUnwatchedOnly = false;
  document.getElementById("rp-w-any").addEventListener("click", (e) => {
    wantUnwatchedOnly = false;
    document.querySelectorAll("#rp-w-any, #rp-w-unwatched").forEach((el) => el.classList.remove("active"));
    e.target.classList.add("active");
  });
  document.getElementById("rp-w-unwatched").addEventListener("click", (e) => {
    wantUnwatchedOnly = true;
    document.querySelectorAll("#rp-w-any, #rp-w-unwatched").forEach((el) => el.classList.remove("active"));
    e.target.classList.add("active");
  });

  document.getElementById("rp-go").addEventListener("click", () => {
    const decade = document.getElementById("rp-decade").value;
    const genre = document.getElementById("rp-genre").value;
    const pool = films.filter((f) => {
      if (decade && decadeOf(f.year) != decade) return false;
      if (genre && !(f.genres || []).includes(genre)) return false;
      if (wantUnwatchedOnly && isWatched(f.id)) return false;
      return true;
    });
    if (!pool.length) {
      document.getElementById("rp-empty").style.display = "block";
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    openDetail(pick.id);
  });
}

// ---------------------------------------------------------------- detail
async function openDetail(filmId) {
  const f = filmsById.get(filmId);
  if (!f) return;
  renderDetailPanel(f, null);
  overlay.classList.remove("hidden");

  const hasStaticContent = !!(f.why_iconic || f.hidden_analysis);
  if (!hasStaticContent && firebaseOk) {
    try {
      const cached = await watchedApi.getAnalysis(f.id);
      if (cached) renderDetailPanel(f, cached);
    } catch (e) {
      console.warn("Could not check cached analysis:", e);
    }
  }
}

function renderDetailPanel(f, analysis) {
  const watched = isWatched(f.id);
  const oscarLines = (f.oscar_wins || [])
    .map((w) => `${w.category} (${w.year_ceremony})`)
    .join(" · ");
  const whyIconic = f.why_iconic || analysis?.why_iconic || "";
  const hiddenAnalysis = f.hidden_analysis || analysis?.hidden_analysis || "";
  const funFacts = (f.fun_facts && f.fun_facts.length ? f.fun_facts : analysis?.fun_facts) || [];
  const hasContent = !!(whyIconic || hiddenAnalysis);

  panel.innerHTML = `
    <div class="detail-close"><button id="close-detail">✕</button></div>
    <div class="detail-hero">
      ${f.poster ? `<img src="${escapeAttr(f.poster)}" alt="">` : `<div class="no-poster">${escapeHtml(f.title)}</div>`}
      <div>
        <p class="detail-title">${escapeHtml(f.title)}</p>
        <p class="detail-sub">${f.year || "Year unknown"}${f.director ? " · Directed by " + escapeHtml(f.director) : ""}${f.runtime_minutes ? " · " + f.runtime_minutes + " min" : ""}</p>
        ${f.genres && f.genres.length ? `<p class="detail-sub">${f.genres.map(escapeHtml).join(", ")}</p>` : ""}
        ${oscarLines ? `<p class="detail-oscars">🏆 ${escapeHtml(oscarLines)}</p>` : ""}
        <button id="watch-btn" class="watch-btn ${watched ? "watched" : ""}">${watched ? "✓ Watched" : "Mark as watched"}</button>
      </div>
    </div>
    <div class="detail-body">
      ${f.cast && f.cast.length ? `
      <div class="detail-section">
        <h3>Cast</h3>
        <p>${f.cast.slice(0, 6).map(escapeHtml).join(", ")}</p>
      </div>` : ""}

      <div class="detail-section">
        <h3>About this film</h3>
        ${whyIconic
          ? `<p>${escapeHtml(whyIconic)}</p>`
          : `<p class="pending-note">Non-spoiler write-up for this one hasn't been added yet.</p>`}
      </div>

      ${hasContent ? `
      <button class="spoiler-toggle" id="spoiler-toggle">🔒 Show deep analysis (contains spoilers)</button>
      <p class="spoiler-warning" style="display:none" id="spoiler-warning">Only tap this after watching — full plot and ending discussed below.</p>
      <div class="spoiler-body" id="spoiler-body">
        <p>${escapeHtml(hiddenAnalysis)}</p>
      </div>
      ` : `
      <div class="detail-section">
        <h3>Deep analysis</h3>
        <p class="pending-note" id="ask-pending">Nobody's asked for this one yet.</p>
        <button class="ask-claude-btn" id="ask-claude-btn">🤖 Ask Claude to write it up</button>
      </div>
      `}

      ${funFacts.length ? `
      <div class="detail-section" style="margin-top:16px">
        <h3>Fun facts</h3>
        <ul class="fun-facts">${funFacts.map((ff) => `<li>${escapeHtml(ff)}</li>`).join("")}</ul>
      </div>` : ""}
    </div>
  `;

  document.getElementById("close-detail").addEventListener("click", closeDetail);
  document.getElementById("watch-btn").addEventListener("click", () => toggleWatched(f.id));
  const spoilerToggle = document.getElementById("spoiler-toggle");
  if (spoilerToggle) {
    spoilerToggle.addEventListener("click", () => {
      document.getElementById("spoiler-body").classList.toggle("open");
      document.getElementById("spoiler-warning").style.display = "block";
    });
  }
  const askBtn = document.getElementById("ask-claude-btn");
  if (askBtn) askBtn.addEventListener("click", () => handleAskClaude(f));
}

async function handleAskClaude(f) {
  const btn = document.getElementById("ask-claude-btn");
  const pending = document.getElementById("ask-pending");
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Thinking… (a few seconds)`;
  if (pending) pending.textContent = "";

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-secret": APP_SECRET },
      body: JSON.stringify({
        title: f.title,
        year: f.year,
        director: f.director,
        cast: f.cast,
        genres: f.genres,
        country: f.country,
        oscar_wins: f.oscar_wins,
        synopsis: f.synopsis,
      }),
    });
    if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    const analysis = await res.json();
    if (firebaseOk) {
      try { await watchedApi.saveAnalysis(f.id, analysis); }
      catch (e) { console.warn("Could not cache analysis to Firestore:", e); }
    }
    renderDetailPanel(f, analysis);
  } catch (e) {
    console.error("Ask Claude failed:", e);
    btn.disabled = false;
    btn.innerHTML = "🤖 Ask Claude to write it up";
    showToast("Couldn't reach the analysis service — try again in a moment.");
  }
}

function closeDetail() {
  overlay.classList.add("hidden");
  panel.innerHTML = "";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetail();
});
