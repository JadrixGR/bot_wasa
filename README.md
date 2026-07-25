# JadrixServs Bot V4.3

Bot de WhatsApp con panel privado para administrar respuestas, entrenamiento, clientes, cobros, vencimientos y recordatorios.

## Qué corrige la V4.3

### Inicio de sesión de WhatsApp

La conexión usa Baileys 7 por WebSocket, sin Chromium.

- Guarda la sesión en el disco persistente de Render.
- Cuando WhatsApp acepta el QR y solicita un reinicio interno, lo completa automáticamente.
- Reintenta una conexión vinculada sin borrar sus credenciales.
- El panel distingue QR, autenticación, reconexión y conexión completa.
- **Forzar conexión** reabre la sesión guardada.
- **Cerrar sesión** elimina las credenciales y genera un QR totalmente nuevo.

### Super Combo IA 2026

La frase:

```text
¿Cuál es el precio del Super Combo IA 2026?
```

envía exactamente tres mensajes separados y en este orden:

1. Catálogo de JadrixServs.
2. Combos especiales.
3. Entrega, soporte y llamada final.

Cada mensaje muestra “escribiendo…”, espera un tiempo proporcional a su longitud y recién después se envía. Las frases que activan esta secuencia y el contenido de los tres mensajes se editan desde **Mensajes y archivos**.

Un “hola” normal recibe solamente el saludo corto. Las demás consultas reciben únicamente la información solicitada, no los tres bloques completos.

### Entrenamiento local

El panel ahora incluye **Entrenamiento local**:

- Puedes crear hasta 200 respuestas.
- Cada respuesta admite hasta 20 formas distintas de hacer la pregunta.
- Se puede activar, desactivar, editar o eliminar cada respuesta.
- Funciona aunque `OPENAI_API_KEY` no esté configurada o no tenga saldo.
- La V4.3 incluye respuestas sobre productos, privacidad, cuentas compartidas, dispositivos, DICloak, entrega, garantía, renovación, pagos, comprobantes, combos y streaming.

Los productos y planes también siguen entrenados directamente en el motor, con sus precios y condiciones.

### OpenAI como respaldo

OpenAI se consulta solamente cuando no coincide una respuesta local, un producto, un plan, un pago u otra regla confirmada.

- Usa la Responses API.
- El modelo recibe los productos, planes y respuestas editables.
- La instrucción exige contestar únicamente la pregunta actual en una a tres oraciones.
- No agrega catálogo, pagos ni promociones que no fueron solicitados.
- No inventa información: si falta un dato, deriva a un asesor.
- La respuesta máxima está limitada para controlar costo y evitar bloques largos.
- El modelo predeterminado es `gpt-5.6-luna`, apropiado para respuestas breves y de menor costo.

## Qué significa el error 429 de la captura

El mensaje `You exceeded your current quota` significa que la cuenta de la API no tiene créditos disponibles o alcanzó el límite de gasto. No significa que falte el código del bot.

ChatGPT Plus y la API de OpenAI tienen facturación separada. Para habilitar el respaldo:

