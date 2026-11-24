#!/usr/bin/env node
/**
 * Percorre o fluxo de cobrança no Asaas: cria cliente e assinatura de teste, lê a fatura e remove a assinatura.
 * Só roda com chave do SANDBOX ($aact_hmlg_), a não ser que você passe --producao (cria cobrança de verdade!).
 * Uso: node --env-file=.env scripts/testar-asaas.mjs [--producao]
 */
import { loadConfig } from '../gateway/src/config.js';
import { criarAsaas, ErroAsaas } from '../gateway/src/asaas.js';

const config = loadConfig({ AUTH_SECRET: 'x'.repeat(40), ...process.env });
const asaas = criarAsaas(config);
if (!asaas.ativo) { console.error('ASAAS_API_KEY está vazia no .env.'); process.exit(2); }
const sandbox = config.asaas.apiKey.startsWith('$aact_hmlg_');
if (!sandbox && !process.argv.includes('--producao')) { console.error('Esta chave não é do sandbox. Use a chave $aact_hmlg_ ou passe --producao (cria uma assinatura real).'); process.exit(2); }
console.log(`Ambiente: ${sandbox ? 'SANDBOX' : 'PRODUÇÃO'} (${config.asaas.url})`);
let ok = true;
const passo = async (nome, fn) => { try { const r = await fn(); console.log(`  ✓ ${nome}`); return r; } catch (e) { ok = false; console.log(`  ✗ ${nome}: ${e instanceof ErroAsaas ? e.message : e}`); return null; } };

const cliente = await passo('criar cliente (CPF de teste)', () => asaas.criarCliente({ nome: 'Cliente de Teste Nexo', cpfCnpj: '52998224725', email: 'teste@example.com', referencia: 'teste-integracao' }));
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const sub = cliente && await passo('criar assinatura mensal', () => asaas.criarAssinatura({ cliente: cliente.id, valor: config.precos.profissional, primeiroVencimento: hoje, descricao: 'Teste de integração', referencia: 'nexo:teste:profissional' }));
if (sub) {
  const cobrancas = await passo('ler a primeira fatura', async () => { const c = await asaas.cobrancas(sub.id); if (!c.length) throw new Error('nenhuma cobrança gerada ainda (tente de novo em instantes)'); return c; });
  if (cobrancas) console.log(`    Fatura: ${cobrancas[0].invoiceUrl}\n    No sandbox, abra o link, "pague" e confirme que o Asaas chama o webhook (o plano da conta de teste muda).`);
  await passo('remover a assinatura de teste', () => asaas.removerAssinatura(sub.id));
}
console.log(ok ? '\nTudo certo com a API. Falta conferir o webhook: cadastre no Asaas  ' + `${config.publicUrl}/webhooks/asaas  com o token de ASAAS_WEBHOOK_TOKEN.` : '\nHouve falhas: confira a chave e o ambiente (sandbox x produção).');
process.exit(ok ? 0 : 1);
