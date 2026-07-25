"use strict";

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error("La fecha debe tener el formato AAAA-MM-DD.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("La fecha no es válida.");
  }
  return date;
}

function formatDateOnly(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function addMonthsClamped(value, months) {
  const date = typeof value === "string" ? parseDateOnly(value) : new Date(value);
  const wantedDay = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(months), 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(wantedDay, lastDay));
  return formatDateOnly(target);
}

function compareDateOnly(left, right) {
  return parseDateOnly(left).getTime() - parseDateOnly(right).getTime();
}

function daysBetween(from, to) {
  return Math.round((parseDateOnly(to) - parseDateOnly(from)) / 86400000);
}

function todayInTimeZone(timeZone = "America/Lima") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function calculateRenewal(previousExpiry, paymentDate, termMonths = 1) {
  const months = Math.max(1, Number(termMonths) || 1);
  const startDate =
    previousExpiry && compareDateOnly(previousExpiry, paymentDate) >= 0
      ? previousExpiry
      : paymentDate;
  return {
    startDate,
    expiryDate: addMonthsClamped(startDate, months)
  };
}

module.exports = {
  parseDateOnly,
  formatDateOnly,
  addMonthsClamped,
  compareDateOnly,
  daysBetween,
  todayInTimeZone,
  calculateRenewal
};
