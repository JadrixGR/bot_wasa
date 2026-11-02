"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { addMonthsClamped, daysBetween } = require("../src/date-utils");
const { DicloakAdminService, parseAdminCommand } = require("../src/dicloak-admin");

function storeFixture() {
  const state = { records: [], operations: [], logs: [], clients: [] };
  return {
    state,
    getDicloakAdminOperation: (id) => state.operations.find((item) => item.messageId === id) || null,
    getDicloakAdminOperationsForMember: (name) => state.operations.filter((item) => item.memberName === name),
    beginDicloakAdminOperation: (item) => state.operations.push({ ...item, status: "PENDING" }),
    finishDicloakAdminOperation: (id, patch) => Object.assign(state.operations.find((item) => item.messageId === id), patch),
    saveDicloakMemberRecord: (item) => {
      const index = state.records.findIndex((record) => record.dicloakMemberName === item.dicloakMemberName);
      if (index < 0) state.records.push(item); else state.records[index] = item;
      return item;
    },
    getDicloakMemberRecord: (name) => state.records.find((item) => item.dicloakMemberName === name) || null,
    getDicloakCommercialCandidates: (name) => state.clients.filter((item) => item.accountReference === name),
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

test("acepta compensaciones por días completos y rechaza duraciones inválidas", () => {
  assert.deepEqual(parseAdminCommand("renovar | Erick3486 | 1 día"), { isCommand: true, ok: true, command: "RENOVAR", name: "Erick3486", plan: null, months: 0, days: 1 });
  assert.equal(parseAdminCommand("RENOVAR | Erick3486 | 3 DIAS").days, 3);
  assert.equal(parseAdminCommand("NUEVO | Cliente123 | PLAN PLUS | 2 DÍAS").days, 2);
  for (const duration of ["0 DIAS", "-1 DIA", "1.5 DIAS", "36501 DIAS", "121 MESES", "2"]) {
    assert.equal(parseAdminCommand(`RENOVAR | Erick3486 | ${duration}`).ok, false);
  }
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

test("crea un periodo por días manteniendo la fecha comercial desde el alta", async () => {
  const store = storeFixture();
  let creation;
  const client = {
    listMembers: async () => [],
    listMemberGroups: async () => [{ id: "members-1", name: "CHAT GPT" }],
    listProfileGroups: async () => [{ id: "profiles-1", name: "PLAN PLUS" }],
    createMember: async (body) => { creation = body; return { id: "days-member" }; }
  };
  const service = new DicloakAdminService({ store, client, timeZone: "America/Lima" });
  await service.create(parseAdminCommand("NUEVO | Cliente123 | PLAN PLUS | 3 DIAS"), message());
  assert.equal(creation.expiration.days, 3);
  assert.equal(creation.expiration.mode, "LOGIN_START");
  assert.equal(store.state.records[0].commercialStartDate, "2026-10-15");
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-10-18");
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

function renewalFixture(record = null) {
  const store = storeFixture();
  if (record) store.saveDicloakMemberRecord({ dicloakMemberId: "member-erick", dicloakMemberName: "Erick3486", ...record });
  const calls = [];
  const member = { id: "member-erick", name: "Erick3486", account: "Erick3486", status: "ENABLED", member_group_id: "chat-gpt", profile_group_list: [{ id: "solo", name: "Solo pro" }, { id: "work", name: "PRO WORK" }] };
  let expiration = { enabled: true, time_zone: "Asia/Singapore", mode: "INSTANT", expires_at: "2026-11-02 09:56" };
  const client = {
    listMembers: async () => [member],
    getExpiration: async () => expiration,
    updateExpiration: async (id, body) => { calls.push([id, body]); expiration = body; },
    updateMember: async () => undefined
  };
  const service = new DicloakAdminService({ store, client, timeZone: "America/Lima", expirationTime: "23:59" });
  return { store, calls, client, member, service };
}

test("incorpora el vencimiento fijo de un cliente antiguo y conserva sus días pendientes", async () => {
  const { store, calls, service } = renewalFixture();
  const response = await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"));
  assert.match(response, /Vencimiento anterior: 2026-11-02/);
  assert.match(response, /Nueva renovación: 2026-12-02/);
  assert.deepEqual(calls, [["member-erick", { enabled: true, time_zone: "America/Lima", mode: "INSTANT", expires_at: "2026-12-02 23:59" }]]);
  assert.equal(store.state.records[0].commercialDateSource, "dicloak-fixed-expiration");
  assert.equal(store.state.records[0].commercialStartDate, "", "no inventa una fecha de activación");
  assert.equal(store.state.records[0].commercialAnchorDay, 2);
  assert.equal(store.state.records[0].plan, "Solo pro / PRO WORK");
});

for (const paidOn of ["2026-11-01T18:00:00Z", "2026-11-05T18:00:00Z"]) {
  test(`pago ${paidOn.slice(0, 10)} conserva el vencimiento comercial del día 3 pese a un login tardío`, async () => {
    const { client, calls, service } = renewalFixture({ commercialStartDate: "2026-10-03", commercialNextRenewalDate: "2026-11-03" });
    client.getExpiration = async () => { assert.fail("la expiración técnica no reemplaza el registro comercial"); };
    await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"), { messageTimestamp: Date.parse(paidOn) / 1000 });
    assert.equal(calls[0][1].expires_at, "2026-12-03 23:59");
  });
}

test("conserva el día 31 al pasar por febrero y recargar el registro de renovación", async () => {
  const { store, service, calls } = renewalFixture({ commercialStartDate: "2026-12-31", commercialNextRenewalDate: "2027-01-31" });
  await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"));
  assert.equal(calls[0][1].expires_at, "2027-02-28 23:59");
  assert.equal(store.state.records[0].commercialAnchorDay, 31);
  await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"));
  assert.equal(calls[1][1].expires_at, "2027-03-31 23:59");
});

test("suma días al vencimiento, conserva la compensación en meses posteriores y no duplica el mensaje", async () => {
  process.env.WHATSAPP_ADMIN_GROUP_ID = "120363000000000000@g.us";
  process.env.WHATSAPP_ADMIN_NUMBERS = "51911111111";
  const { store, calls, service } = renewalFixture({ commercialStartDate: "2026-10-02", commercialNextRenewalDate: "2026-11-02" });
  const replies = [];
  const request = { message: message("compensation-1"), body: "RENOVAR | Erick3486 | 3 DIAS", reply: async (text) => replies.push(text) };
  await service.handle(request);
  await service.handle(request);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].expires_at, "2026-11-05 23:59");
  assert.equal(store.state.records[0].daysAdded, 3);
  assert.match(replies[0], /Duración añadida: 3 días/);
  assert.match(replies[1], /ya procesado/);
  assert.equal(store.state.operations[0].targetDate, "2026-11-05");
  await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"));
  assert.equal(calls[1][1].expires_at, "2026-12-05 23:59");
});

test("un día adicional cruza fin de mes sin perder tiempo pendiente", async () => {
  const { calls, service } = renewalFixture({ commercialNextRenewalDate: "2026-12-31" });
  await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 DIA"));
  assert.equal(calls[0][1].expires_at, "2027-01-01 23:59");
});

test("reutiliza la fecha comercial del cliente cuando su cuenta está vinculada exactamente", async () => {
  const { store, calls, client, service } = renewalFixture();
  store.state.clients.push({ accountReference: "Erick3486", startDate: "2026-10-03", expiryDate: "2026-11-03" });
  client.getExpiration = async () => { assert.fail("no debe usar el vencimiento técnico"); };
  await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"));
  assert.equal(calls[0][1].expires_at, "2026-12-03 23:59");
  assert.equal(store.state.records[0].commercialDateSource, "client-record");
});

test("un cliente antiguo contratado por días conserva el día de vencimiento actual", async () => {
  const { store, calls, service } = renewalFixture();
  store.state.clients.push({ accountReference: "Erick3486", startDate: "2026-10-03", expiryDate: "2026-11-02", durationDays: 30 });
  await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"));
  assert.equal(calls[0][1].expires_at, "2026-12-02 23:59");
});

test("no adivina la fecha comercial antigua a partir de LOGIN_START ni de create_time", async () => {
  const { member, store, calls, client, service } = renewalFixture();
  member.create_time = "2026-10-01 00:10:00";
  client.getExpiration = async () => ({ enabled: true, time_zone: "America/Lima", mode: "LOGIN_START", days: 31 });
  await assert.rejects(service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES")), /FECHA COMERCIAL NO DISPONIBLE/);
  assert.equal(calls.length, 0);
  assert.equal(store.state.records.length, 0);
});

test("no modifica un miembro si la cuenta fue recreada con otro identificador", async () => {
  const { store, calls, service } = renewalFixture({ dicloakMemberId: "deleted-member", commercialNextRenewalDate: "2026-11-02" });
  await assert.rejects(service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES")), /REGISTRO INCONSISTENTE/);
  assert.equal(calls.length, 0);
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-11-02");
});

test("no duplica el mes al reintentar después de actualizar la API y fallar la reactivación", async () => {
  const { store, member, calls, client, service } = renewalFixture();
  member.status = "DISABLED";
  client.updateMember = async () => { throw new Error("falló reactivación"); };
  await assert.rejects(service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES")), /falló reactivación/);
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-11-02");
  client.updateMember = async () => undefined;
  await service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].expires_at, "2026-12-02 23:59");
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(store.state.records[0].commercialNextRenewalDate, "2026-12-02");
});

test("rechaza vencimientos inválidos y compras ambiguas sin modificar DICloak", async () => {
  const fixture = renewalFixture();
  fixture.client.getExpiration = async () => ({ enabled: true, mode: "INSTANT", expires_at: "2026-02-30 23:59" });
  await assert.rejects(fixture.service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES")), /fecha no es válida/);
  fixture.store.state.clients.push({ accountReference: "Erick3486" }, { accountReference: "Erick3486" });
  await assert.rejects(fixture.service.renew(parseAdminCommand("RENOVAR | Erick3486 | 1 MES")), /FECHA COMERCIAL AMBIGUA/);
  assert.equal(fixture.calls.length, 0);
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
