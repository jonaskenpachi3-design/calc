import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';

let upstream, gateway, base, upBase, db;
const chamadas = [];

const ouvir = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
  // Serviço oficial falso: registra o que o gateway encaminha.
  upstream = http.createServer(async (req, res) => {
    const partes = [];
    for await (const p of req) partes.push(p);
    chamadas.push({ metodo: req.method, url: req.url, corpo: Buffer.concat(partes).toString() });
    if (req.url.startsWith('/api/danfse')) {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return res.end('%PDF-fake');
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-versao-calculadora': '9.9.9' });
    res.end(JSON.stringify({ ok: true }));
  });
  upBase = await ouvir(upstream);

  db = abrirBanco(':memory:');
  const config = {
    ...loadConfig({ AUTH_SECRET: 'x'.repeat(40), ADMIN_TOKEN: 'adm', RATE_LIMIT_PER_MINUTE: '1000', PUBLIC_DIR: '/nonexistent' }),
    upstream: { regimeRegular: upBase, simplesNacional: upBase, danfse: upBase, timeoutMs: 2000 },
  };
  gateway = criarApp(config, db);
  base = await ouvir(gateway);
});

after(() => { gateway.close(); upstream.close(); db.close(); });

const post = (rota, corpo, headers = {}) =>
  fetch(base + rota, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });

async function cadastrar(email = 'a@b.com') {
  const r = await post('/auth/register', { nome: 'Acme', email, senha: 'senha-bem-longa' });
  assert.equal(r.status, 201);
  return (await r.json()).token;
}

test('rotas fiscais exigem credencial', async () => {
  const r = await post('/v1/calculo', { regime: 'regular', operacao: {} });
  assert.equal(r.status, 401);
});

test('cadastro, login e senha curta', async () => {
  assert.equal((await post('/auth/register', { nome: 'X', email: 'x@y.com', senha: 'curta' })).status, 400);
  await cadastrar('login@b.com');
  assert.equal((await post('/auth/register', { nome: 'X', email: 'login@b.com', senha: 'senha-bem-longa' })).status, 409);
  assert.equal((await post('/auth/login', { email: 'login@b.com', senha: 'errada-errada' })).status, 401);
  assert.equal((await post('/auth/login', { email: 'login@b.com', senha: 'senha-bem-longa' })).status, 200);
});

test('chave de API: criada uma vez, calcula nos dois regimes, e revogação funciona', async () => {
  const sessao = await cadastrar('chave@b.com');
  const k = await (await post('/keys', { nome: 'erp' }, { authorization: `Bearer ${sessao}` })).json();
  assert.match(k.chave, /^rtc_/);
  const auth = { authorization: `Bearer ${k.chave}` };

  chamadas.length = 0;
  const r1 = await post('/v1/calculo', { regime: 'regular', operacao: { id: 'o1' } }, auth);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('x-versao-calculadora'), '9.9.9');
  assert.equal(chamadas.at(-1).url, '/api/calculadora/observabilidade/regime-geral');

  await post('/v1/calculo', { regime: 'simples', operacao: { id: 'o2' } }, auth);
  assert.equal(chamadas.at(-1).url, '/api/calculadora/observabilidade/simples-nacional/nao-assistido');

  assert.equal((await post('/v1/calculo', { regime: 'outro', operacao: {} }, auth)).status, 400);

  // chave de API não gerencia chaves
  assert.equal((await fetch(base + '/keys', { headers: auth })).status, 403);

  const lista = await (await fetch(base + '/keys', { headers: { authorization: `Bearer ${sessao}` } })).json();
  assert.equal((await fetch(`${base}/keys/${lista.chaves[0].id}`, { method: 'DELETE', headers: { authorization: `Bearer ${sessao}` } })).status, 200);
  assert.equal((await post('/v1/calculo', { regime: 'regular', operacao: {} }, auth)).status, 401);
});

