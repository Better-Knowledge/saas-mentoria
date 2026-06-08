// jobs/worker.js — worker da fila (pg-boss).
// Nesta fase do cutover ainda NÃO há jobs registrados (billing, WhatsApp e IA chegam nas próximas
// fases). O worker apenas mantém o processo vivo, sem tocar no banco, para o serviço de fila poder
// existir no compose sem falhar. Quando as filas forem implementadas, este arquivo inicializa o
// pg-boss e registra os handlers (whatsapp.ingest, ai.*, billing.*).
console.log('[worker] ocioso — nenhuma fila registrada nesta fase. Aguardando próximas fases.');
setInterval(() => {}, 1 << 30);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
