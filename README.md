# YumeVerse

YumeVerse es una web de anime con diseno oscuro, animaciones suaves y datos en tiempo real.

## Arranque rapido

```bash
npm install
npm start
```

Abre:

- `http://localhost:8787`

## Login y registro

El sistema de autenticacion ya incluye:

- Login/registro local con correo y contrasena (funciona sin configurar nada externo)
- Login con Google (opcional, autoregistro en el primer acceso)

Configura variables de entorno antes de iniciar:

```bash
set GOOGLE_CLIENT_ID=tu_google_client_id.apps.googleusercontent.com
set SESSION_SECRET=una_clave_larga_y_segura
npm start
```

Si no defines `GOOGLE_CLIENT_ID`, sigue funcionando el login por correo.

## Que guarda por usuario

Cada cuenta tiene su propio perfil en backend:

- Historial de animes vistos y episodio actual
- Favoritos
- Pendientes
- Recomendaciones personalizadas

La pagina `profile.html` muestra todo en "Mi perfil".

## Endpoints principales

- `GET /api/config`
- `GET /api/auth/session`
- `POST /api/auth/google`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/profile/me`
- `POST /api/profile/list/toggle`
- `POST /api/profile/history/upsert`
- `POST /api/profile/history/remove`
- `POST /api/profile/history/clear`
- `GET /api/profile/recommendations`
- `POST /api/anilist`
- `GET /api/jikan/*`
- `GET /api/translate?q=texto&source=en&target=es`
- `POST /api/synopsis`
- `POST /api/image-quality`
- `GET /api/health`

## Inicio rapido en Windows

- Ejecuta `Iniciar-YumeVerse.bat`
