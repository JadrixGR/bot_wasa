export const DEFAULT_WELCOME_MESSAGES = [
`🚀 JADRIXSERVS 🚀

🔥 PRODUCTOS DISPONIBLES 🔥

🇵🇪🇨🇱 🇨🇴 🇪🇨 🇲🇽 Consulta el precio para tu país

➡️ \`𝗖𝗟𝗔𝗨𝗗𝗘 𝗣𝗥𝗢\`  🤖 — S/25
➡️ \`𝗖𝗛𝗔𝗧𝗚𝗣𝗧 𝗣𝗥𝗢\` 🚀 — S/45
➡️ \`𝗖𝗛𝗔𝗧𝗚𝗣𝗧 𝗣𝗟𝗨𝗦\` 🚀 — S/10
➡️ \`𝗖𝗛𝗔𝗧𝗚𝗣𝗧 𝗣𝗟𝗨𝗦 𝗣𝗘𝗥𝗦𝗢𝗡𝗔𝗟\` 🚀 — S/30
➡️ \`𝗚𝗘𝗠𝗜𝗡𝗜 𝗣𝗥𝗢\` 💎 — S/20 mensual
➡️ \`𝗚𝗘𝗠𝗜𝗡𝗜 𝗣𝗥𝗢 𝗔𝗡𝗨𝗔𝗟\` 💎 — S/50
➡️ \`𝗚𝗘𝗠𝗜𝗡𝗜 𝟭𝟴 𝗠𝗘𝗦𝗘𝗦\` 💎 — S/70
➡️ \`𝗦𝗨𝗣𝗘𝗥𝗚𝗥𝗢𝗞\` 🧠 — S/20
➡️ \`𝗣𝗘𝗥𝗣𝗟𝗘𝗫𝗜𝗧𝗬 𝗣𝗥𝗢\` 🔎 — S/15
➡️ \`𝗚𝗔𝗠𝗠𝗔 𝗣𝗥𝗢\` 📊 — S/20
➡️ \`𝗖𝗔𝗣𝗖𝗨𝗧 𝗣𝗥𝗢\` 🎬 — S/15

➡️ \`𝗛𝗕𝗢\` 🎬 — S/7 el perfil
➡️ \`𝗖𝗥𝗨𝗡𝗖𝗛𝗬𝗥𝗢𝗟𝗟\` ⛩️ — S/5 el perfil`,
`💼 COMBOS ESPECIALES - Todo en 1

➡️ 𝗣𝗟𝗔𝗡 𝗣𝗥𝗢 💎 — \`S/60/mes\`

✅ \`ChatGPT Pro\`
✅ \`Gemini 3 Ultra\`
✅ \`Perplexity Pro\`
✅ \`Freepik Premium\`
✅ \`CapCut Pro\`
✅ \`+1000 cursos de IA\`
✅ \`SuperGrok\`
✅ \`SuperGrok Heavy\`

⭐ *PLAN PLUS – \`S/25/mes\`*

✅ \`ChatGPT Plus\`
✅ \`Perplexity Pro\`
✅ \`Capcut Pro\`
✅ \`+ 1000 cursos de IA\``,
`✅ \`Entrega inmediata\`
✅ \`Soporte activo\`
✅ \`Renovación garantizada\`

🔥 Escríbeme para armarte un combo personalizado 🔥

JadrixServs 💪`
];

