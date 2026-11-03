# Cine de todo

Aplicación web de películas y series hecha con HTML, CSS y JavaScript, con un backend en Node.js (Express) y base de datos SQLite.

- El catálogo de títulos viene de la API pública de [TVmaze](https://www.tvmaze.com/api).
- Para entrar hay que iniciar sesión.
- El administrador elige qué títulos forman parte de la colección, y los usuarios solo ven esa colección.

## Requisitos

- Node.js 22.13 o posterior (trae `node:sqlite` incluido, no hay que instalar SQLite aparte)
- Conexión a internet para consultar TVmaze

## Cómo correrlo

```bash
npm install
npm start
```

Abre <http://localhost:3000>. La base de datos se crea sola en `data/cine-de-todo.db` la primera vez que arranca el servidor.

## Cuentas de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@cine.local` | `admin123` |
| Usuario | `usuario@cine.local` | `usuario123` |

## Qué puede hacer cada rol

**Administrador**
- Ver el catálogo de TVmaze en "Descubrir", buscar y filtrar por género.
- Guardar títulos en la colección. Si ya están guardados, el botón aparece como "✓ En tu colección".
- Agregar, editar y eliminar títulos en "Mi colección".

**Usuario**
- Ver solo las películas que el administrador agregó a la colección.
- Buscar dentro de esa lista.

## Estructura

```
server.js          Servidor Express: login, API y base de datos
public/index.html  Estructura de la página
public/styles.css  Estilos
public/app.js      Lógica del frontend (login, catálogo, colección)
```

## API

Todas las respuestas son JSON. Las rutas protegidas necesitan el token que devuelve el login, en el header `Authorization: Bearer <token>`.

| Método | Ruta | Acceso | Acción |
|---|---|---|---|
| `POST` | `/api/auth/login` | Público | Inicia sesión y devuelve token y rol |
| `GET` | `/api/auth/me` | Con sesión | Devuelve el usuario actual |
| `GET` | `/api/movies` | Con sesión | Lista la colección |
| `POST` | `/api/movies` | Admin | Agrega un título |
| `PUT` | `/api/movies/:id` | Admin | Edita un título |
| `DELETE` | `/api/movies/:id` | Admin | Elimina un título |

Ejemplo de cuerpo para agregar o editar:

```json
{
  "title": "Nombre del título",
  "summary": "Sinopsis",
  "imageUrl": "https://example.com/poster.jpg",
  "year": "2026",
  "rating": 8.5,
  "genres": ["Drama"],
  "sourceId": null
}
```

## Variables de entorno (opcional)

Las cuentas de prueba se pueden cambiar antes de crear la base de datos con `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `USER_EMAIL` y `USER_PASSWORD`. Para algo más que pruebas locales, define también `JWT_SECRET` con un valor propio.
