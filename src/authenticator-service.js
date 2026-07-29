"use strict";

const crypto = require("node:crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SUPPORTED_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);
const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_AAD = Buffer.from(
  "jadrixservs-authenticator-secret:v1",
  "utf8"
);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deriveAuthenticatorCommand(value) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
  return `/${slug.length >= 2 ? slug : "2fa"}`;
}

function normalizeAuthenticatorCommand(value) {
  let command = String(value || "").trim().toLowerCase();
  if (command && !command.startsWith("/")) command = `/${command}`;
  if (!/^\/[a-z0-9][a-z0-9_-]{1,31}$/.test(command)) {
    throw new Error(
      "El comando 2FA debe empezar con / y contener entre 2 y 32 letras, números, guiones o guiones bajos. Ejemplo: /gpt01."
    );
  }
  return command;
}

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
  constructor({
    store,
    encryptionKey,
    clock = () => Date.now(),
    sleepFn = wait
  }) {
    if (!store) throw new Error("El Autenticador necesita acceso a la base de datos.");
    this.store = store;
    this.encryptionKey = deriveEncryptionKey(encryptionKey);
    this.clock = clock;
    this.sleepFn = sleepFn;
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
      email: input?.email ?? current.email,
      command:
        input?.command ??
        current.command ??
        deriveAuthenticatorCommand(current.name)
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
      email: deleted.email,
      command: deleted.command
    };
  }

  findAccountByCommand(command) {
    const account = this.store.findAuthenticatorAccountByCommand(command);
    if (!account) return null;
    return {
      id: account.id,
      name: account.name,
      service: account.service,
      email: account.email,
      command: account.command,
      period: account.period,
      digits: account.digits,
      algorithm: account.algorithm
    };
  }

  async getFreshCodeByCommand(
    command,
    {
      minimumSeconds = 20,
      maximumSeconds = 30,
      safetyMilliseconds = 750
    } = {}
  ) {
    const normalizedCommand = normalizeAuthenticatorCommand(command);
    const minimum = Number(minimumSeconds);
    const maximum = Number(maximumSeconds);
    const safety = Math.max(0, Number(safetyMilliseconds) || 0);
    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      minimum < 1 ||
      maximum < minimum ||
      maximum > 120
    ) {
      throw new Error("La ventana de validez solicitada para el código 2FA no es válida.");
    }

    let waitedMilliseconds = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const account =
        this.store.findAuthenticatorAccountByCommand(normalizedCommand);
      if (!account) return null;

      const nowValue = this.clock();
      const now =
        nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
      const presented = this.#toPublicAccount(account, now);
      if (!presented.available || !presented.expiresAt) {
        const error = new Error(
          presented.error || "No se pudo generar el código 2FA."
        );
        error.code = "AUTHENTICATOR_UNAVAILABLE";
        throw error;
      }

      const periodMilliseconds = presented.period * 1000;
      const minimumWindow = minimum * 1000 + safety;
      const maximumWindow = maximum * 1000;
      if (periodMilliseconds < minimumWindow) {
        const error = new Error(
          `La cuenta ${presented.name} usa códigos de ${presented.period} segundos y no puede garantizar ${minimum} segundos de vigencia.`
        );
        error.code = "AUTHENTICATOR_WINDOW_UNAVAILABLE";
        throw error;
      }

      const remainingMilliseconds =
        new Date(presented.expiresAt).getTime() - now;
      if (
        remainingMilliseconds >= minimumWindow &&
        remainingMilliseconds <= maximumWindow
      ) {
        return {
          ...presented,
          secondsRemaining: Math.min(
            maximum,
            Math.floor(remainingMilliseconds / 1000)
          ),
          waitedMilliseconds
        };
      }

      const upperTarget = Math.max(
        minimumWindow,
        maximumWindow - 350
      );
      const waitMilliseconds =
        remainingMilliseconds > maximumWindow
          ? remainingMilliseconds - upperTarget + 100
          : remainingMilliseconds +
            Math.max(0, periodMilliseconds - upperTarget) +
            100;
      if (
        !Number.isFinite(waitMilliseconds) ||
        waitMilliseconds < 0 ||
        waitMilliseconds > 130000
      ) {
        const error = new Error(
          "No se pudo obtener una ventana segura para enviar el código 2FA."
        );
        error.code = "AUTHENTICATOR_WINDOW_UNAVAILABLE";
        throw error;
      }

      const delay = Math.ceil(waitMilliseconds);
      waitedMilliseconds += delay;
      await this.sleepFn(delay);
    }

    const error = new Error(
      "El código 2FA no alcanzó la vigencia mínima para enviarse."
    );
    error.code = "AUTHENTICATOR_WINDOW_UNAVAILABLE";
    throw error;
  }

  #normalizeMetadata(input) {
    const name = normalizeText(input?.name, "el nombre", 120);
    return {
      name,
      service: normalizeText(input?.service, "el servicio", 120),
      email: normalizeText(input?.email, "el correo o usuario", 240),
      command: normalizeAuthenticatorCommand(
        input?.command || deriveAuthenticatorCommand(name)
      )
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
      command:
        account.command || deriveAuthenticatorCommand(account.name),
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
  deriveAuthenticatorCommand,
  decodeBase32,
  deriveEncryptionKey,
  encryptSecret,
  decryptSecret,
  generateTotp,
  normalizeAuthenticatorCommand,
  normalizeBase32Secret,
  parseTotpSecret
};
