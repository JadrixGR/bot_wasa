# Bienvenidas y precios por país · JadrixServs V4.9.3

## Resultado

El bot ahora identifica el prefijo internacional del número que escribe por WhatsApp y selecciona una bienvenida local de tres mensajes. Por ejemplo, un número `+51` recibe la secuencia configurada para Perú y un número `+54` recibe la de Argentina.

## Cambios realizados

- Nuevo editor **Mensajes automáticos → Bienvenidas y precios por país**.
- Perfiles editables con país, prefijo, moneda, estado activo y exactamente tres mensajes.
- Plantillas de prefijo y moneda para países de Latinoamérica, Estados Unidos y España; se puede escribir cualquier otro país manualmente.
- Detección compatible con números normales y con identificadores LID de WhatsApp.
- Coincidencia por prefijo más específico: `+1809` tiene prioridad sobre `+1`.
- Bienvenida predeterminada como respaldo cuando ningún país activo coincide.
- Si una secuencia se interrumpe, continúa con el mismo perfil de país sin mezclar mensajes.
- Migración automática: las instalaciones existentes conservan sus mensajes actuales dentro del perfil inicial de Perú (`+51`).
- Diseño responsive, accesible y consistente con el modo noche del panel.

La moneda funciona como referencia para el editor. Los precios se escriben directamente en cada mensaje y no dependen de una API de conversión, por lo que el administrador conserva el control exacto de los importes enviados.

## Archivos modificados

- `src/defaults.js`
- `src/store.js`
- `src/bot-engine.js`
- `src/whatsapp-service.js`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `test/defaults.test.js`
- `test/store.test.js`
- `test/bot-engine.test.js`
- `README.md`

## Verificación

- Sintaxis de los archivos JavaScript modificados: correcta.
- Suite completa: **111 pruebas aprobadas, 0 fallos**.
- Navegador: creación y guardado del perfil Argentina con `+54` y `ARS ($)` comprobados.
- Móvil: probado a 390 × 844 px, una columna y sin scroll horizontal.
- Consola del navegador: sin errores ni advertencias.

## Render

No se modificaron `render.yaml`, `Dockerfile`, `package.json`, el puerto, los scripts de inicio ni las variables de entorno. La nueva configuración se guarda en el mismo archivo persistente `/data/jadrixservs-v4.json`, por lo que se conserva con el disco actual de Render.

No se eliminó ninguna función existente y no se modificaron el logo, la autenticación, la sesión de WhatsApp, los clientes, las compras independientes, las renovaciones, las cobranzas, el modo AFK, el Autenticador ni las respuestas rápidas.