export const DEFAULT_CONFIG = {
  businessName: 'JadrixServs',
  aiEnabled: false,
  answerMode: 'hybrid',
  aiModel: 'gpt-5-mini',
  reasoningEffort: 'low',
  maxOutputTokens: 500,
  humanPauseMinutes: 30,
  supportHours: '24 horas',
  customerGroupUrl: 'https://chat.whatsapp.com/LT9aopkfDbD2jiy1OQ08st?mode=gi_t',
  welcomeEnabled: true,
  welcomeRepeatDays: 30,
  welcomeDelayMs: 750,
  welcomeMessages: DEFAULT_WELCOME_MESSAGES,
  systemPrompt: `Eres el asesor comercial de JadrixServs por WhatsApp.

Responde como una persona amable, clara y directa. Usa la palabra “estimad@” de forma natural, sin repetirla demasiado.

REGLAS:
- Usa solamente la información registrada en el panel y en la base de conocimiento.
- Nunca inventes disponibilidad, precios, duración, garantía, funciones o condiciones.
- Si un producto está inactivo, indica que no está disponible actualmente.
- Explica claramente cuándo una cuenta es compartida y que otros usuarios pueden ver los chats o archivos.
- No recomiendes una cuenta compartida para información privada.
- Todo servicio por DICloak tiene un perfil independiente dentro de la cuenta DICloak del cliente.
- DICloak funciona en Windows, macOS y Linux. Se usa en una computadora a la vez, aunque el cliente puede cambiar de equipo.
- No presentes DICloak como una integración oficial del proveedor.
- No confirmes un pago, pedido o activación hasta que un asesor revise el comprobante.
- Si falta un dato, realiza una sola pregunta concreta.
- Mantén las respuestas breves y apropiadas para WhatsApp.
- Cuando el cliente decida comprar, explica el método de pago y solicita el comprobante.`,
  fallbackText: 'Cuénteme qué producto desea o para qué necesita la inteligencia artificial y con gusto le recomiendo una opción.',
  humanText: 'Perfecto, estimad@. Dejaré esta conversación para atención humana. Puede escribir todos los detalles y un asesor continuará con usted.',
  billingAutomationEnabled: false,
  defaultReminderLeadDays: 2,
  reminderHour: 10,
  timezone: 'America/Lima',
  reminderTemplate: `Hola, {cliente} 👋

Le recordamos que su servicio de {producto} vence el {vencimiento}.

Puede renovar desde ahora sin perder días. Si paga antes del vencimiento, el nuevo periodo comenzará cuando termine su suscripción actual.

{pago}

Después de realizar el pago, envíeme el comprobante para proceder con la renovación.

JadrixServs 💪`,
  yapeNumber: '921444991',
  yapeHolder: 'Jaime Gar.',
  binanceId: '1205380212',
  penToUsdRate: 0.29,
  internationalSurchargePct: 3,
  audioCooldownHours: 24
};

const P = (seedKey, name, pricePen, active, tags, knowledge, extra = {}) => ({
  seedKey,
  name,
  pricePen,
  active,
  tags,
  knowledge,
  category: 'IA',
  durationValue: 1,
  durationUnit: 'months',
  updatedAt: new Date().toISOString(),
  ...extra
});

