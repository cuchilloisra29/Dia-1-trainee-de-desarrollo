const API_BASE = "/api";
const TVMAZE_BASE = "https://api.tvmaze.com";
const state = {
  view: "discover",
  shows: [],
  collection: [],
  genres: ["Todos"],
  genre: "Todos",
  page: 0,
  query: "",
  sort: "rating",
    user: null,
    token: localStorage.getItem("cinedetodoToken"),
  loading: false,
  tvController: null,
};

const grid = document.querySelector("#movieGrid");
const statusMessage = document.querySelector("#statusMessage");
const filterList = document.querySelector("#filterList");
const loadMoreButton = document.querySelector("#loadMore");
const searchInput = document.querySelector("#searchInput");
const searchPanel = document.querySelector("#searchPanel");
const loginScreen = document.querySelector("#loginScreen");
const appView = document.querySelector("#app");
const movieDialog = document.querySelector("#movieDialog");
let searchTimer;

function setStatus(message) {
  statusMessage.textContent = message;
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) clearSession();
    throw new Error(data.error || "No se pudo completar la solicitud.");
  }
  return data;
}

function clearSession() {
  state.token = null;
  state.user = null;
  state.shows = [];
  state.collection = [];
  state.tvController?.abort();
  localStorage.removeItem("cinedetodoToken");
  showLoginScreen();
}

function showLoginScreen() {
  appView.classList.add("is-hidden");
  loginScreen.classList.remove("is-hidden");
  movieDialog.close();
  document.querySelector("#loginError").textContent = "";
  document.querySelector("#passwordInput").value = "";
  document.querySelector("#emailInput").focus();
}

async function enterApp() {
  loginScreen.classList.add("is-hidden");
  appView.classList.remove("is-hidden");
  state.genre = "Todos";
  updateAccount();

  // El admin ve el catálogo de TVmaze; el usuario normal solo ve lo que el admin agregó
  const isAdmin = state.user.role === "admin";
  // Las pestañas solo tienen sentido para el admin (el usuario tiene una sola vista)
  document.querySelector(".main-nav").classList.toggle("is-hidden", !isAdmin);
  document.querySelector(".intro p").textContent = isAdmin
    ? "Busca películas y series en el catálogo y elige cuáles podrán ver los usuarios."
    : "Estas son las películas y series disponibles para ti.";

  if (isAdmin) {
    state.view = "discover";
    try {
      await fetchCollection();
    } catch {
      // si falla, el catálogo se muestra igual
    }
    await loadShows();
  } else {
    state.view = "collection";
    await loadCollection();
  }
}

function updateAccount() {
  if (state.user) {
    document.querySelector("#accountAvatar").textContent = state.user.email.slice(0, 1).toUpperCase();
    document.querySelector("#accountName").textContent =
      state.user.role === "admin" ? "Admin" : "Mi cuenta";
  }
}

async function restoreSession() {
  if (!state.token) return;
  try {
    const data = await request(`${API_BASE}/auth/me`);
    state.user = data.user;
  } catch {
    localStorage.removeItem("cinedetodoToken");
    state.token = null;
  }
  updateAccount();
}

function showGenres(shows) {
  const genres = new Set(["Todos"]);
  for (const show of shows) {
    for (const genre of show.genres || []) genres.add(genre);
  }
  state.genres = [...genres];
  if (!genres.has(state.genre)) state.genre = "Todos";
  filterList.replaceChildren();
  for (const genre of state.genres) {
    const button = document.createElement("button");
    button.className = `filter-chip${genre === state.genre ? " is-active" : ""}`;
    button.type = "button";
    button.textContent = genre;
    button.setAttribute("aria-pressed", String(genre === state.genre));
    button.addEventListener("click", () => {
      state.genre = genre;
      render();
    });
    filterList.append(button);
  }
}

function plainText(value) {
  if (!value) return "";
  return new DOMParser().parseFromString(value, "text/html").body.textContent.trim();
}

