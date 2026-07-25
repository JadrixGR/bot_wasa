# JadrixServs Bot V4

Bot de WhatsApp Web con panel privado para administrar catálogo, respuestas, clientes, cobros, vencimientos y recordatorios.

## Lo que ya incluye

- QR visible en el panel para vincular WhatsApp sin usar la API de Meta.
- Saludo inicial en **tres mensajes separados**: catálogo, combos y entrega/soporte.
- Catálogo completo de JadrixServs y respuestas específicas por producto.
- Plan Pro de S/60 y Plan Plus de S/25.
- Instrucciones de pago por Yape y Binance/USDT.
- Recepción de comprobantes y transferencia a atención personal.
- Audio de DICloak y catálogo PDF configurables desde el panel.
- Registro manual de clientes, compras y vencimientos.
- Renovación anticipada sin pérdida de días: si vence el 26 y paga el 23, el nuevo periodo empieza el 26.
- Recordatorios automáticos 1 o 2 días antes.
- Cobro automático opcional el día de vencimiento, inicialmente desactivado.
- Exportación de clientes a CSV.
- Sesión protegida con contraseña.

## Probarlo en tu computadora

Necesitas Node.js 20 o superior.

```bash
npm install
```

En Windows CMD:

```bat
set ADMIN_PASSWORD=TuClaveSegura
set COOKIE_SECRET=UnTextoLargoYSecreto
npm start
```

Abre `http://localhost:3000`, ingresa con la contraseña elegida y escanea el QR.

Si no configuras `ADMIN_PASSWORD` en una prueba local, la clave temporal es `Jadrix2026!`.

## Subir esta V4 a GitHub

Descomprime la carpeta y abre CMD dentro de ella. Luego ejecuta:

```bat
git init
git add .
git commit -m "JadrixServs bot version 4"
git branch -M main
git remote add origin URL_DE_TU_REPOSITORIO
git push -u origin main
```

Si el repositorio ya existe y ya tiene un `origin`, no vuelvas a ejecutar `git remote add origin`.

## Desplegar en Render

La carpeta incluye `Dockerfile` y `render.yaml`.

1. Sube la carpeta a tu repositorio de GitHub.
2. En Render entra a **New → Blueprint**.
3. Conecta el repositorio y selecciona la rama `main`.
4. Render detectará `render.yaml`.
5. Cuando pregunte por `ADMIN_PASSWORD`, escribe la contraseña que usarás para entrar al panel.
6. Crea el servicio y espera a que el estado sea **Live**.
7. Abre la URL de Render, inicia sesión y escanea el QR.

El Blueprint usa un servicio Starter y un disco de 1 GB montado en `/data`. Ese disco guarda:

- La sesión de WhatsApp.
- Los clientes y vencimientos.
- El audio DICloak y el PDF.

Sin disco persistente, el bot puede probarse, pero perderá la sesión y los datos cuando Render reinicie o vuelva a desplegar el servicio.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `ADMIN_PASSWORD` | Contraseña para entrar al panel. |
| `COOKIE_SECRET` | Secreto generado por Render para proteger la sesión del panel. |
| `DATA_DIR` | Carpeta persistente. En Render: `/data`. |
| `MEDIA_DIR` | Archivos del bot. En Render: `/data/media`. |
| `BOT_TIMEZONE` | Zona horaria. Ya está configurada como `America/Lima`. |
| `GREETING_COOLDOWN_HOURS` | Horas antes de repetir el saludo a un contacto. |
| `REMINDER_CHECK_MINUTES` | Frecuencia con que revisa vencimientos. |

## Uso del panel

- **WhatsApp:** muestra el QR, el estado y permite reiniciar o cerrar la sesión.
- **Clientes y cobros:** agrega y edita compras; usa **Renovar** para aplicar correctamente la fecha anterior.
- **Mensajes y archivos:** permite modificar los tres mensajes, pagos, respuestas, audio DICloak y PDF.
- **Atención personal:** reactiva el bot después de que un cliente pidió un asesor.
- **Actividad:** muestra mensajes, comprobantes, recordatorios y errores recientes.

## Importante

Este proyecto usa `whatsapp-web.js`, que automatiza WhatsApp Web y no es la API oficial de Meta. WhatsApp puede cambiar su funcionamiento o limitar cuentas automatizadas. Úsalo con mensajes solicitados por tus clientes, evita envíos masivos y conserva una copia de tus datos.
