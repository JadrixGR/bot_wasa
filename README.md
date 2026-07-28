# JadrixServs Bot V4.8.1 Profesional

## Corrección de conexión V4.8.1

- Corrige el bucle de reconexión con código `405` causado por el perfil Ubuntu rechazado por WhatsApp.
- Usa el perfil compatible **Mac OS + Chrome** que Baileys emplea actualmente como predeterminado.
- Ante un `405`, vuelve a conectar sin borrar `/data/whatsapp-session` ni pedir un QR innecesario.
- Oculta los volcados internos `Closing session: SessionEntry` para impedir que las claves efímeras de cifrado aparezcan en los logs de Render.
- Conserva íntegramente los clientes, mensajes, comandos, renovaciones, cobranzas, AFK, IA y configuración existentes.

## Diseño profesional de V4.8

- Interfaz profesional completamente renovada en el acceso y en todas las secciones del panel.
- Resumen ejecutivo con estados visuales, indicadores animados y contadores suaves.
- Navegación con iconos, cabecera inteligente y menú móvil accesible.
- Animaciones discretas en paneles, clientes, QR, ventanas y notificaciones.
- Modo día y modo noche rediseñados; la preferencia continúa guardándose en el navegador.
- Mejor adaptación para computadora, tablet y celular, sin eliminar ningún control.
- Se mantienen el bot, comandos, clientes, renovaciones, cobranzas, AFK, respaldos y conexión de WhatsApp.
- La actualización conserva `/data/jadrixservs-v4.json`, `/data/jadrixservs-v4.backup.json`, `/data/media` y `/data/whatsapp-session`.
- El esquema interno de datos permanece en V4.7 deliberadamente, evitando una migración innecesaria y protegiendo la base existente.


Bot de WhatsApp con panel privado para dar una bienvenida única, registrar clientes, consultar servicios por celular, usar modo AFK y automatizar renovaciones.

## Flujo de mensajes

La V4.8.1 funciona en modo **solo bienvenida**:

1. El primer mensaje de un contacto nuevo activa los tres mensajes iniciales.
2. Los tres se envían por separado, mostrando “escribiendo…” y una pequeña demora antes de cada envío.
3. Después de completar esa secuencia, el bot no vuelve a responder los mensajes entrantes de ese contacto y los deja sin leer para que aparezcan pendientes de atención manual.
4. Si el número ya está registrado como cliente, sus respuestas tampoco activan la bienvenida.
5. Desde ese momento, el bot solamente envía recordatorios o cobranzas programadas desde el panel.

El contenido de los tres mensajes iniciales puede editarse en **Mensajes automáticos**. Los datos antiguos de productos y entrenamiento se conservan al actualizar, pero no generan respuestas en este modo. `OPENAI_API_KEY` no es necesaria para la bienvenida ni para las renovaciones.

## Registro rápido mediante comandos

Puedes registrar una compra escribiendo un comando desde **tu propio WhatsApp** dentro del chat del cliente:

```text
/planpro 30
/gptpro 30
/geminipro 365
```

La primera parte identifica el producto o plan y el número indica los días agregados. El bot:

- Obtiene automáticamente el número de WhatsApp de ese chat.
- Crea un cliente nuevo con el nombre `estimad@`.
- Guarda el producto, el precio del catálogo, los días y el vencimiento.
- Activa el recordatorio de 2 días y deja apagada la cobranza automática.
- Renueva el registro existente si el mismo número ya tiene el mismo producto.
- Suma los días desde el vencimiento vigente para que una renovación anticipada no pierda días.
- Crea otro registro independiente cuando el mismo número compra un producto diferente.
- Ignora los comandos escritos por el cliente; solamente los mensajes enviados por el propietario pueden registrar o renovar.
- Evita sumar dos veces si WhatsApp repite el mismo evento.

El comando queda visible dentro del chat y el bot no envía una confirmación adicional. La lista completa está en `public/COMANDOS-WHATSAPP-V4.8.txt` y también se descarga desde **Clientes y cobros**.

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

### Cobrar a quienes vencen hoy

En **Clientes y cobros** aparece el botón **Cobrar a los que vencen hoy**. Envía el mensaje de cobranza a todos los clientes activos cuya fecha de vencimiento sea hoy y omite los que ya fueron cobrados para esa misma fecha. Tanto este botón como la cobranza automática se habilitan desde la hora configurada en **Mensajes automáticos**; el valor inicial es **09:00**, usando `America/Lima`.

### Buscar cliente por celular

