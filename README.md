# JadrixServs Bot V4.4

Bot de WhatsApp con panel privado para dar una bienvenida única, registrar clientes y automatizar renovaciones.

## Flujo de mensajes

La V4.4 funciona en modo **solo bienvenida**:

1. El primer mensaje de un contacto nuevo activa los tres mensajes iniciales.
2. Los tres se envían por separado, mostrando “escribiendo…” y una pequeña demora antes de cada envío.
3. Después de completar esa secuencia, el bot no vuelve a responder los mensajes entrantes de ese contacto.
4. Si el número ya está registrado como cliente, sus respuestas tampoco activan la bienvenida.
5. Desde ese momento, el bot solamente envía recordatorios o cobranzas programadas desde el panel.

El contenido de los tres mensajes iniciales puede editarse en **Mensajes automáticos**. Los datos antiguos de productos y entrenamiento se conservan al actualizar, pero no generan respuestas en este modo. `OPENAI_API_KEY` no es necesaria para la bienvenida ni para las renovaciones.

## Clientes y renovaciones

En **Clientes y cobros** puedes guardar y editar:

- Nombre y número de WhatsApp.
- Servicio o plan comprado.
- Cuenta asociada, perfil o código interno.
- Precio y método de pago.
- Fecha de activación y fecha de vencimiento.
- Duración, estado y notas.
- Recordatorio automático y cobranza automática.

No guardes contraseñas en el campo **Cuenta asociada**.

Al registrar un cliente:

- El recordatorio queda activado por defecto y se envía exactamente **2 días antes** del vencimiento.
- La cobranza automática queda apagada. Debes activarla manualmente en la ficha del cliente si quieres que se envíe el día del vencimiento.
- Los botones **Recordar** y **Cobrar** permiten enviar cualquiera de los dos mensajes manualmente.
- **Procesar vencimientos** ejecuta una revisión inmediata.

El programador revisa los vencimientos cada 15 minutos mientras WhatsApp está conectado. Cada aviso se marca con la fecha de renovación para no enviarlo dos veces.

Al pulsar **Renovar**, el nuevo periodo comienza desde el vencimiento vigente si el cliente pagó antes; así no pierde días. También puedes actualizar la cuenta asociada durante la renovación.

## Editar los mensajes

En **Mensajes automáticos** puedes editar:

- Los tres mensajes de bienvenida.
- El recordatorio de 2 días antes.
- La cobranza del día de vencimiento.

Los mensajes de renovación admiten estas variables:

| Variable | Contenido |
| --- | --- |
| `{nombre}` | Nombre del cliente |
| `{producto}` | Servicio o plan |
| `{cuenta}` | Cuenta asociada |
| `{precio}` | Precio registrado |
| `{fecha}` | Fecha de vencimiento |

## Actualizar una instalación existente

1. Descomprime `JadrixServs-Bot-V4.zip`.
2. Copia el contenido de `jadrixservs-bot-v4` dentro de tu repositorio.
3. Acepta reemplazar los archivos y no borres la carpeta `.git`.
4. Elimina los archivos antiguos de la raíz si todavía existen:

```bat
git rm --ignore-unmatch server.js seed-data.js ACTUALIZAR-A-V3.txt ACTUALIZAR-A-V4.txt INSTRUCCIONES-ACTUALIZACION.txt INSTRUCCIONES-RAPIDAS.txt PASOS-ACTUALIZAR-V4.3.txt
git add -A
git commit -m "Actualizar JadrixServs a V4.4"
git push
```

El proceso inicia desde `src/server.js`. El archivo persistente `/data/jadrixservs-v4.json` se migra automáticamente a V4.4 y conserva clientes, fechas, mensajes, conversaciones y demás datos existentes. Los contactos que ya tenían una conversación guardada se marcan como atendidos para que la actualización no les repita la bienvenida.

## Variables de Render

En **Render → tu servicio → Environment** revisa:

| Variable | Valor recomendado |
| --- | --- |
| `ADMIN_PASSWORD` | Contraseña segura para el panel |
| `COOKIE_SECRET` | Texto largo y secreto |
| `DATA_DIR` | `/data` |
| `MEDIA_DIR` | `/data/media` |
| `BOT_TIMEZONE` | `America/Lima` |
| `REMINDER_CHECK_MINUTES` | `15` |
| `HUMAN_DELAY_MIN_MS` | `900` |
| `HUMAN_DELAY_MAX_MS` | `4200` |
| `WHATSAPP_READY_TIMEOUT_MS` | `45000` |
| `WHATSAPP_RECONNECT_DELAY_MS` | `3000` |

`render.yaml` configura un disco persistente de 1 GB montado en `/data`. Es indispensable para conservar la sesión de WhatsApp y los clientes después de cada despliegue.

## Vincular WhatsApp

1. Espera a que Render termine el despliegue.
2. Abre **WhatsApp** en el panel.
3. Si aparece un QR, en el celular entra a **Dispositivos vinculados → Vincular un dispositivo**.
4. Escanea el QR y espera; el panel debe pasar de **Autenticando** a **Conectado** automáticamente.
5. No pulses **Reiniciar** mientras esté autenticando.

Si el celular muestra la sesión iniciada pero el panel no termina de conectar:

1. Espera 45 segundos.
2. Pulsa **Forzar conexión** una sola vez.
3. Si continúa detenido, pulsa **Cerrar sesión**, elimina también ese dispositivo desde el celular y escanea el QR nuevo.

La sesión válida se guarda en `/data/whatsapp-session`; no hace falta volver a escanear después de cada despliegue.

## Prueba recomendada

Desde un número que no esté registrado como cliente:

1. Envía cualquier mensaje.
2. Debes recibir tres mensajes separados.
3. Envía una segunda consulta: el bot debe permanecer en silencio.

Luego registra un cliente con vencimiento dentro de 2 días, deja activo el recordatorio y pulsa **Procesar vencimientos**. Para probar la cobranza, usa un vencimiento de hoy y activa manualmente **Cobranza automática**.

## Ejecutar localmente

Requiere Node.js 20 o superior:

```bash
npm install
npm test
npm start
```

Abre `http://localhost:3000`.

La carpeta de autenticación de WhatsApp equivale a una credencial privada. No la subas a GitHub ni la compartas. Este proyecto usa Baileys y no la API oficial de Meta; evita envíos masivos o no solicitados.
