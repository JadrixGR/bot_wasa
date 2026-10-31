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
    getDicloakAdminOperationsForMember: (name) => state.operations.filter((item) => item.memberName === name),
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
    listProfileGroups: async () => ({ data: { list: [{ id: "profiles-1", name: "PLAN PLUS" }] } }),
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
  assert.equal("group_id" in calls[0][1], false);
  assert.deepEqual(calls[0][1].profile_group_ids, ["profiles-1"]);
  assert.deepEqual(calls[0][1].expiration, { enabled: true, time_zone: "America/Lima", mode: "LOGIN_START", days: 31 });
  assert.equal(calls.length, 1, "el alta incluye el vencimiento sin un PATCH posterior");
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-11-15");
  assert.equal(store.state.operations[0].commercialStartDate, "2026-10-15");
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

function failedCreationFixture() {
  const store = storeFixture();
  store.state.operations.push({
    messageId: "old-attempt", command: "NUEVO", memberName: "Jeremias4587", plan: "PLAN PLUS", months: 1,
    status: "FAILED", createdAt: "2026-10-15T22:26:00.000Z",
    error: "DICloak rechazó la operación (This member has already been activated, days can no longer be changed: submit expires_at to renew)."
  });
  const member = {
    id: "member-1", name: "Jeremias4587", account: "Jeremias4587", type: "INTERNAL", authority: "MEMBER",
    status: "ENABLED", member_group_id: "members-1", all_profile_groups: false,
    profile_group_list: [{ id: "profiles-1", name: "PLAN PLUS" }]
  };
  const calls = [];
  const client = {
    listMembers: async () => [member],
    listMemberGroups: async () => [{ id: "members-1", name: "CHAT GPT" }],
    listProfileGroups: async () => [{ id: "profiles-1", name: "PLAN PLUS" }],
    getExpiration: async () => ({ enabled: false }),
    createMember: async () => { assert.fail("no debe crear otro miembro"); },
    updateExpiration: async (id, body) => { calls.push([id, body]); }
  };
  return { store, member, client, calls, service: new DicloakAdminService({ store, client, timeZone: "America/Lima", expirationTime: "23:59" }) };
}

test("recupera el alta fallida con fecha fija y conserva la fecha original al reintentar otro día", async () => {
  const { store, calls, service } = failedCreationFixture();
  const incoming = message();
  incoming.messageTimestamp += 86400 * 5;
  const result = await service.create(parseAdminCommand("NUEVO | Jeremias4587 | PLAN PLUS | 1 MES"), incoming);
  assert.match(result, /ALTA RECUPERADA/);
  assert.deepEqual(calls, [["member-1", { enabled: true, time_zone: "America/Lima", mode: "INSTANT", expires_at: "2026-11-15 23:59" }]]);
  assert.equal(store.state.records[0].commercialStartDate, "2026-10-15");
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-11-15");
  await assert.rejects(service.create(parseAdminCommand("NUEVO | Jeremias4587 | PLAN PLUS | 1 MES"), incoming), /ya existe/);
  assert.equal(calls.length, 1);
});

test("recuperación prefiere la fecha guardada del mensaje y no vuelve a escribir un vencimiento ya aplicado", async () => {
  const { store, calls, client, service } = failedCreationFixture();
  store.state.operations[0].commercialStartDate = "2026-10-14";
  client.getExpiration = async () => ({ enabled: true, time_zone: "America/Lima", mode: "INSTANT", expires_at: "2026-11-14 23:59" });
  await service.create(parseAdminCommand("NUEVO | Jeremias4587 | PLAN PLUS | 1 MES"), message());
  assert.equal(calls.length, 0);
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-11-14");
});

for (const [name, change] of [
  ["sin intento fallido", ({ store }) => { store.state.operations = []; }],
  ["con otro error", ({ store }) => { store.state.operations[0].error = "timeout"; }],
  ["con otro plan", ({ store }) => { store.state.operations[0].plan = "PLAN MAX"; }],
  ["con otra duración", ({ store }) => { store.state.operations[0].months = 2; }],
  ["con otra cuenta", ({ member }) => { member.account = "OtraCuenta123"; }],
  ["con otros permisos", ({ member }) => { member.all_profile_groups = true; }],
  ["sin fecha original", ({ store }) => { delete store.state.operations[0].createdAt; }],
  ["con otro vencimiento", ({ client }) => { client.getExpiration = async () => ({ enabled: true, mode: "INSTANT", expires_at: "2027-01-01 23:59" }); }]
]) {
  test(`no modifica un miembro existente ${name}`, async () => {
    const fixture = failedCreationFixture();
    change(fixture);
    await assert.rejects(fixture.service.create(parseAdminCommand("NUEVO | Jeremias4587 | PLAN PLUS | 1 MES"), message()), /ya existe|otro vencimiento/);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.store.state.records.length, 0);
  });
}

test("no guarda el alta recuperada si DICloak rechaza la expiración", async () => {
  const { store, client, service } = failedCreationFixture();
  client.updateExpiration = async () => { throw new Error("DICloak rechazó la operación"); };
  await assert.rejects(service.create(parseAdminCommand("NUEVO | Jeremias4587 | PLAN PLUS | 1 MES"), message()), /rechazó/);
  assert.equal(store.state.records.length, 0);
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
