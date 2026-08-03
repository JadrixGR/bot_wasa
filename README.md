# JadrixServs Bot V4.9.3 Profesional

## Respuestas rápidas con imágenes y textos

El panel incluye el apartado **Respuestas rápidas** para crear comandos privados como `/diferencia`.

- Cada respuesta admite de 1 a 6 imágenes PNG, JPG o WEBP, con un máximo de 8 MB por archivo.
- Se pueden guardar de 1 a 10 textos: el primero se adjunta como pie de foto de la última imagen y los siguientes se envían como mensajes separados, respetando el orden del editor.
- El comando se ejecuta únicamente cuando lo escribe el administrador desde el WhatsApp conectado dentro del chat de destino. Un cliente no puede dispararlo desde su propio teléfono.
- Los comandos no pueden repetirse ni entrar en conflicto con el catálogo de registro o con el Autenticador 2FA.
- Los eventos repetidos de WhatsApp no vuelven a enviar la misma secuencia.
- Al eliminar la última imagen, la respuesta se desactiva automáticamente hasta que se cargue otra.

### Crear y usar una respuesta

1. Abre **Respuestas rápidas → Nueva respuesta**.
2. Escribe un nombre interno y un comando, por ejemplo `/diferencia`.
3. Carga las imágenes en el orden en que deben llegar.
4. Agrega uno o más bloques de texto; el primero aparecerá dentro de la última imagen y los demás llegarán por separado. Usa las flechas para cambiar su orden.
5. Guarda la respuesta y déjala activa.
6. Desde tu propio WhatsApp abre el chat del cliente y envía únicamente `/diferencia`.

Las imágenes se guardan en `MEDIA_DIR` (`/data/media` en Render), mientras que la definición, el orden y los textos se guardan en `/data/jadrixservs-v4.json`. Por eso el disco persistente debe conservarse: el respaldo JSON incluye la configuración, pero no incrusta los archivos binarios de las imágenes.

## Comandos 2FA seguros por WhatsApp · V4.9.1

- Cada cuenta del Autenticador tiene un comando único y editable, por ejemplo `/gpt01`.
- Las cuentas ya guardadas reciben el comando automáticamente según su nombre: `GPT01` pasa a `/gpt01` y `GROK01` a `/grok01`.
- El comando solo se ejecuta cuando lo escribes desde el WhatsApp propietario dentro del chat del cliente.
- Si un cliente escribe `/gpt01`, el bot nunca genera ni envía el código 2FA.
- Si quedan menos de 20 segundos, el bot espera silenciosamente el siguiente código.
- El mensaje se envía únicamente cuando el código conserva entre 20 y 30 segundos útiles.
- Antes de enviarlo aparece “escribiendo…” y el cliente recibe solo el servicio, el código y su vigencia.
- El código numérico y el correo asociado nunca se copian a los registros de actividad.
- Los comandos de clientes como `/gptpro 30` siguen funcionando y no pueden repetirse como comandos 2FA.
- Los eventos duplicados de WhatsApp se detectan para no reenviar el mismo código.

### Cómo enviar un código al chat de un cliente

1. Abre **Autenticador** y revisa el comando de la cuenta.
2. Puedes copiarlo desde la tarjeta o editarlo, por ejemplo `/gpt01`.
3. En tu propio WhatsApp abre el chat del cliente.
4. Envía únicamente `/gpt01`.
5. El bot espera una ventana segura si hace falta y manda el código en ese mismo chat.

Los códigos TOTP normales duran 30 segundos. Una cuenta configurada con un periodo inferior al necesario no se enviará, porque no puede garantizar 20 segundos de vigencia.

## Autenticador 2FA protegido

