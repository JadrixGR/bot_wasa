"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { addMonthsClamped, daysBetween } = require("../src/date-utils");
const { DicloakAdminService, parseAdminCommand } = require("../src/dicloak-admin");

function storeFixture() {
  const state = { records: [], operations: [], logs: [] };
  return {
    state,
    getDicloakAdminOperation: (id) => state.operations.find((item) => item.messageId === id) || null,
    beginDicloakAdminOperation: (item) => state.operations.push({ ...item, status: "PENDING" }),
    finishDicloakAdminOperation: (id, patch) => Object.assign(state.operations.find((item) => item.messageId === id), patch),
    saveDicloakMemberRecord: (item) => { state.records.push(item); return item; },
    getDicloakMemberRecord: (name) => state.records.find((item) => item.dicloakMemberName === name) || null,
    addLog: (type, message, metadata) => state.logs.push({ type, message, metadata }),
    save: () => undefined
  };
}

function message(id = "wamid-1", sender = "51911111111") {
  return { key: { id, remoteJid: "120363000000000000@g.us", participant: `${sender}@s.whatsapp.net` }, messageTimestamp: 1792065600 };
}

test("calcula meses calendario y días de LOGIN_START", () => {
  assert.equal(addMonthsClamped("2026-10-15", 1), "2026-11-15");
  assert.equal(addMonthsClamped("2026-11-14", 1), "2026-12-14");
  assert.equal(addMonthsClamped("2026-10-20", 2), "2026-12-20");
  assert.equal(addMonthsClamped("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsClamped("2026-08-31", 1), "2026-09-30");
  assert.equal(daysBetween("2026-10-15", "2026-11-15"), 31);
});

test("parser acepta NUEVO/RENOVAR con barras y rechaza formatos incompletos", () => {
  assert.deepEqual(parseAdminCommand("nuevo | Jeremias4587 | plan plus | 1 mes"), { isCommand: true, ok: true, command: "NUEVO", name: "Jeremias4587", plan: "plan plus", months: 1 });
  assert.equal(parseAdminCommand("RENOVAR | Jeremias4587 | 2 MESES").months, 2);
  assert.equal(parseAdminCommand("NUEVO Jeremias").ok, false);
  assert.equal(parseAdminCommand("hola").isCommand, false);
});

test("crea miembro con credenciales iguales, grupos resueltos y fecha comercial persistente", async () => {
  process.env.WHATSAPP_ADMIN_GROUP_ID = "120363000000000000@g.us";
  process.env.WHATSAPP_ADMIN_NUMBERS = "51911111111";
  const store = storeFixture();
  const calls = [];
  const client = {
    listMemberGroups: async () => [{ id: "members-1", name: "CHAT GPT" }],
    listProfiles: async () => ({ data: [{ group_id: "profiles-1", group_name: "PLAN PLUS" }] }),
    listMembers: async () => [],
    createMember: async (body) => { calls.push(["create", body]); return { id: "member-1" }; },
    updateExpiration: async (id, body) => { calls.push(["expiration", id, body]); return {}; }
  };
  const replies = [];
  const service = new DicloakAdminService({ store, client });
  await service.handle({ message: message(), body: "NUEVO | Jeremias4587 | PLAN PLUS | 1 MES", reply: async (text) => replies.push(text) });
  assert.equal(calls[0][1].name, "Jeremias4587");
  assert.equal(calls[0][1].account, "Jeremias4587");
  assert.equal(calls[0][1].password, "Jeremias4587");
  assert.deepEqual(calls[0][1].profile_group_ids, ["profiles-1"]);
  assert.equal(calls[1][2].mode, "LOGIN_START");
  assert.equal(calls[1][2].days, 31);
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-11-15");
  assert.match(replies[0], /CLIENTE CREADO/);
});

test("renueva desde la fecha comercial, usa INSTANT y bloquea reintentos por message ID", async () => {
  process.env.WHATSAPP_ADMIN_GROUP_ID = "120363000000000000@g.us";
  process.env.WHATSAPP_ADMIN_NUMBERS = "51911111111";
  const store = storeFixture();
  store.state.records.push({ dicloakMemberId: "member-1", dicloakMemberName: "Jeremias4587", commercialNextRenewalDate: "2026-11-15", monthsPurchased: 1 });
  const calls = [];
  const client = {
    listMembers: async () => [{ id: "member-1", name: "Jeremias4587", status: "DISABLED" }],
    updateExpiration: async (id, body) => { calls.push(["expiration", id, body]); return {}; },
    updateMember: async (id, body) => { calls.push(["member", id, body]); return {}; }
  };
  const replies = [];
  const service = new DicloakAdminService({ store, client });
  await service.handle({ message: message("wamid-renew"), body: "RENOVAR | Jeremias4587 | 2 MESES", reply: async (text) => replies.push(text) });
  await service.handle({ message: message("wamid-renew"), body: "RENOVAR | Jeremias4587 | 2 MESES", reply: async (text) => replies.push(text) });
  assert.equal(calls[0][2].mode, "INSTANT");
  assert.equal(calls[0][2].expires_at, "2027-01-15 23:59");
  assert.deepEqual(calls[1], ["member", "member-1", { status: "ENABLED" }]);
  assert.equal(store.state.records.at(-1).commercialNextRenewalDate, "2027-01-15");
  assert.match(replies[1], /ya procesado/i);
});

test("ignora grupo o remitente no autorizados", async () => {
  process.env.WHATSAPP_ADMIN_GROUP_ID = "grupo-autorizado@g.us";
  process.env.WHATSAPP_ADMIN_NUMBERS = "51911111111";
  const service = new DicloakAdminService({ store: storeFixture(), client: {} });
  let replied = false;
  const handled = await service.handle({ message: message("x", "51999999999"), body: "NUEVO | Jeremias4587 | PLAN PLUS | 1 MES", reply: async () => { replied = true; } });
  assert.equal(handled, false);
  assert.equal(replied, false);
});

test("autoriza el número alternativo cuando WhatsApp entrega el remitente como LID", async () => {
  process.env.WHATSAPP_ADMIN_GROUP_ID = "120363000000000000@g.us";
  process.env.WHATSAPP_ADMIN_NUMBERS = "51911111111";
  const service = new DicloakAdminService({ store: storeFixture(), client: {} });
  const incoming = message("id-dicloak", "123456789");
  incoming.key.participant = "123456789@lid";
  incoming.key.participantAlt = "51911111111@s.whatsapp.net";
  const replies = [];
  const handled = await service.handle({ message: incoming, body: "ID DICLOAK", reply: async (text) => replies.push(text) });
  assert.equal(handled, true);
  assert.deepEqual(replies, ["ID de este grupo: 120363000000000000@g.us"]);
});

test("resuelve el número del administrador desde el mapeo LID de WhatsApp", async () => {
  process.env.WHATSAPP_ADMIN_GROUP_ID = "120363000000000000@g.us";
  process.env.WHATSAPP_ADMIN_NUMBERS = "51911111111";
  const service = new DicloakAdminService({ store: storeFixture(), client: {} });
  const incoming = message("id-dicloak-mapped", "123456789");
  incoming.key.participant = "123456789@lid";
  const replies = [];
  const handled = await service.handle({
    message: incoming,
    body: "ID DICLOAK",
    socket: { signalRepository: { lidMapping: { getPNForLID: async () => "51911111111@s.whatsapp.net" } } },
    reply: async (text) => replies.push(text)
  });
  assert.equal(handled, true);
  assert.deepEqual(replies, ["ID de este grupo: 120363000000000000@g.us"]);
});

test("permite obtener el ID del grupo durante la configuración", async () => {
  delete process.env.WHATSAPP_ADMIN_GROUP_ID;
  delete process.env.WHATSAPP_ADMIN_NUMBERS;
  const service = new DicloakAdminService({ store: storeFixture(), client: {} });
  const replies = [];
  const handled = await service.handle({
    message: message("id-dicloak-setup", "51999999999"),
    body: "ID DICLOAK",
    reply: async (text) => replies.push(text)
  });
  assert.equal(handled, true);
  assert.deepEqual(replies, ["ID de este grupo: 120363000000000000@g.us"]);
});