La sección **Buscar celular** permite escribir los 9 dígitos peruanos o el número con código de país. El panel muestra todos los servicios asociados al número, su precio, cuenta, estado, activación y fecha de vencimiento. Un mismo celular puede tener varios servicios independientes.

### Modo AFK

La sección **Modo AFK** permite activar o desactivar un mensaje editable para fuera del horario de atención. Durante cada activación, cada contacto recibe el mensaje AFK una sola vez para evitar respuestas repetidas. El modo AFK también responde a clientes registrados y tiene prioridad sobre la bienvenida: mientras esté activo, un contacto nuevo recibe el AFK; al desactivarlo, la bienvenida de tres mensajes vuelve a funcionar cuando ese contacto escriba nuevamente.

Al pulsar **Renovar**, el nuevo periodo comienza desde el vencimiento vigente si el cliente pagó antes; así no pierde días. También puedes actualizar la cuenta asociada durante la renovación.

## Protección de clientes y sesión

La base principal continúa siendo `/data/jadrixservs-v4.json`; no se cambia su nombre ni su ubicación, por lo que la actualización conserva los clientes existentes. La sesión vinculada se mantiene en `/data/whatsapp-session`.

La V4.8.1 conserva estos niveles de protección:

- Antes de reemplazar una base válida guarda `/data/jadrixservs-v4.backup.json`.
- Si el JSON principal queda dañado, el bot recupera automáticamente la copia válida.
- En **Clientes y cobros → Descargar respaldo JSON** puedes guardar una copia completa en tu computadora.
- **Restaurar respaldo JSON** vuelve a cargar clientes, fechas, mensajes y configuración desde esa copia sin tocar la sesión de WhatsApp.

No elimines el disco persistente, no cambies su punto de montaje y no crees otro servicio de Render para hacer la actualización. El disco debe seguir unido al mismo servicio.

## Editar los mensajes

En **Mensajes automáticos** puedes editar:

- Los tres mensajes de bienvenida.
- El recordatorio de 2 días antes.
- La cobranza del día de vencimiento.
- La hora mínima para iniciar cobranzas, configurada inicialmente a las 09:00.

El mensaje fuera de horario se edita por separado en **Modo AFK**.

Los mensajes de renovación admiten estas variables:

| Variable | Contenido |
| --- | --- |
| `{nombre}` | Nombre del cliente |
| `{producto}` | Servicio o plan |
| `{cuenta}` | Cuenta asociada |
| `{precio}` | Precio registrado |
| `{fecha}` | Fecha de vencimiento |

## Actualizar una instalación existente

Antes de subir el código, abre el panel actual y pulsa **Clientes y cobros → Descargar respaldo JSON**. Después abre **Render → tu servicio → Disks** y confirma que ya existe el disco `jadrixservs-data` montado en `/data`.

Si el disco no existe, guarda primero el respaldo JSON y después crea el disco con `Mount Path: /data` y `1 GB`. Al adjuntar el disco Render realiza un despliegue y los archivos efímeros anteriores no se copian automáticamente. Una vez instalada la V4.8.1, usa **Restaurar respaldo JSON** para recuperar la base. El respaldo recupera clientes y configuración; si la sesión de WhatsApp estaba únicamente en almacenamiento efímero, será necesario escanear el QR una vez para guardarla en el disco nuevo.

Si el disco ya aparece, continúa:

1. Descomprime `JadrixServs-Bot-V4.8.1-Fix-WhatsApp-405.zip`.
2. Copia el contenido de `jadrixservs-bot-v4` dentro de tu repositorio.
3. Acepta reemplazar los archivos y no borres la carpeta `.git`.
4. Elimina los archivos antiguos si todavía existen:

```bat
git rm --ignore-unmatch server.js seed-data.js ACTUALIZAR-A-V3.txt ACTUALIZAR-A-V4.txt INSTRUCCIONES-ACTUALIZACION.txt INSTRUCCIONES-RAPIDAS.txt PASOS-ACTUALIZAR-V4.3.txt PASOS-ACTUALIZAR-V4.4.txt PASOS-ACTUALIZAR-V4.5.txt PASOS-ACTUALIZAR-V4.6.txt PASOS-ACTUALIZAR-V4.7.2.txt PASOS-ACTUALIZAR-V4.8.txt public/COMANDOS-WHATSAPP-V4.5.txt public/COMANDOS-WHATSAPP-V4.6.txt public/COMANDOS-WHATSAPP-V4.7.txt
git add -A
git commit -m "Corregir conexión WhatsApp 405 en V4.8.1"
git push
```