- Agrega una sección nueva llamada **Autenticador** al panel privado.
- Permite registrar nombre, servicio, correo o usuario y la clave secreta 2FA.
- Acepta una clave Base32 o el enlace completo `otpauth://totp/...`.
- Genera códigos TOTP de 6, 7 u 8 dígitos y los renueva automáticamente según el intervalo de cada servicio.
- Muestra el tiempo restante, permite copiar el código y buscar cuentas por nombre, servicio, correo o comando.
- Permite editar los datos sin volver a escribir la clave; una clave nueva solo se guarda cuando se desea reemplazar.
- Cifra cada clave con AES-256-GCM antes de guardarla en `/data/jadrixservs-v4.json`.
- La clave 2FA original nunca se devuelve al navegador ni se muestra después de guardarla.
- Los respaldos conservan las cuentas del Autenticador, pero únicamente con sus claves cifradas.
- No utiliza OpenAI ni un servicio externo para generar los códigos.
- Conserva sin cambios los clientes, la sesión de WhatsApp, los mensajes, los comandos y las automatizaciones existentes.

### Cómo agregar una cuenta al Autenticador

1. En el servicio que deseas proteger, abre su configuración de **Seguridad** o **Verificación en dos pasos**.
2. Elige configurar una aplicación de autenticación y busca la **clave de configuración**, **setup key** o el enlace `otpauth://`.
3. En JadrixServs abre **Autenticador → Nueva cuenta**.
4. Escribe un nombre, el servicio y el correo o usuario asociado.
5. Revisa el comando privado sugerido o escribe uno único, como `/gpt01`.
6. Pega la clave Base32 o el enlace `otpauth://` completo y guarda.
7. Usa el código temporal que aparece en la tarjeta para completar la activación en el servicio.

No pegues un código temporal de seis dígitos en el campo **Clave secreta 2FA**. Ese campo necesita la clave de configuración permanente que entrega el servicio al activar el autenticador.

### Clave de cifrado en Render

Antes de guardar la primera cuenta, crea en **Render → Environment**:

```text
AUTHENTICATOR_ENCRYPTION_KEY=una-clave-larga-aleatoria-y-estable
```

Esta variable debe conservar siempre el mismo valor. Si se cambia o elimina, las claves 2FA existentes no podrán descifrarse y será necesario volver a registrarlas. Si la variable no existe, el bot utiliza el `COOKIE_SECRET` actual como respaldo; en ese caso tampoco debes cambiar ese valor después de guardar cuentas.

El panel muestra los códigos únicamente después de iniciar sesión como administrador. Utilízalo siempre mediante la dirección HTTPS de Render y no compartas el acceso al panel, las claves de configuración ni los códigos temporales.

## Conexión de WhatsApp conservada de V4.8.3

- Corrige el caso en que **Cerrar sesión** terminaba correctamente, pero la sesión nueva quedaba en `CONNECTING` sin mostrar el QR.
- Consulta en cada inicio la revisión vigente directamente desde WhatsApp Web y la envía explícitamente a Baileys.
- Incluye revisiones recientes de respaldo para que un fallo temporal de la consulta externa no reactive la versión antigua incluida en Baileys.
- Ante un `405`, rota automáticamente la versión y los perfiles **Mac OS/Chrome** y **Windows/Chrome** sin volver a borrar la sesión ni tocar clientes.
- Si `CONNECTING` no entrega un QR en 20 segundos, cambia automáticamente de candidato y vuelve a solicitarlo.
- Mantiene el cierre con tiempo límite de V4.8.2, que elimina únicamente `/data/whatsapp-session` y nunca la base de clientes.
- Conserva el filtro de los volcados sensibles `Closing session: SessionEntry`.
- Integra el logo oficial **Jadrix Serv · Digital Solutions** en el acceso, la barra lateral y el icono del sitio.
- V4.9.1 conserva íntegramente estas correcciones junto con los clientes, mensajes, comandos, renovaciones, cobranzas, AFK, IA y configuración existentes.

## Diseño profesional de V4.8

