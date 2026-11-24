#!/usr/bin/env node
/**
 * Testa o SMTP do .env enviando uma mensagem de verdade.
 * Uso: node --env-file=.env scripts/testar-email.mjs voce@seudominio.com.br
 */
import { loadConfig } from '../gateway/src/config.js';
import { criarEmail } from '../gateway/src/email.js';

const para = process.argv[2];
if (!para || !para.includes('@')) { console.error('Uso: node --env-file=.env scripts/testar-email.mjs seu@email.com'); process.exit(2); }
const config = loadConfig({ AUTH_SECRET: 'x'.repeat(40), ...process.env });
const email = criarEmail(config);
if (!email.ativo) { console.error('SMTP_HOST está vazio no .env: o e-mail está desligado.'); process.exit(2); }
const s = config.smtp;
console.log(`Enviando de ${s.from} para ${para} via ${s.host}:${s.port}${s.secure ? ' (TLS direto)' : ''}...`);
try {
  await email.enviar({ para, assunto: `${config.appName}: teste de e-mail`, texto: `Se você recebeu esta mensagem, o envio de e-mail do ${config.appName} está funcionando.\n\nAgora cadastre uma conta de teste e veja se chega o link de confirmação.` });
  console.log('OK: o servidor SMTP aceitou a mensagem. Confira a caixa de entrada (e o spam).');
} catch (e) {
  console.error(`FALHOU: ${e.message}`);
  console.error('Dicas: confira host/porta/usuário/senha; no Gmail use "senha de app"; porta 465 exige SMTP_SECURE=true; remetente (SMTP_FROM) precisa ser autorizado pelo provedor.');
  process.exit(1);
}
