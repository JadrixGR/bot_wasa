"use strict";

const crypto = require("node:crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SUPPORTED_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);
const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_AAD = Buffer.from(
  "jadrixservs-authenticator-secret:v1",
  "utf8"
);

function normalizeBase32Secret(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/=+$/g, "");

  if (!normalized) {
    throw new Error("Ingresa la clave secreta 2FA.");
  }
  if (normalized.length > 1024) {
    throw new Error("La clave secreta 2FA es demasiado larga.");
  }
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error(
      "La clave 2FA no es válida. Usa la clave Base32 o el enlace otpauth:// completo."
    );
  }
  if (normalized.length < 8) {
    throw new Error("La clave secreta 2FA es demasiado corta.");
  }

  decodeBase32(normalized);
  return normalized;
}

function decodeBase32(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/=+$/g, "");

  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("La clave secreta 2FA no tiene un formato Base32 válido.");
  }

  const bytes = [];
  let accumulator = 0;
  let bits = 0;

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    accumulator = (accumulator << 5) | index;
    bits += 5;

    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }

  if (!bytes.length) {
    throw new Error("La clave secreta 2FA no contiene datos suficientes.");
  }
  return Buffer.from(bytes);
}

function normalizeAlgorithm(value) {
  const algorithm = String(value || "SHA1")
    .trim()
    .toUpperCase()
    .replaceAll("-", "");
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new Error(
      "El algoritmo del autenticador debe ser SHA1, SHA256 o SHA512."
    );
  }
  return algorithm;
}

function normalizeDigits(value) {
  const digits = Number(value ?? 6);
  if (!Number.isSafeInteger(digits) || digits < 6 || digits > 8) {
    throw new Error("El autenticador debe generar códigos de 6, 7 u 8 dígitos.");
  }
  return digits;
}

function normalizePeriod(value) {
  const period = Number(value ?? 30);
  if (!Number.isSafeInteger(period) || period < 15 || period > 120) {
    throw new Error("El intervalo del autenticador debe estar entre 15 y 120 segundos.");
  }
  return period;
}

function parseTotpSecret(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Ingresa la clave secreta 2FA.");

  if (!/^otpauth:\/\//i.test(raw)) {
    return {
      secret: normalizeBase32Secret(raw),
      algorithm: "SHA1",
      digits: 6,
      period: 30
    };
  }

  let uri;
  try {
    uri = new URL(raw);
  } catch {
    throw new Error("El enlace otpauth:// no es válido.");
  }

  if (
    uri.protocol.toLowerCase() !== "otpauth:" ||
    uri.hostname.toLowerCase() !== "totp"
  ) {
    throw new Error("Solo se admiten enlaces otpauth:// de tipo TOTP.");
  }

  return {
    secret: normalizeBase32Secret(uri.searchParams.get("secret")),
    algorithm: normalizeAlgorithm(uri.searchParams.get("algorithm") || "SHA1"),
    digits: normalizeDigits(uri.searchParams.get("digits") || 6),
    period: normalizePeriod(uri.searchParams.get("period") || 30)
  };
}

function generateTotp(
  secret,
  {
    timestamp = Date.now(),
    algorithm = "SHA1",
    digits = 6,
    period = 30
  } = {}
) {
  const normalizedSecret = normalizeBase32Secret(secret);
  const normalizedAlgorithm = normalizeAlgorithm(algorithm);
  const normalizedDigits = normalizeDigits(digits);
  const normalizedPeriod = normalizePeriod(period);
  const timestampMs =
    timestamp instanceof Date ? timestamp.getTime() : Number(timestamp);

  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error("La hora usada para generar el código 2FA no es válida.");
  }

  const epochSeconds = Math.floor(timestampMs / 1000);
  const counter = Math.floor(epochSeconds / normalizedPeriod);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto
    .createHmac(normalizedAlgorithm.toLowerCase(), decodeBase32(normalizedSecret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  const code = String(binary % 10 ** normalizedDigits).padStart(
    normalizedDigits,
    "0"
  );
  const expiresAtSeconds =
    (Math.floor(epochSeconds / normalizedPeriod) + 1) * normalizedPeriod;

  return {
    code,
    secondsRemaining: Math.max(1, expiresAtSeconds - epochSeconds),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    period: normalizedPeriod,
    digits: normalizedDigits,
    algorithm: normalizedAlgorithm
  };
}

function deriveEncryptionKey(value) {
  const source = String(value || "");
  if (!source) {
    throw new Error(
      "Configura AUTHENTICATOR_ENCRYPTION_KEY o COOKIE_SECRET para proteger el Autenticador."
    );
  }
  return crypto
    .createHash("sha256")
    .update("jadrixservs-authenticator-key:v1\0", "utf8")
    .update(source, "utf8")
    .digest();
}

function encryptSecret(secret, encryptionKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey,
    iv,
    { authTagLength: 16 }
  );
  cipher.setAAD(ENCRYPTION_AAD);
  const encrypted = Buffer.concat([
    cipher.update(String(secret), "utf8"),
    cipher.final()
  ]);
  const authenticationTag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function decryptSecret(payload, encryptionKey) {
  const parts = String(payload || "").split(".");
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error("La clave 2FA cifrada no tiene un formato compatible.");
  }

  const iv = Buffer.from(parts[1], "base64url");
  const authenticationTag = Buffer.from(parts[2], "base64url");
  const encrypted = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || authenticationTag.length !== 16 || !encrypted.length) {
    throw new Error("La clave 2FA cifrada está incompleta.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    iv,
    { authTagLength: 16 }
  );
  decipher.setAAD(ENCRYPTION_AAD);
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString("utf8");
}

