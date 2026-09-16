// Firebase is loaded dynamically so a blocked/offline network (ad-blockers,
// no connectivity, etc.) degrades gracefully to "browsing works, watched
// status just isn't saved" instead of a blank white screen.
let watchedApi = {
  isWatched: () => false,
  toggleWatched: async () => {},
  onWatchedChange: () => () => {},
  ensureWatchedLoaded: async () => ({}),
};
let firebaseOk = false;

function isWatched(id) { return watchedApi.isWatched(id); }
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

  // First paint immediately with whatever local watched-state we have
  // (none, until Firebase connects) so the UI never sits blank.
  render();

  try {
    const mod = await import("./firebase-config.js");
    watchedApi = mod;
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
      ${watched ? '<div class="watched-badge">✓</div>' : ""}
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
}

// ---------------------------------------------------------------- home
function renderHome() {
  const total = films.length;
  const watched = watchedCount(films);
  const bp = films.filter((f) => (f.oscar_wins || []).some((w) => w.category === "Best Picture"));
  const bpWatched = watchedCount(bp);

  app.innerHTML = `
    <h1 class="page-title">Welcome back</h1>
    <p class="subtle">${watched} of ${total} films watched so far. Keep going.</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${watched}/${total}</div><div class="stat-label">All films</div></div>
      <div class="stat-card"><div class="stat-num">${bpWatched}/${bp.length}</div><div class="stat-label">Best Picture winners</div></div>
    </div>
    <h2 class="section-title">Jump in</h2>
    <div class="chip-row">
      <a href="#/classics" class="chip">📚 Browse the classics</a>
      <a href="#/oscars" class="chip">🏆 Browse the Oscars</a>
      <a href="#/classics?unwatched=1" class="chip">🎯 What should I watch next?</a>
    </div>
    <h2 class="section-title">Recently added</h2>
    <div class="grid">${films.slice(0, 12).map(filmCard).join("")}</div>
  `;
  attachCardHandlers(app);
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
    <p class="subtle">The essential canon — 1,158 films from the "1001 Movies" list, plus every other Oscar-winning film.</p>
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

// ---------------------------------------------------------------- detail
function openDetail(filmId) {
  const f = filmsById.get(filmId);
  if (!f) return;
  const watched = isWatched(f.id);
  const oscarLines = (f.oscar_wins || [])
    .map((w) => `${w.category} (${w.year_ceremony})`)
    .join(" · ");

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
        ${f.why_iconic || f.synopsis
          ? `<p>${escapeHtml(f.why_iconic || f.synopsis)}</p>`
          : `<p class="pending-note">Non-spoiler write-up for this one hasn't been added yet.</p>`}
      </div>

      <button class="spoiler-toggle" id="spoiler-toggle">🔒 Show deep analysis (contains spoilers)</button>
      <p class="spoiler-warning" style="display:none" id="spoiler-warning">Only tap this after watching — full plot and ending discussed below.</p>
      <div class="spoiler-body" id="spoiler-body">
        ${f.hidden_analysis
          ? `<p>${escapeHtml(f.hidden_analysis)}</p>`
          : `<p class="pending-note">Deep analysis for this one hasn't been written yet.</p>`}
      </div>

      ${f.fun_facts && f.fun_facts.length ? `
      <div class="detail-section" style="margin-top:16px">
        <h3>Fun facts</h3>
        <ul class="fun-facts">${f.fun_facts.map((ff) => `<li>${escapeHtml(ff)}</li>`).join("")}</ul>
      </div>` : ""}
    </div>
  `;

  overlay.classList.remove("hidden");
  document.getElementById("close-detail").addEventListener("click", closeDetail);
  document.getElementById("watch-btn").addEventListener("click", () => toggleWatched(f.id));
  document.getElementById("spoiler-toggle").addEventListener("click", () => {
    document.getElementById("spoiler-body").classList.toggle("open");
    document.getElementById("spoiler-warning").style.display = "block";
  });
}

function closeDetail() {
  overlay.classList.add("hidden");
  panel.innerHTML = "";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetail();
});
