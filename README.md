# Bot de WhatsApp con QR para Render — versión 2

Esta versión reemplaza `whatsapp-web.js` y Chromium por **Baileys**. El cambio evita el bloqueo donde el teléfono muestra el dispositivo vinculado, pero el servidor nunca recibe el evento `ready`.

## Actualizar un repositorio existente

Reemplaza todos los archivos del proyecto anterior por los de esta carpeta, manteniendo solamente tu carpeta `.git` local.

Desde PowerShell, dentro de la carpeta del proyecto:

```powershell
git add .
git commit -m "Cambiar conexion a Baileys"
git push
```

Render detectará el cambio y hará un nuevo despliegue automático.

## Después del despliegue

1. Espera a que Render muestre `Live`.
2. Abre la URL `.onrender.com`.
3. Entra con tu `ADMIN_KEY`.
4. Pulsa **Cerrar sesión y nuevo QR** si no aparece un QR limpio.
5. En el teléfono, elimina antes el dispositivo antiguo que quedó vinculado sin funcionar.
6. Escanea el QR nuevo.
7. El panel debe cambiar a **conectado**.

## Variables de Render

- `ADMIN_KEY`: contraseña del panel.
- `BUSINESS_NAME`: nombre del negocio.
- `BUSINESS_HOURS`: horario.
- `BUSINESS_ADDRESS`: dirección.
- `BUSINESS_MAPS_URL`: enlace opcional de Maps.
- `PRICE_TEXT`: respuesta de precios.
- `HUMAN_TEXT`: respuesta de asesor.
- `SESSION_PATH`: `/data/baileys_auth`.
- `WA_LOG_LEVEL`: `silent`.
- `WA_VERSION`: opcional; no la configures salvo que sea necesario diagnosticar una actualización de WhatsApp.

## Avisos

Esta integración no es oficial. Utiliza un número secundario, no envíes spam ni mensajes masivos. En Render gratuito, los datos locales se pueden borrar cuando el servicio se suspende o redespliega, por lo que puede pedir un QR nuevamente.
