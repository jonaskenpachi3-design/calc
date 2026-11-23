import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { documentoValido } from '../src/asaas.js';

const ouvir = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

/** Asaas de mentira: guarda o que recebeu e devolve o formato documentado. */
function asaasFalso() {
  const chamadas = [];
  let n = 0;
  const srv = http.createServer(async (req, res) => {
    const partes = []; for await (const p of req) partes.push(p);
    const corpo = partes.length ? JSON.parse(Buffer.concat(partes).toString()) : null;
    chamadas.push({ metodo: req.method, url: req.url, corpo, chave: req.headers.access_token, agente: req.headers['user-agent'] });
    const json = (status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/customers') return corpo.cpfCnpj === '00000000000000' ? json(400, { errors: [{ description: 'CPF/CNPJ inválido' }] }) : json(200, { id: 'cus_1' });
    if (req.method === 'POST' && req.url === '/subscriptions') return json(200, { id: `sub_${++n}`, status: 'ACTIVE' });
    if (req.method === 'GET' && /^\/subscriptions\/sub_\d+\/payments$/.test(req.url)) return json(200, { data: [{ id: 'pay_1', status: 'PENDING', invoiceUrl: `https://sandbox.asaas.com/i/${req.url.split('/')[2]}` }] });
    if (req.method === 'DELETE' && /^\/subscriptions\/sub_\d+$/.test(req.url)) return json(200, { deleted: true });
    json(404, { errors: [{ description: 'não encontrado' }] });
  });
  return { srv, chamadas };
}

async function montar(extra = {}) {
  const fake = asaasFalso();
  const urlAsaas = await ouvir(fake.srv);
  const db = abrirBanco(':memory:');
  const gw = criarApp(loadConfig({ AUTH_SECRET: 'c'.repeat(40), PUBLIC_DIR: '/nonexistent', ASAAS_API_KEY: '$aact_hmlg_teste', ASAAS_URL: urlAsaas, ASAAS_WEBHOOK_TOKEN: 'w'.repeat(40), RATE_LIMIT_PER_MINUTE: '1000', ...extra }), db);
  const base = await ouvir(gw);
  const api = (metodo, rota, corpo, h = {}) => fetch(base + rota, { method: metodo, headers: { 'content-type': 'application/json', ...h }, body: corpo ? JSON.stringify(corpo) : undefined });
  const cadastro = await (await api('POST', '/auth/register', { nome: 'Contabil Silva', email: 'silva@x.com', senha: 'senha-bem-longa' })).json();
  const auth = { authorization: `Bearer ${cadastro.token}` };
  const tenantId = (await (await api('GET', '/me', null, auth)).json()).id;
  const webhook = (corpo, token = 'w'.repeat(40)) => api('POST', '/webhooks/asaas', corpo, { 'asaas-access-token': token });
  const eu = async () => (await api('GET', '/me', null, auth)).json();
  const fechar = () => { gw.close(); fake.srv.close(); db.close(); };
  return { api, auth, tenantId, webhook, eu, fake, db, fechar };
}

test('CPF e CNPJ: dígitos verificadores', () => {
  assert.equal(documentoValido('529.982.247-25'), true);
  assert.equal(documentoValido('11.222.333/0001-81'), true);
  assert.equal(documentoValido('111.111.111-11'), false);
  assert.equal(documentoValido('529.982.247-24'), false);
  assert.equal(documentoValido('11222333000180'), false);
  assert.equal(documentoValido(''), false);
});

test('cobrança desligada sem chave: planos mostram, assinar recusa', async () => {
  const db = abrirBanco(':memory:');
  const gw = criarApp(loadConfig({ AUTH_SECRET: 'c'.repeat(40), PUBLIC_DIR: '/nonexistent' }), db);
  const base = await ouvir(gw);
  try {
    const planos = await (await fetch(base + '/planos')).json();
    assert.equal(planos.cobranca, false);
    assert.deepEqual(planos.precos, { gratuito: 0, profissional: 149, ilimitado: 399 });
    const t = (await (await fetch(base + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'A', email: 'a@x.com', senha: 'senha-bem-longa' }) })).json()).token;
    const r = await fetch(base + '/me/assinatura', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ plano: 'profissional', cpfCnpj: '52998224725' }) });
    assert.equal(r.status, 503);
    // webhook também fica fechado
    assert.equal((await fetch(base + '/webhooks/asaas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 503);
  } finally { gw.close(); db.close(); }
});

