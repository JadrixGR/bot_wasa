# JadrixServs Bot V4.1

Bot de WhatsApp Web con panel privado para administrar respuestas, clientes, cobros, vencimientos y recordatorios.

## Mejoras de esta actualización

- Después de escanear el QR, el panel muestra el porcentaje real de sincronización.
- Si WhatsApp queda vinculado pero no llega a `ready`, intenta completar la sincronización y reinicia una vez sin borrar la sesión.
- Botón **Forzar conexión** para recuperar manualmente una carga detenida.
- Estado técnico visible: porcentaje, estado de WhatsApp Web y versión cargada.
- Cada mensaje muestra “escribiendo…” y espera brevemente antes de enviarse.
- Los audios simulan el estado de grabación.
- Un saludo recibe una sola respuesta corta.
- El catálogo, los planes y los pagos se envían únicamente cuando el cliente los pide.
- Las preguntas de precio reciben solamente precio y duración, sin bloques adicionales.
- `OPENAI_API_KEY` activa una IA de respaldo para preguntas no previstas.
- La IA usa únicamente la información entrenada de JadrixServs, responde en 1–3 oraciones y no inventa datos.
- El panel permite probar la conexión con OpenAI sin mostrar ni guardar la clave.

También conserva:

- Catálogo completo de JadrixServs.
- Plan Pro de S/60 y Plan Plus de S/25.
- Pagos por Yape y Binance/USDT.
- Audio DICloak y catálogo PDF configurables.
- Registro de clientes, compras y vencimientos.
- Renovación anticipada sin perder días.
- Recordatorios 1 o 2 días antes.
- Cobro automático opcional, inicialmente desactivado.
- Exportación de clientes a CSV.

## Actualizar el repositorio

Descomprime el ZIP y reemplaza con su contenido todos los archivos del proyecto anterior. En Windows CMD, dentro de la carpeta:

```bat
git add .
git commit -m "Actualizar JadrixServs a V4.1"
git push
```

Render iniciará un nuevo despliegue si el repositorio tiene Auto-Deploy activado.

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
| `WHATSAPP_READY_TIMEOUT_MS` | `60000` |

No escribas la clave de OpenAI dentro de ningún archivo ni la subas a GitHub. Debe existir únicamente como variable secreta de Render.

## Conectar WhatsApp

1. Abre la URL de Render e ingresa al panel.
2. Entra a **WhatsApp**.
3. Escanea el QR desde **WhatsApp → Dispositivos vinculados → Vincular dispositivo**.
4. El panel cambiará a **Sincronizando** y mostrará el porcentaje.
5. Espera hasta que aparezca **Conectado**.

Si el celular muestra la sesión iniciada pero el panel no conecta:

1. Espera un minuto; la recuperación automática se ejecutará.
2. Pulsa **Forzar conexión**.
3. Si continúa detenido, pulsa **Cerrar sesión**.
4. En el celular elimina el dispositivo JadrixServs que haya quedado vinculado.
5. Escanea el QR nuevo y no cierres el panel hasta que diga **Conectado**.

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

- La sesión de WhatsApp.
- Los clientes y vencimientos.
- El audio DICloak y el PDF.

Sin disco persistente, Render perderá la sesión y los datos cuando reinicie o vuelva a desplegar.

## Uso del panel

- **WhatsApp:** QR, progreso, recuperación, reinicio y cierre de sesión.
- **Clientes y cobros:** compras, renovaciones y recordatorios.
- **Mensajes y archivos:** saludo corto, respuestas bajo pedido, OpenAI, pagos, audio y PDF.
- **Atención personal:** reactiva el bot después de que un cliente pidió un asesor.
- **Actividad:** mensajes, IA, comprobantes, recordatorios y errores.

## Importante

Este proyecto usa `whatsapp-web.js`, que automatiza WhatsApp Web y no es la API oficial de Meta. Evita envíos masivos y mensajes no solicitados. WhatsApp puede cambiar su funcionamiento y requerir futuras actualizaciones.
