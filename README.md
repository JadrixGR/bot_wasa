# JadrixServs Bot v4

Bot de WhatsApp no oficial conectado por QR con Baileys, panel web, catálogo, respuestas con OpenAI, productos, PDF, audios, clientes y recordatorios de renovación.

## Novedades de v4

- Los tres mensajes iniciales configurados desde el panel.
- Base inicial con los productos y condiciones recopiladas.
- Productos no disponibles marcados como inactivos.
- Reglas de DICloak, privacidad, soporte, pagos y recomendaciones.
- Subida de audio explicativo y envío automático por palabra o producto.
- Conversión PEN a USDT con recargo y redondeo hacia arriba.
- Registro de compras, vencimientos y renovaciones sin perder días.
- Recordatorios 1 o 2 días antes, activados manualmente.
- Historial de compras, renovaciones y recordatorios.
- Importación de PDF y texto.
- Simulador de respuestas.
- Respaldo JSON.

## Actualización

Copia los archivos sobre tu repositorio actual sin borrar `.git` y ejecuta:

```powershell
git add .
git commit -m "Actualizar JadrixServs Bot a version 4"
git push
```

## Variables de Render

```text
ADMIN_KEY=tu_clave_del_panel
OPENAI_API_KEY=tu_clave_de_api_opcional
OPENAI_MODEL=gpt-5-mini
SESSION_PATH=/data/baileys_auth
DATA_DIR=/data/bot-control
WA_LOG_LEVEL=silent
```

La API de OpenAI se factura por separado de ChatGPT.

## Recordatorios

La automatización queda desactivada inicialmente. Actívala desde `Clientes y cobros` cuando los registros estén revisados. El proceso comprueba los vencimientos cada 10 minutos, pero solo envía después de la hora configurada y una vez por periodo.

## Persistencia

Render gratis usa almacenamiento temporal y puede suspender el servicio. Para conservar audios, clientes, configuración y sesión, usa un servicio con disco persistente. Descarga respaldos JSON con frecuencia.

## Aviso

La conexión por Baileys controla WhatsApp Web y no es una API oficial. Úsala con un número de prueba, sin spam, y cumple las políticas de WhatsApp y de los proveedores de los servicios ofrecidos.
