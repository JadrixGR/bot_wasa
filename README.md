# JadrixServs Bot V4.2

Bot de WhatsApp con panel privado para administrar respuestas, clientes, cobros, vencimientos y recordatorios.

## Corrección del inicio de sesión

La V4.2 reemplaza la conexión anterior basada en `whatsapp-web.js` y Chromium por Baileys 7 mediante WebSocket.

- El teléfono y el bot ahora completan el vínculo usando el mismo evento de conexión.
- Al aceptar el QR, el reinicio requerido por WhatsApp ocurre automáticamente y conserva las credenciales.
- Si la conexión se interrumpe, se restaura sin pedir otro QR mientras la sesión siga siendo válida.
- La sesión se guarda en el disco persistente de Render.
- Ya no se instala ni ejecuta Chromium, por lo que el despliegue consume menos memoria.
- El panel muestra QR, autenticación, reconexión, conexión completa y errores de sesión.
- **Forzar conexión** reabre el socket sin borrar la sesión.
- **Cerrar sesión** elimina las credenciales guardadas y genera un QR completamente nuevo.

También conserva:

- Estado “escribiendo…” y una demora breve antes de cada respuesta.
- Estado de grabación para los audios.
- Respuestas breves que contestan solamente lo preguntado.
- Catálogo y planes únicamente cuando el cliente los solicita.
- `OPENAI_API_KEY` como respaldo para preguntas no previstas.
- Catálogo completo de JadrixServs.
- Plan Pro de S/60 y Plan Plus de S/25.
- Pagos por Yape y Binance/USDT.
- Audio DICloak y catálogo PDF configurables.
- Registro de clientes, compras y vencimientos.
- Renovación anticipada sin perder días.
- Recordatorios 1 o 2 días antes.
- Cobro automático opcional, inicialmente desactivado.
- Exportación de clientes a CSV.

## Limpiar los archivos antiguos

En la captura aparecen archivos de versiones anteriores mezclados con el proyecto nuevo:

- `server.js`
- `seed-data.js`
- `ACTUALIZAR-A-V3.txt`
- `ACTUALIZAR-A-V4.txt`
- `INSTRUCCIONES-ACTUALIZACION.txt`
- `INSTRUCCIONES-RAPIDAS.txt`

La V4.2 no usa ninguno. El proceso correcto siempre inicia `src/server.js`.

Después de copiar el contenido del ZIP nuevo, abre CMD dentro de la carpeta del repositorio y ejecuta:

```bat
git rm --ignore-unmatch server.js seed-data.js ACTUALIZAR-A-V3.txt ACTUALIZAR-A-V4.txt INSTRUCCIONES-ACTUALIZACION.txt INSTRUCCIONES-RAPIDAS.txt
git add -A
git commit -m "Actualizar JadrixServs a V4.2"
git push
```

No borres la carpeta `.git`.

## Variables necesarias en Render

En **Render → tu servicio → Environment**, comprueba estas variables:

| Variable | Valor |
| --- | --- |
| `ADMIN_PASSWORD` | Tu contraseña para entrar al panel. |
| `COOKIE_SECRET` | Texto largo y secreto. |
| `DATA_DIR` | `/data` |
| `MEDIA_DIR` | `/data/media` |
| `BOT_TIMEZONE` | `America/Lima` |
| `OPENAI_API_KEY` | Tu clave de la plataforma de OpenAI. |
| `OPENAI_MODEL` | `gpt-5.6` |
| `OPENAI_TIMEOUT_MS` | `25000` |
| `HUMAN_DELAY_MIN_MS` | `900` |
| `HUMAN_DELAY_MAX_MS` | `4200` |
| `WHATSAPP_READY_TIMEOUT_MS` | `45000` |
| `WHATSAPP_RECONNECT_DELAY_MS` | `3000` |

No escribas la clave de OpenAI dentro de ningún archivo ni la subas a GitHub.

## Vincular nuevamente después de actualizar

La sesión creada por la conexión antigua no se reutiliza. Haz este procedimiento una sola vez:

1. Espera a que el despliegue V4.2 de Render termine correctamente.
2. En el celular abre **WhatsApp → Dispositivos vinculados**.
3. Elimina el dispositivo viejo del bot si todavía aparece.
4. Abre el panel de JadrixServs y entra a **WhatsApp**.
5. Pulsa **Cerrar sesión** para limpiar del disco la sesión anterior.
6. Cuando aparezca el QR nuevo, pulsa **Vincular dispositivo** en el celular y escanéalo.
7. El panel mostrará **Autenticando** y luego **Conectado**. No pulses Reiniciar mientras completa este paso.

Después del QR, WhatsApp puede solicitar internamente un reinicio de la conexión. La V4.2 lo reconoce y lo completa automáticamente.

Si no aparece **Conectado** después de 45 segundos:

1. Pulsa **Forzar conexión** una sola vez.
2. Espera otros 45 segundos.
3. Si aparece **Error de sesión**, usa **Cerrar sesión**, elimina el dispositivo del celular y escanea el siguiente QR.
4. Revisa **Actividad**: allí se guarda el código de desconexión para el diagnóstico.

## Probar OpenAI

1. Agrega `OPENAI_API_KEY` en las variables de Render.
2. Guarda los cambios y ejecuta un nuevo deploy.
3. Abre **Mensajes y archivos → IA de respaldo**.
4. Pulsa **Probar conexión con OpenAI**.

Las respuestas predeterminadas se usan primero. OpenAI se consulta solamente cuando la pregunta no coincide con esas reglas.

## Probarlo en una computadora

Necesitas Node.js 20 o superior:

```bash
npm install
```

En Windows CMD:

```bat
set ADMIN_PASSWORD=TuClaveSegura
set COOKIE_SECRET=UnTextoLargoYSecreto
set OPENAI_API_KEY=TuClaveDeOpenAI
npm start
```

Abre `http://localhost:3000`.

## Disco persistente

El archivo `render.yaml` usa un servicio Starter y un disco de 1 GB montado en `/data`. Allí se guardan:

- Las credenciales de la sesión de WhatsApp.
- Los clientes y vencimientos.
- El audio DICloak y el PDF.

Sin disco persistente, Render perderá la sesión y los datos cuando reinicie o vuelva a desplegar.

La carpeta de autenticación equivale a una credencial privada. No la subas a GitHub, no la compartas y no publiques capturas de su contenido.

## Importante

Este proyecto usa Baileys, que se conecta a WhatsApp Web sin la API oficial de Meta. Evita envíos masivos y mensajes no solicitados. WhatsApp puede cambiar su funcionamiento y requerir futuras actualizaciones.
