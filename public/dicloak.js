"use strict";

let dicloakReport = null;
let dicloakRequest = 0;
const dicloakMoney = minor => financeMoney(minor, "S/");

function resetDicloak() {
  dicloakRequest++;
  dicloakReport = null;
  $("#dicloakReport").classList.add("hidden");
  $("#dicloakFilter").reset();
  $("#dicloakRuleForm").reset();
  for (const selector of ["#dicloakUsers", "#dicloakEntries", "#dicloakRules", "#dicloakMessage"]) $(selector).textContent = "";
}

async function loadDicloak({ defaults = false } = {}) {
  const sequence = ++dicloakRequest, userId = state.user?.id;
  $("#dicloakReport").classList.add("hidden");
  $("#dicloakMessage").textContent = "Cargando aportes…";
  const from = $("#dicloakFrom").value, to = $("#dicloakTo").value;
  const query = defaults || (!from && !to) ? "" : `?${new URLSearchParams({ from, to })}`;
  try {
    const report = await api(`/api/dicloak${query}`);
    if (sequence !== dicloakRequest || userId !== state.user?.id) return;
    dicloakReport = report;
    $("#dicloakFrom").value = report.from;
    $("#dicloakTo").value = report.to;
    $("#dicloakScope").textContent = report.scope === "all" ? "Resumen de los aportes de todos los usuarios vinculados." : "Aportes generados por las ventas de tu usuario.";
    $("#dicloakTotal").textContent = dicloakMoney(report.totalMinor);
    $("#dicloakCount").textContent = report.salesCount;
    $("#dicloakPeriod").textContent = `${report.from} al ${report.to} · ${report.timeZone}`;
    $("#dicloakUsers").innerHTML = report.byUser.map(u => `<tr><td>${escapeHtml(u.username)}</td><td>${u.salesCount}</td><td><strong>${dicloakMoney(u.amountMinor)}</strong></td></tr>`).join("");
    $("#dicloakEntries").innerHTML = report.entries.map(e => `<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.username)}</td><td>${escapeHtml(e.product)}</td><td>${dicloakMoney(e.amountMinor)}</td></tr>`).join("") || '<tr><td colspan="4">No hay aportes en este periodo.</td></tr>';
    $("#dicloakAdd").classList.toggle("hidden", !report.canEdit);
    $("#dicloakRules").innerHTML = report.rules.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${dicloakMoney(r.priceMinor)}</td><td>${dicloakMoney(r.contributionMinor)}</td><td>${dicloakMoney(r.priceMinor - (r.enabled ? r.contributionMinor : 0))}</td><td>${r.enabled ? "Activo" : "Sin aporte"}${report.canEdit ? ` <button class="button secondary small" type="button" data-dicloak-edit="${escapeHtml(r.id)}">Editar</button>` : ""}</td></tr>`).join("");
    $("#dicloakReport").classList.remove("hidden");
    $("#dicloakMessage").textContent = "";
  } catch (error) {
    if (sequence === dicloakRequest) $("#dicloakMessage").textContent = error.message;
    throw error;
  }
}

function dicloakProfitPreview() {
  const price = Number($("#dicloakPrice").value), cost = $("#dicloakEnabled").checked ? Number($("#dicloakContribution").value) : 0;
  $("#dicloakProfit").textContent = `Ganancia por venta: ${dicloakMoney(Math.round((price - cost) * 100))}`;
}

function openDicloakRule(rule = null) {
  $("#dicloakRuleForm").reset();
  $("#dicloakRuleId").value = rule?.id || "";
  $("#dicloakName").value = rule?.name || "";
  $("#dicloakAliases").value = (rule?.aliases || []).join(", ");
  $("#dicloakPrice").value = rule ? (rule.priceMinor / 100).toFixed(2) : "";
  $("#dicloakContribution").value = rule ? (rule.contributionMinor / 100).toFixed(2) : "";
  $("#dicloakEnabled").checked = rule?.enabled !== false;
  $("#dicloakItemType").value = rule?.itemType || "product";
  $("#dicloakItemType").disabled = Boolean(rule);
  $("#dicloakDialogTitle").textContent = rule ? "Editar producto y aporte" : "Agregar producto con aporte";
  $("#dicloakError").textContent = "";
  dicloakProfitPreview();
  $("#dicloakDialog").showModal();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#dicloakFilter").addEventListener("submit", event => { event.preventDefault(); loadDicloak().catch(e => showToast(e.message, true)); });
  $("#dicloakMonth").addEventListener("click", () => loadDicloak({ defaults: true }).catch(e => showToast(e.message, true)));
  $("#dicloakAdd").addEventListener("click", () => openDicloakRule());
  $("#dicloakCancel").addEventListener("click", () => $("#dicloakDialog").close());
  $("#dicloakRules").addEventListener("click", event => {
    const button = event.target.closest("[data-dicloak-edit]");
    if (button && dicloakReport?.canEdit) openDicloakRule(dicloakReport.rules.find(r => r.id === button.dataset.dicloakEdit));
  });
  for (const selector of ["#dicloakPrice", "#dicloakContribution", "#dicloakEnabled"]) $(selector).addEventListener("input", dicloakProfitPreview);
  $("#dicloakRuleForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#dicloakSave");
    if (button.disabled) return;
    button.disabled = true;
    $("#dicloakError").textContent = "";
    const id = $("#dicloakRuleId").value;
    try {
      await api(`/api/dicloak/rules${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body: {
        name: $("#dicloakName").value, aliases: $("#dicloakAliases").value, price: $("#dicloakPrice").value,
        contribution: $("#dicloakContribution").value, enabled: $("#dicloakEnabled").checked, itemType: $("#dicloakItemType").value
      } });
      $("#dicloakDialog").close();
      state.loadedSections.delete("catalog");
      await loadDicloak();
      await loadSettings();
      showToast("Producto actualizado para las próximas ventas de todos los usuarios.");
    } catch (error) { $("#dicloakError").textContent = error.message; showToast(error.message, true); }
    finally { button.disabled = false; }
  });
});