test('DANFSe devolve PDF, valida parâmetros e não grava o XML', async () => {
  const t = await cadastrar('pdf@b.com');
  const auth = { authorization: `Bearer ${t}`, 'content-type': 'application/xml' };
  chamadas.length = 0;
  const r = await fetch(base + '/v1/danfse?stc=2&canhoto=false', { method: 'POST', headers: auth, body: '<nfse/>' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(chamadas.at(-1).url, '/api/danfse?stc=2&canhoto=false');
  assert.equal((await fetch(base + '/v1/danfse?stc=9', { method: 'POST', headers: auth, body: '<a/>' })).status, 400);
  const hist = await (await fetch(base + '/history', { headers: { authorization: `Bearer ${t}` } })).json();
  assert.ok(hist.eventos.every((e) => e.payload === null));
});

test('cota do plano gratuito bloqueia com 402 e o plano admin libera', async () => {
  const t = await cadastrar('cota@b.com');
  const auth = { authorization: `Bearer ${t}` };
  const { tenantId } = { tenantId: db.usuarioPorEmail('cota@b.com').tenant_id };
  for (let i = 0; i < 50; i++) db.registrarUso({ tenantId, recurso: 'danfse', servico: 'danfse', status: 200, duracaoMs: 1 });
  const r = await fetch(base + '/v1/danfse', { method: 'POST', headers: { ...auth, 'content-type': 'application/xml' }, body: '<a/>' });
  assert.equal(r.status, 402);

  const sem = await fetch(`${base}/admin/tenants/${tenantId}/plano`, { method: 'PUT', body: JSON.stringify({ plano: 'ilimitado' }), headers: { authorization: 'Bearer errado' } });
  assert.equal(sem.status, 403);
  const com = await fetch(`${base}/admin/tenants/${tenantId}/plano`, { method: 'PUT', body: JSON.stringify({ plano: 'ilimitado' }), headers: { authorization: 'Bearer adm' } });
  assert.equal(com.status, 200);
  const r2 = await fetch(base + '/v1/danfse', { method: 'POST', headers: { ...auth, 'content-type': 'application/xml' }, body: '<a/>' });
  assert.equal(r2.status, 200);
});

test('tabelas: só caminhos permitidos; serviço fora do ar vira 502', async () => {
  const t = await cadastrar('tab@b.com');
  const auth = { authorization: `Bearer ${t}` };
  chamadas.length = 0;
  assert.equal((await fetch(base + '/v1/tabelas/ncm?ncm=2203', { headers: auth })).status, 200);
  assert.equal(chamadas.at(-1).url, '/api/calculadora/dados-abertos/ncm?ncm=2203');
  assert.equal((await fetch(base + '/v1/tabelas/../../etc', { headers: auth })).status, 404);
  assert.equal((await fetch(base + '/v1/tabelas/admin', { headers: auth })).status, 404);
});

test('busca por nome e conferência de cadastro: endpoints liberados e encaminhados', async () => {
  const t = await cadastrar('busca@b.com');
  const auth = { authorization: `Bearer ${t}` };
  const casos = [
    ['/v1/dados/ncm/vigentes?data=2027-03-10', '/api/calculadora/dados-abertos/ncm/vigentes?data=2027-03-10'],
    ['/v1/dados/nbs/lista?data=2027-03-10', '/api/calculadora/dados-abertos/nbs/lista?data=2027-03-10'],
    ['/v1/dados/classificacoes-tributarias/ncm-aplicavel?cClassTrib=000001&ncm=02013000&dataOcorrenciaFatoGerador=2027-03-10', '/api/calculadora/dados-abertos/classificacoes-tributarias/ncm-aplicavel?cClassTrib=000001&ncm=02013000&dataOcorrenciaFatoGerador=2027-03-10'],
    ['/v1/dados/classificacoes-tributarias/nbs-aplicavel?cClassTrib=200028&nbs=122011200&dataOcorrenciaFatoGerador=2027-03-10', '/api/calculadora/dados-abertos/classificacoes-tributarias/nbs-aplicavel?cClassTrib=200028&nbs=122011200&dataOcorrenciaFatoGerador=2027-03-10'],
    ['/v1/dados/classificacoes-tributarias/nbs?nbs=122011200&data=2027-03-10', '/api/calculadora/dados-abertos/classificacoes-tributarias/nbs?nbs=122011200&data=2027-03-10'],
  ];
  for (const [rota, destino] of casos) {
    chamadas.length = 0;
    assert.equal((await fetch(base + rota, { headers: auth })).status, 200, rota);
    assert.equal(chamadas.at(-1).url, destino);
  }
  assert.equal((await fetch(base + '/v1/dados/classificacoes-tributarias/outra', { headers: auth })).status, 404);
});

const CNPJ_A = '11222333000181';
const novaEmpresa = (auth, cnpj = CNPJ_A) => post('/empresas', { cnpj, razao_social: 'Empresa Teste', regime_atual: 'lucro-presumido' }, auth);

test('análises: só totais, validação, dashboard real e vazio sem inventar números', async () => {
  const t = await cadastrar('dash@b.com');
  const auth = { authorization: `Bearer ${t}` };
  assert.equal((await novaEmpresa(auth)).status, 201);
  const vazio = await (await fetch(`${base}/empresas/${CNPJ_A}/dashboard`, { headers: auth })).json();
  assert.equal(vazio.vazio, true);
  assert.equal(vazio.faturamentoAnalisado.valor, 0);
  assert.equal(vazio.diferenca.valor, null);

  const ok = { origem: 'lote', regime: 'regime-normal', documentos: 10, itens: 12, itensComProblema: 2, base: 1000, cbs: 90, ibs: 10, total: 100, tributosAtuais: 80, cbsIbsComparavel: 100 };
  assert.equal((await post(`/empresas/${CNPJ_A}/analises`, ok, auth)).status, 201);
  assert.equal((await post(`/empresas/${CNPJ_A}/analises`, { ...ok, base: -1 }, auth)).status, 400);
  assert.equal((await post(`/empresas/${CNPJ_A}/analises`, { ...ok, origem: 'x' }, auth)).status, 400);
  assert.equal((await post(`/empresas/11222333000182/analises`, ok, auth)).status, 404);

  const d = await (await fetch(`${base}/empresas/${CNPJ_A}/dashboard`, { headers: auth })).json();
  assert.equal(d.vazio, false);
  assert.equal(d.faturamentoAnalisado.valor, 1000);
  assert.equal(d.faturamentoAnalisado.qtdNotas, 10);
  assert.equal(d.cargaAtual.valor, 80);
  assert.equal(d.projecaoReforma.valor, 100);
  assert.equal(d.diferenca.valor, 20);
  assert.equal(d.diferenca.tipo, 'aumento');
  assert.equal(d.alertas[0].qtd, 2);
  assert.equal(d.grafico.labels.length, 6);
});

test('empresas: isoladas entre escritórios e limitadas pelo plano', async () => {
  const t1 = await cadastrar('iso1@b.com');
  const t2 = await cadastrar('iso2@b.com');
  const a1 = { authorization: `Bearer ${t1}` }; const a2 = { authorization: `Bearer ${t2}` };
  assert.equal((await novaEmpresa(a1)).status, 201);
  assert.equal((await novaEmpresa(a2)).status, 201, 'mesmo CNPJ em outro escritório não pode colidir');
  assert.equal((await fetch(`${base}/empresas/${CNPJ_A}/dashboard`, { headers: a2 })).status, 200);
  assert.equal((await novaEmpresa(a1, '11444777000161')).status, 201);
  const estouro = await novaEmpresa(a1, '07526557000100');
  assert.equal(estouro.status, 403);
  assert.equal((await estouro.json()).erro?.codigo ?? (await estouro.clone().json()).codigo, 'limite_empresas');
});

test('dados do escritório: grava com login, recusa chave de API e logotipo inválido', async () => {
  const t = await cadastrar('esc@b.com');
  const auth = { authorization: `Bearer ${t}` };
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const r = await fetch(base + '/me/escritorio', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Contab X', crc: 'CRC-SP 1', cor: '#112233', logo: png }) });
  assert.equal(r.status, 200);
  assert.equal((await (await fetch(base + '/me/escritorio', { headers: auth })).json()).nome, 'Contab X');
  const ruim = await fetch(base + '/me/escritorio', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ logo: 'data:text/html;base64,AAAA' }) });
  assert.equal(ruim.status, 400);
  const k = await (await post('/keys', { nome: 'x' }, auth)).json();
  const viaChave = await fetch(base + '/me/escritorio', { method: 'PUT', headers: { authorization: `Bearer ${k.chave}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(viaChave.status, 403);
});
