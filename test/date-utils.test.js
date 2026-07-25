"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addMonthsClamped,
  calculateRenewal,
  daysBetween
} = require("../src/date-utils");

test("la renovación anticipada comienza desde el vencimiento actual", () => {
  assert.deepEqual(calculateRenewal("2026-07-26", "2026-07-23", 1), {
    startDate: "2026-07-26",
    expiryDate: "2026-08-26"
  });
});

test("una renovación vencida comienza desde la fecha de pago", () => {
  assert.deepEqual(calculateRenewal("2026-07-20", "2026-07-23", 1), {
    startDate: "2026-07-23",
    expiryDate: "2026-08-23"
  });
});

test("los meses se ajustan al último día disponible", () => {
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
});

test("calcula días usando fechas sin hora", () => {
  assert.equal(daysBetween("2026-07-23", "2026-07-25"), 2);
  assert.equal(daysBetween("2026-07-25", "2026-07-23"), -2);
});
