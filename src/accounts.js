"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);

// Initial owner credential is stored only as a salted hash. Never reset on startup.
const INITIAL_OWNER_HASH = "720069e4e8e5c3d2cc3eff47c242e8d9:161bc59559fb78a7e689728d79c40d99d2ccb46b5a731798e365d4ec7bd203f10619d22139cb49c54421c868425dcf4c9ba5efe735eaf54fb6eb0f03b94fcbce";

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

class Accounts {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, "accounts.json");
    this.sessions = new Map();
    this.pendingNames = new Set();
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(parsed.users) || !parsed.users.some(u => u.id === "owner" && u.role === "admin")) {
        throw new Error("El archivo de usuarios no es válido. Restaura accounts.json antes de iniciar.");
      }
      this.users = parsed.users;
    } else {
      for (const filename of ["jadrixservs-v4.json", "jadrixservs-v4.backup.json"]) {
        const source = path.join(this.dataDir, filename);
        const backup = `${source}.pre-multiuser`;
        if (fs.existsSync(source) && !fs.existsSync(backup)) fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
      }
      this.users = [{ id: "owner", username: "JadrixGR", role: "admin", passwordHash: INITIAL_OWNER_HASH, createdAt: new Date().toISOString() }];
      this.save();
    }
  }

  save() {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, users: this.users }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  list() { return this.users.map(publicUser); }

  directory(user) {
    if (user.id === "owner") return this.dataDir;
    if (!/^[a-f0-9-]{36}$/.test(user.id)) throw new Error("Identificador de usuario inválido.");
    return path.join(this.dataDir, "tenants", user.id);
  }

  async create({ username, password } = {}) {
    const name = String(username || "").trim().normalize("NFKC");
    const key = name.toLowerCase();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,59}$/u.test(name)) throw new Error("Usa un nombre de 2 a 60 caracteres: letras, números o espacios.");
    const secret = String(password || "");
    if (secret.length < 4 || secret.length > 128) throw new Error("La contraseña debe tener entre 4 y 128 caracteres.");
    if (this.pendingNames.has(key) || this.users.some(u => u.username.toLowerCase() === key)) throw new Error("Ese nombre de usuario ya existe.");
    this.pendingNames.add(key);
    try {
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = await scrypt(secret, salt, 64);
      const user = { id: crypto.randomUUID(), username: name, passwordHash: `${salt}:${hash.toString("hex")}`, role: "user", createdAt: new Date().toISOString() };
      this.users.push(user);
      try { this.save(); } catch (error) { this.users.pop(); throw error; }
      return publicUser(user);
    } finally { this.pendingNames.delete(key); }
  }

  async login(username, password) {
    const name = String(username || "").trim().normalize("NFKC").toLowerCase();
    const user = this.users.find(u => u.username.toLowerCase() === name);
    const secret = String(password || "");
    if (secret.length > 128) return null;
    const [salt, encoded] = (user?.passwordHash || INITIAL_OWNER_HASH).split(":");
    const actual = await scrypt(secret, salt, 64);
    const expected = Buffer.from(encoded, "hex");
    if (!crypto.timingSafeEqual(actual, expected) || !user) return null;
    const now = Date.now();
    for (const [key, entry] of this.sessions) if (entry.expiresAt <= now) this.sessions.delete(key);
    const token = crypto.randomBytes(32).toString("hex");
    this.sessions.set(token, { userId: user.id, expiresAt: now + 7 * 86400000 });
    return { token, user: publicUser(user) };
  }

  session(token) {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) { this.sessions.delete(token); return null; }
    const user = this.users.find(u => u.id === session.userId);
    return user ? publicUser(user) : null;
  }

  logout(token) { this.sessions.delete(token); }
}

module.exports = { Accounts };