function normalizeText(value, label, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Ingresa ${label}.`);
  if (text.length > maxLength) {
    throw new Error(`${label} supera el límite de ${maxLength} caracteres.`);
  }
  return text;
}

class AuthenticatorService {
  constructor({ store, encryptionKey, clock = () => Date.now() }) {
    if (!store) throw new Error("El Autenticador necesita acceso a la base de datos.");
    this.store = store;
    this.encryptionKey = deriveEncryptionKey(encryptionKey);
    this.clock = clock;
  }

  listAccounts() {
    const now = this.clock();
    return this.store
      .listAuthenticatorAccounts()
      .map((account) => this.#toPublicAccount(account, now));
  }

  createAccount(input) {
    const metadata = this.#normalizeMetadata(input);
    const totp = parseTotpSecret(input?.secret);
    const account = this.store.createAuthenticatorAccount({
      ...metadata,
      encryptedSecret: encryptSecret(totp.secret, this.encryptionKey),
      algorithm: totp.algorithm,
      digits: totp.digits,
      period: totp.period
    });
    return this.#toPublicAccount(account, this.clock());
  }

  updateAccount(id, input) {
    const current = this.store.getAuthenticatorAccount(id);
    if (!current) throw new Error("Cuenta del Autenticador no encontrada.");

    const patch = this.#normalizeMetadata({
      name: input?.name ?? current.name,
      service: input?.service ?? current.service,
      email: input?.email ?? current.email
    });
    const nextSecret = String(input?.secret || "").trim();
    if (nextSecret) {
      const totp = parseTotpSecret(nextSecret);
      Object.assign(patch, {
        encryptedSecret: encryptSecret(totp.secret, this.encryptionKey),
        algorithm: totp.algorithm,
        digits: totp.digits,
        period: totp.period
      });
    }

    const account = this.store.updateAuthenticatorAccount(id, patch);
    return this.#toPublicAccount(account, this.clock());
  }

  deleteAccount(id) {
    const deleted = this.store.deleteAuthenticatorAccount(id);
    return {
      id: deleted.id,
      name: deleted.name,
      service: deleted.service,
      email: deleted.email
    };
  }

  #normalizeMetadata(input) {
    return {
      name: normalizeText(input?.name, "el nombre", 120),
      service: normalizeText(input?.service, "el servicio", 120),
      email: normalizeText(input?.email, "el correo o usuario", 240)
    };
  }

  #toPublicAccount(account, timestamp) {
    let algorithm = "SHA1";
    let digits = 6;
    let period = 30;
    let configurationValid = true;
    try {
      algorithm = normalizeAlgorithm(account.algorithm || "SHA1");
      digits = normalizeDigits(account.digits || 6);
      period = normalizePeriod(account.period || 30);
    } catch {
      // Una configuración dañada se presenta como no disponible sin bloquear
      // el resto de las cuentas guardadas.
      configurationValid = false;
    }

    const publicAccount = {
      id: account.id,
      name: account.name,
      service: account.service,
      email: account.email,
      algorithm,
      digits,
      period,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      secretConfigured: Boolean(account.encryptedSecret)
    };

    try {
      if (!configurationValid) {
        throw new Error("Configuración 2FA no compatible.");
      }
      const secret = decryptSecret(account.encryptedSecret, this.encryptionKey);
      return {
        ...publicAccount,
        ...generateTotp(secret, {
          timestamp,
          algorithm: publicAccount.algorithm,
          digits: publicAccount.digits,
          period: publicAccount.period
        }),
        available: true,
        error: null
      };
    } catch {
      return {
        ...publicAccount,
        code: null,
        secondsRemaining: null,
        expiresAt: null,
        available: false,
        error: configurationValid
          ? "No se pudo abrir esta clave 2FA. Revisa que la clave de cifrado de Render no haya cambiado."
          : "La configuración de esta cuenta 2FA no es compatible. Edítala y guarda una clave nueva."
      };
    }
  }
}

module.exports = {
  AuthenticatorService,
  decodeBase32,
  deriveEncryptionKey,
  encryptSecret,
  decryptSecret,
  generateTotp,
  normalizeBase32Secret,
  parseTotpSecret
};
