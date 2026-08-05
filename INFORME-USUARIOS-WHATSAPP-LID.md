# Compatibilidad con usuarios de WhatsApp sin teléfono visible

## Resultado

El bot ahora registra clientes aunque WhatsApp oculte su número y entregue únicamente un nombre de usuario y un identificador privado LID.

- Si WhatsApp entrega teléfono, se conserva el comportamiento existente.
- Si entrega `@usuario`, el panel muestra y permite buscar ese usuario.
- El LID se guarda como destino técnico estable para recordatorios, cobranzas y respuestas.
- Si el nombre de usuario llega después mediante la sincronización de contactos, los registros relacionados se completan automáticamente.
- Como último respaldo, un chat LID también puede registrarse aunque WhatsApp todavía no haya entregado su `@usuario`.

## Cambios funcionales

- Registro privado por comando compatible con teléfono, `@usuario`, LID y `remoteJidAlt`.
- Caché de contactos para los eventos `contacts.upsert`, `contacts.update`, `messaging-history.set` y `lid-mapping.update`.
- Resolución opcional de un `@usuario` mediante USync cuando se registra manualmente desde el panel.
- Búsqueda, edición y eliminación de clientes por teléfono o `@usuario`.
- Recordatorios y cobranzas enviados al LID guardado cuando el teléfono está oculto.
- Migración automática y no destructiva de clientes existentes.
- Exportación CSV ampliada con usuario e identificador de chat.
- Textos y campos del panel actualizados para aceptar número o `@usuario`.

## Archivos modificados

- `src/store.js`
- `src/whatsapp-service.js`
- `src/server.js`
- `src/scheduler.js`
- `public/index.html`
- `public/app.js`
- `test/store.test.js`
- `test/whatsapp-service.test.js`

## Verificación

Comandos ejecutados:

```powershell
node --check src/store.js
node --check src/whatsapp-service.js
node --check src/server.js
node --check src/scheduler.js
node --check public/app.js
node --test
```

Resultado:

- Sintaxis: correcta en todos los archivos comprobados.
- Tests: 140 aprobados, 0 fallidos.
- Flujo HTTP temporal: login 200, creación por `@usuario` 201, búsqueda por `@usuario` 200 y cliente encontrado.
- Lint: el proyecto no define un script de lint.
- Build: el proyecto no define un paso de compilación; se ejecuta directamente con Node.js.

## Render

No se modificaron `package.json`, el script de inicio, la variable `PORT`, las variables de entorno ni la persistencia de la sesión. La base sigue migrándose al iniciar y los campos nuevos se guardan dentro del mismo JSON persistente.

## Punto no verificable sin una sesión real

No fue posible ejecutar un mensaje real contra los servidores de WhatsApp desde el entorno de prueba. Se verificaron con simulaciones fieles los campos de Baileys `remoteJidUsername`, LID, `remoteJidAlt`, el mapeo LID-PN y los eventos de contactos. El navegador integrado también bloqueó `127.0.0.1` por política de seguridad, aunque la API local sí fue comprobada directamente.

No se eliminó ninguna función existente.
