"use strict";

const { clientWhatsAppTarget } = require("./store");

const {
  daysBetween,
  todayInTimeZone,
  minutesInTimeZone,
  timeToMinutes
} = require("./date-utils");

function fillTemplate(template, client) {
  const [year, month, day] = String(client.expiryDate || "").split("-");
  const formattedDate =
    year && month && day ? `${day}/${month}/${year}` : client.expiryDate;
  const replacements = {
    nombre: client.name,
    producto: client.product,
    precio: client.price,
    fecha: formattedDate,
    cuenta: client.accountReference
  };
  return String(template).replace(
    /\{(nombre|producto|precio|fecha|cuenta)\}/g,
    (_, key) => replacements[key] || ""
  );
}

function reminderActionFor(client, today, { chargeAllowed = true, reminderAllowed = true } = {}) {
  if (client.archived || client.status !== "activo" || !client.expiryDate) return null;
  const remaining = daysBetween(today, client.expiryDate);
  if (reminderAllowed && client.autoReminder && remaining === 2) {
    const key = `${client.expiryDate}:reminder:2`;
    if (client.lastReminderKey !== key) {
      return { type: "reminder", key, remaining };
    }
  }
  if (chargeAllowed && client.autoCharge && remaining === 0) {
    const key = `${client.expiryDate}:charge`;
    if (client.lastChargeKey !== key) return { type: "charge", key, remaining };
  }
  return null;
}

function isChargeWindowOpen(startTime, currentMinutes) {
  return Number(currentMinutes) >= timeToMinutes(startTime || "09:00");
}

function isSendWindowOpen(startTime, currentMinutes) {
  return isChargeWindowOpen(startTime, currentMinutes);
}

class ReminderScheduler {
  constructor({
    store,
    whatsapp,
    timeZone = "America/Lima",
    intervalMinutes = 15,
    todayFn = todayInTimeZone,
    minutesFn = minutesInTimeZone,
    nowFn = () => new Date()
  }) {
    this.store = store;
    this.whatsapp = whatsapp;
    this.timeZone = timeZone;
    this.todayFn = todayFn;
    this.minutesFn = minutesFn;
    this.nowFn = nowFn;
    this.intervalMs = Math.max(5, Number(intervalMinutes) || 15) * 60000;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.store.addLog("error", `Error del programador: ${error.message}`);
        this.store.save();
      });
    }, this.intervalMs);
    this.timer.unref();
    setTimeout(() => this.runOnce().catch(() => undefined), 20000).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.running || !this.whatsapp.getStatus().ready) {
      return { sent: 0, skipped: true };
    }
    this.running = true;
    let sent = 0;
    const errors = [];
    const now = this.nowFn();
    const today = this.todayFn(this.timeZone, now);
    const settings = this.store.getSettings();
    const currentMinutes = this.minutesFn(this.timeZone, now);
    const chargeWindowOpen = isChargeWindowOpen(
      settings.chargeStartTime || "09:00",
      currentMinutes
    );
    const reminderWindowOpen = isSendWindowOpen(
      settings.reminderStartTime || settings.chargeStartTime || "09:00",
      currentMinutes
    );

    try {
      for (const client of this.store.listClients()) {
        const action = reminderActionFor(client, today, {
          chargeAllowed: chargeWindowOpen,
          reminderAllowed: reminderWindowOpen
        });
        if (!action) continue;
        try {
          const template =
            action.type === "reminder" ? settings.reminderTemplate : settings.chargeTemplate;
          await this.whatsapp.sendText(
            clientWhatsAppTarget(client),
            fillTemplate(template, client)
          );
          this.store.updateClient(client.id, {
            ...(action.type === "reminder"
              ? { lastReminderKey: action.key }
              : { lastChargeKey: action.key })
          });
          this.store.addLog(
            action.type,
            `${action.type === "reminder" ? "Recordatorio" : "Cobro"} enviado a ${client.name}`,
            { clientId: client.id }
          );
          this.store.save();
          sent += 1;
        } catch (error) {
          errors.push({ clientId: client.id, message: error.message });
        }
      }
    } finally {
      this.running = false;
    }
    return { sent, errors, skipped: false, chargeWindowOpen, reminderWindowOpen };
  }
}

module.exports = {
  ReminderScheduler,
  reminderActionFor,
  fillTemplate,
  isChargeWindowOpen,
  isSendWindowOpen
};