export const SEEDED_PRODUCTS = [
  P('claude-pro', 'Claude Pro', 25, true,
    'claude, anthropic, claude pro, documentos, redacción',
    `Cuenta compartida entre 4 clientes. Se entrega correo y contraseña. Puede usarse en celular o laptop. Dura 1 mes. Otros usuarios pueden ver conversaciones y archivos. No se permite modificar los datos de la cuenta ni borrar chats. Incluye garantía durante el periodo contratado y soporte ante cualquier inconveniente.`),

  P('chatgpt-pro', 'ChatGPT Pro', 45, true,
    'chatgpt pro, gpt pro, investigación, dicloak, pc, laptop',
    `Cuenta original de ChatGPT Pro compartida mediante DICloak. Precio S/45 por 1 mes. Funciona en laptop o PC con Windows, macOS o Linux. JadrixServs crea las credenciales de DICloak y envía las instrucciones. Puede usarse en diferentes computadoras, pero solo en una a la vez. Los demás usuarios pueden ver las conversaciones. Los chats están configurados para evitar que otros usuarios los borren. Incluye una cuenta compartida de ChatGPT Plus para celular durante el mismo mes sin costo adicional; en esa cuenta los demás usuarios también pueden ver los chats. Servicio garantizado, soporte 24 horas y acceso al grupo de clientes.`,
    { dicloak: true }),

  P('chatgpt-plus-shared', 'ChatGPT Plus compartido', 10, true,
    'chatgpt plus, chat gpt plus, económico, tareas, celular',
    `Cuenta compartida entre 8 y 10 personas. Se entrega correo y contraseña. Dura 30 días. El cliente elige usarla en un celular o en una laptop. El acceso incluido es para un dispositivo. Un segundo dispositivo cuesta S/5 adicionales y permite usar ambos simultáneamente. Los demás usuarios pueden ver las conversaciones. No se permite modificar los datos de la cuenta. Incluye soporte.`,
    { durationValue: 30, durationUnit: 'days' }),

  P('chatgpt-plus-personal', 'ChatGPT Plus Personal', 30, true,
    'chatgpt plus personal, privado, exclusiva, privacidad, documentos privados',
    `JadrixServs entrega una cuenta exclusiva para el cliente. Precio S/30 por 1 mes. El cliente puede modificarla, usarla en los dispositivos que desee y compartirla con un familiar o amigo bajo su responsabilidad. La cuenta dura solo 1 mes y no es renovable sobre la misma cuenta; al renovar se entrega otra cuenta. Si falla dentro del periodo, se reemplaza por otra. Es la recomendación para uso general y para clientes que necesitan privacidad.`,
    { sharingType: 'personal' }),

  P('gemini-pro-monthly', 'Gemini Pro mensual', 20, true,
    'gemini pro, google ai pro, video, vídeos, 5tb, personal',
    `Activación personal en el correo del cliente. Solo se solicita la dirección de correo, nunca la contraseña. Dura 1 mes. Puede abrirse en todos los dispositivos vinculados al correo. Incluye 5 TB de almacenamiento y beneficios de Google AI Pro durante todo el periodo. Activación inmediata, garantía durante el plan y restauración si la activación se pierde. Puede renovarse en el mismo correo. Recomendado principalmente para trabajo con videos.`,
    { sharingType: 'personal' }),

  P('gemini-pro-year', 'Gemini Pro anual', 50, true,
    'gemini pro anual, google ai pro, 1 año, 12 meses, 5tb',
    `Activación personal en el correo del cliente. Solo se solicita la dirección de correo. Dura 1 año. Incluye 5 TB y beneficios de Google AI Pro durante todo el periodo. Activación inmediata, garantía durante el año, restauración si se pierde y renovación posible en el mismo correo.`,
    { durationValue: 1, durationUnit: 'years', sharingType: 'personal' }),

  P('gemini-pro-18', 'Gemini Pro 18 meses', 70, true,
    'gemini pro 18 meses, google ai pro, 5tb',
    `Activación personal en el correo del cliente. Solo se solicita la dirección de correo. Dura 18 meses. Incluye 5 TB y beneficios de Google AI Pro durante todo el periodo. Activación inmediata, garantía durante los 18 meses, restauración si se pierde y renovación posible en el mismo correo.`,
    { durationValue: 18, durationUnit: 'months', sharingType: 'personal' }),

  P('supergrok-monthly', 'SuperGrok', 20, true,
    'supergrok, grok, imágenes, búsquedas',
    `Cuenta compartida entre aproximadamente 5 personas. Se entrega correo y contraseña. Dura 1 mes. El cliente elige celular o laptop. Un segundo dispositivo simultáneo cuesta S/5 adicionales. No se permite modificar los datos de la cuenta. Otros usuarios pueden ver y borrar conversaciones. Incluye generación de imágenes, búsquedas y las funciones disponibles del plan. Incluye garantía y solución pronta ante inconvenientes.`),

  P('supergrok-year', 'SuperGrok 1 año', 60, false,
    'supergrok anual, grok un año',
    `Este plan no está disponible actualmente. No debe ofrecerse ni cobrarse.`,
    { durationValue: 1, durationUnit: 'years' }),

  P('perplexity-pro', 'Perplexity Pro', 15, true,
    'perplexity pro, investigación, fuentes, búsquedas, archivos, dicloak',
    `Cuenta compartida mediante DICloak por S/15 durante 1 mes. Tiene su propio perfil dentro de la cuenta DICloak. Funciona en laptop o PC con Windows, macOS o Linux y se usa en una computadora a la vez. JadrixServs crea las credenciales y envía las instrucciones. Los demás usuarios pueden ver la actividad guardada. No se permite modificar los datos. Incluye búsquedas Pro, modelos disponibles, carga y análisis de archivos, garantía y soporte 24 horas.`,
    { dicloak: true }),

  P('gamma-pro', 'Gamma Pro', 20, true,
    'gamma pro, presentaciones, powerpoint, pdf',
    `Cuenta compartida entre 5 personas. Se entrega correo y contraseña. Dura 1 mes. Puede usarse en celular y computadora, incluso simultáneamente. Otros usuarios pueden ver, editar o borrar presentaciones guardadas. Permite descargar en PowerPoint y PDF. Incluye funciones y créditos del plan. Si se agotan los créditos o surge un problema, JadrixServs brinda una solución pronta.`),

  P('capcut-pro', 'CapCut Pro', 15, true,
    'capcut pro, editar video, vídeos, sin marca de agua',
    `Cuenta compartida entre 4 personas. Se entrega correo y contraseña. Dura 1 mes. Puede usarse en celular y laptop simultáneamente, compatible con Windows y macOS. Incluye funciones Pro, almacenamiento en la nube y exportación sin marca de agua. Se recomienda guardar los proyectos localmente para que permanezcan separados de otros usuarios. No se permiten cambios en los datos de la cuenta. Incluye soporte y solución pronta.`),

  P('netflix', 'Netflix por perfil', 10, false,
    'netflix, películas, series',
    `Netflix no está disponible actualmente. No debe ofrecerse ni cobrarse.`,
    { category: 'Streaming' }),

  P('hbo', 'HBO por perfil', 7, true,
    'hbo, max, películas, series, perfil',
    `Perfil exclusivo dentro de una cuenta compartida. Después del pago, el cliente indica el nombre del perfil y un PIN. Se entrega correo, contraseña, nombre de perfil y PIN. Puede iniciar sesión en celular, laptop o Smart TV, incluso en varios dispositivos, pero reproducir solo en uno a la vez. No se puede cambiar el nombre ni el PIN después de la activación. Otros usuarios no acceden al perfil sin conocer el PIN. Entrega inmediata. Dura 1 mes. Incluye solución pronta ante inconvenientes.`,
    { category: 'Streaming' }),

  P('crunchyroll', 'Crunchyroll por perfil', 5, true,
    'crunchyroll, anime, perfil',
    `Mismas condiciones que HBO. Perfil exclusivo dentro de una cuenta compartida. Después del pago, el cliente indica el nombre y PIN. Se entrega correo, contraseña, perfil y PIN. Puede iniciar sesión en celular, laptop o Smart TV, pero reproducir solo en uno a la vez. No puede cambiarse el nombre ni PIN. Entrega inmediata, duración de 1 mes y solución pronta ante inconvenientes.`,
    { category: 'Streaming' }),

  P('plan-pro', 'Plan Pro', 60, true,
    'plan pro, combo pro, creación contenido, video, redes sociales, dicloak',
    `Combo compartido por DICloak, S/60 por 1 mes. Dentro de la cuenta DICloak, cada servicio tiene su propio perfil independiente. Incluye ChatGPT Pro, Gemini 3 Ultra, Perplexity Pro, Freepik Premium, CapCut Pro, más de 1000 cursos de IA, SuperGrok y SuperGrok Heavy. Recomendado para creación de videos y contenido, ideas, guiones, imágenes, investigación y edición. Funciona principalmente en laptop o PC. Incluye soporte y garantía.`,
    { category: 'Combo', dicloak: true }),

  P('plan-plus', 'Plan Plus', 25, true,
    'plan plus, combo económico, dicloak, domestika, cursos',
    `Combo compartido por DICloak, S/25 por 1 mes. Cada servicio tiene su propio perfil. Incluye ChatGPT Plus, Perplexity Pro, CapCut Pro y más de 1000 cursos de IA. Los cursos se abren desde un perfil de Domestika. Funciona principalmente en laptop o PC. Incluye soporte y solución ante inconvenientes.`,
    { category: 'Combo', dicloak: true }),

  P('freepik-premium', 'Freepik Premium', 0, true,
    'freepik premium, imágenes, recursos, plantillas',
    `Incluido dentro del Plan Pro. Es una cuenta compartida y tiene su propio perfil dentro de DICloak. Incluye las funciones disponibles del plan Premium. No se ofrece como producto individual salvo que el administrador lo configure.`,
    { category: 'Incluido', dicloak: true, soldSeparately: false }),

  P('supergrok-heavy', 'SuperGrok Heavy', 0, true,
    'supergrok heavy, grok heavy',
    `Incluido dentro del Plan Pro. Es una cuenta compartida y tiene su propio perfil dentro de DICloak. Incluye las funciones disponibles del servicio. No se ofrece como producto individual salvo que el administrador lo configure.`,
    { category: 'Incluido', dicloak: true, soldSeparately: false })
];

