#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');

const SALT = 'zsf-2026-salt-v1';
const TOKENS_FILE = 'tokens.json';

function hmacToken(token) {
  return crypto.createHmac('sha256', SALT).update(token).digest('hex');
}

function genToken() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let t = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) t += alphabet[bytes[i] % alphabet.length];
  return t;
}

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch (e) {
    return { users: [] };
  }
}

function saveTokens(data) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2) + '\n');
}

const cmd = process.argv[2];
const arg = process.argv[3];

if (cmd === 'add' && arg) {
  const data = loadTokens();
  const username = arg.trim().toLowerCase();
  if (data.users.find(u => u.username === username)) {
    console.error('Korisnik "' + username + '" vec postoji. Koristi "regen" za novi token.');
    process.exit(1);
  }
  const token = genToken();
  data.users.push({ username: username, hash: hmacToken(token), revoked: false });
  saveTokens(data);
  console.log('Dodat korisnik:  ' + username);
  console.log('TOKEN (posalji privatno korisniku): ' + token);
  console.log('Sacuvano u ' + TOKENS_FILE + '. Commit i push.');
} else if (cmd === 'regen' && arg) {
  const data = loadTokens();
  const username = arg.trim().toLowerCase();
  const user = data.users.find(u => u.username === username);
  if (!user) { console.error('Korisnik nije pronadjen: ' + username); process.exit(1); }
  const token = genToken();
  user.hash = hmacToken(token);
  user.revoked = false;
  saveTokens(data);
  console.log('Novi token za: ' + username);
  console.log('TOKEN (posalji privatno): ' + token);
} else if (cmd === 'revoke' && arg) {
  const data = loadTokens();
  const username = arg.trim().toLowerCase();
  const user = data.users.find(u => u.username === username);
  if (!user) { console.error('Korisnik nije pronadjen: ' + username); process.exit(1); }
  user.revoked = true;
  saveTokens(data);
  console.log('Revokovan: ' + username + '. Commit i push.');
} else if (cmd === 'unrevoke' && arg) {
  const data = loadTokens();
  const username = arg.trim().toLowerCase();
  const user = data.users.find(u => u.username === username);
  if (!user) { console.error('Korisnik nije pronadjen: ' + username); process.exit(1); }
  user.revoked = false;
  saveTokens(data);
  console.log('Vracen pristup: ' + username + '. Commit i push.');
} else if (cmd === 'list') {
  const data = loadTokens();
  if (!data.users.length) { console.log('Nema korisnika.'); }
  data.users.forEach(u => console.log((u.revoked ? '[REVOKED] ' : '[aktivan] ') + u.username));
} else {
  console.log('ZSF token alat\n');
  console.log('Upotreba:');
  console.log('  node zsf-token-tool.js add <username>       - dodaje korisnika, generise token');
  console.log('  node zsf-token-tool.js regen <username>     - novi token za postojeceg');
  console.log('  node zsf-token-tool.js revoke <username>    - blokira pristup');
  console.log('  node zsf-token-tool.js unrevoke <username>  - vraca pristup');
  console.log('  node zsf-token-tool.js list                 - lista korisnika');
  console.log('\nPokreni iz root-a zsf-config repo-a (gde je tokens.json).');
}
