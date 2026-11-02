"use strict";

const { addMonthsClamped, addDays, parseDateOnly, daysBetween, todayInTimeZone } = require("./date-utils");
const { DicloakHttpError } = require("./dicloak-http");

function normalizeCommandText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function normalizedName(value) { return normalizeCommandText(value).toLocaleUpperCase("es-PE"); }

function parseMonths(value) {
  const match = /^(\d{1,3})\s+MES(?:ES)?$/i.exec(normalizeCommandText(value));
  const months = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(months) || months < 1 || months > 120) return null;
  return months;
}

function parseDuration(value) {
  const months = parseMonths(value);
  if (months) return { months };
  const match = /^(\d{1,5})\s+DIAS?$/i.exec(normalizeCommandText(value));
  const days = Number(match?.[1]);
  return match && Number.isSafeInteger(days) && days >= 1 && days <= 36500 ? { months: 0, days } : null;
}

function durationLabel(parsed) {
  return parsed.days ? `${parsed.days} ${parsed.days === 1 ? "día" : "días"}` : `${parsed.months} ${parsed.months === 1 ? "mes" : "meses"}`;
}

function advanceCommercialDate(base, parsed, anchorDay) {
  return parsed.days ? addDays(base, parsed.days) : addMonthsClamped(base, parsed.months, anchorDay);
}

function parseAdminCommand(value, aliases = {}) {
  const text = normalizeCommandText(value);
  const parts = text.split("|").map((part) => part.trim());
  const command = normalizedName(parts[0].split(/\s+/)[0]);
  if (command !== "NUEVO" && command !== "RENOVAR") return { isCommand: false };
  const expected = command === "NUEVO" ? 4 : 3;
  if (parts.length !== expected || parts.some((part) => !part)) return { isCommand: true, ok: false, error: command === "NUEVO" ? "Formato correcto:\nNUEVO | nombre | plan | duración\nEjemplo:\nNUEVO | Jeremias4587 | PLAN PLUS | 1 MES" : "Formato correcto:\nRENOVAR | nombre | duración\nEjemplo:\nRENOVAR | Jeremias4587 | 2 MESES" };
  const name = parts[1];
  const requestedPlan = command === "NUEVO" ? parts[2] : null;
  const plan = requestedPlan && aliases[normalizedName(requestedPlan)] ? aliases[normalizedName(requestedPlan)] : requestedPlan;
  const duration = parseDuration(parts[command === "NUEVO" ? 3 : 2]);
  if (!duration) return { isCommand: true, ok: false, error: "La duración debe ser 1 MES, 2 MESES, 1 DIA o una cantidad válida de días (hasta 36500) o meses (hasta 120)." };
  return { isCommand: true, ok: true, command, name, plan, ...duration };
}

function dateFromMessage(message, timeZone) {
  const timestamp = Number(message?.messageTimestamp?.low ?? message?.messageTimestamp ?? 0);
  return todayInTimeZone(timeZone, timestamp > 0 ? new Date(timestamp * 1000) : new Date());
}

function normalizeGroupName(value) { return normalizeCommandText(value).toLocaleUpperCase("es-PE"); }

function listFromData(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["list", "items", "rows", "groups", "members", "profile_groups", "data", "records"]) if (Array.isArray(data?.[key])) return data[key];
  if (data && typeof data === "object" && (data.id !== undefined || data.group_id !== undefined || data.name !== undefined)) return [data];
  return [];
}

function collectProfileGroups(value, result = []) {
  if (!value || typeof value !== "object") return result;
  const id = value.id ?? value.group_id ?? value.groupId;
  const name = value.name ?? value.group_name ?? value.groupName ?? value.env_group_name;
  if (id !== undefined && id !== null && name !== undefined && name !== null && String(name).trim()) {
    result.push({ id: String(id), name: String(name) });
  }
  for (const child of Object.values(value)) if (child && typeof child === "object") collectProfileGroups(child, result);
  return result;
}

function parseManualMap() {
  try { const parsed = JSON.parse(process.env.DICLOAK_PROFILE_GROUP_MAP_JSON || "{}"); return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [normalizeGroupName(key), String(value)])); } catch { return {}; }
}

function exactMatches(items, value, fields) {
  const target = normalizeGroupName(value);
  return items.filter((item) => fields.some((field) => normalizeGroupName(item?.[field]) === target));
}

