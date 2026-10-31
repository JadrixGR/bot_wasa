"use strict";

class DicloakHttpError extends Error {
  constructor(message, { httpStatus = null, code = null, apiMessage = "" } = {}) {
    super(message);
    this.name = "DicloakHttpError";
    this.httpStatus = httpStatus;
    this.dicloakCode = code;
    this.apiMessage = apiMessage;
  }
}

function joinUrl(baseUrl, endpoint) {
  return `${String(baseUrl || "https://app.dicloak.com/gin").replace(/\/+$/, "")}/${String(endpoint || "").replace(/^\/+/, "")}`;
}

function unwrapApiData(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DicloakHttpError("DICloak devolvió una respuesta JSON inválida.");
  }
  if (Number(payload.code) !== 0) {
    throw new DicloakHttpError(
      `DICloak rechazó la operación (${payload.msg || "sin mensaje"}).`,
      { code: payload.code ?? null, apiMessage: String(payload.msg || "") }
    );
  }
  return payload.data;
}

class DicloakHttpClient {
  constructor({ baseUrl, apiKey, timeoutMs } = {}) {
    this.baseUrl = String(baseUrl || process.env.DICLOAK_BASE_URL || "https://app.dicloak.com/gin").trim();
    this.apiKey = String(apiKey ?? process.env.DICLOAK_HTTP_KEY ?? "").trim();
    this.timeoutMs = Math.max(1000, Number(timeoutMs || process.env.DICLOAK_TIMEOUT_MS || 10000));
  }

  configured() {
    return Boolean(this.apiKey);
  }

  async request(method, endpoint, body, query) {
    if (!this.configured()) throw new DicloakHttpError("DICLOAK_HTTP_KEY no está configurada en Render.");
    const url = new URL(joinUrl(this.baseUrl, endpoint));
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { "X-HTTP-KEY": this.apiKey, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      let payload;
      try { payload = await response.json(); } catch { throw new DicloakHttpError("DICloak devolvió una respuesta no válida.", { httpStatus: response.status }); }
      if (!response.ok) {
        throw new DicloakHttpError(`DICloak respondió HTTP ${response.status}.`, { httpStatus: response.status, code: payload?.code ?? null, apiMessage: String(payload?.msg || "") });
      }
      return unwrapApiData(payload);
    } catch (error) {
      if (error instanceof DicloakHttpError) throw error;
      if (error?.name === "AbortError") throw new DicloakHttpError("La solicitud a DICloak agotó el tiempo de espera.");
      throw new DicloakHttpError(`No se pudo conectar con DICloak: ${error?.message || "error de red"}.`);
    } finally { clearTimeout(timer); }
  }

  listMemberGroups(query) { return this.request("GET", "/v1/api/request/member/group", undefined, query); }
  listMembers(query) { return this.request("GET", "/v1/api/request/member", undefined, query); }
  getMember(id) { return this.request("GET", `/v1/api/request/member/${encodeURIComponent(id)}`); }
  createMember(body) { return this.request("POST", "/v1/api/request/member", body); }
  updateMember(id, body) { return this.request("PATCH", `/v1/api/request/member/${encodeURIComponent(id)}`, body); }
  getExpiration(id) { return this.request("GET", `/v1/api/request/member/${encodeURIComponent(id)}/expiration`); }
  updateExpiration(id, body) { return this.request("PATCH", `/v1/api/request/member/${encodeURIComponent(id)}/expiration`, body); }
  listProfiles(query) { return this.request("GET", "/v1/api/request/env", undefined, query); }
}

module.exports = { DicloakHttpClient, DicloakHttpError, unwrapApiData };
