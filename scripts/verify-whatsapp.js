// scripts/verify-whatsapp.js — lógica determinística do WhatsApp (sem rede/DB):
// cifragem de credenciais por org + normalização do inbound da Evolution + seleção de adapter.
// O fluxo real (conectar/QR/ingestão) é validado em produção (Evolution da org + leitura do QR).
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
const secrets = require('../lib/secrets');
const evolution = require('../whatsapp/evolution');
const { adapterFor } = require('../whatsapp/provider');

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', m); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', m); } };

console.log('\n[1] Cifragem de credenciais por org (AES-256-GCM)');
const segredo = 'evolution-api-key-da-org-XYZ';
const enc = secrets.encrypt(segredo);
check(typeof enc === 'string' && enc !== segredo, 'encrypt produz ciphertext (≠ texto puro)');
check(secrets.decrypt(enc) === segredo, 'decrypt recupera o segredo original');
check(secrets.encrypt(null) === null && secrets.decrypt(null) === null, 'null → null');

console.log('\n[2] Normalização do inbound da Evolution');
const m = evolution.parseInbound({
  event: 'messages.upsert', instance: 'org-x',
  data: { key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'MSGID1' },
          pushName: 'Maria', message: { conversation: 'Olá, tenho interesse' }, messageTimestamp: 123 },
});
check(m && m.provider_msg_id === 'MSGID1' && m.direcao === 'entrada' && m.remetente === '5511999998888'
  && m.conteudo === 'Olá, tenho interesse', 'mensagem de entrada normalizada');
check(evolution.parseInbound({ data: { key: { remoteJid: '123@g.us', id: 'X' }, message: { conversation: 'oi' } } }) === null,
  'mensagem de grupo (@g.us) é ignorada');
const m2 = evolution.parseInbound({ data: { key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'M2' }, message: { extendedTextMessage: { text: 'resposta' } } } });
check(m2 && m2.conteudo === 'resposta', 'extendedTextMessage extraído');

console.log('\n[3] Seleção de adapter');
check(adapterFor('evolution') === evolution, 'adapterFor("evolution") → Evolution');
check(typeof adapterFor('zapi').sendMessage === 'function', 'adapterFor("zapi") → stub Z-API');

console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`);
process.exit(fail ? 1 : 0);
