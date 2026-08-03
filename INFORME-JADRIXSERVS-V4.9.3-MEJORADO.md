# JadrixServs Bot V4.9.3 — Informe de mejoras

## Resultado

Se mejoró el registro rápido desde WhatsApp para que cada comando nuevo cree una compra independiente, incluso cuando el mismo número repite el mismo producto. Cada compra conserva su propio ID, fecha de activación, vencimiento, recordatorio y cobranza.

La protección contra eventos duplicados se mantiene: si WhatsApp reenvía el mismo evento con el mismo ID, no se crea una compra adicional.

El botón **Renovar** del panel conserva su funcionamiento anterior y sigue extendiendo deliberadamente el registro seleccionado sin perder días.

## Diseño y experiencia

- Interfaz dark-first SaaS con navy, azul petróleo, cian y violeta.
- Hero principal con mayor jerarquía, texto degradado y visual de WhatsApp mejorado.
- Tarjetas de métricas uniformes, acentos por estado y hover sutil sin cambios de layout.
- Sidebar, encabezado, botones, paneles, formularios, estados y modales con transiciones coherentes.
- Cambio entre apartados mediante View Transitions cuando el navegador lo admite y fallback CSS cuando no.
- Animaciones de 180 a 300 ms basadas principalmente en `opacity` y `transform`.
- Soporte de `prefers-reduced-motion`.
- Navegación móvil, controles táctiles mínimos de 44 px y ausencia de scroll horizontal accidental.
- Caché de datos ya cargados por sección para evitar solicitudes repetidas innecesarias.
- No se cambió el archivo `public/jadrixservs-logo.jpg`.

## Archivos modificados

- `src/store.js`
- `src/server.js`
- `public/app.js`
- `public/styles.css`
- `public/index.html`
- `public/COMANDOS-WHATSAPP-V4.8.txt`
- `test/store.test.js`
- `test/scheduler.test.js`
- `README.md`

No se crearon componentes de framework porque el frontend existente es HTML, CSS y JavaScript nativo. Se reorganizó la navegación en funciones internas reutilizables (`updateActiveSection` y `loadSectionData`) sin cambiar rutas, IDs ni eventos públicos.

## Validación realizada

Comandos principales:

```text
node --check src/*.js
node --check public/app.js
node --test
node src/server.js
```

Resultados:

- Sintaxis JavaScript: correcta en todos los archivos de `src` y `public/app.js`.
- Tests: **98 aprobados, 0 fallidos**.
- Prueba nueva: dos comandos distintos del mismo producto y número crean dos compras independientes.
- Prueba nueva: dos compras del mismo número se cobran por separado el 2 y el 5 de agosto.
- Servidor local: inició correctamente.
- `GET /health`: HTTP correcto, versión `4.9.3`, respaldo automático activo.
- Navegador: las 9 secciones del panel abrieron correctamente.
- Consola del navegador: 0 errores y 0 advertencias durante la revisión.
- Responsive probado a 1600 px y 390 px; sin desbordamiento horizontal.
- Menú móvil probado: abre, bloquea el fondo, navega y se cierra correctamente.

El proyecto no define scripts `lint` ni `build` en `package.json`; por eso no se inventaron ni modificaron. La validación equivalente disponible fue `node --check`, la suite completa y el arranque real del servidor.

## Render

- `render.yaml`, `Dockerfile`, `package.json`, `package-lock.json`, scripts de inicio, `PORT`, rutas, endpoints y variables de entorno permanecen intactos.
- La base sigue en `/data/jadrixservs-v4.json` y la sesión de WhatsApp en `/data/whatsapp-session`.
- El endpoint de salud ahora toma la versión directamente de `package.json`, evitando que mostrara `4.9.2` por error.
- No se requiere ninguna variable nueva ni cambio de configuración para desplegar.

Antes de actualizar en Render, se recomienda descargar el respaldo JSON desde el panel y confirmar que el disco persistente continúa montado en `/data`.

## Funciones conservadas

No se eliminó ninguna función. Se conservaron autenticación, conexión y sesión de WhatsApp, clientes, renovaciones manuales, recordatorios, cobranzas, catálogo, comandos, mensajes automáticos, AFK, Autenticador 2FA, actividad, respaldos, rutas y endpoints.

La única modificación funcional es la solicitada: un comando nuevo registra una compra nueva en lugar de sobrescribir o renovar automáticamente otra compra del mismo producto.

## Consideración importante

Se mantuvo el comportamiento seguro existente: la **cobranza automática queda apagada** al registrar por comando. Si deseas que ambas compras cobren automáticamente en sus respectivos vencimientos, activa **Cobranza automática** en cada registro. Los recordatorios siguen activos por defecto.

## No verificable sin el entorno real

- Escaneo de QR y conexión con una cuenta real de WhatsApp.
- Envío real de mensajes, recordatorios o cobranzas a clientes.
- Despliegue efectivo en la cuenta de Render y persistencia después de un reinicio real.
- Variables y secretos configurados actualmente en Render.

