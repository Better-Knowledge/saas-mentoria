// whatsapp/provider.js — seleção do adapter de provider. Cada org traz a sua credencial (base_url +
// api_key) numa `conn`; o adapter opera SEMPRE contra a credencial da org (isolamento por org).
//
// Forma normalizada de uma mensagem (independe do provider):
//   { provider_msg_id, direcao:'entrada'|'saida', remetente, destinatario, conteudo, metadata }
const evolution = require('./evolution');
const zapi = require('./zapi');

function adapterFor(provider) {
  return provider === 'zapi' ? zapi : evolution; // default: Evolution
}

module.exports = { adapterFor };