- Interfaz profesional completamente renovada en el acceso y en todas las secciones del panel.
- Resumen ejecutivo con estados visuales, indicadores animados y contadores suaves.
- Navegación con iconos, cabecera inteligente y menú móvil accesible.
- Animaciones discretas en paneles, clientes, QR, ventanas y notificaciones.
- Modo día y modo noche rediseñados; la preferencia continúa guardándose en el navegador.
- Mejor adaptación para computadora, tablet y celular, sin eliminar ningún control.
- Se mantienen el bot, comandos, clientes, renovaciones, cobranzas, AFK, respaldos y conexión de WhatsApp.
- La actualización conserva `/data/jadrixservs-v4.json`, `/data/jadrixservs-v4.backup.json`, `/data/media` y `/data/whatsapp-session`.
- El esquema interno de datos permanece en V4.7 deliberadamente. La lista cifrada `authenticatorAccounts` se agrega de forma compatible cuando se usa por primera vez, sin reemplazar la base existente.


Bot de WhatsApp con panel privado para dar una bienvenida única, registrar clientes, consultar servicios por celular, usar modo AFK y automatizar renovaciones.

## Flujo de mensajes

La V4.9.1 funciona en modo **solo bienvenida**:

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
- Crea una compra independiente por cada comando nuevo, aunque el mismo número repita el producto.
- Conserva por separado la activación, el vencimiento, el recordatorio y la cobranza de cada compra.
- Mantiene el botón **Renovar** del panel para extender deliberadamente un registro existente sin perder días.
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

La V4.9.1 conserva estos niveles de protección:

- Antes de reemplazar una base válida guarda `/data/jadrixservs-v4.backup.json`.
- Si el JSON principal queda dañado, el bot recupera automáticamente la copia válida.
- En **Clientes y cobros → Descargar respaldo JSON** puedes guardar una copia completa en tu computadora.
- **Restaurar respaldo JSON** vuelve a cargar clientes, fechas, mensajes y configuración desde esa copia sin tocar la sesión de WhatsApp.
- Las cuentas del Autenticador se incluyen en el respaldo únicamente con sus secretos cifrados. Para recuperarlas también debes conservar la misma `AUTHENTICATOR_ENCRYPTION_KEY`.

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

Si el disco no existe, guarda primero el respaldo JSON y después crea el disco con `Mount Path: /data` y `1 GB`. Al adjuntar el disco Render realiza un despliegue y los archivos efímeros anteriores no se copian automáticamente. Una vez instalada la V4.9.1, usa **Restaurar respaldo JSON** para recuperar la base. El respaldo recupera clientes y configuración; si la sesión de WhatsApp estaba únicamente en almacenamiento efímero, será necesario escanear el QR una vez para guardarla en el disco nuevo.

Si el disco ya aparece, continúa:

1. Descomprime `JadrixServs-Bot-V4.9.1-Comandos-2FA-WhatsApp.zip`.
2. Copia el contenido de `jadrixservs-bot-v4` dentro de tu repositorio.
3. Acepta reemplazar los archivos y no borres la carpeta `.git`.
4. Elimina los archivos antiguos si todavía existen:

```bat
git rm --ignore-unmatch server.js seed-data.js ACTUALIZAR-A-V3.txt ACTUALIZAR-A-V4.txt INSTRUCCIONES-ACTUALIZACION.txt INSTRUCCIONES-RAPIDAS.txt PASOS-ACTUALIZAR-V4.3.txt PASOS-ACTUALIZAR-V4.4.txt PASOS-ACTUALIZAR-V4.5.txt PASOS-ACTUALIZAR-V4.6.txt PASOS-ACTUALIZAR-V4.7.2.txt PASOS-ACTUALIZAR-V4.8.txt PASOS-ACTUALIZAR-V4.8.1.txt PASOS-ACTUALIZAR-V4.8.2.txt PASOS-ACTUALIZAR-V4.8.3.txt PASOS-ACTUALIZAR-V4.9.0.txt public/COMANDOS-WHATSAPP-V4.5.txt public/COMANDOS-WHATSAPP-V4.6.txt public/COMANDOS-WHATSAPP-V4.7.txt
git add -A
git commit -m "Agregar comandos 2FA seguros en V4.9.1"
git push
```

