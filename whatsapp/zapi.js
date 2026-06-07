// whatsapp/zapi.js — adapter Z-API (stub). O provider inicial é a Evolution; este adapter fica
// pronto para ser completado quando uma org optar por Z-API. Assinaturas espelham evolution.js.
function naoImplementado() { const e = new Error('Provider Z-API ainda não implementado'); e.status = 501; throw e; }

module.exports = {
  async createInstance() { return naoImplementado(); },
  async getQrCode() { return naoImplementado(); },
  async getConnectionState() { return 'desconectado'; },
  async sendMessage() { return naoImplementado(); },
  async logout() { /* no-op */ },
  parseInbound() { return null; },
};