El proceso inicia desde `src/server.js`. El archivo persistente `/data/jadrixservs-v4.json` conserva su esquema V4.7 y no cambia de nombre ni ubicación. Se mantienen clientes, fechas, mensajes, entrenamiento heredado, conversaciones y demás datos existentes. Los contactos que ya tenían una conversación guardada continúan marcados como atendidos para que la actualización no les repita la bienvenida.

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

En un servicio existente también puedes revisarlo directamente en Render:

1. Abre **Dashboard → jadrixservs-bot-v4 → Disks**.
2. Confirma `Mount Path: /data` y al menos `1 GB`.
3. En **Environment**, confirma `DATA_DIR=/data` y `MEDIA_DIR=/data/media`.
4. No pulses **Delete Disk**, no cambies el punto de montaje y no crees un servicio nuevo.
5. Si tienes acceso a **Shell**, antes de actualizar puedes crear una copia adicional:

```bash
cp /data/jadrixservs-v4.json /data/jadrixservs-v4.pre-v4.8-manual.json
```

Los servicios gratuitos de Render no admiten discos persistentes. Para mantener la sesión y los clientes entre reinicios o despliegues, el servicio debe usar un plan de pago compatible con disco, como Starter.

Render también crea una instantánea diaria del disco persistente y permite restaurar instantáneas recientes desde **Disks**. Esta protección pertenece al disco completo; el respaldo JSON del panel sigue siendo útil como copia independiente de clientes y configuración.

## Vincular WhatsApp

1. Espera a que Render termine el despliegue.
2. Abre **WhatsApp** en el panel.
3. Si aparece un QR, en el celular entra a **Dispositivos vinculados → Vincular un dispositivo**.
4. Escanea el QR y espera; el panel debe pasar de **Autenticando** a **Conectado** automáticamente.
5. No pulses **Reiniciar** mientras esté autenticando.

Si el celular muestra la sesión iniciada pero el panel no termina de conectar:

1. Espera: cada 45 segundos el bot vuelve a abrir la conexión sin borrar las credenciales.
2. Los reintentos continúan sin un límite de dos intentos y se espacian hasta un máximo de 60 segundos para evitar saturar WhatsApp.
3. Puedes pulsar **Forzar conexión** si deseas iniciar un intento inmediato.
4. Usa **Cerrar sesión** solamente si WhatsApp revocó la sesión o el panel indica **Error de sesión**; ese botón sí elimina las credenciales guardadas y requiere un QR nuevo.

La sesión válida se guarda en `/data/whatsapp-session`; no hace falta volver a escanear después de cada despliegue.

Ningún bot basado en una conexión no oficial puede prometer una sesión literalmente ilimitada: WhatsApp puede revocarla, reemplazarla si se abre otra conexión o solicitar un nuevo QR. La V4.8.1 evita que un corte temporal o un rechazo `405` detenga definitivamente el bot y mantiene reintentos automáticos mientras la sesión siga siendo válida.

## Prueba recomendada

Desde un número que no esté registrado como cliente:

1. Envía cualquier mensaje.
2. Debes recibir tres mensajes separados.
3. Envía una segunda consulta: el bot debe permanecer en silencio y ese mensaje debe quedar sin leer.

Luego registra un cliente con vencimiento dentro de 2 días, deja activo el recordatorio y pulsa **Procesar vencimientos**. Para probar la cobranza, usa un vencimiento de hoy y activa manualmente **Cobranza automática**.

Para probar las funciones nuevas:

1. Crea o edita un cliente para que venza hoy.
2. Después de las 09:00, pulsa **Cobrar a los que vencen hoy** y confirma que no vuelve a cobrarlo al pulsar nuevamente.
3. Abre **Buscar celular**, escribe su número y revisa que aparezcan el servicio y vencimiento.
4. Activa **Modo AFK**, escribe desde otro número dos veces y confirma que recibe una sola respuesta AFK. Desactívalo al terminar.

Para probar el registro rápido:

1. Abre en tu WhatsApp el chat de un cliente.
2. Envía `/planpro 30`.
3. Abre **Clientes y cobros** en el panel.
4. Debe aparecer `estimad@`, el número del chat, Plan Pro, 30 días y el vencimiento calculado.

## Ejecutar localmente

Requiere Node.js 20 o superior:

```bash
npm install
npm test
npm start
```

Abre `http://localhost:3000`.

La carpeta de autenticación de WhatsApp equivale a una credencial privada. No la subas a GitHub ni la compartas. Este proyecto usa Baileys y no la API oficial de Meta; evita envíos masivos o no solicitados.
