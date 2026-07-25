# Bot experimental de WhatsApp con QR en Render

Este proyecto abre WhatsApp Web dentro de un navegador Chromium en Render, muestra el código QR en un panel web protegido y responde mensajes básicos.

> Importante: utiliza una biblioteca no oficial que controla WhatsApp Web. Puede dejar de funcionar cuando WhatsApp cambie, puede pedir un nuevo QR y existe riesgo de restricción de la cuenta. Úsalo primero con un número secundario, evita mensajes masivos y no lo uses para contactar personas sin permiso.

## Qué hace inicialmente

- Muestra el QR en una página web.
- Responde saludos con un menú.
- Responde sobre precios, horario y ubicación.
- Pasa una conversación a “modo humano” durante 30 minutos cuando escriben “asesor”.
- Ignora grupos, estados y mensajes enviados por la propia cuenta.
- Permite pausar el bot, reiniciar la conexión y cerrar sesión desde el panel.

## Paso 1: subir los archivos a GitHub

1. Crea una cuenta en GitHub.
2. Pulsa **New repository**.
3. Nombre sugerido: `whatsapp-qr-render-bot`.
4. Déjalo como **Private**.
5. Pulsa **Create repository**.
6. Pulsa **uploading an existing file** o **Add file > Upload files**.
7. Arrastra todos los archivos de esta carpeta, no el ZIP.
8. Pulsa **Commit changes**.

Debes ver en GitHub: `server.js`, `package.json`, `Dockerfile`, `render.yaml` y la carpeta `public`.

## Paso 2: crear el servicio en Render

1. Entra en Render y pulsa **New > Web Service**.
2. Conecta tu cuenta de GitHub.
3. Selecciona el repositorio `whatsapp-qr-render-bot`.
4. Render debería detectar el `Dockerfile`.
5. Elige el plan gratuito solo para probar.
6. Agrega las variables de entorno indicadas abajo.
7. Pulsa **Deploy Web Service**.

## Paso 3: variables de entorno

En Render, entra en **Environment** y crea estas variables:

### Obligatoria

- `ADMIN_KEY`: una contraseña larga que solo tú conozcas. Ejemplo: `panel_whatsapp_2026_83741`

### Textos del negocio

- `BUSINESS_NAME`: nombre de tu negocio.
- `BUSINESS_HOURS`: horario.
- `BUSINESS_ADDRESS`: dirección.
- `BUSINESS_MAPS_URL`: enlace de Google Maps, opcional.
- `PRICE_TEXT`: respuesta cuando preguntan por precios.
- `HUMAN_TEXT`: respuesta cuando solicitan un asesor.

No cambies `SESSION_PATH`; debe ser `/data/.wwebjs_auth`.

## Paso 4: abrir el panel y escanear

1. Cuando Render muestre **Live**, abre la URL del servicio.
2. Escribe la clave configurada en `ADMIN_KEY`.
3. Espera a que aparezca el QR.
4. En tu teléfono abre WhatsApp.
5. Ve a **Dispositivos vinculados > Vincular un dispositivo**.
6. Escanea el QR mostrado en Render.
7. Espera hasta que el panel diga **conectado**.

## Paso 5: probar respuestas

Desde otro número, envía al WhatsApp conectado:

- `Hola`
- `1` o `precio`
- `2` o `horario`
- `3` o `ubicación`
- `4` o `asesor`

El bot no responde en grupos.

## Limitación importante de Render gratis

Render usa un sistema de archivos temporal de forma predeterminada. Si el servicio se reinicia o vuelve a desplegarse, puede perder la sesión de WhatsApp y pedir otro QR.

Para conservar la sesión de manera más estable:

1. Cambia el servicio a un plan de pago.
2. En Render abre **Disks**.
3. Agrega un disco persistente.
4. Usa como punto de montaje: `/data`.
5. Usa el tamaño mínimo disponible para la prueba.

El código ya guarda la sesión bajo `/data/.wwebjs_auth`, así que no tendrás que modificarlo.

## Cambiar las respuestas sin programar

Puedes modificar las variables `BUSINESS_NAME`, `BUSINESS_HOURS`, `BUSINESS_ADDRESS`, `BUSINESS_MAPS_URL`, `PRICE_TEXT` y `HUMAN_TEXT` en Render. Guarda los cambios y deja que Render redespliegue.

## Cambiar reglas más adelante

Las reglas se encuentran en la función `buildReply()` dentro de `server.js`. Más adelante se pueden agregar:

- Catálogo y productos.
- Registro de clientes.
- Reservas y citas.
- Consultas a una base de datos.
- Inteligencia artificial.
- Panel para ver conversaciones.
- Horarios diferentes por día.

## Solución de problemas

### No aparece el QR

- Revisa **Logs** en Render.
- Confirma que el servicio diga **Live**.
- Espera uno o dos minutos y pulsa **Reiniciar conexión**.
- Confirma que Render detectó el proyecto como Docker.

### El panel dice que falta ADMIN_KEY

Agrega `ADMIN_KEY` en **Environment**, guarda y vuelve a desplegar.

### Después de reiniciar pide otro QR

Es normal en el plan gratuito. Para conservar archivos entre reinicios necesitas un disco persistente de Render.

### El bot no responde

- Verifica que el panel diga **conectado**.
- Verifica que las respuestas estén activadas.
- Prueba desde otro teléfono.
- El bot ignora grupos, estados y mensajes propios.
- Revisa **Logs** y la actividad reciente del panel.

### Quiero desconectar el número

Entra al panel y pulsa **Cerrar sesión y nuevo QR**. También puedes desvincular el dispositivo desde WhatsApp en tu teléfono.