class DicloakAdminService {
  constructor({ store, client, timeZone, expirationTime, memberGroupName } = {}) {
    this.store = store;
    this.client = client;
    this.timeZone = timeZone || process.env.DICLOAK_TIMEZONE || process.env.BOT_TIMEZONE || "America/Lima";
    this.expirationTime = expirationTime || process.env.DICLOAK_EXPIRATION_TIME || "23:59";
    this.memberGroupName = memberGroupName || process.env.DICLOAK_MEMBER_GROUP_NAME || "CHAT GPT";
  }

  async authorized(message, socket) {
    const groupId = String(process.env.WHATSAPP_ADMIN_GROUP_ID || "").trim();
    if (!groupId || message?.key?.remoteJid !== groupId || message?.key?.fromMe) return false;
    return this.authorizedSender(message, socket);
  }

  async authorizedSender(message, socket) {
    if (message?.key?.fromMe) return false;
    const allowed = new Set(String(process.env.WHATSAPP_ADMIN_NUMBERS || "").split(/[\s,;]+/).map((value) => value.replace(/\D/g, "")).filter(Boolean));
    const senderIds = [
      message?.key?.participant,
      message?.key?.participantAlt,
      message?.key?.remoteJidAlt,
      message?.key?.participantPn,
      message?.key?.participantLid
    ].filter(Boolean);
    const mappedLids = [];
    for (const value of senderIds) {
      if (!/@(?:lid|hosted\.lid)$/i.test(String(value))) continue;
      try {
        const mapped = await socket?.signalRepository?.lidMapping?.getPNForLID?.(value);
        if (mapped) mappedLids.push(mapped);
      } catch {
        // Algunos mensajes de grupo no incluyen el mapeo LID disponible.
      }
    }
    const senders = [...senderIds, ...mappedLids]
      .map((value) => String(value || "").split("@")[0].split(":")[0].replace(/\D/g, ""))
      .filter(Boolean);
    return senders.some((sender) => allowed.has(sender));
  }

  async resolveMemberGroup() {
    const data = await this.client.listMemberGroups({ name: this.memberGroupName });
    const matches = exactMatches(listFromData(data), this.memberGroupName, ["name", "group_name", "groupName"]);
    if (matches.length !== 1 || !matches[0].id && !matches[0].group_id && !matches[0].groupId) throw new Error(`No existe un único grupo de miembros llamado “${this.memberGroupName}”.`);
    return String(matches[0].id ?? matches[0].group_id ?? matches[0].groupId);
  }

