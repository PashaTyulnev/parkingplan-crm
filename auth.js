// Login für die App: ein Benutzer, Passwort als scrypt-Hash in data/benutzer.json.
// Die Sitzung steckt in einem signierten Cookie. Jede Passwortänderung erhöht die Version, dadurch werden alle
// anderen Sitzungen ungültig.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');

const scrypt = util.promisify(crypto.scrypt);
const COOKIE = 'sitzung';
const SITZUNG_TAGE = 14;
const MIN_LAENGE = 10;
const MAX_FEHLVERSUCHE = 5;
const SPERRE_MS = 15 * 60 * 1000;

function dateiPfad(dataDir) {
  return path.join(dataDir, 'benutzer.json');
}

function laden(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(dateiPfad(dataDir), 'utf8'));
  } catch {
    return null;
  }
}

function speichern(dataDir, b) {
  const datei = dateiPfad(dataDir);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei + '.tmp', JSON.stringify(b, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(datei + '.tmp', datei);
}

async function hashen(passwort, salt) {
  return (await scrypt(String(passwort).normalize('NFC'), salt, 64)).toString('hex');
}

async function passwortSetzen(dataDir, benutzer, passwort) {
  const alt = laden(dataDir);
  const salt = crypto.randomBytes(16).toString('hex');
  const b = {
    benutzer,
    salt,
    hash: await hashen(passwort, salt),
    secret: (alt && alt.secret) || crypto.randomBytes(32).toString('hex'),
    version: ((alt && alt.version) || 0) + 1,
    geaendert: new Date().toISOString(),
  };
  speichern(dataDir, b);
  return b;
}

async function passwortPruefen(b, passwort) {
  if (!b || typeof passwort !== 'string') return false;
  const ist = Buffer.from(await hashen(passwort, b.salt), 'hex');
  const soll = Buffer.from(b.hash, 'hex');
  return ist.length === soll.length && crypto.timingSafeEqual(ist, soll);
}

// Beim ersten Start einen Benutzer anlegen. Ohne NUXT_LOGIN_PASSWORT wird ein Zufallspasswort erzeugt und einmal ausgegeben.
async function einrichten(dataDir, cfg) {
  if (laden(dataDir)) return;
  const benutzer = (cfg.NUXT_LOGIN_BENUTZER || 'admin').trim();
  const vorgegeben = (cfg.NUXT_LOGIN_PASSWORT || '').trim();
  const passwort = vorgegeben || crypto.randomBytes(12).toString('base64url');
  await passwortSetzen(dataDir, benutzer, passwort);
  console.log(`Benutzer „${benutzer}“ angelegt.` + (vorgegeben ? ' Passwort aus NUXT_LOGIN_PASSWORT.' : ` Startpasswort: ${passwort}  (bitte nach dem Login ändern)`));
}

const sig = (secret, daten) => crypto.createHmac('sha256', secret).update(daten).digest('base64url');

function tokenErzeugen(b) {
  const daten = Buffer.from(JSON.stringify({ u: b.benutzer, v: b.version, exp: Date.now() + SITZUNG_TAGE * 864e5 })).toString('base64url');
  return `${daten}.${sig(b.secret, daten)}`;
}

function cookies(req) {
  const out = {};
  for (const teil of (req.headers.cookie || '').split(';')) {
    const i = teil.indexOf('=');
    if (i > 0) out[teil.slice(0, i).trim()] = teil.slice(i + 1).trim();
  }
  return out;
}

// Liefert den Benutzernamen der gültigen Sitzung oder null
function sitzung(dataDir, req) {
  const token = cookies(req)[COOKIE];
  const b = laden(dataDir);
  if (!token || !b) return null;
  const [daten, s] = token.split('.');
  if (!daten || !s) return null;
  const soll = Buffer.from(sig(b.secret, daten));
  const ist = Buffer.from(s);
  if (ist.length !== soll.length || !crypto.timingSafeEqual(ist, soll)) return null;
  try {
    const t = JSON.parse(Buffer.from(daten, 'base64url').toString('utf8'));
    return t.u === b.benutzer && t.v === b.version && t.exp > Date.now() ? b.benutzer : null;
  } catch {
    return null;
  }
}

function istHttps(req, cfg) {
  if (cfg.NUXT_COOKIE_SECURE === '1') return true;
  return cfg.NUXT_TRUST_PROXY === '1' && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function cookieSetzen(res, req, cfg, wert, maxAge) {
  const teile = [`${COOKIE}=${wert}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (istHttps(req, cfg)) teile.push('Secure');
  res.setHeader('Set-Cookie', teile.join('; '));
}

const anmelden = (res, req, cfg, b) => cookieSetzen(res, req, cfg, tokenErzeugen(b), SITZUNG_TAGE * 86400);
const abmelden = (res, req, cfg) => cookieSetzen(res, req, cfg, '', 0);

// Schutz gegen Durchprobieren: nach 5 Fehlversuchen ist die Adresse 15 Minuten gesperrt
const versuche = new Map();

function clientIp(req, cfg) {
  if (cfg.NUXT_TRUST_PROXY === '1') {
    const kette = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (kette.length) return kette[kette.length - 1];
  }
  return req.socket.remoteAddress || '';
}

function gesperrtBis(ip) {
  const v = versuche.get(ip);
  if (!v) return 0;
  if (v.bis && v.bis > Date.now()) return v.bis;
  if (v.bis) versuche.delete(ip);
  return 0;
}

function fehlversuch(ip) {
  const v = versuche.get(ip) || { anzahl: 0, bis: 0 };
  v.anzahl++;
  if (v.anzahl >= MAX_FEHLVERSUCHE) v.bis = Date.now() + SPERRE_MS;
  versuche.set(ip, v);
}

module.exports = {
  MIN_LAENGE, laden, einrichten, passwortSetzen, passwortPruefen, sitzung, anmelden, abmelden,
  clientIp, gesperrtBis, fehlversuch, erfolg: (ip) => versuche.delete(ip),
};
