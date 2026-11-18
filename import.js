// Übernimmt neue Einträge aus data/recherche.json in data/kunden.json.
// Bestehende Einträge (gleicher Name) bleiben unverändert, damit Status und Notizen erhalten bleiben.
// Aufruf: node import.js   (am besten bei gestopptem Server)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { istGesperrt } = require('./sperrliste');

const dir = path.join(__dirname, 'data');
const kundenFile = path.join(dir, 'kunden.json');
const recherche = JSON.parse(fs.readFileSync(path.join(dir, 'recherche.json'), 'utf8'));
const kunden = fs.existsSync(kundenFile) ? JSON.parse(fs.readFileSync(kundenFile, 'utf8')) : [];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
const vorhanden = new Set(kunden.map((k) => norm(k.name)));
let neu = 0;
for (const r of recherche) {
  if (vorhanden.has(norm(r.name)) || istGesperrt(r)) continue;
  kunden.push({ id: crypto.randomUUID(), status: 'Neu', ...r, erstellt: new Date().toISOString() });
  vorhanden.add(norm(r.name));
  neu++;
}
fs.writeFileSync(kundenFile, JSON.stringify(kunden, null, 2), 'utf8');
console.log(`${neu} neue Einträge übernommen, insgesamt ${kunden.length}.`);
