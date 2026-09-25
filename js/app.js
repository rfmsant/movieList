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
  isShortlisted: () => false,
  setShortlisted: async () => {},
  toggleShortlisted: async () => {},
  onShortlistChange: () => () => {},
  ensureShortlistLoaded: async () => ({}),
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
function isShortlisted(id) { return watchedApi.isShortlisted(id); }
function toggleShortlisted(id) { return watchedApi.toggleShortlisted(id); }

// ---------------------------------------------------------------- confetti
const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function fireConfettiAt(x, y) {
  if (prefersReducedMotion) return;
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", pointerEvents: "none", zIndex: "300",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const colors = ["#d4a24c", "#e8c47f", "#4caf82", "#eef0f4", "#8a6b2e"];
  const count = 46;
  const particles = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI - Math.PI / 2 - Math.PI / 4; // upward-ish burst
    const speed = 4 + Math.random() * 6;
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.3,
      life: 1,
    };
  });

  const gravity = 0.22;
  const drag = 0.985;
  let frame = 0;
  const maxFrames = 70;

  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life = Math.max(0, 1 - frame / maxFrames);
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (frame < maxFrames) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(tick);
}

function fireConfettiFromEl(el) {
  const rect = el.getBoundingClientRect();
  fireConfettiAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

let films = [];
let filmsById = new Map();
let oscars = [];
let oscarsByCeremony = new Map();

const app = document.getElementById("app");
const overlay = document.getElementById("detail-overlay");
const panel = document.getElementById("detail-panel");

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed:", e));
  });
}

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

  const searchBtn = document.getElementById("search-btn");
  const searchBar = document.getElementById("global-search-bar");
  const searchInput = document.getElementById("global-search-input");
  const searchClear = document.getElementById("global-search-clear");
  searchBtn.addEventListener("click", () => {
    if (searchBar.classList.contains("hidden")) openGlobalSearch();
    else closeGlobalSearch();
  });
  searchClear.addEventListener("click", closeGlobalSearch);
  searchInput.addEventListener("input", () => renderSearchDropdown(searchInput.value));
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goSearch(searchInput.value);
    if (e.key === "Escape") closeGlobalSearch();
  });
  document.addEventListener("click", (e) => {
    if (searchBar.classList.contains("hidden")) return;
    if (searchBar.contains(e.target) || searchBtn.contains(e.target)) return;
    closeGlobalSearch();
  });

  const tag = document.getElementById("profile-tag");
  tag.innerHTML = `${icon("user", 12)} ${escapeHtml(watchedApi.PROFILE)}`;

  // First paint immediately with whatever local watched-state we have
  // (none, until Firebase connects) so the UI never sits blank.
  render();

  try {
    const mod = await import("./firebase-config.js");
    watchedApi = mod;
    tag.innerHTML = `${icon("user", 12)} ${escapeHtml(watchedApi.PROFILE)}`;
    await watchedApi.ensureWatchedLoaded();
    await watchedApi.ensureShortlistLoaded();
    firebaseOk = true;
    watchedApi.onWatchedChange(() => render());
    watchedApi.onShortlistChange(() => render());
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

function openGlobalSearch() {
  document.getElementById("global-search-bar").classList.remove("hidden");
  document.getElementById("global-search-input").focus();
}

function closeGlobalSearch() {
  document.getElementById("global-search-bar").classList.add("hidden");
  document.getElementById("global-search-input").value = "";
  document.getElementById("global-search-results").innerHTML = "";
}

function renderSearchDropdown(q) {
  const results = document.getElementById("global-search-results");
  const query = q.trim().toLowerCase();
  if (!query) { results.innerHTML = ""; return; }
  const matches = films.filter((f) => f.title.toLowerCase().includes(query));
  if (!matches.length) {
    results.innerHTML = `<div class="gsr-empty">No films match "${escapeHtml(q.trim())}".</div>`;
    return;
  }
  const shown = matches.slice(0, 6);
  results.innerHTML = `
    ${shown.map((f) => `
      <div class="gsr-row" data-id="${escapeAttr(f.id)}" role="button" tabindex="0">
        ${f.poster ? `<img class="gsr-poster" src="${escapeAttr(f.poster)}" alt="" loading="lazy">` : `<div class="gsr-poster"></div>`}
        <div class="gsr-info">
          <div class="gsr-title">${escapeHtml(f.title)}</div>
          <div class="gsr-year">${f.year || ""}</div>
        </div>
      </div>`).join("")}
    ${matches.length > shown.length ? `<div class="gsr-more" id="gsr-see-all">See all ${matches.length} results</div>` : ""}
  `;
  results.querySelectorAll(".gsr-row").forEach((row) => {
    const go = () => { closeGlobalSearch(); openDetail(row.dataset.id); };
    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
  });
  const seeAll = document.getElementById("gsr-see-all");
  if (seeAll) seeAll.addEventListener("click", () => goSearch(q));
}

function goSearch(q) {
  classicsState.q = q.trim();
  classicsState.filter = "all";
  closeGlobalSearch();
  if (route().name === "classics") renderClassics();
  else location.hash = "#/classics";
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

// ---------------------------------------------------------------- icons
// A small hand-drawn line-icon set (24x24, stroke-based) so the UI doesn't
// lean on emoji for its chrome — emoji render inconsistently across
// platforms and read as a placeholder rather than a designed icon.
const ICONS = {
  film: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.3"/><circle cx="12" cy="4.7" r="1.2"/><circle cx="12" cy="19.3" r="1.2"/><circle cx="19.3" cy="12" r="1.2"/><circle cx="4.7" cy="12" r="1.2"/><circle cx="17.1" cy="6.9" r="1.2"/><circle cx="6.9" cy="17.1" r="1.2"/><circle cx="17.1" cy="17.1" r="1.2"/><circle cx="6.9" cy="6.9" r="1.2"/>`,
  shuffle: `<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"/>`,
  search: `<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  x: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  check: `<polyline points="20 6 9 17 4 12"/>`,
  award: `<polygon points="12,2 14.7,8.6 22,9.3 16.5,14 18.2,21 12,17.3 5.8,21 7.5,14 2,9.3 9.3,8.6"/>`,
  bookmark: `<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>`,
  lock: `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  play: `<polygon points="5,3 19,12 5,21"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>`,
  sparkle: `<polygon points="12,2 14,9 21,11 14,13 12,20 10,13 3,11 10,9"/><polygon points="19,3 19.6,4.6 21.2,5.2 19.6,5.8 19,7.4 18.4,5.8 16.8,5.2 18.4,4.6" fill="currentColor" stroke="none"/>`,
  books: `<rect x="3" y="7" width="4" height="14" rx="1"/><rect x="9" y="3" width="4" height="18" rx="1"/><rect x="15" y="9" width="4" height="12" rx="1"/>`,
};

function icon(name, size = 16, extraClass = "") {
  const body = ICONS[name] || "";
  return `<svg class="icon${extraClass ? " " + extraClass : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function filmCard(f) {
  const watched = isWatched(f.id);
  const shortlisted = isShortlisted(f.id);
  const oscarWins = f.oscar_wins && f.oscar_wins.length;
  const genreTags = (f.genres || []).slice(0, 2);
  return `
  <div class="card" data-film="${f.id}" role="button" tabindex="0" aria-label="${escapeAttr(f.title)}${f.year ? `, ${f.year}` : ""}">
    <div class="poster-wrap">
      ${posterImg(f)}
      <div class="watch-toggle ${watched ? "watched" : ""}" data-toggle="${f.id}" role="button" tabindex="0" aria-pressed="${watched}" aria-label="${watched ? "Mark as unwatched" : "Mark as watched"}" title="${watched ? "Mark as unwatched" : "Mark as watched"}">${icon("check", 14)}</div>
      <div class="shortlist-toggle ${shortlisted ? "shortlisted" : ""}" data-shortlist="${f.id}" role="button" tabindex="0" aria-pressed="${shortlisted}" aria-label="${shortlisted ? "Remove from want-to-watch list" : "Add to want-to-watch list"}" title="${shortlisted ? "Remove from want-to-watch list" : "Add to want-to-watch list"}">${icon("bookmark", 13)}</div>
      ${oscarWins ? `<div class="oscar-badge">${icon("award", 11)} ${f.oscar_wins.length}</div>` : ""}
    </div>
    <div class="meta">
      <p class="title">${escapeHtml(f.title)}</p>
      <p class="year">${f.year || "—"}</p>
      ${genreTags.length ? `<div class="genre-tags">${genreTags.map((g) => `<span class="genre-tag">${escapeHtml(g)}</span>`).join("")}</div>` : ""}
    </div>
  </div>`;
}

function attachCardHandlers(root) {
  root.querySelectorAll("[data-film]").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.film));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail(el.dataset.film);
      }
    });
  });
  root.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasWatched = isWatched(el.dataset.toggle);
      if (!wasWatched) fireConfettiFromEl(el);
      toggleWatched(el.dataset.toggle);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const wasWatched = isWatched(el.dataset.toggle);
        if (!wasWatched) fireConfettiFromEl(el);
        toggleWatched(el.dataset.toggle);
      }
    });
  });
  root.querySelectorAll("[data-shortlist]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleShortlisted(el.dataset.shortlist);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        toggleShortlisted(el.dataset.shortlist);
      }
    });
  });
}

// ---------------------------------------------------------------- home
function renderHome() {
  const total = films.length;
  const watched = watchedCount(films);
  const bp = films.filter((f) => (f.oscar_wins || []).some((w) => w.category === "Best Picture"));
  const bpWatched = watchedCount(bp);

  app.innerHTML = `
    <h1 class="page-title">Welcome back${watchedApi.PROFILE !== "rui" ? `, ${escapeHtml(watchedApi.PROFILE)}` : ""}</h1>
    <p class="subtle">${watched} of ${total} films watched so far. Keep going.</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${watched}/${total}</div><div class="stat-label">All films</div></div>
      <div class="stat-card"><div class="stat-num">${bpWatched}/${bp.length}</div><div class="stat-label">Best Picture winners</div></div>
    </div>
    <h2 class="section-title">Jump in</h2>
    <div class="chip-row">
      <a href="#/classics" class="chip">${icon("books", 13)} Browse the classics</a>
      <a href="#/oscars" class="chip">${icon("award", 13)} Browse the Oscars</a>
      <div class="chip" id="home-random">${icon("shuffle", 13)} Surprise me</div>
    </div>
    <h2 class="section-title icon-title">${icon("film", 16)} Today's picks</h2>
    <p class="subtle" style="margin-top:-8px">4 unwatched films picked for today — same set all day, a fresh batch tomorrow.</p>
    ${dailyPicksHtml()}
  `;
  attachCardHandlers(app);
  document.getElementById("home-random").addEventListener("click", openRandomPicker);
}

function dailyPicksHtml() {
  const picks = dailyPicks(4);
  if (!picks.length) {
    return `<div class="empty-state">🎉 You've watched every film on the list. Incredible.</div>`;
  }
  return `<div class="grid">${picks.map(filmCard).join("")}</div>`;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// Deterministic shuffle seeded from a number, so the same seed always
// produces the same order (mulberry32 PRNG).
function seededShuffle(arr, seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dailyPicks(n) {
  const unwatched = films.filter((f) => !isWatched(f.id));
  if (!unwatched.length) return [];
  const seed = hashStr(`${todayKey()}|${watchedApi.PROFILE}`);
  return seededShuffle(unwatched, seed).slice(0, n);
}

// ---------------------------------------------------------------- classics
let classicsState = { q: "", decade: "", genre: "", filter: "all", sort: "default" };

function decadeOf(year) {
  if (!year) return null;
  return Math.floor(year / 10) * 10;
}

function renderClassics() {
  const decades = [...new Set(films.map((f) => decadeOf(f.year)).filter(Boolean))].sort((a, b) => a - b);
  const genres = [...new Set(films.flatMap((f) => f.genres || []))].sort();

  app.innerHTML = `
    <h1 class="page-title">Classics</h1>
    <p class="subtle">The essential canon — 1,158 films from the "1001 Movies" list, plus every other Oscar-winning film. Tap the <span class="inline-icon">${icon("check", 12)}</span> on a poster to mark it watched without opening it.</p>
    <div class="controls">
      <input type="search" id="q" placeholder="Search title..." value="${escapeAttr(classicsState.q)}">
      <select id="decade"><option value="">All decades</option>${decades.map((d) => `<option value="${d}" ${classicsState.decade == d ? "selected" : ""}>${d}s</option>`).join("")}</select>
      <select id="genre"><option value="">All genres</option>${genres.map((g) => `<option value="${escapeAttr(g)}" ${classicsState.genre === g ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}</select>
      <select id="sort">
        <option value="default" ${classicsState.sort === "default" ? "selected" : ""}>Sort: default</option>
        <option value="year-desc" ${classicsState.sort === "year-desc" ? "selected" : ""}>Year: newest first</option>
        <option value="year-asc" ${classicsState.sort === "year-asc" ? "selected" : ""}>Year: oldest first</option>
        <option value="title" ${classicsState.sort === "title" ? "selected" : ""}>Title: A–Z</option>
        <option value="rating" ${classicsState.sort === "rating" ? "selected" : ""}>Rating: highest first</option>
      </select>
    </div>
    <div class="chip-row">
      <div class="chip ${classicsState.filter === "all" ? "active" : ""}" data-f="all">All</div>
      <div class="chip ${classicsState.filter === "unwatched" ? "active" : ""}" data-f="unwatched">Unwatched</div>
      <div class="chip ${classicsState.filter === "watched" ? "active" : ""}" data-f="watched">Watched</div>
      <div class="chip ${classicsState.filter === "1001" ? "active" : ""}" data-f="1001">1001 list only</div>
      <div class="chip ${classicsState.filter === "oscars" ? "active" : ""}" data-f="oscars">Oscar winners only</div>
      <div class="chip ${classicsState.filter === "shortlist" ? "active" : ""}" data-f="shortlist">${icon("bookmark", 13)} Want to watch</div>
    </div>
    <div id="results"></div>
  `;

  document.getElementById("q").addEventListener("input", (e) => { classicsState.q = e.target.value; renderClassicsResults(); });
  document.getElementById("decade").addEventListener("change", (e) => { classicsState.decade = e.target.value; renderClassicsResults(); });
  document.getElementById("genre").addEventListener("change", (e) => { classicsState.genre = e.target.value; renderClassicsResults(); });
  document.getElementById("sort").addEventListener("change", (e) => { classicsState.sort = e.target.value; renderClassicsResults(); });
  app.querySelectorAll(".chip[data-f]").forEach((c) => c.addEventListener("click", () => {
    classicsState.filter = c.dataset.f;
    renderClassics();
  }));

  renderClassicsResults();
}

const CLASSICS_SORTERS = {
  "year-desc": (a, b) => (b.year || 0) - (a.year || 0),
  "year-asc": (a, b) => (a.year || 0) - (b.year || 0),
  "title": (a, b) => a.title.localeCompare(b.title),
  "rating": (a, b) => (b.rating || 0) - (a.rating || 0),
};

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
    if (classicsState.filter === "shortlist" && !isShortlisted(f.id)) return false;
    return true;
  });
  const sorter = CLASSICS_SORTERS[classicsState.sort];
  if (sorter) list = [...list].sort(sorter);

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
          const watched = w.film_id ? isWatched(w.film_id) : false;
          return `
          <div class="winner-row" ${w.film_id ? `data-film="${w.film_id}" role="button" tabindex="0" aria-label="${escapeAttr(w.film_title || w.winner_name)}"` : ""}>
            ${thumb}
            <div class="wtext">
              <div class="wname">${escapeHtml(w.winner_name)}</div>
              <div class="wfilm">${escapeHtml(w.film_title || "")}</div>
            </div>
            ${w.film_id ? `<div class="watch-toggle ${watched ? "watched" : ""}" data-toggle="${w.film_id}" role="button" tabindex="0" aria-pressed="${watched}" style="position:static;flex-shrink:0" aria-label="${watched ? "Mark as unwatched" : "Mark as watched"}" title="Mark watched">${icon("check", 14)}</div>` : ""}
          </div>`;
        }).join("")}
      </div>
    `).join("")}
  `;
  attachCardHandlers(app);
}

// ---------------------------------------------------------------- stats
function breakdownRow(r) {
  const pct = r.total ? Math.round((r.watched / r.total) * 100) : 0;
  return `
    <div class="breakdown-row">
      <div class="breakdown-label">${escapeHtml(r.label)}</div>
      <div class="breakdown-bar"><div class="breakdown-fill" style="width:${pct}%"></div></div>
      <div class="breakdown-count">${r.watched}/${r.total}</div>
    </div>`;
}

function formatDuration(totalMinutes) {
  const m = Math.round(totalMinutes || 0);
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function renderStats() {
  const total = films.length;
  const watched = watchedCount(films);
  const oneThousandOne = films.filter((f) => f.in_1001_list);
  const bp = films.filter((f) => (f.oscar_wins || []).some((w) => w.category === "Best Picture"));
  const watchedMinutes = films.reduce((sum, f) => sum + (isWatched(f.id) ? (f.runtime_minutes || 0) : 0), 0);
  const toGoMinutes = films.reduce((sum, f) => sum + (!isWatched(f.id) ? (f.runtime_minutes || 0) : 0), 0);

  const decadeGroups = {};
  films.forEach((f) => {
    const d = decadeOf(f.year);
    if (d == null) return;
    (decadeGroups[d] = decadeGroups[d] || []).push(f);
  });
  const decadeRows = Object.keys(decadeGroups).map(Number).sort((a, b) => a - b).map((d) => ({
    label: `${d}s`, watched: watchedCount(decadeGroups[d]), total: decadeGroups[d].length,
  }));

  const genreGroups = {};
  films.forEach((f) => (f.genres || []).forEach((g) => { (genreGroups[g] = genreGroups[g] || []).push(f); }));
  const genreRows = Object.keys(genreGroups)
    .map((g) => ({ label: g, watched: watchedCount(genreGroups[g]), total: genreGroups[g].length }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  app.innerHTML = `
    <h1 class="page-title">Your progress</h1>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${watched}</div><div class="stat-label">Films watched</div></div>
      <div class="stat-card"><div class="stat-num">${total - watched}</div><div class="stat-label">Still to watch</div></div>
      <div class="stat-card"><div class="stat-num">${watchedCount(oneThousandOne)}/${oneThousandOne.length}</div><div class="stat-label">1001 list</div></div>
      <div class="stat-card"><div class="stat-num">${watchedCount(bp)}/${bp.length}</div><div class="stat-label">Best Picture winners</div></div>
      <div class="stat-card"><div class="stat-num">${formatDuration(watchedMinutes)}</div><div class="stat-label">Time watched</div></div>
      <div class="stat-card"><div class="stat-num">${formatDuration(toGoMinutes)}</div><div class="stat-label">Time to go</div></div>
    </div>

    <h2 class="section-title">By decade</h2>
    <div class="breakdown-list">${decadeRows.map(breakdownRow).join("")}</div>

    <h2 class="section-title">By genre</h2>
    <div class="breakdown-list">${genreRows.map(breakdownRow).join("")}</div>

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
    <div class="detail-close"><button id="close-detail">${icon("x", 16)}</button></div>
    <div class="detail-body random-picker" style="padding-top:6px">
      <h2 class="icon-title">${icon("shuffle", 18)} Surprise me</h2>
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

function watchProvidersHtml(f) {
  const wp = f.watch_pt;
  if (!wp) return "";
  const flatrate = wp.flatrate || [];
  const rent = wp.rent || [];
  const buy = wp.buy || [];
  const badge = (name) => `<span class="provider-badge">${escapeHtml(name)}</span>`;
  if (!flatrate.length && !rent.length && !buy.length) {
    return `
      <div class="detail-section">
        <h3>Where to watch (Portugal)</h3>
        <p class="subtle">Not currently available to stream in Portugal.</p>
      </div>`;
  }
  return `
    <div class="detail-section">
      <h3>Where to watch (Portugal)</h3>
      ${flatrate.length ? `<div class="provider-row"><span class="provider-row-label">Stream</span>${flatrate.map(badge).join("")}</div>` : ""}
      ${rent.length ? `<div class="provider-row"><span class="provider-row-label">Rent</span>${rent.map(badge).join("")}</div>` : ""}
      ${buy.length ? `<div class="provider-row"><span class="provider-row-label">Buy</span>${buy.map(badge).join("")}</div>` : ""}
      ${wp.link ? `<p class="provider-attribution">Data via <a href="${escapeAttr(wp.link)}" target="_blank" rel="noopener">JustWatch</a></p>` : ""}
    </div>`;
}

function renderDetailPanel(f, analysis) {
  const watched = isWatched(f.id);
  const shortlisted = isShortlisted(f.id);
  const oscarLines = (f.oscar_wins || [])
    .map((w) => `${w.category} (${w.year_ceremony})`)
    .join(" · ");
  const synopsis = f.synopsis || "";
  const whyIconic = f.why_iconic || analysis?.why_iconic || "";
  const hiddenAnalysis = f.hidden_analysis || analysis?.hidden_analysis || "";
  const funFacts = (f.fun_facts && f.fun_facts.length ? f.fun_facts : analysis?.fun_facts) || [];
  const hasContent = !!(whyIconic || hiddenAnalysis);
  const trailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${f.title}${f.year ? " " + f.year : ""} trailer`)}`;

  panel.innerHTML = `
    <div class="detail-close"><button id="close-detail">${icon("x", 16)}</button></div>
    <div class="detail-hero">
      ${f.poster ? `<img src="${escapeAttr(f.poster)}" alt="">` : `<div class="no-poster">${escapeHtml(f.title)}</div>`}
      <div>
        <p class="detail-title">${escapeHtml(f.title)}</p>
        <p class="detail-sub">${f.year || "Year unknown"}${f.director ? " · Directed by " + escapeHtml(f.director) : ""}${f.runtime_minutes ? " · " + f.runtime_minutes + " min" : ""}</p>
        ${f.genres && f.genres.length ? `<p class="detail-sub">${f.genres.map(escapeHtml).join(", ")}</p>` : ""}
        ${oscarLines ? `<p class="detail-oscars">${icon("award", 13)} ${escapeHtml(oscarLines)}</p>` : ""}
        <button id="watch-btn" class="watch-btn ${watched ? "watched" : ""}">${watched ? icon("check", 14) + " Watched" : "Mark as watched"}</button>
        <div class="detail-actions-row">
          <button id="shortlist-btn" class="shortlist-btn ${shortlisted ? "active" : ""}" aria-pressed="${shortlisted}">${icon("bookmark", 14)} ${shortlisted ? "On your list" : "Want to watch"}</button>
          <a class="trailer-link" href="${trailerUrl}" target="_blank" rel="noopener">${icon("play", 13)} Trailer</a>
        </div>
      </div>
    </div>
    <div class="detail-body">
      ${watchProvidersHtml(f)}

      ${f.cast && f.cast.length ? `
      <div class="detail-section">
        <h3>Cast</h3>
        <p>${f.cast.slice(0, 6).map(escapeHtml).join(", ")}</p>
      </div>` : ""}

      <div class="detail-section">
        <h3>About this film</h3>
        ${synopsis ? `<p>${escapeHtml(synopsis)}</p>` : ""}
        ${whyIconic
          ? `<p class="why-iconic">${icon("film", 14)} ${escapeHtml(whyIconic)}</p>`
          : ""}
        ${!synopsis && !whyIconic
          ? `<p class="pending-note">No write-up for this one yet.</p>`
          : ""}
      </div>

      ${hasContent ? `
      <button class="spoiler-toggle" id="spoiler-toggle">${icon("lock", 14)} Show deep analysis (contains spoilers)</button>
      <p class="spoiler-warning" style="display:none" id="spoiler-warning">Only tap this after watching — full plot and ending discussed below.</p>
      <div class="spoiler-body" id="spoiler-body">
        <p>${escapeHtml(hiddenAnalysis)}</p>
      </div>
      ` : `
      <div class="detail-section">
        <h3>Deep analysis</h3>
        <p class="pending-note" id="ask-pending">Nobody's asked for this one yet.</p>
        <button class="ask-claude-btn" id="ask-claude-btn">${icon("sparkle", 15)} Ask Claude to write it up</button>
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
  document.getElementById("watch-btn").addEventListener("click", (e) => {
    if (!isWatched(f.id)) fireConfettiFromEl(e.currentTarget);
    toggleWatched(f.id);
  });
  document.getElementById("shortlist-btn").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const next = !isShortlisted(f.id);
    toggleShortlisted(f.id);
    btn.classList.toggle("active", next);
    btn.setAttribute("aria-pressed", String(next));
    btn.innerHTML = `${icon("bookmark", 14)} ${next ? "On your list" : "Want to watch"}`;
  });
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
    btn.innerHTML = `${icon("sparkle", 15)} Ask Claude to write it up`;
    showToast("Couldn't reach the analysis service — try again in a moment.");
  }
}

function closeDetail() {
  overlay.classList.add("hidden");
  panel.innerHTML = "";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetail();
  if (e.key === "/") {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    openGlobalSearch();
  }
});
