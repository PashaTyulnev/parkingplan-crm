// Notfall, falls das Passwort vergessen wurde. Muss direkt auf dem Server ausgeführt werden.
// Aufruf: node passwort-zuruecksetzen.js [benutzername]
// Setzt ein neues Zufallspasswort, gibt es einmal aus und meldet alle Sitzungen ab.
const path = require('path');
const crypto = require('crypto');
const auth = require('./auth');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

(async () => {
  const alt = auth.laden(DATA_DIR);
  const benutzer = (process.argv[2] || (alt && alt.benutzer) || 'admin').trim();
  const passwort = crypto.randomBytes(12).toString('base64url');
  await auth.passwortSetzen(DATA_DIR, benutzer, passwort);
  console.log(`Benutzer: ${benutzer}\nNeues Passwort: ${passwort}\nBitte nach dem Login unter „Einstellungen“ ändern.`);
})();