function normalizeShow(show) {
  return {
    id: `tvmaze-${show.id}`,
    sourceId: String(show.id),
    title: show.name || "Sin título",
    summary: plainText(show.summary),
    imageUrl: show.image?.medium || show.image?.original || "",
    year: show.premiered ? show.premiered.slice(0, 4) : "",
    rating: show.rating?.average ?? null,
    genres: Array.isArray(show.genres) ? show.genres : [],
  };
}

function normalizeSaved(movie) {
  return { ...movie, id: String(movie.id), imageUrl: movie.image_url || movie.imageUrl || "" };
}

async function loadShows({ append = false } = {}) {
  if (append && state.loading) return;
  if (!append) state.tvController?.abort();
  const controller = new AbortController();
  state.tvController = controller;
  state.loading = true;
  loadMoreButton.disabled = true;
  setStatus(append ? "Cargando más títulos..." : "Buscando títulos...");
  if (!append) grid.replaceChildren();
  try {
    let shows;
    if (state.query.trim()) {
      const response = await fetch(
        `${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(state.query.trim())}`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error("No fue posible buscar títulos en TVmaze.");
      const data = await response.json();
      shows = data.map((item) => item.show);
    } else {
      const response = await fetch(`${TVMAZE_BASE}/shows?page=${state.page}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("No fue posible cargar títulos desde TVmaze.");
      shows = await response.json();
    }
    if (controller.signal.aborted) return;
    const normalized = shows.map(normalizeShow);
    state.shows = append ? [...state.shows, ...normalized] : normalized;
    showGenres(state.shows);
    render();
  } catch (error) {
    if (error.name !== "AbortError") setStatus(error.message);
  } finally {
    if (state.tvController === controller) {
      state.loading = false;
      loadMoreButton.disabled = false;
    }
  }
}

async function fetchCollection() {
  const data = await request(`${API_BASE}/movies`);
  state.collection = data.movies.map(normalizeSaved);
}

function isInCollection(item) {
  return state.collection.some((movie) => movie.source_id && movie.source_id === item.sourceId);
}

async function loadCollection() {
  setStatus("Cargando tu colección...");
  grid.replaceChildren();
  try {
    await fetchCollection();
    render();
  } catch (error) {
    setStatus(error.message);
  }
}

function getVisibleItems() {
  let items = state.view === "collection" ? [...state.collection] : [...state.shows];
  if (state.view === "discover" && state.genre !== "Todos") {
    items = items.filter((item) => item.genres.includes(state.genre));
  }
  if (state.view === "collection" && state.query.trim()) {
    const query = state.query.trim().toLowerCase();
    items = items.filter((item) => item.title.toLowerCase().includes(query));
  }
  if (state.sort === "rating") {
    items.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  } else if (state.sort === "newest") {
    items.sort((a, b) => (b.year || "").localeCompare(a.year || ""));
  } else if (state.sort === "alphabetical") {
    items.sort((a, b) => a.title.localeCompare(b.title, "es"));
  }
  return items;
}

function makeCard(item) {
  const card = document.createElement("article");
  card.className = "movie-card";

  const posterWrap = document.createElement("div");
  posterWrap.className = "poster-wrap";
  if (item.imageUrl) {
    const image = document.createElement("img");
    image.className = "poster";
    image.src = item.imageUrl;
    image.alt = `Póster de ${item.title}`;
    image.loading = "lazy";
    image.addEventListener("error", () => {
      const placeholder = document.createElement("div");
      placeholder.className = "poster-placeholder";
      placeholder.textContent = item.title.slice(0, 1).toUpperCase();
      image.replaceWith(placeholder);
    }, { once: true });
    posterWrap.append(image);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "poster-placeholder";
    placeholder.textContent = item.title.slice(0, 1).toUpperCase();
    posterWrap.append(placeholder);
  }

  if (item.rating !== null && item.rating !== undefined) {
    const rating = document.createElement("span");
    rating.className = "rating-badge";
    rating.textContent = `★ ${Number(item.rating).toFixed(1)}`;
    posterWrap.append(rating);
  }

  const overlay = document.createElement("div");
  overlay.className = "card-overlay";
  if (state.view === "discover" && state.user?.role === "admin") {
    const saveButton = document.createElement("button");
    saveButton.className = "card-action";
    saveButton.type = "button";
    if (isInCollection(item)) {
      saveButton.textContent = "✓ En tu colección";
      saveButton.disabled = true;
    } else {
      saveButton.textContent = "Guardar en colección";
      saveButton.addEventListener("click", () => saveShow(item));
    }
    overlay.append(saveButton);
  }
  if (state.view === "collection" && state.user?.role === "admin") {
    const editButton = document.createElement("button");
    editButton.className = "card-action";
    editButton.type = "button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => openMovieForm(item));
    const deleteButton = document.createElement("button");
    deleteButton.className = "card-action";
    deleteButton.type = "button";
    deleteButton.textContent = "Eliminar";
    deleteButton.addEventListener("click", () => deleteMovie(item));
    overlay.append(editButton, deleteButton);
  }
  posterWrap.append(overlay);

  const info = document.createElement("div");
  info.className = "movie-info";
  const meta = document.createElement("div");
  meta.className = "movie-meta";
  const genre = document.createElement("span");
  genre.className = "genre-label";
  genre.textContent = item.genres.slice(0, 2).join(" · ") || "Cine y televisión";
  const year = document.createElement("span");
  year.textContent = item.year || "—";
  meta.append(genre, year);
  const title = document.createElement("h3");
  title.textContent = item.title;
  title.title = item.title;
  info.append(meta, title);
  if (item.summary) {
    const summary = document.createElement("p");
    summary.className = "movie-summary";
    summary.textContent = item.summary;
    info.append(summary);
  }
  card.append(posterWrap, info);
  return card;
}

function render() {
  const visible = getVisibleItems();
  grid.replaceChildren(...visible.map(makeCard));
  document.querySelector("#catalogTitle").innerHTML =
    state.view === "discover" ? 'Explora el <span>catálogo</span>'
    : state.user?.role === "admin" ? 'Mi <span>colección</span>'
    : 'Películas <span>disponibles</span>';
  document.querySelectorAll(".nav-link").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelector(".sort-select").classList.toggle("is-hidden", state.view === "collection");
  filterList.classList.toggle("is-hidden", state.view === "collection");
  document.querySelector("#resultsCount").textContent =
    `${visible.length} ${visible.length === 1 ? "título" : "títulos"}`;
  loadMoreButton.classList.toggle("is-hidden", state.view === "collection" || Boolean(state.query.trim()));
  document.querySelector("#addMovieButton")?.remove();
  if (state.view === "collection" && state.user?.role === "admin") {
    const button = document.createElement("button");
    button.id = "addMovieButton";
    button.className = "load-more";
    button.type = "button";
    button.textContent = "＋ Agregar título";
    button.addEventListener("click", () => openMovieForm());
    document.querySelector(".section-heading").append(button);
  }
  if (visible.length) setStatus("");
  else if (state.view === "collection") {
    setStatus(state.user?.role === "admin"
      ? "Tu colección está vacía. Explora el catálogo y guarda títulos, o agrega uno manualmente."
      : "Todavía no hay películas disponibles. El administrador aún no ha agregado ninguna.");
  } else {
    setStatus("No encontramos títulos con esos filtros. Prueba otra búsqueda o categoría.");
  }
  updateAccount();
}

async function saveShow(item) {
  if (!state.user) return showLoginScreen();
  try {
    await request(`${API_BASE}/movies`, {
      method: "POST",
      body: JSON.stringify({
        title: item.title,
        summary: item.summary,
        imageUrl: item.imageUrl,
        year: item.year,
        rating: item.rating,
        genres: item.genres,
        sourceId: item.sourceId,
      }),
    });
    state.view = "collection";
    await loadCollection();
  } catch (error) {
    setStatus(error.message);
  }
}

function openMovieForm(movie) {
  document.querySelector("#movieError").textContent = "";
  document.querySelector("#movieDialogTitle").innerHTML =
    movie ? 'Editar <span>título</span>' : 'Agregar <span>título</span>';
  document.querySelector("#movieId").value = movie?.id || "";
  document.querySelector("#movieSourceId").value = movie?.source_id || movie?.sourceId || "";
  document.querySelector("#movieTitle").value = movie?.title || "";
  document.querySelector("#movieYear").value = movie?.year || "";
  document.querySelector("#movieRating").value = movie?.rating ?? "";
  document.querySelector("#movieGenres").value = (movie?.genres || []).join(", ");
  document.querySelector("#movieImage").value = movie?.imageUrl || "";
  document.querySelector("#movieSummary").value = movie?.summary || "";
  movieDialog.showModal();
}

async function deleteMovie(movie) {
  if (!window.confirm(`¿Eliminar "${movie.title}" de la colección?`)) return;
  try {
    await request(`${API_BASE}/movies/${encodeURIComponent(movie.id)}`, { method: "DELETE" });
    await loadCollection();
  } catch (error) {
    setStatus(error.message);
  }
}

document.querySelector("#logoutButton").addEventListener("click", clearSession);
document.querySelector("#exploreButton").addEventListener("click", () => {
  document.querySelector("#catalog").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#searchToggle").addEventListener("click", () => {
  searchPanel.classList.toggle("is-hidden");
  if (!searchPanel.classList.contains("is-hidden")) searchInput.focus();
});
document.querySelector("#clearSearch").addEventListener("click", () => {
  searchInput.value = "";
  state.query = "";
  state.page = 0;
  if (state.view === "collection") render();
  else loadShows();
});
document.querySelector("#sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
document.querySelector("#loadMore").addEventListener("click", () => {
  state.page += 1;
  loadShows({ append: true });
});
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = searchInput.value;
    state.page = 0;
    if (state.view === "collection") render();
    else loadShows();
  }, 350);
});
searchPanel.addEventListener("submit", (event) => event.preventDefault());
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "discover" && state.user?.role !== "admin") return;
    state.view = button.dataset.view;
    if (state.view === "collection") loadCollection();
    else render();
  });
});
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = document.querySelector("#loginError");
  errorNode.textContent = "";
  try {
    const data = await request(`${API_BASE}/auth/login`, {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#emailInput").value,
        password: document.querySelector("#passwordInput").value,
      }),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("cinedetodoToken", data.token);
    enterApp();
  } catch (error) {
    errorNode.textContent = error.message;
  }
});

document.querySelector("#movieForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = document.querySelector("#movieError");
  errorNode.textContent = "";
  const id = document.querySelector("#movieId").value;
  const ratingText = document.querySelector("#movieRating").value;
  const movie = {
    title: document.querySelector("#movieTitle").value,
    summary: document.querySelector("#movieSummary").value,
    imageUrl: document.querySelector("#movieImage").value,
    year: document.querySelector("#movieYear").value,
    rating: ratingText === "" ? null : Number(ratingText),
    genres: document.querySelector("#movieGenres").value.split(",").map((genre) => genre.trim()).filter(Boolean),
    sourceId: document.querySelector("#movieSourceId").value || null,
  };
  try {
    await request(id ? `${API_BASE}/movies/${encodeURIComponent(id)}` : `${API_BASE}/movies`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(movie),
    });
    movieDialog.close();
    await loadCollection();
  } catch (error) {
    errorNode.textContent = error.message;
  }
});

async function start() {
  await restoreSession();
  if (state.user) enterApp();
  else showLoginScreen();
}

start();