El proceso inicia desde `src/server.js`. El archivo persistente `/data/jadrixservs-v4.json` conserva su esquema V4.7 y no cambia de nombre ni ubicación. Se mantienen clientes, fechas, mensajes, entrenamiento heredado, conversaciones y demás datos existentes. Los contactos que ya tenían una conversación guardada continúan marcados como atendidos para que la actualización no les repita la bienvenida.

## Variables de Render

En **Render → tu servicio → Environment** revisa:

| Variable | Valor recomendado |
| --- | --- |
| `ADMIN_PASSWORD` | Contraseña segura para el panel |
| `COOKIE_SECRET` | Texto largo y secreto |
| `AUTHENTICATOR_ENCRYPTION_KEY` | Clave larga, aleatoria y estable para cifrar las cuentas 2FA |
| `DATA_DIR` | `/data` |
| `MEDIA_DIR` | `/data/media` |
| `BOT_TIMEZONE` | `America/Lima` |
| `REMINDER_CHECK_MINUTES` | `15` |
| `HUMAN_DELAY_MIN_MS` | `900` |
| `HUMAN_DELAY_MAX_MS` | `4200` |
| `WHATSAPP_READY_TIMEOUT_MS` | `45000` |
| `WHATSAPP_RECONNECT_DELAY_MS` | `3000` |
| `WHATSAPP_LOGOUT_TIMEOUT_MS` | `4000` |
| `WHATSAPP_QR_WAIT_TIMEOUT_MS` | `20000` |
| `WHATSAPP_WEB_VERSION` | Déjala sin crear; el bot la consulta automáticamente |

`render.yaml` configura un disco persistente de 1 GB montado en `/data`. Es indispensable para conservar la sesión de WhatsApp y los clientes después de cada despliegue.

En un servicio existente también puedes revisarlo directamente en Render:

1. Abre **Dashboard → jadrixservs-bot-v4 → Disks**.
2. Confirma `Mount Path: /data` y al menos `1 GB`.
3. En **Environment**, confirma `DATA_DIR=/data` y `MEDIA_DIR=/data/media`.
4. No pulses **Delete Disk**, no cambies el punto de montaje y no crees un servicio nuevo.
5. Si tienes acceso a **Shell**, antes de actualizar puedes crear una copia adicional:

```bash
cp /data/jadrixservs-v4.json /data/jadrixservs-v4.pre-v4.9-manual.json
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

Ningún bot basado en una conexión no oficial puede prometer una sesión literalmente ilimitada: WhatsApp puede revocarla, reemplazarla si se abre otra conexión o solicitar un nuevo QR. La V4.9.1 conserva la actualización de la revisión Web antes de conectar, rota alternativas ante `405`, mantiene reintentos automáticos mientras la sesión siga siendo válida y permite borrar una sesión dañada para obtener un QR nuevo.

## Prueba recomendada

Para probar el Autenticador:

1. Configura `AUTHENTICATOR_ENCRYPTION_KEY` en Render y espera el despliegue.
2. Abre **Autenticador → Nueva cuenta**.
3. Agrega una cuenta de prueba con la clave de configuración que entrega el servicio.
4. Confirma que aparece un código, que el contador disminuye y que al llegar a cero se genera uno nuevo.
5. Pulsa **Copiar**, edita solo el nombre y verifica que la clave continúa funcionando sin volver a pegarla.
6. Revisa que la tarjeta muestre un comando como `/gpt01`.
7. Desde tu WhatsApp propietario, envíalo en un chat y confirma que el código recibido indica entre 20 y 30 segundos.
8. Repite la prueba cuando al código actual le queden menos de 20 segundos: el bot debe esperar el siguiente antes de enviarlo.

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