export const SEEDED_FAQS = [
  {
    seedKey: 'dicloak-general',
    title: 'Cómo funciona DICloak',
    triggers: 'dicloak, dialock, di cloack, cómo funciona dicloak, como funciona dicloak, instalar dicloak, acceso dicloak',
    answer: `DICloak se utiliza para acceder desde una laptop o PC con Windows, macOS o Linux. JadrixServs crea sus credenciales y le envía las instrucciones. Dentro de su cuenta tendrá un perfil independiente para cada servicio contratado. Puede cambiar de computadora, pero debe usar una a la vez. Al tratarse de cuentas compartidas, otros usuarios pueden ver la actividad guardada y no se deben modificar los datos de las cuentas.`,
    active: true,
    audioSuggested: true
  },
  {
    seedKey: 'shared-privacy',
    title: 'Privacidad de cuentas compartidas',
    triggers: 'pueden ver mis chats, privacidad, ven mis conversaciones, cuenta compartida, borrar chats',
    answer: `En toda cuenta compartida, otros clientes pueden ver las conversaciones, archivos o proyectos guardados. Por eso no debe colocar información privada o confidencial. No se permite modificar el correo, contraseña ni otros datos de la cuenta. Las condiciones específicas pueden variar según el producto.`,
    active: true
  },
  {
    seedKey: 'support',
    title: 'Soporte y garantía',
    triggers: 'soporte, garantía, garantia, dejó de funcionar, dejo de funcionar, problema con la cuenta, grupo de clientes',
    answer: `Contamos con soporte las 24 horas y garantía durante el periodo contratado. Ante cualquier inconveniente, escríbanos para darle una solución pronta. Grupo de WhatsApp para clientes: https://chat.whatsapp.com/LT9aopkfDbD2jiy1OQ08st?mode=gi_t`,
    active: true
  },
  {
    seedKey: 'payment-peru',
    title: 'Pago en Perú',
    triggers: 'yape, pagar en perú, pago peru, método de pago peru',
    answer: `Para Perú contamos con Yape:\nNúmero: 921444991\nTitular: Jaime Gar.\n\nDespués de realizar el pago, envíe el comprobante para proceder con la activación.`,
    active: true
  },
  {
    seedKey: 'payment-international',
    title: 'Pago internacional',
    triggers: 'binance, usdt, pago internacional, chile, colombia, ecuador, méxico, mexico, otro país',
    answer: `Para otros países aceptamos USDT mediante el ID de Binance 1205380212. Se convierte el precio de soles a dólares, se añade 3 % y el monto se redondea hacia arriba a dos decimales. El envío es interno por ID de Binance, sin seleccionar una red. Después del pago, envíe el comprobante y la activación es inmediata.`,
    active: true
  },
  {
    seedKey: 'renewal',
    title: 'Renovaciones anticipadas',
    triggers: 'renovar, renovación, renovacion, vence, vencimiento, pagar antes',
    answer: `Puede pagar antes de la fecha de vencimiento sin perder días. El nuevo periodo comienza cuando termina la suscripción actual. Si la suscripción ya venció y paga después, el nuevo periodo comienza desde la fecha del nuevo pago.`,
    active: true
  },
  {
    seedKey: 'recommend-private',
    title: 'Recomendación con privacidad',
    triggers: 'privado, privacidad, documentos privados, nadie vea mis chats',
    answer: `Para privacidad solo recomendamos opciones personales. ChatGPT Plus Personal por S/30 es la mejor opción para uso general. Gemini Pro, activado en el correo del cliente, se recomienda principalmente para trabajo con videos.`,
    active: true
  },
  {
    seedKey: 'recommend-research',
    title: 'Recomendación para investigación',
    triggers: 'investigar, investigación, fuentes, análisis de documentos',
    answer: `Para investigación recomendamos ChatGPT Pro. Si también necesita crear presentaciones, puede complementarlo con Gamma Pro.`,
    active: true
  },
  {
    seedKey: 'recommend-content',
    title: 'Recomendación para contenido y videos',
    triggers: 'crear contenido, redes sociales, editar videos, hacer guiones, generar imágenes',
    answer: `Para creación de videos y contenido recomendamos el Plan Pro de S/60 por 1 mes, porque reúne herramientas para ideas, guiones, imágenes, investigación y edición.`,
    active: true
  },
  {
    seedKey: 'recommend-budget',
    title: 'Opción económica de ChatGPT',
    triggers: 'más económico, mas economico, barato, solo tareas, redactar textos',
    answer: `Si no tiene inconveniente con una cuenta compartida, ChatGPT Plus compartido cuesta S/10 por 30 días. Si necesita privacidad y una cuenta exclusiva, ChatGPT Plus Personal cuesta S/30 por 1 mes.`,
    active: true
  }
];