  async resolveProfileGroup(plan) {
    const manual = parseManualMap();
    const discovered = [];
    if (typeof this.client.listProfileGroups === "function") {
      const data = await this.client.listProfileGroups({ all: true });
      discovered.push(...collectProfileGroups(data));
    } else {
      for (let page = 1; page <= 100; page += 1) {
        const data = await this.client.listProfiles(page === 1 ? undefined : { page_no: page, page_size: 100 });
        const items = collectProfileGroups(data);
        if (!items.length) break;
        discovered.push(...items);
        if (items.length < 100) break;
      }
    }
    const unique = new Map(discovered.filter((item) => item.id && item.name).map((item) => [item.name + "\u0000" + item.id, item]));
    const matches = [...unique.values()].filter((item) => normalizeGroupName(item.name) === normalizeGroupName(plan));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) throw new Error(`El plan “${plan}” es ambiguo. Opciones: ${matches.map((item) => item.name).join(", ")}.`);
    if (manual[normalizeGroupName(plan)]) return manual[normalizeGroupName(plan)];
    throw new Error(`No existe un grupo de perfiles llamado “${plan}”.`);
  }

  async findExactMember(name) {
    const data = await this.client.listMembers({ name });
    const members = listFromData(data);
    return members.find((item) => String(item?.name || "") === name) || null;
  }

  validateCredentials(name) {
    if (!name || name.length > 20) throw new Error("El nombre no puede estar vacío ni superar 20 caracteres.");
    if (!/^[A-Za-z0-9]{6,20}$/.test(name)) throw new Error("El usuario/contraseña debe tener entre 6 y 20 caracteres alfanuméricos, sin espacios.");
    if (name.length < 8 || !/[A-Za-z]/.test(name) || !/\d/.test(name)) throw new Error("El usuario/contraseña debe tener al menos 8 caracteres e incluir letras y números.");
  }

  async create(parsed, message) {
    this.validateCredentials(parsed.name);
    const existingByName = await this.findExactMember(parsed.name);
    const existingByAccount = await this.client.listMembers({ account: parsed.name });
    if (existingByName) {
      const recovered = await this.recoverFailedCreation(parsed, existingByName);
      if (recovered) return recovered;
    }
    if (existingByName || listFromData(existingByAccount).some((item) => String(item?.account || "") === parsed.name)) throw new Error(`⚠️ ${parsed.name} ya existe en DICloak.\nNo se creó un segundo miembro.`);
    const memberGroupId = await this.resolveMemberGroup();
    const profileGroupId = await this.resolveProfileGroup(parsed.plan);
    const start = dateFromMessage(message, this.timeZone);
    const next = advanceCommercialDate(start, parsed);
    const member = await this.client.createMember({
      name: parsed.name, account: parsed.name, password: parsed.name,
      type: "INTERNAL", authority: "MEMBER", status: "ENABLED",
      all_profile_groups: false, profile_group_ids: [profileGroupId], member_group_id: memberGroupId,
      expiration: { enabled: true, time_zone: this.timeZone, mode: "LOGIN_START", days: daysBetween(start, next) }
    });
    const memberId = String(member?.id ?? member?.member_id ?? member?.memberId ?? "");
    if (!memberId) throw new Error("DICloak creó una respuesta sin identificador de miembro.");
    this.store.saveDicloakMemberRecord({ dicloakMemberId: memberId, dicloakMemberName: parsed.name, plan: parsed.plan, commercialStartDate: start, commercialNextRenewalDate: next, commercialAnchorDay: parseDateOnly(parsed.days ? next : start).getUTCDate(), commercialDateSource: "bot-creation", monthsPurchased: parsed.months, daysAdded: parsed.days || 0, profileGroupId, memberGroupId });
    return `✅ CLIENTE CREADO\n\nNombre: ${parsed.name}\nPlan: ${parsed.plan}\nGrupo de miembros: ${this.memberGroupName}\nDuración comercial: ${durationLabel(parsed)}\nPróxima renovación: ${next}\nEstado DICloak: Activo`;
  }

  async recoverFailedCreation(parsed, member) {
    if (this.store.getDicloakMemberRecord(parsed.name)) return null;
    const operations = this.store.getDicloakAdminOperationsForMember?.(parsed.name) || [];
    // Only reconcile the old two-request creation failure, never an arbitrary existing member.
    const failed = operations.find((operation) => operation.command === "NUEVO" && operation.status === "FAILED"
      && /This member has already been activated, days can no longer be changed/i.test(operation.error || ""));
    if (!failed || normalizeGroupName(failed.plan) !== normalizeGroupName(parsed.plan)
      || Number(failed.months) !== parsed.months || Number(failed.days || 0) !== Number(parsed.days || 0) || member.account !== parsed.name
      || member.type !== "INTERNAL" || member.authority !== "MEMBER") return null;
    const memberId = String(member.id ?? member.member_id ?? member.memberId ?? "");
    if (!memberId) return null;
    const memberGroupId = await this.resolveMemberGroup();
    const profileGroupId = await this.resolveProfileGroup(parsed.plan);
    if (String(member.member_group_id) !== memberGroupId || member.all_profile_groups !== false
      || member.profile_group_list?.length !== 1 || String(member.profile_group_list[0].id) !== profileGroupId) return null;
    // Older operations stored their receipt time; new ones preserve the WhatsApp purchase date.
    if (!failed.commercialStartDate && !Number.isFinite(Date.parse(failed.createdAt))) return null;
    const start = failed.commercialStartDate || todayInTimeZone(this.timeZone, new Date(failed.createdAt));
    const next = advanceCommercialDate(start, parsed);
    const expiration = { enabled: true, time_zone: this.timeZone, mode: "INSTANT", expires_at: `${next} ${this.expirationTime}` };
    const current = await this.client.getExpiration(memberId);
    if (current?.enabled === false) {
      await this.client.updateExpiration(memberId, expiration);
    } else if (!current || !Object.entries(expiration).every(([key, value]) => current[key] === value)) {
      throw new Error(`⚠️ ${parsed.name} ya tiene otro vencimiento en DICloak. Revisa ese vencimiento antes de recuperar el alta fallida.`);
    }
    if (String(member.status || "").toUpperCase() === "DISABLED") await this.client.updateMember(memberId, { status: "ENABLED" });
    this.store.saveDicloakMemberRecord({ dicloakMemberId: memberId, dicloakMemberName: parsed.name, plan: parsed.plan, commercialStartDate: start, commercialNextRenewalDate: next, commercialAnchorDay: parseDateOnly(parsed.days ? next : start).getUTCDate(), commercialDateSource: "recovered-creation", monthsPurchased: parsed.months, daysAdded: parsed.days || 0, profileGroupId, memberGroupId });
    return `✅ ALTA RECUPERADA\n\nNombre: ${parsed.name}\nPlan: ${parsed.plan}\nPróxima renovación: ${next}\nEstado DICloak: Activo\nSe completó el intento anterior sin crear otro miembro.`;
  }

  async resolveCommercialRecord(member) {
    const memberId = String(member.id ?? member.member_id ?? member.memberId ?? "");
    if (!memberId) throw new Error("DICloak devolvió un miembro sin identificador.");
    const record = this.store.getDicloakMemberRecord(member.name);
    if (record) {
      if (record.dicloakMemberId && String(record.dicloakMemberId) !== memberId) throw new Error("❌ REGISTRO INCONSISTENTE\nEl nombre corresponde a otro identificador de DICloak. No se modificó el miembro.");
      parseDateOnly(record.commercialNextRenewalDate);
      return record;
    }
    const candidates = this.store.getDicloakCommercialCandidates?.(member.account || member.name) || [];
    if (candidates.length > 1) throw new Error("❌ FECHA COMERCIAL AMBIGUA\nHay varias compras asociadas a esta cuenta. No se modificó su vencimiento.");
    let start = "", next, source, anchorDay;
    if (candidates.length === 1) {
      start = candidates[0].startDate;
      next = candidates[0].expiryDate;
      parseDateOnly(start);
      parseDateOnly(next);
      anchorDay = !candidates[0].durationDays && addMonthsClamped(start, candidates[0].termMonths || 1) === next
        ? parseDateOnly(start).getUTCDate() : parseDateOnly(next).getUTCDate();
      source = "client-record";
    } else {
      const expiration = await this.client.getExpiration(memberId);
      // Import only an explicit fixed deadline. LOGIN_START, login dates and remaining days
      // cannot establish an old customer's commercial date. A saved record always wins.
      if (expiration?.enabled !== true || expiration.mode !== "INSTANT"
        || !/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(expiration.expires_at || "")) {
        throw new Error("❌ FECHA COMERCIAL NO DISPONIBLE\nEste cliente antiguo no tiene una fecha comercial registrada ni un vencimiento fijo en DICloak. No se usó la fecha del primer ingreso para calcularla.");
      }
      // Preserve the configured calendar deadline, including when the legacy account used
      // another time zone. New expiration times are explicitly written in this.timeZone.
      next = expiration.expires_at.slice(0, 10);
      parseDateOnly(next);
      source = "dicloak-fixed-expiration";
    }
    return {
      dicloakMemberId: memberId, dicloakMemberName: member.name,
      plan: (member.profile_group_list || []).map((group) => group.name).filter(Boolean).join(" / "),
      commercialStartDate: start, commercialNextRenewalDate: next,
      commercialAnchorDay: anchorDay || parseDateOnly(next).getUTCDate(), commercialDateSource: source,
      monthsPurchased: 0, daysAdded: 0,
      profileGroupId: member.profile_group_list?.length === 1 ? String(member.profile_group_list[0].id) : "",
      memberGroupId: String(member.member_group_id || "")
    };
  }

  async renew(parsed, message) {
    const member = await this.findExactMember(parsed.name);
    if (!member) throw new Error(`❌ CLIENTE NO ENCONTRADO\nNo existe un miembro llamado “${parsed.name}”.`);
    const record = await this.resolveCommercialRecord(member);
    const anchorDay = record.commercialAnchorDay || parseDateOnly(record.commercialStartDate || record.commercialNextRenewalDate).getUTCDate();
    const next = advanceCommercialDate(record.commercialNextRenewalDate, parsed, anchorDay);
    const nextAnchorDay = parsed.days ? parseDateOnly(next).getUTCDate() : anchorDay;
    const memberId = String(member.id ?? member.member_id ?? member.memberId);
    // Persist the imported baseline before changing the API so a partial failure cannot
    // import the already-extended API deadline and charge the same period again.
    this.store.saveDicloakMemberRecord({ ...record, dicloakMemberId: memberId, commercialAnchorDay: anchorDay });
    if (message?.key?.id) this.store.finishDicloakAdminOperation?.(message.key.id, { baseDate: record.commercialNextRenewalDate, targetDate: next });
    await this.client.updateExpiration(memberId, { enabled: true, time_zone: this.timeZone, mode: "INSTANT", expires_at: `${next} ${this.expirationTime}` });
    if (String(member.status || "").toUpperCase() === "DISABLED") await this.client.updateMember(memberId, { status: "ENABLED" });
    this.store.saveDicloakMemberRecord({ ...record, dicloakMemberId: memberId, monthsPurchased: Number(record.monthsPurchased || 0) + parsed.months, daysAdded: Number(record.daysAdded || 0) + Number(parsed.days || 0), commercialNextRenewalDate: next, commercialAnchorDay: nextAnchorDay });
    return `✅ CLIENTE RENOVADO\n\nNombre: ${parsed.name}\nVencimiento anterior: ${record.commercialNextRenewalDate}\nDuración añadida: ${durationLabel(parsed)}\nNueva renovación: ${next}\nEstado DICloak: Activo`;
  }

  async handle({ message, body, reply, socket }) {
    if (message?.key?.remoteJid?.endsWith("@g.us") && normalizeGroupName(body) === "ID DICLOAK") {
      await reply(`ID de este grupo: ${message.key.remoteJid}`);
      return true;
    }
    if (!await this.authorized(message, socket)) return false;
    const parsed = parseAdminCommand(body, this.aliases());
    if (!parsed.isCommand) return false;
    const messageId = String(message?.key?.id || "");
    if (messageId && this.store.getDicloakAdminOperation?.(messageId)) { await reply("⚠️ Comando ya procesado anteriormente."); return true; }
    if (!parsed.ok) { await reply(parsed.error); return true; }
    if (messageId) this.store.beginDicloakAdminOperation?.({ messageId, command: parsed.command, memberName: parsed.name, plan: parsed.plan, months: parsed.months, days: parsed.days || 0, ...(parsed.command === "NUEVO" ? { commercialStartDate: dateFromMessage(message, this.timeZone) } : {}) });
    try {
      const response = parsed.command === "NUEVO" ? await this.create(parsed, message) : await this.renew(parsed, message);
      if (messageId) this.store.finishDicloakAdminOperation?.(messageId, { status: "SUCCESS" });
      this.store.addLog("dicloak-admin", `Comando ${parsed.command} completado para ${parsed.name}`, { command_type: parsed.command, whatsapp_message_id: messageId, member_name: parsed.name, target_plan: parsed.plan || null, target_date: null, resultado: "SUCCESS" });
      this.store.save();
      await reply(response);
    } catch (error) {
      if (messageId) this.store.finishDicloakAdminOperation?.(messageId, { status: "FAILED", error: String(error.message || "Error").slice(0, 300) });
      const publicMessage = error instanceof DicloakHttpError && error.dicloakCode !== null ? `❌ ERROR DICLOAK\nNo se pudo realizar la operación.\nCódigo: ${error.dicloakCode}\nMensaje: ${error.apiMessage || "Error devuelto por DICloak."}` : String(error.message || "No se pudo realizar la operación.");
      this.store.addLog("dicloak-admin", `Comando ${parsed.command} fallido para ${parsed.name}: ${publicMessage}`, { command_type: parsed.command, whatsapp_message_id: messageId, member_name: parsed.name, target_plan: parsed.plan || null, resultado: "FAILED", dicloak_code: error.dicloakCode ?? null });
      this.store.save();
      await reply(publicMessage);
    }
    return true;
  }

  aliases() { try { const parsed = JSON.parse(process.env.DICLOAK_PLAN_ALIASES_JSON || "{}"); return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [normalizedName(key), String(value).trim()])); } catch { return {}; } }
}

module.exports = { DicloakAdminService, parseAdminCommand, parseMonths, parseDuration, advanceCommercialDate, dateFromMessage, normalizeGroupName, listFromData, collectProfileGroups };
