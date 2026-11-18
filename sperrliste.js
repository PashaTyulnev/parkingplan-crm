// Harte Sperre: Treffer aus data/sperrliste.json dürfen nie in die Liste und nie eine Mail bekommen.
const fs = require('fs');
const path = require('path');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
const ziffern = (s) => String(s || '').replace(/\D/g, '');
const domain = (s) => String(s || '').toLowerCase().replace(/^.*@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

function istGesperrt(k) {
  const sperre = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'sperrliste.json'), 'utf8'));
  const inhalt = norm(`${k.name} ${k.notizen}`);
  const domains = [domain(k.email), domain(k.website)];
  const tel = ziffern(k.telefon);
  return sperre.firmen.some((f) => inhalt.includes(norm(f)))
    || sperre.namen.some((n) => norm(k.name) === norm(n))
    || sperre.domains.some((d) => domains.some((x) => x === d || x.endsWith('.' + d)))
    || sperre.telefon.some((t) => tel.length >= 8 && tel.endsWith(t));
}

module.exports = { istGesperrt };
