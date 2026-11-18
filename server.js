// Parkingplan – Webapp mit Login. Mailversand per SMTP. Die Zugangsdaten werden in der App unter „Einstellungen“
// gepflegt und in data/einstellungen.json gespeichert (nicht im Git).
// Start: node server.js  ->  http://localhost:3100
// Das Tracking-Pixel liegt auf dem Server (NUXT_TRACKING_URL), die Öffnungen holt die App dort ab.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const nodemailer = require('nodemailer');
const { istGesperrt } = require('./sperrliste');
const auth = require('./auth');

const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || '127.0.0.1';
const SYNC_MS = Number(process.env.SYNC_MS ?? 60000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'kunden.json');
const VERSAND_FILE = path.join(DATA_DIR, 'versand.json');
const VORLAGEN_FILE = path.join(DATA_DIR, 'vorlagen.json');
const EINSTELLUNGEN_FILE = path.join(DATA_DIR, 'einstellungen.json');
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS ?? 2000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const FIELDS = ['name', 'website', 'email', 'telefon', 'ort', 'land', 'flughafen', 'typ', 'status', 'notizen', 'quelle'];

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).filter((k) => !istGesperrt(k));
  } catch {
    return [];
  }
}

function save(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function loadVersand() {
  try {
    return JSON.parse(fs.readFileSync(VERSAND_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveVersand(list) {
  const tmp = VERSAND_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, VERSAND_FILE);
}

function loadVorlagen() {
  try {
    return JSON.parse(fs.readFileSync(VORLAGEN_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveVorlagen(list) {
  const tmp = VORLAGEN_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, VORLAGEN_FILE);
}

// Einstellungen, die in der App gepflegt werden. geheim = der Wert wird nie an den Browser zurückgegeben.
const EINSTELLUNGEN = [
  { key: 'NUXT_SMTP_HOST' }, { key: 'NUXT_SMTP_PORT' }, { key: 'NUXT_SMTP_USER' }, { key: 'NUXT_SMTP_PASS', geheim: true },
  { key: 'NUXT_SMTP_FROM_NAME' }, { key: 'NUXT_CONTACT_TO' }, { key: 'NUXT_KOPIE_AN' },
  { key: 'NUXT_TRACKING_URL' }, { key: 'NUXT_TRACKING_TOKEN', geheim: true }, { key: 'NUXT_TEST_EMPFAENGER' },
];

function envDatei() {
  try {
    return util.parseEnv(fs.readFileSync(path.join(__dirname, '.env'), 'utf8'));
  } catch {
    return {};
  }
}

function loadEinstellungen() {
  try {
    return JSON.parse(fs.readFileSync(EINSTELLUNGEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveEinstellungen(e) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(EINSTELLUNGEN_FILE + '.tmp', JSON.stringify(e, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(EINSTELLUNGEN_FILE + '.tmp', EINSTELLUNGEN_FILE);
}

// Einmalig: vorhandene Werte aus .env übernehmen, danach gilt nur noch data/einstellungen.json
function einstellungenEinrichten() {
  if (loadEinstellungen()) return;
  const quelle = { ...envDatei(), ...process.env };
  const e = {};
  for (const { key } of EINSTELLUNGEN) e[key] = String(quelle[key] || '').trim();
  saveEinstellungen(e);
  if (Object.values(e).some(Boolean)) console.log('Einstellungen aus .env nach data/einstellungen.json übernommen. Die .env wird dafür nicht mehr gebraucht.');
}

// Wird bei jedem Zugriff neu gelesen, damit Änderungen in der App sofort gelten
function config() {
  return { ...envDatei(), ...process.env, ...(loadEinstellungen() || {}) };
}

// Nur echte Web-Adressen zulassen, damit nie ein falsch eingetragener Wert in den Mails landet
function trackingBasis(cfg) {
  const u = (cfg.NUXT_TRACKING_URL || '').trim();
  return /^https?:\/\/\S+$/i.test(u) ? u.replace(/\/$/, '') : '';
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fuelle = (vorlage, k, wandle = (x) => x) => vorlage.replace(/\{\{\s*(name|flughafen)\s*\}\}/g, (_, f) => wandle(k[f] || ''));

// Vorlage eines Versands: gespeichert seit 10.11.2026, ältere Einträge über den Betreff erkennen
const vorlageVon = (e, vorlagen) => e.vorlageId || (vorlagen.find((v) => v.betreff === e.betreff) || {}).id || '';

async function sendeMail(transport, cfg, adresse, kunde, betreffRoh, text, htmlVorlage, vorlage) {
  // Testmodus: Hier läuft jeder Versand durch, echte Adressen werden sicher ersetzt
  const testAn = (cfg.NUXT_TEST_EMPFAENGER || '').trim();
  const empfaenger = testAn || adresse;
  const betreff = testAn ? `[TEST statt ${adresse}] ${betreffRoh}` : betreffRoh;
  const token = crypto.randomBytes(16).toString('hex');
  const basis = trackingBasis(cfg);
  const pixel = basis ? `<img src="${escHtml(basis)}/o/${token}.gif" width="1" height="1" alt="" style="display:block;border:0">` : '';
  const eintrag = { token, kundeId: kunde.id || null, name: kunde.name, email: empfaenger, betreff, gesendet: new Date().toISOString(), tracking: Boolean(basis), test: Boolean(testAn), geoeffnet: [] };
  if (vorlage) Object.assign(eintrag, { vorlageId: vorlage.id, vorlageName: vorlage.name });
  const absender = { name: cfg.NUXT_SMTP_FROM_NAME || 'ParkingPlan', address: cfg.NUXT_SMTP_USER };
  const mitBild = (bild) => (htmlVorlage
    ? (/<\/body>/i.test(htmlVorlage) ? htmlVorlage.replace(/<\/body>/i, () => `${bild}</body>`) : htmlVorlage + bild)
    : `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${escHtml(text).replace(/\r?\n/g, '<br>')}</div>${bild}`);
  const mail = { from: absender, replyTo: cfg.NUXT_CONTACT_TO || undefined, to: empfaenger, subject: betreff, text };
  try {
    await transport.sendMail({ ...mail, html: mitBild(pixel) });
  } catch (e) {
    eintrag.fehler = e.message;
  }
  // Eigene Kopie: Der Empfänger bleibt im An-Feld sichtbar. Ohne Pixel, damit das Öffnen der Kopie nicht mitzählt.
  const kopieAn = (cfg.NUXT_KOPIE_AN || '').trim();
  if (kopieAn && !eintrag.fehler) {
    try {
      await transport.sendMail({ ...mail, html: mitBild(''), envelope: { from: cfg.NUXT_SMTP_USER, to: kopieAn } });
      eintrag.kopieAn = kopieAn;
    } catch (e) {
      eintrag.kopieFehler = e.message;
    }
  }
  const versand = loadVersand();
  versand.push(eintrag);
  saveVersand(versand);
  return eintrag;
}

// Öffnungen vom Tracking-Server holen und im Versandprotokoll eintragen
function alsZeit(wert) {
  const zahl = Number(wert);
  const d = new Date(Number.isFinite(zahl) ? (zahl < 1e12 ? zahl * 1000 : zahl) : wert);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function opensAus(antwort) {
  const liste = Array.isArray(antwort) ? antwort : antwort.opens || antwort.data || antwort.events || [];
  const opens = new Map();
  for (const o of liste) {
    const zeit = alsZeit(o.time ?? o.ts ?? o.timestamp ?? o.opened_at ?? o.date ?? o.at);
    if (!o.id || !zeit) continue;
    opens.set(o.id, [...(opens.get(o.id) || []), zeit]);
  }
  return opens;
}

let trackingFehler = '';

async function opensAbgleichen() {
  const cfg = config();
  const basis = trackingBasis(cfg);
  if (!basis || !cfg.NUXT_TRACKING_TOKEN) return;
  try {
    const r = await fetch(`${basis}/stats?key=${encodeURIComponent(cfg.NUXT_TRACKING_TOKEN)}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Antwort ${r.status}`);
    const opens = opensAus(await r.json());
    const versand = loadVersand();
    let geaendert = false;
    for (const v of versand) {
      const zeiten = opens.get(v.token);
      if (zeiten && zeiten.length !== v.geoeffnet.length) {
        v.geoeffnet = zeiten.sort();
        geaendert = true;
      }
    }
    if (geaendert) saveVersand(versand);
    trackingFehler = '';
  } catch (e) {
    trackingFehler = (e.cause && e.cause.message) || e.message;
  }
}

function transportAus(cfg) {
  const port = Number(cfg.NUXT_SMTP_PORT || 465);
  return nodemailer.createTransport({ host: cfg.NUXT_SMTP_HOST, port, secure: port === 465, auth: { user: cfg.NUXT_SMTP_USER, pass: cfg.NUXT_SMTP_PASS } });
}

const smtpFertig = (cfg) => Boolean(cfg.NUXT_SMTP_HOST && cfg.NUXT_SMTP_USER && cfg.NUXT_SMTP_PASS);
let versandLaeuft = false;
const fortschritt = { gesendet: 0, gesamt: 0, fehler: 0 };

function clean(input) {
  const out = {};
  for (const f of FIELDS) out[f] = typeof input[f] === 'string' ? input[f].trim() : '';
  if (!out.status) out.status = 'Neu';
  return out;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

function weiterleiten(res, ziel) {
  res.writeHead(302, { Location: ziel, 'Cache-Control': 'no-store' });
  res.end();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function warteText(bis) {
  return `Zu viele Fehlversuche. Bitte in ${Math.ceil((bis - Date.now()) / 60000)} Minuten erneut versuchen.`;
}

// Beim ersten Start die recherchierten Betreiber übernehmen (falls vorhanden)
if (!fs.existsSync(DATA_FILE) && fs.existsSync(path.join(DATA_DIR, 'recherche.json'))) {
  const seed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recherche.json'), 'utf8'));
  save(seed.filter((s) => !istGesperrt(s)).map((s) => ({ id: crypto.randomUUID(), ...clean(s), erstellt: new Date().toISOString() })));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const cfg = config();

  // Nur JSON annehmen: verhindert, dass fremde Webseiten per Formular-Post Aktionen auslösen
  if (url.pathname.startsWith('/api/') && req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'JSON erwartet' });
  }

  const benutzer = auth.sitzung(DATA_DIR, req);

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const ip = auth.clientIp(req, cfg);
    const bis = auth.gesperrtBis(ip);
    if (bis) return send(res, 429, { error: warteText(bis) });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: 'Ungültige Anfrage' }); }
    const b = auth.laden(DATA_DIR);
    const passtPw = await auth.passwortPruefen(b, body.passwort);
    const passtName = Boolean(b) && String(body.benutzer || '').trim().toLowerCase() === b.benutzer.toLowerCase();
    if (!passtPw || !passtName) {
      auth.fehlversuch(ip);
      return send(res, 401, { error: 'Benutzername oder Passwort falsch' });
    }
    auth.erfolg(ip);
    auth.anmelden(res, req, cfg, b);
    return send(res, 200, { benutzer: b.benutzer });
  }

  if (url.pathname === '/login' || url.pathname === '/login.html') {
    if (benutzer) return weiterleiten(res, '/');
    return fs.readFile(path.join(PUBLIC_DIR, 'login.html'), (err, buf) => (err ? send(res, 500, 'Fehler', 'text/plain') : send(res, 200, buf, MIME['.html'])));
  }

  // Ab hier nur mit gültiger Sitzung
  if (!benutzer) {
    if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Bitte anmelden' });
    return weiterleiten(res, '/login');
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    auth.abmelden(res, req, cfg);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/ich' && req.method === 'GET') return send(res, 200, { benutzer });

  if (url.pathname === '/api/passwort' && req.method === 'POST') {
    const ip = auth.clientIp(req, cfg);
    const bis = auth.gesperrtBis(ip);
    if (bis) return send(res, 429, { error: warteText(bis) });
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: 'Ungültige Anfrage' }); }
    const alt = String(body.alt || ''), neu = String(body.neu || '');
    const b = auth.laden(DATA_DIR);
    if (!(await auth.passwortPruefen(b, alt))) {
      auth.fehlversuch(ip);
      return send(res, 400, { error: 'Das aktuelle Passwort ist falsch' });
    }
    if (neu.length < auth.MIN_LAENGE) return send(res, 400, { error: `Das neue Passwort muss mindestens ${auth.MIN_LAENGE} Zeichen haben` });
    if (neu === alt) return send(res, 400, { error: 'Das neue Passwort muss sich vom alten unterscheiden' });
    // Neue Version: alle anderen Sitzungen werden ungültig, diese bekommt ein neues Cookie
    const nb = await auth.passwortSetzen(DATA_DIR, b.benutzer, neu);
    auth.erfolg(ip);
    auth.anmelden(res, req, cfg, nb);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/einstellungen' && req.method === 'GET') {
    const e = loadEinstellungen() || {};
    const werte = {}, gesetzt = {};
    for (const { key, geheim } of EINSTELLUNGEN) {
      if (geheim) gesetzt[key] = Boolean(e[key]);
      else werte[key] = e[key] || '';
    }
    return send(res, 200, { werte, gesetzt });
  }

  if (url.pathname === '/api/einstellungen' && req.method === 'PUT') {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: 'Ungültige Anfrage' }); }
    const e = loadEinstellungen() || {};
    const loeschen = new Set(Array.isArray(body.loeschen) ? body.loeschen : []);
    for (const { key, geheim } of EINSTELLUNGEN) {
      const wert = typeof body[key] === 'string' ? body[key].trim() : undefined;
      if (geheim) {
        // Leeres Feld = unverändert lassen, damit das Passwort nie zum Browser zurück muss
        if (loeschen.has(key)) e[key] = '';
        else if (wert) e[key] = wert;
      } else if (wert !== undefined) e[key] = wert;
    }
    if (e.NUXT_SMTP_PORT && !/^\d{1,5}$/.test(e.NUXT_SMTP_PORT)) return send(res, 400, { error: 'Der SMTP-Port muss eine Zahl sein, z.B. 465 oder 587' });
    if (e.NUXT_TRACKING_URL && !/^https?:\/\/\S+$/i.test(e.NUXT_TRACKING_URL)) return send(res, 400, { error: 'Die Tracking-Adresse muss mit https:// beginnen' });
    for (const [key, name] of [['NUXT_CONTACT_TO', 'Antwort-Adresse'], ['NUXT_KOPIE_AN', 'Kopie an'], ['NUXT_TEST_EMPFAENGER', 'Testempfänger']]) {
      if (e[key] && !EMAIL.test(e[key])) return send(res, 400, { error: `${name}: keine gültige E-Mail-Adresse` });
    }
    saveEinstellungen(e);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/einstellungen/smtp-pruefen' && req.method === 'POST') {
    if (!smtpFertig(cfg)) return send(res, 400, { error: 'Server, Benutzer und Passwort eintragen und speichern' });
    const transport = transportAus(cfg);
    try {
      await transport.verify();
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: `Verbindung fehlgeschlagen: ${e.message}` });
    } finally {
      transport.close();
    }
  }

  if (url.pathname === '/api/versand' && req.method === 'GET') return send(res, 200, loadVersand());
  if (url.pathname === '/api/fortschritt' && req.method === 'GET') return send(res, 200, { laeuft: versandLaeuft, ...fortschritt });

  if (url.pathname === '/api/mailconfig' && req.method === 'GET') {
    return send(res, 200, { bereit: smtpFertig(cfg), absender: `${cfg.NUXT_SMTP_FROM_NAME || 'ParkingPlan'} <${cfg.NUXT_SMTP_USER || ''}>`, testModus: (cfg.NUXT_TEST_EMPFAENGER || '').trim(), tracking: Boolean(trackingBasis(cfg)), trackingFehler });
  }

  const vm = url.pathname.match(/^\/api\/vorlagen(?:\/([\w-]+))?$/);
  if (vm) {
    const list = loadVorlagen();
    if (req.method === 'GET' && !vm[1]) return send(res, 200, list);
    if (req.method === 'DELETE' && vm[1]) {
      saveVorlagen(list.filter((v) => v.id !== vm[1]));
      return send(res, 200, { ok: true });
    }
    if ((req.method === 'POST' && !vm[1]) || (req.method === 'PUT' && vm[1])) {
      let body;
      try { body = await readBody(req); } catch { return send(res, 400, { error: 'Ungültige Anfrage' }); }
      const name = String(body.name || '').trim(), betreff = String(body.betreff || '').trim(), text = String(body.text || '').trim(), html = String(body.html || '').trim();
      if (!name || !betreff || !text) return send(res, 400, { error: 'Name, Betreff und Text sind Pflicht' });
      if (vm[1]) {
        const v = list.find((x) => x.id === vm[1]);
        if (!v) return send(res, 404, { error: 'Nicht gefunden' });
        if (list.some((x) => x.id !== v.id && x.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'Eine Vorlage mit diesem Namen gibt es schon' });
        Object.assign(v, { name, betreff, text, html, geaendert: new Date().toISOString() });
        saveVorlagen(list);
        return send(res, 200, v);
      }
      // Gleicher Name überschreibt die vorhandene Vorlage
      let v = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (v) Object.assign(v, { name, betreff, text, html, geaendert: new Date().toISOString() });
      else list.push((v = { id: crypto.randomUUID(), name, betreff, text, html, erstellt: new Date().toISOString() }));
      saveVorlagen(list);
      return send(res, 200, v);
    }
    return send(res, 405, { error: 'Methode nicht erlaubt' });
  }

  if ((url.pathname === '/api/senden' || url.pathname === '/api/testmail') && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: 'Ungültige Anfrage' }); }
    const betreff = String(body.betreff || '').trim(), text = String(body.text || '').trim(), html = String(body.html || '').trim();
    if (!smtpFertig(cfg)) return send(res, 400, { error: 'SMTP nicht vollständig: unter „Einstellungen“ Server, Benutzer und Passwort eintragen' });
    if (!betreff || !text) return send(res, 400, { error: 'Betreff und Text sind Pflicht' });
    if (versandLaeuft) return send(res, 409, { error: 'Es läuft bereits ein Versand' });

    const istTest = url.pathname === '/api/testmail';
    const vorlagen = loadVorlagen();
    const vorlage = vorlagen.find((v) => v.id === body.vorlageId) || vorlagen.find((v) => v.betreff === betreff) || null;
    const uebersprungen = [];
    let ziele;
    if (istTest) {
      if (!cfg.NUXT_CONTACT_TO) return send(res, 400, { error: 'Unter „Einstellungen“ fehlt die Antwort-Adresse (dorthin geht die Testmail)' });
      ziele = [{ name: 'TEST', flughafen: 'Frankfurt', email: cfg.NUXT_CONTACT_TO }];
    } else {
      // Nur ausdrücklich ausgewählte IDs; die Adresse kommt immer aus der Liste, nie vom Client
      const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
      ziele = load().filter((k) => ids.has(k.id) && k.email);
      // Wer diese Vorlage schon bekommen hat, bekommt sie nicht noch einmal
      if (vorlage) {
        const schon = new Set(loadVersand().filter((e) => !e.fehler && !e.test && vorlageVon(e, vorlagen) === vorlage.id).map((e) => e.kundeId));
        uebersprungen.push(...ziele.filter((k) => schon.has(k.id)).map((k) => ({ name: k.name, email: k.email, uebersprungen: true })));
        ziele = ziele.filter((k) => !schon.has(k.id));
      }
      if (!ziele.length) return send(res, uebersprungen.length ? 200 : 400, uebersprungen.length ? uebersprungen : { error: 'Keine Empfänger ausgewählt' });
    }

    versandLaeuft = true;
    Object.assign(fortschritt, { gesendet: 0, gesamt: ziele.length, fehler: 0 });
    const transport = transportAus(cfg);
    const ergebnis = [];
    try {
      for (let i = 0; i < ziele.length; i++) {
        const k = ziele[i];
        const e = await sendeMail(transport, cfg, k.email, k, fuelle(betreff, k), fuelle(text, k), fuelle(html, k, escHtml), vorlage);
        ergebnis.push({ name: k.name, email: k.email, fehler: e.fehler });
        fortschritt.gesendet++;
        if (e.fehler) fortschritt.fehler++;
        if (!e.fehler && !istTest && !e.test) {
          const list = load();
          const t = list.find((x) => x.id === k.id);
          if (t && t.status === 'Neu') { t.status = 'Kontaktiert'; save(list); }
        }
        if (i < ziele.length - 1) await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
      }
    } finally {
      versandLaeuft = false;
      transport.close();
    }
    return send(res, 200, [...ergebnis, ...uebersprungen]);
  }

  const m = url.pathname.match(/^\/api\/kunden(?:\/([\w-]+))?$/);

  if (m) {
    const id = m[1];
    const list = load();
    try {
      if (req.method === 'GET' && !id) return send(res, 200, list);
      if (req.method === 'POST' && !id) {
        const item = { id: crypto.randomUUID(), ...clean(await readBody(req)), erstellt: new Date().toISOString() };
        if (!item.name) return send(res, 400, { error: 'Name ist Pflicht' });
        if (istGesperrt(item)) return send(res, 403, { error: 'Dieser Anbieter steht auf der Sperrliste' });
        list.push(item);
        save(list);
        return send(res, 201, item);
      }
      const idx = list.findIndex((k) => k.id === id);
      if (idx === -1) return send(res, 404, { error: 'Nicht gefunden' });
      if (req.method === 'PUT') {
        const upd = clean(await readBody(req));
        if (!upd.name) return send(res, 400, { error: 'Name ist Pflicht' });
        if (istGesperrt(upd)) return send(res, 403, { error: 'Dieser Anbieter steht auf der Sperrliste' });
        list[idx] = { ...list[idx], ...upd, geaendert: new Date().toISOString() };
        save(list);
        return send(res, 200, list[idx]);
      }
      if (req.method === 'DELETE') {
        const [removed] = list.splice(idx, 1);
        save(list);
        return send(res, 200, removed);
      }
      return send(res, 405, { error: 'Methode nicht erlaubt' });
    } catch {
      return send(res, 400, { error: 'Ungültige Anfrage' });
    }
  }

  // Statische Dateien
  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

(async () => {
  einstellungenEinrichten();
  await auth.einrichten(DATA_DIR, { ...envDatei(), ...process.env });
  server.listen(PORT, HOST, () => console.log(`Parkingplan läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
  opensAbgleichen();
  setInterval(opensAbgleichen, SYNC_MS);
})();
