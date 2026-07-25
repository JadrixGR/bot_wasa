# Bot WhatsApp QR + Panel + IA — versión 3

Esta versión agrega un centro de control en la misma URL de Render.

## Funciones

- Conexión por QR con Baileys.
- Estado, QR, reinicio y cierre de sesión.
- Activar o pausar respuestas.
- Editar nombre, horario, dirección y mensajes.
- Registrar productos, precios, stock, descripción y palabras clave.
- Importar muchos productos pegando una lista.
- Crear comandos y respuestas rápidas.
- Cargar PDF con catálogo, políticas o preguntas frecuentes.
- Pegar información directamente.
- Responder con OpenAI usando productos, FAQs y PDF como conocimiento.
- Probar respuestas desde el panel.
- Descargar y restaurar respaldo JSON.

## Importante: no es entrenamiento tradicional

El PDF y los productos forman una base de conocimiento. Cuando llega una pregunta, el bot busca la información relevante y se la entrega a la IA. Esto permite actualizarlo desde el panel sin reentrenar un modelo.

## Actualizar tu repositorio actual

1. Extrae este ZIP.
2. Copia todos los archivos dentro de tu carpeta actual del repositorio.
3. Reemplaza los archivos existentes, pero no borres la carpeta oculta `.git`.
4. Ejecuta:

```powershell
git add .
git commit -m "Agregar panel de productos PDF e IA"
git push
```

Render iniciará un despliegue automático.

## Configurar la IA

En Render abre:

`whatsapp-qr-render-bot → Environment`

Agrega:

```text
OPENAI_API_KEY = tu_clave_secreta
OPENAI_MODEL = gpt-5.6-luna
```

La clave se configura únicamente en Render. No la escribas en GitHub ni en el panel del navegador.

Después pulsa `Save and deploy`.

La API de OpenAI se cobra por separado de ChatGPT Plus.

## Uso del panel

Entra a tu URL de Render y usa la ADMIN_KEY.

### Productos

Puedes registrar cada producto individualmente o importar líneas con este formato:

```text
Nombre | Precio | Stock | Descripción | palabras clave
Laptop Pro | S/ 2500 | 5 unidades | Laptop para oficina | laptop, computadora
```

### Respuestas rápidas

Agrega palabras separadas por comas:

```text
delivery, envío, envios, hacen entregas
```

y escribe la respuesta correspondiente.

### PDF

Carga un PDF con texto seleccionable. Los PDF escaneados como imagen no se pueden leer sin OCR.

### Modos

- `Híbrido`: respuestas rápidas cuando existe una coincidencia clara; IA para las demás preguntas.
- `IA`: usa IA para casi todo, salvo la derivación a asesor.
- `Solo reglas`: no consume la API de IA.

## Persistencia

Render gratuito usa almacenamiento temporal. Guarda respaldos JSON frecuentemente. Para conservar permanentemente la sesión y la configuración necesitas un disco persistente o una base de datos externa.