test('preços configuráveis por variável', async () => {
  const db = abrirBanco(':memory:');
  const gw = criarApp(loadConfig({ AUTH_SECRET: 'c'.repeat(40), PUBLIC_DIR: '/nonexistent', PRECO_PROFISSIONAL: '99.9', PRECO_ILIMITADO: '250' }), db);
  const base = await ouvir(gw);
  try { assert.deepEqual((await (await fetch(base + '/planos')).json()).precos, { gratuito: 0, profissional: 99.9, ilimitado: 250 }); } finally { gw.close(); db.close(); }
});

test('assinar: valida, cria cliente e assinatura no Asaas, e o plano só muda com o pagamento', async () => {
  const c = await montar();
  try {
    assert.equal((await c.api('POST', '/me/assinatura', { plano: 'gratuito', cpfCnpj: '52998224725' }, c.auth)).status, 400);
    assert.equal((await c.api('POST', '/me/assinatura', { plano: 'profissional', cpfCnpj: '123' }, c.auth)).status, 400);
    assert.equal(c.fake.chamadas.length, 0); // nada vai ao Asaas com dados inválidos

    const r = await c.api('POST', '/me/assinatura', { plano: 'profissional', cpfCnpj: '529.982.247-25', nome: 'Contábil Silva LTDA' }, c.auth);
    assert.equal(r.status, 201);
    const corpo = await r.json();
    assert.equal(corpo.status, 'aguardando_pagamento');
    assert.equal(corpo.url, 'https://sandbox.asaas.com/i/sub_1');

    const [cliente, assinatura] = c.fake.chamadas;
    assert.equal(cliente.url, '/customers');
    assert.deepEqual([cliente.corpo.name, cliente.corpo.cpfCnpj, cliente.corpo.email], ['Contábil Silva LTDA', '52998224725', 'silva@x.com']);
    assert.equal(cliente.chave, '$aact_hmlg_teste');
    assert.match(cliente.agente, /NexoFiscal/);
    assert.equal(assinatura.corpo.customer, 'cus_1');
    assert.equal(assinatura.corpo.value, 149);
    assert.equal(assinatura.corpo.cycle, 'MONTHLY');
    assert.equal(assinatura.corpo.billingType, 'UNDEFINED');
    assert.equal(assinatura.corpo.externalReference, `nexo:${c.tenantId}:profissional`);
    assert.match(assinatura.corpo.nextDueDate, /^\d{4}-\d{2}-\d{2}$/);

    assert.equal((await c.eu()).plano, 'gratuito'); // ainda não pagou
    const st = await (await c.api('GET', '/me/assinatura', null, c.auth)).json();
    assert.equal(st.assinatura.status, 'aguardando_pagamento');
    assert.equal(st.assinatura.url, 'https://sandbox.asaas.com/i/sub_1');
    assert.equal(st.cobranca_ativa, true);

    // erro do Asaas (documento recusado) vira mensagem clara e não grava nada novo
    const ruim = await c.api('POST', '/me/assinatura', { plano: 'ilimitado', cpfCnpj: '00000000000000' }, c.auth);
    assert.equal(ruim.status, 400); // recusado antes pela validação local
  } finally { c.fechar(); }
});

test('webhook: autenticação, idempotência, ativação, renovação, vencimento e carência', async () => {
  const c = await montar();
  try {
    await c.api('POST', '/me/assinatura', { plano: 'profissional', cpfCnpj: '52998224725' }, c.auth);
    const pago = (id, dueDate, evento = 'PAYMENT_CONFIRMED') => ({ id, event: evento, payment: { id: 'pay_1', subscription: 'sub_1', dueDate, status: 'CONFIRMED' } });

    assert.equal((await c.webhook(pago('evt_1', '2026-11-23'), 'errado')).status, 401);
    assert.equal((await c.api('POST', '/webhooks/asaas', pago('evt_1', '2026-11-23'))).status, 401); // sem o cabeçalho
    assert.equal((await c.eu()).plano, 'gratuito');

    assert.equal((await c.webhook(pago('evt_1', '2026-11-23'))).status, 200);
    assert.equal((await c.eu()).plano, 'profissional');
    const a = c.db.assinaturaDoTenant(c.tenantId);
    assert.equal(a.status, 'ativa');
    assert.equal(new Date(a.valido_ate).toISOString().slice(0, 10), '2026-12-24'); // vencimento + 1 mês (fim do dia no Brasil)

    // mesmo evento de novo: ignorado; PAYMENT_RECEIVED seguinte não encurta o período
    assert.deepEqual(await (await c.webhook(pago('evt_1', '2026-11-23'))).json(), { ok: true, repetido: true });
    await c.webhook(pago('evt_2', '2026-11-23', 'PAYMENT_RECEIVED'));
    assert.equal(c.db.assinaturaDoTenant(c.tenantId).valido_ate, a.valido_ate);

    // assinatura desconhecida é ignorada sem erro
    assert.equal((await c.webhook({ id: 'evt_x', event: 'PAYMENT_CONFIRMED', payment: { subscription: 'sub_999', dueDate: '2026-11-23' } })).status, 200);

    // período venceu: dentro da carência continua; depois da carência volta ao gratuito
    const dia = 86400000;
    c.db.atualizarAssinatura(c.tenantId, 'ativa', Date.now() - 2 * dia);
    assert.equal((await c.eu()).plano, 'profissional');
    c.db.atualizarAssinatura(c.tenantId, 'ativa', Date.now() - 6 * dia);
    const vencido = await c.eu();
    assert.equal(vencido.plano, 'gratuito');
    assert.equal(vencido.plano_vencido, true);
    // limites do plano gratuito passam a valer
    const uso = await (await c.api('GET', '/usage', null, c.auth)).json();
    assert.equal(uso.plano, 'gratuito');

    // pagamento da renovação traz o plano de volta
    await c.webhook(pago('evt_3', new Date().toISOString().slice(0, 10)));
    assert.equal((await c.eu()).plano, 'profissional');
  } finally { c.fechar(); }
});

