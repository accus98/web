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
- Verificacion de correo para cuentas locales
- Recuperacion de contrasena (token temporal)
- Pantalla de ayuda post-recuperacion (`password-recovery-sent.html`)
- Cambio de contrasena desde `profile.html`
- Cierre de otras sesiones desde `profile.html`
- Limite de intentos para frenar fuerza bruta
- Persistencia de sesion (no se pierde al reiniciar servidor)
- Auditoria de seguridad en archivo (`security.log`)

Configura variables de entorno antes de iniciar:

```bash
set GOOGLE_CLIENT_ID=tu_google_client_id.apps.googleusercontent.com
set SESSION_SECRET=una_clave_larga_y_segura
npm start
```

Si no defines `GOOGLE_CLIENT_ID`, sigue funcionando el login por correo.

### Recuperacion de contrasena (correo)

Para envio real por email (recomendado en produccion):

```bash
set SMTP_HOST=smtp.tu-proveedor.com
set SMTP_PORT=587
set SMTP_USER=tu_usuario_smtp
set SMTP_PASS=tu_password_smtp
set SMTP_FROM="YumeVerse <no-reply@tu-dominio.com>"
set SMTP_SECURE=false
set APP_BASE_URL=https://tu-dominio.com
```

Notas:

- En desarrollo, si no hay SMTP, el backend escribe enlaces de verificacion y recuperacion en la consola.
- En produccion sin SMTP, la recuperacion se desactiva automaticamente.
- Usa siempre un `SESSION_SECRET` largo (minimo 24 caracteres).
- Al cambiar/restablecer contrasena, se invalidan otros tokens de recuperacion pendientes del usuario.

Opcional para entornos de prueba:

```bash
set YV_DATA_DIR=.yv-data-test
```

Si no se define, usa `.yv-data`.

Flujo de verificacion local:

1. Registro por correo -> cuenta creada sin sesion.
2. Se envia enlace de verificacion (o se imprime en consola en local).
3. Usuario abre `verify-email.html?token=...`.
4. Cuenta verificada y sesion iniciada automaticamente.

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
- `POST /api/auth/email/resend`
- `POST /api/auth/email/verify`
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `POST /api/auth/password/change`
- `GET /api/auth/sessions`
- `POST /api/auth/sessions/revoke`
- `POST /api/auth/sessions/revoke-others`
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

## Tests de autenticacion

```bash
npm run test:auth
```

Ejecuta flujos E2E de:

- registro con verificacion de correo
- recuperacion de contrasena
- escritura de auditoria de seguridad