1. Entra a la [facturación de la plataforma de OpenAI](https://platform.openai.com/settings/organization/billing/overview).
2. Agrega un método de pago y créditos de API.
3. Revisa que el proyecto u organización tenga un límite de gasto mayor que cero.
4. En Render configura `OPENAI_API_KEY` y `OPENAI_MODEL=gpt-5.6-luna`.
5. Despliega y usa **Mensajes y archivos → Probar conexión con OpenAI**.

La V4.3 traduce errores de cuota, clave, permisos, modelo y conexión a mensajes claros dentro del panel. Nunca envía el error 429 al cliente; usa el entrenamiento local o la respuesta para derivar a un asesor.

## Actualizar el repositorio

Antes de limpiar archivos antiguos, guarda una copia fuera del repositorio de `server.js` y `seed-data.js` si allí tenías respuestas personalizadas. El bot nuevo no ejecuta esos archivos; el proceso correcto inicia `src/server.js`.

1. Descomprime `JadrixServs-Bot-V4.zip`.
2. Copia el contenido de la carpeta `jadrixservs-bot-v4` dentro de tu repositorio.
3. Acepta reemplazar archivos y no borres `.git`.
4. Abre CMD dentro de la carpeta y ejecuta:

```bat
git rm --ignore-unmatch server.js seed-data.js ACTUALIZAR-A-V3.txt ACTUALIZAR-A-V4.txt INSTRUCCIONES-ACTUALIZACION.txt INSTRUCCIONES-RAPIDAS.txt
git add -A
git commit -m "Actualizar JadrixServs a V4.3"
git push
```

El archivo persistente `/data/jadrixservs-v4.json` conserva clientes, vencimientos, conversaciones y ajustes. Al leer datos V4.2, la aplicación instala automáticamente el disparador del Super Combo y el entrenamiento local V4.3.

## Variables de Render

En **Render → tu servicio → Environment**:

| Variable | Valor |
| --- | --- |
| `ADMIN_PASSWORD` | Contraseña segura para el panel. |
| `COOKIE_SECRET` | Texto largo y secreto. |
| `DATA_DIR` | `/data` |
| `MEDIA_DIR` | `/data/media` |
| `BOT_TIMEZONE` | `America/Lima` |
| `OPENAI_API_KEY` | Clave de la plataforma de OpenAI. |
| `OPENAI_MODEL` | `gpt-5.6-luna` |
| `OPENAI_TIMEOUT_MS` | `25000` |
| `HUMAN_DELAY_MIN_MS` | `900` |
| `HUMAN_DELAY_MAX_MS` | `4200` |
| `WHATSAPP_READY_TIMEOUT_MS` | `45000` |
| `WHATSAPP_RECONNECT_DELAY_MS` | `3000` |

No escribas claves dentro del código ni las subas a GitHub.

## Vincular WhatsApp después de actualizar

La sesión del sistema antiguo no es compatible con Baileys. Haz esto una sola vez:

1. Espera a que Render termine el despliegue V4.3.
2. En el celular abre **WhatsApp → Dispositivos vinculados**.
3. Elimina el dispositivo viejo del bot.
4. En el panel abre **WhatsApp** y pulsa **Cerrar sesión**.
5. Espera el QR nuevo y escanéalo.
6. No pulses Reiniciar mientras diga **Autenticando**.
7. El panel debe cambiar a **Conectado** automáticamente.

Si no conecta después de 45 segundos:

1. Pulsa **Forzar conexión** una sola vez.
2. Espera otros 45 segundos.
3. Si aparece **Error de sesión**, pulsa **Cerrar sesión**, elimina el dispositivo del celular y escanea el QR nuevo.
4. Revisa **Actividad** para ver el código de desconexión.

## Probar respuestas

Pruebas recomendadas desde otro número:

```text
¿Cuál es el precio del Super Combo IA 2026?
¿Cuánto cuesta Claude Pro?
¿Cuál es mejor, ChatGPT o Gemini?
¿Puedo renovar antes?
¿Cómo puedo pagar?
```

La primera debe producir tres mensajes. Cada una de las demás debe producir una sola respuesta relacionada con la pregunta.

## Ejecutar en una computadora

Requiere Node.js 20 o superior:

```bash
npm install
npm test
npm start
```

Abre `http://localhost:3000`.

## Disco persistente y seguridad

`render.yaml` configura un servicio Starter con un disco de 1 GB montado en `/data`. Allí se guardan:

- Credenciales de WhatsApp.
- Entrenamiento editable.
- Clientes y vencimientos.
- Audio DICloak y catálogo PDF.

La carpeta de autenticación equivale a una credencial privada. No la subas a GitHub ni la compartas.

Este proyecto usa Baileys y no la API oficial de Meta. Evita envíos masivos y mensajes no solicitados.