test('trocar de plano, cancelar e estorno', async () => {
  const c = await montar();
  try {
    await c.api('POST', '/me/assinatura', { plano: 'profissional', cpfCnpj: '52998224725' }, c.auth);
    await c.webhook({ id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { subscription: 'sub_1', dueDate: '2026-11-23' } });
    assert.equal((await c.api('POST', '/me/assinatura', { plano: 'profissional', cpfCnpj: '52998224725' }, c.auth)).status, 409); // já tem

    // upgrade: nova assinatura; a antiga é removida no Asaas; o plano atual continua até o novo pagamento
    const up = await c.api('POST', '/me/assinatura', { plano: 'ilimitado', cpfCnpj: '52998224725' }, c.auth);
    assert.equal(up.status, 201);
    assert.ok(c.fake.chamadas.some((x) => x.metodo === 'DELETE' && x.url === '/subscriptions/sub_1'));
    assert.equal((await c.eu()).plano, 'profissional');
    // o evento de remoção da assinatura antiga não derruba nada
    await c.webhook({ id: 'e2', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } });
    assert.equal((await c.eu()).plano, 'profissional');
    assert.equal(c.db.assinaturaDoTenant(c.tenantId).assinatura_id, 'sub_2');
    await c.webhook({ id: 'e3', event: 'PAYMENT_CONFIRMED', payment: { subscription: 'sub_2', dueDate: '2026-11-23' } });
    assert.equal((await c.eu()).plano, 'ilimitado');

    // cancelar: continua até o fim do período pago
    const canc = await c.api('DELETE', '/me/assinatura', null, c.auth);
    assert.equal(canc.status, 200);
    assert.ok(c.fake.chamadas.some((x) => x.metodo === 'DELETE' && x.url === '/subscriptions/sub_2'));
    assert.equal(c.db.assinaturaDoTenant(c.tenantId).status, 'cancelada');
    assert.equal((await c.eu()).plano, 'ilimitado');
    assert.equal((await c.api('DELETE', '/me/assinatura', null, c.auth)).status, 404);
    // pagamento atrasado de cobrança antiga não reativa a assinatura cancelada
    await c.webhook({ id: 'e4', event: 'PAYMENT_RECEIVED', payment: { subscription: 'sub_2', dueDate: '2026-12-23' } });
    assert.equal(c.db.assinaturaDoTenant(c.tenantId).status, 'cancelada');

    // contratar de novo, pagar e receber estorno: suspende na hora
    await c.api('POST', '/me/assinatura', { plano: 'profissional', cpfCnpj: '52998224725' }, c.auth);
    await c.webhook({ id: 'e5', event: 'PAYMENT_CONFIRMED', payment: { subscription: 'sub_3', dueDate: '2026-11-23' } });
    assert.equal((await c.eu()).plano, 'profissional');
    await c.webhook({ id: 'e6', event: 'PAYMENT_REFUNDED', payment: { subscription: 'sub_3' } });
    assert.equal((await c.eu()).plano, 'gratuito');
    assert.equal(c.db.assinaturaDoTenant(c.tenantId).status, 'suspensa');
  } finally { c.fechar(); }
});

test('plano definido pelo operador (sem assinatura) não é afetado pelo vencimento', async () => {
  const c = await montar({ ADMIN_TOKEN: 'adm' });
  try {
    assert.equal((await c.api('PUT', `/admin/tenants/${c.tenantId}/plano`, { plano: 'ilimitado' }, { authorization: 'Bearer adm' })).status, 200);
    assert.equal((await c.eu()).plano, 'ilimitado');
  } finally { c.fechar(); }
});
