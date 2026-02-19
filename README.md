# YumeVerse (Fase 1)

Fase 1 agrega una base estable para la web:

- Backend local para servir la pagina (`http://localhost:8787`).
- Proxy para AniList, Jikan y traduccion.
- Cache en memoria para reducir tiempos de carga y limites de API.

## Como iniciar

```bash
npm start
```

Luego abre:

- `http://localhost:8787`

## Inicio rapido en Windows (doble clic)

- Ejecuta `Iniciar-YumeVerse.bat`
- Se abrira el navegador automaticamente en `http://localhost:8787`

## Endpoints del backend

- `POST /api/anilist`
- `GET /api/jikan/*`
- `GET /api/translate?q=texto&source=en&target=es`
- `POST /api/synopsis`
- `POST /api/image-quality`
- `GET /api/health`

## Fase 2 y 3 (sinopsis)

- La ficha usa `POST /api/synopsis` para pedir sinopsis en espanol.
- Orden de fuentes cuando falta descripcion:
  1. AniList (si trae descripcion)
  2. Jikan (MyAnimeList)
  3. Kitsu (busqueda por titulo)
- La traduccion y el resultado se guardan en cache del backend para reducir errores y tiempos.

## Mejora de imagenes (punto 4)

- La home y la ficha piden `POST /api/image-quality` con `idMal`.
- El backend compara fuentes de Jikan (cover/trailer) y devuelve la mejor portada y banner disponibles.
- Se aplica en segundo plano para no frenar la carga inicial.
