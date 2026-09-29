"use strict";

let financeReport = null;
let financeRequest = 0;

function resetFinance() {
  financeRequest++;
  financeReport = null;
  $("#financeReport").classList.add("hidden");
  $("#financeExport").classList.add("hidden");
  $("#financePrint").disabled = true;
  $("#financeFilter").reset();
  $("#financeEntryForm").reset();
  for (const selector of ["#financeSales", "#financeExpenses", "#financeUndated", "#financeTotals", "#financeWarnings", "#financeCategories", "#financeMessage"]) $(selector).textContent = "";
}

function financeMoney(minor, currency) {
  return `${currency} ${new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

function financeRows(entries) {
  if (!entries.length) return '<tr><td colspan="5">No hay movimientos en este periodo.</td></tr>';
  const origins = { recuperado: "Recuperado", renovacion: "Renovación", registro: "Compra", manual: "Manual" };
  return entries.map(e => `<tr class="${e.voided ? "finance-voided" : ""}"><td>${escapeHtml(e.date || "Sin fecha")}</td><td>${escapeHtml(e.description)}${e.type === "expense" ? `<small>${escapeHtml(e.category)}</small>` : ""}</td><td>${e.amountMinor === null || !e.currency ? "Por completar" : escapeHtml(financeMoney(e.amountMinor, e.currency))}</td><td>${escapeHtml(origins[e.source] || e.source)} · ${e.voided ? "Anulado" : e.amountMinor === null || !e.currency || !e.date ? "Revisar" : "Registrado"}</td><td class="finance-action-column"><button class="button secondary small" type="button" data-finance-edit="${escapeHtml(e.id)}">Editar</button> <button class="button secondary small" type="button" data-finance-void="${escapeHtml(e.id)}">${e.voided ? "Restaurar" : "Anular"}</button></td></tr>`).join("");
}

async function loadFinance({ defaults = false } = {}) {
  const sequence = ++financeRequest;
  const userId = state.user?.id;
  financeReport = null;
  $("#financeReport").classList.add("hidden");
  $("#financeExport").classList.add("hidden");
  $("#financePrint").disabled = true;
  $("#financeMessage").textContent = "Cargando movimientos…";
  const from = $("#financeFrom").value;
  const to = $("#financeTo").value;
  const query = defaults || (!from && !to) ? "" : `?${new URLSearchParams({ from, to })}`;
  try {
    const report = await api(`/api/finance${query}`);
    if (sequence !== financeRequest || !state.user || state.user.id !== userId) return;
    financeReport = report;
    $("#financeFrom").value = report.from;
    $("#financeTo").value = report.to;
    $("#financeTimezone").textContent = `Zona horaria: ${report.timeZone}.`;
    $("#financePeriod").textContent = `Del ${report.from} al ${report.to} · ${state.user.username}`;
    $("#financeSalesCount").textContent = report.salesCount;
    $("#financeExpenseCount").textContent = report.expenseCount;
    $("#financeTotals").innerHTML = report.totals.length ? report.totals.map(t => `<tr><td>${escapeHtml(t.currency)}</td><td>${escapeHtml(financeMoney(t.incomeMinor, t.currency))}</td><td>${escapeHtml(financeMoney(t.expenseMinor, t.currency))}</td><td><strong>${escapeHtml(financeMoney(t.balanceMinor, t.currency))}</strong></td></tr>`).join("") : '<tr><td colspan="4">Sin importes confirmados para este periodo.</td></tr>';
    $("#financeWarnings").textContent = `${report.recoveredCount} venta(s) recuperada(s) del historial anterior. ${report.reviewCount} movimiento(s) con importe o moneda por completar: cuentan como registros, pero no se suman. ${report.undatedEntries.length} registro(s) sin fecha, fuera del periodo.`;
    $("#financeSales").innerHTML = financeRows(report.entries.filter(e => e.type === "sale"));
    $("#financeExpenses").innerHTML = financeRows(report.entries.filter(e => e.type === "expense"));
    $("#financeUndated").innerHTML = financeRows(report.undatedEntries);
    $("#financeUndatedPanel").classList.toggle("hidden", !report.undatedEntries.length);
    $("#financeCategories").textContent = report.totals.flatMap(t => Object.entries(t.categories).map(([category, amount]) => `${category}: ${financeMoney(amount, t.currency)}`)).join(" · ") || "Registra publicidad, costos de productos, comisiones y otros gastos.";
    $("#financeExport").href = `/api/finance/export.csv?${new URLSearchParams({ from: report.from, to: report.to })}`;
    $("#financeExport").classList.remove("hidden");
    $("#financePrint").disabled = false;
    $("#financeReport").classList.remove("hidden");
    $("#financeMessage").textContent = "";
  } catch (error) {
    if (sequence === financeRequest) $("#financeMessage").textContent = error.message;
    throw error;
  }
}

function openFinanceEntry(type, entry = null) {
  $("#financeEntryForm").reset();
  $("#financeEntryId").value = entry?.id || "";
  $("#financeEntryType").value = type;
  $("#financeDialogTitle").textContent = `${entry ? "Editar" : "Registrar"} ${type === "sale" ? "venta" : "gasto"}`;
  $("#financeEntryDate").value = entry?.date || financeReport?.today || "";
  $("#financeEntryDescription").value = entry?.description || "";
  $("#financeEntryAmount").value = entry?.amountMinor ? (entry.amountMinor / 100).toFixed(2) : "";
  $("#financeEntryCurrency").value = entry ? entry.currency : "PEN";
  $("#financeEntryCategory").value = entry?.category || "Publicidad";
  $("#financeCategoryLabel").classList.toggle("hidden", type === "sale");
  $("#financeEntryNotes").value = entry?.notes || "";
  $("#financeEntryError").textContent = "";
  $("#financeDialog").showModal();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#financeFilter").addEventListener("submit", event => { event.preventDefault(); loadFinance().catch(error => showToast(error.message, true)); });
  $("#financeMonth").addEventListener("click", () => loadFinance({ defaults: true }).catch(error => showToast(error.message, true)));
  $("#financePrint").addEventListener("click", () => { if (financeReport) window.print(); });
  $("#financeAddSale").addEventListener("click", () => openFinanceEntry("sale"));
  $("#financeAddExpense").addEventListener("click", () => openFinanceEntry("expense"));
  $("#financeCancel").addEventListener("click", () => $("#financeDialog").close());
  $("#financeReport").addEventListener("click", async event => {
    const edit = event.target.closest("[data-finance-edit]");
    const toggle = event.target.closest("[data-finance-void]");
    if ((!edit && !toggle) || !financeReport) return;
    const id = edit?.dataset.financeEdit || toggle.dataset.financeVoid;
    const entry = [...financeReport.entries, ...financeReport.undatedEntries].find(e => e.id === id);
    if (!entry) return;
    if (edit) return openFinanceEntry(entry.type, entry);
    toggle.disabled = true;
    try {
      await api(`/api/finance/entries/${encodeURIComponent(id)}/void`, { method: "PATCH", body: { voided: !entry.voided } });
      await loadFinance();
      showToast(entry.voided ? "Movimiento restaurado." : "Movimiento anulado. Puedes restaurarlo desde la misma fila.");
    } catch (error) { showToast(error.message, true); } finally { toggle.disabled = false; }
  });
  $("#financeEntryForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#financeSave");
    if (button.disabled) return;
    button.disabled = true;
    $("#financeEntryError").textContent = "";
    const id = $("#financeEntryId").value;
    const body = { type: $("#financeEntryType").value, date: $("#financeEntryDate").value,
      description: $("#financeEntryDescription").value, amount: $("#financeEntryAmount").value,
      currency: $("#financeEntryCurrency").value, category: $("#financeEntryCategory").value, notes: $("#financeEntryNotes").value };
    try {
      await api(`/api/finance/entries${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body });
      $("#financeDialog").close();
      const outside = financeReport && (body.date < financeReport.from || body.date > financeReport.to);
      showToast(outside ? "Guardado. Cambia el periodo para ver este movimiento." : "Movimiento guardado.");
      await loadFinance();
    } catch (error) { $("#financeEntryError").textContent = error.message; showToast(error.message, true); }
    finally { button.disabled = false; }
  });
});
