const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new DatabaseSync(path.join(dataDirectory, "cine-de-todo.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user'))
  );
  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    year TEXT NOT NULL DEFAULT '',
    rating REAL,
    genres TEXT NOT NULL DEFAULT '[]',
    source_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, movie_id)
  );
`);

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (userCount === 0) {
  const insertUser = db.prepare(
    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
  );
  db.exec("BEGIN");
  try {
    insertUser.run(
      process.env.ADMIN_EMAIL || "admin@cine.local",
      bcrypt.hashSync(process.env.ADMIN_PASSWORD || "admin123", 10),
      "admin"
    );
    insertUser.run(
      process.env.USER_EMAIL || "usuario@cine.local",
      bcrypt.hashSync(process.env.USER_PASSWORD || "usuario123", 10),
      "user"
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

app.use(express.json({ limit: "100kb" }));

const jwtSecret = process.env.JWT_SECRET || "solo-desarrollo-cambia-este-secreto";
function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token) {
    return res.status(401).json({ error: "Inicia sesión para continuar." });
  }
  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: "La sesión expiró o no es válida." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Esta acción requiere permisos de administrador." });
  }
  return next();
}

function parseMovie(row) {
  if (!row) return null;
  return { ...row, genres: JSON.parse(row.genres) };
}

function isUniqueConstraintError(error) {
  return error.errcode === 2067 || error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE";
}

function validateMovie(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "Envía los datos de la película.";
  }
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160) {
    return "El título es obligatorio y debe tener máximo 160 caracteres.";
  }
  if (typeof input.summary !== "string" || input.summary.length > 5000) {
    return "La sinopsis debe ser texto de máximo 5000 caracteres.";
  }
  if (typeof input.imageUrl !== "string" || input.imageUrl.length > 1000) {
    return "La URL de imagen debe ser texto de máximo 1000 caracteres.";
  }
  if (input.imageUrl && !/^https:\/\/\S+$/i.test(input.imageUrl)) {
    return "La URL de imagen debe usar HTTPS.";
  }
  if (typeof input.year !== "string" || input.year.length > 12) {
    return "El año debe ser texto de máximo 12 caracteres.";
  }
  if (
    input.rating !== null &&
    input.rating !== undefined &&
    (typeof input.rating !== "number" || !Number.isFinite(input.rating) || input.rating < 0 || input.rating > 10)
  ) {
    return "La puntuación debe estar entre 0 y 10.";
  }
  if (!Array.isArray(input.genres) || input.genres.length > 20 ||
      input.genres.some((genre) => typeof genre !== "string" || genre.length > 40)) {
    return "Los géneros deben ser una lista de texto válida.";
  }
  if (
    input.sourceId !== undefined &&
    input.sourceId !== null &&
    (typeof input.sourceId !== "string" || input.sourceId.length > 80)
  ) {
    return "El identificador de origen no es válido.";
  }
  return null;
}

function movieValues(input) {
  return [
    input.title.trim(),
    input.summary.trim(),
    input.imageUrl.trim(),
    input.year.trim(),
    input.rating ?? null,
    JSON.stringify(input.genres),
    input.sourceId || null,
  ];
}

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Escribe tu correo y contraseña." });
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Correo o contraseña incorrectos." });
  }
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: "8h" }
  );
  return res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/movies", authenticate, (req, res) => {
  const rows = db.prepare("SELECT * FROM movies ORDER BY created_at DESC, id DESC").all();
  res.json({ movies: rows.map(parseMovie) });
});

app.post("/api/movies", authenticate, requireAdmin, (req, res) => {
  const error = validateMovie(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const result = db.prepare(`
      INSERT INTO movies (title, summary, image_url, year, rating, genres, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(...movieValues(req.body));
    const movie = parseMovie(db.prepare("SELECT * FROM movies WHERE id = ?").get(result.lastInsertRowid));
    return res.status(201).json({ movie });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ error: "Este título ya está guardado en la colección." });
    }
    throw error;
  }
});

app.put("/api/movies/:id", authenticate, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Identificador de película no válido." });
  }
  const error = validateMovie(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const result = db.prepare(`
      UPDATE movies
      SET title = ?, summary = ?, image_url = ?, year = ?, rating = ?, genres = ?, source_id = ?
      WHERE id = ?
    `).run(...movieValues(req.body), id);
    if (result.changes === 0) return res.status(404).json({ error: "No se encontró esa película." });
    const movie = parseMovie(db.prepare("SELECT * FROM movies WHERE id = ?").get(id));
    return res.json({ movie });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ error: "Este título ya está guardado en la colección." });
    }
    throw error;
  }
});

app.delete("/api/movies/:id", authenticate, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Identificador de película no válido." });
  }
  const result = db.prepare("DELETE FROM movies WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ error: "No se encontró esa película." });
  return res.status(204).end();
});

// ----- Favoritos (cada usuario tiene los suyos) -----

// lista de ids de las películas favoritas del usuario
app.get("/api/favorites", authenticate, (req, res) => {
  const rows = db.prepare("SELECT movie_id FROM favorites WHERE user_id = ?").all(req.user.id);
  res.json({ favorites: rows.map((row) => row.movie_id) });
});

// agregar a favoritos
app.post("/api/favorites/:movieId", authenticate, (req, res) => {
  const movieId = Number(req.params.movieId);
  if (!Number.isInteger(movieId) || movieId < 1) {
    return res.status(400).json({ error: "Identificador de película no válido." });
  }
  const movie = db.prepare("SELECT id FROM movies WHERE id = ?").get(movieId);
  if (!movie) return res.status(404).json({ error: "No se encontró esa película." });
  db.prepare("INSERT OR IGNORE INTO favorites (user_id, movie_id) VALUES (?, ?)").run(req.user.id, movieId);
  return res.status(201).json({ movieId });
});

// quitar de favoritos
app.delete("/api/favorites/:movieId", authenticate, (req, res) => {
  const movieId = Number(req.params.movieId);
  if (!Number.isInteger(movieId) || movieId < 1) {
    return res.status(400).json({ error: "Identificador de película no válido." });
  }
  db.prepare("DELETE FROM favorites WHERE user_id = ? AND movie_id = ?").run(req.user.id, movieId);
  return res.status(204).end();
});

app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: "Ocurrió un error interno. Inténtalo de nuevo." });
});

app.listen(port, () => {
  console.log(`Cine de todo está disponible en http://localhost:${port}`);
});
