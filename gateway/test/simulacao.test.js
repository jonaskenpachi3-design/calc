import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  montarRegimeNormal, traduzirRegimeNormal, montarSimples, traduzirSimples,
  mensagemDeErroOficial, EntradaInvalida,
} from '../src/simulacao.js';
import { loadConfig } from '../src/config.js';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';

// Resposta de exemplo copiada da documentação oficial (docs/exemplos.md do regime regular).
const RESPOSTA_OFICIAL = {
  objetos: [
    { nObj: 1, estadoItem: 'CALCULO_SIMULADO', tribCalc: { IBSCBS: { gIBSCBS: { vBC: '1200.00',
      gIBSUF: { pIBSUF: '0.05', vIBSUF: '0.24' }, gIBSMun: { pIBSMun: '0.05', vIBSMun: '0.24' }, vIBS: '0.48',
      gCBS: { pCBS: '8.80', gRed: { pRedAliq: '60.00', pAliqEfet: '3.52' }, vCBS: '42.24' } } } } },
    { nObj: 2, estadoItem: 'INCONSISTENCIA_ENTRADA', erros: [{ code: 'REG-011', title: 'NCM não vinculada',
      pointer: '#/itens/1/ncm', detail: 'NCM de código 02013000 não vinculada à Classificação Tributária de código 200035' }] },
  ],
  total: { tribCalc: { IBSCBSTot: { vBCIBSCBS: '1200.00', gIBS: { vIBS: '0.48' }, gCBS: { vCBS: '42.24' } } } },
};

const formulario = () => ({
  data: '2027-03-10', uf: 'RS', municipio: '4314902',
  itens: [
    { descricao: 'Mensalidade', tipo: 'servico', codigo: '122011200', classificacao: '200028', valor: '1.200,00'.replace('.', '') },
    { descricao: 'Carne', tipo: 'produto', codigo: '02013000', classificacao: '200035', valor: 80 },
  ],
});

test('regime normal: monta o contrato oficial com CST derivado e alíquotas a partir de 2027', () => {
  const op = montarRegimeNormal({ ...formulario(), itens: [{ tipo: 'servico', codigo: '122011200', classificacao: '200028', valor: 1200 }] });
  assert.equal(op.dhFatoGerador, '2027-03-10T12:00:00-03:00');
  assert.equal(op.municipio, 4314902);
  assert.equal(op.uf, 'RS');
  assert.match(op.id, /^[0-9a-f]{32}$/);
  assert.deepEqual(op.itens[0], {
    numero: 1, nbs: '122011200', cst: '200', cClassTrib: '200028', baseCalculo: 1200,
    aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 },
  });
});

test('regime normal: antes de 2027 as alíquotas nominais NÃO são enviadas (a calculadora as proíbe)', () => {
  const op = montarRegimeNormal({ ...formulario(), data: '2026-06-01' });
  assert.ok(op.itens.every((i) => !('aliquotasNominais' in i)));
});

test('regime normal: mensagens de validação em português', () => {
  const f = formulario();
  assert.throws(() => montarRegimeNormal({ ...f, uf: '' }), /Escolha o estado/);
  assert.throws(() => montarRegimeNormal({ ...f, municipio: '12' }), /Escolha o município/);
  assert.throws(() => montarRegimeNormal({ ...f, itens: [] }), /ao menos um item/);
  assert.throws(() => montarRegimeNormal({ ...f, itens: [{ ...f.itens[0], codigo: '123' }] }), /NBS do serviço tem 9/);
  assert.throws(() => montarRegimeNormal({ ...f, itens: [{ ...f.itens[0], classificacao: '' }] }), /classificação/);
  assert.throws(() => montarRegimeNormal({ ...f, itens: [{ ...f.itens[0], valor: 0 }] }), /maior que zero/);
  assert.throws(() => montarRegimeNormal({ ...f, data: 'ontem' }), EntradaInvalida);
});

test('regime normal: traduz a resposta oficial (item calculado, item com erro, totais)', () => {
  const r = traduzirRegimeNormal(RESPOSTA_OFICIAL, formulario());
  assert.equal(r.itens[0].descricao, 'Mensalidade');
  assert.equal(r.itens[0].situacao, 'calculado');
  assert.equal(r.itens[0].cbs, 42.24);
  assert.equal(r.itens[0].ibs, 0.48);
  assert.equal(r.itens[0].total, 42.72);
  assert.equal(r.itens[0].reducaoPercentual, 60);
  assert.equal(r.itens[1].situacao, 'erro');
  assert.equal(r.itens[1].total, null);
  assert.match(r.itens[1].mensagens[0], /NCM não vinculada: NCM de código 02013000/);
  assert.deepEqual(r.totais, { base: 1200, cbs: 42.24, ibs: 0.48, impostoSeletivo: 0, total: 42.72 });
  assert.equal(r.avisos.length, 2);
});

test('regime normal: resposta vazia ou inesperada não derruba a tradução', () => {
  assert.deepEqual(traduzirRegimeNormal({}, formulario()).itens, []);
  assert.deepEqual(traduzirRegimeNormal(null, null).itens, []);
});

test('Simples: monta NF-e (CRT 1) com a alíquota efetiva no anexo escolhido', () => {
  const op = montarSimples({
    data: '2027-03-15', documento: 'nfe',
    aliquotas: { anexo: 'I', cbs: '1,1612', ibs: '0.0129' },
    itens: [{ tipo: 'produto', codigo: '22030000', atividade: '1', classificacao: '000001', valor: 10000 }],
  });
  assert.equal(op.tpDoc, '55');
  assert.equal(op.CRT, '1');
  assert.deepEqual(op.aliquotasEfetivas, { impedimentoSublimite: false, anexoI: { pCBSSN: '1.1612', pIBSSN: '0.0129' } });
  assert.deepEqual(op.itens[0], {
    numero: 1, cAtivSN: '01', cClassTrib: '000001', ncm: '22030000', baseCalculo: '10000.00', valorImpostoSeletivo: '0.00',
  });
});

test('Simples: NFS-e usa opSimpNac/regAp, um item só, e informa ISS nas atividades com ISS', () => {
  const base = {
    data: '2027-03-15', documento: 'nfse', aliquotas: { anexo: 'III', cbs: 2, ibs: 0.03, fatorR: false },
    itens: [{ tipo: 'servico', codigo: '114051000', atividade: '12', classificacao: '000001', valor: 500 }],
  };
  const op = montarSimples(base);
  assert.equal(op.tpDoc, '91');
  assert.equal(op.opSimpNac, '3');
  assert.ok(!('CRT' in op));
  assert.equal(op.itens[0].tribISSQN, '1');
  assert.equal(op.itens[0].tpRetISSQN, '1');
  assert.ok(!('valorImpostoSeletivo' in op.itens[0]));
  assert.equal(op.aliquotasEfetivas.fatorR, false);
  assert.throws(() => montarSimples({ ...base, itens: [base.itens[0], base.itens[0]] }), /um item por simulação/);
});

test('Simples: traduz o resultado', () => {
  const r = traduzirSimples({
    objetos: [{ nObj: 1, estadoItem: 'CALCULADO', tribCalc: { vBC: '10000.00', pCBSSN: '1.1612', vCBSSN: '116.12', pIBSSN: '0.0129', vIBSSN: '1.29', totalItem: '117.41', tpRBSNDescricao: 'Receita sujeita ao Simples' } }],
    total: { vBC: '10000.00', vCBSSNtot: '116.12', vIBSSNtot: '1.29', totalTributos: '117.41' },
    resolucaoAliquotas: { avisos: ['aviso de teste'] },
  }, { itens: [{ descricao: 'Cerveja' }] });
  assert.equal(r.itens[0].descricao, 'Cerveja');
  assert.equal(r.itens[0].cbs, 116.12);
  assert.equal(r.totais.total, 117.41);
  assert.deepEqual(r.avisos, ['aviso de teste']);
});

test('erro oficial vira frase', () => {
  const corpo = Buffer.from(JSON.stringify({ title: 'Erro', erros: [{ title: 'NCM', detail: 'NCM inválida' }] }));
  assert.equal(mensagemDeErroOficial(corpo), 'NCM inválida');
  assert.equal(mensagemDeErroOficial(Buffer.from('não é json')), null);
});

// ---- integração: gateway -> calculadora falsa ----
let upstream, gateway, base, db;
const recebidos = [];
const ouvir = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const partes = []; for await (const p of req) partes.push(p);
    recebidos.push({ url: req.url, corpo: Buffer.concat(partes).toString() });
    if (req.url.endsWith('/regime-geral')) {
      res.writeHead(200, { 'content-type': 'application/json', 'x-warning-dados-simulados': 'sim' });
      return res.end(JSON.stringify(RESPOSTA_OFICIAL));
    }
    res.writeHead(422, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ erros: [{ title: 'Inválido', detail: 'Alíquota efetiva ausente' }] }));
  });
  const up = await ouvir(upstream);
  db = abrirBanco(':memory:');
  const config = { ...loadConfig({ AUTH_SECRET: 'y'.repeat(40), PUBLIC_DIR: '/x', RATE_LIMIT_PER_MINUTE: '1000' }),
    upstream: { regimeRegular: up, simplesNacional: up, danfse: up, timeoutMs: 2000 } };
  gateway = criarApp(config, db);
  base = await ouvir(gateway);
});
after(() => { gateway.close(); upstream.close(); db.close(); });

async function token() {
  const r = await fetch(base + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome: 'T', email: `${Math.random()}@x.com`, senha: 'senha-bem-longa' }) });
  return (await r.json()).token;
}
const simular = (t, tipo, corpo) => fetch(`${base}/v1/simulacoes/${tipo}`, { method: 'POST',
  headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

test('POST /v1/simulacoes/regime-normal devolve resultado legível e envia o contrato oficial', async () => {
  const t = await token();
  recebidos.length = 0;
  const r = await simular(t, 'regime-normal', formulario());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.totais.total, 42.72);
  assert.equal(j.itens[1].situacao, 'erro');
  assert.ok(!('objetos' in j), 'o JSON oficial não deve vazar para a tela');
  const enviado = JSON.parse(recebidos.at(-1).corpo);
  assert.equal(recebidos.at(-1).url, '/api/calculadora/observabilidade/regime-geral');
  assert.equal(enviado.itens[0].cst, '200');
});

test('formulário incompleto volta 400 em português, sem chamar a calculadora nem gastar cota', async () => {
  const t = await token();
  recebidos.length = 0;
  const r = await simular(t, 'regime-normal', { ...formulario(), uf: '' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro.mensagem, /Escolha o estado/);
  assert.equal(recebidos.length, 0);
  const uso = await (await fetch(base + '/usage', { headers: { authorization: `Bearer ${t}` } })).json();
  assert.equal(uso.uso.calculo.usado, 0);
});

test('calculadora recusando os dados vira mensagem para a tela (422)', async () => {
  const t = await token();
  const r = await simular(t, 'simples-nacional', {
    data: '2027-03-15', documento: 'nfe', aliquotas: { anexo: 'I', cbs: 1, ibs: 0.1 },
    itens: [{ tipo: 'produto', codigo: '22030000', atividade: '01', classificacao: '000001', valor: 100 }],
  });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).erro.mensagem, 'Alíquota efetiva ausente');
});

test('lote: simula várias operações, isola erros e gasta uma cota por operação', async () => {
  const t = await token();
  const r = await fetch(`${base}/v1/simulacoes/lote`, { method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify({ regime: 'regime-normal', operacoes: [formulario(), { ...formulario(), uf: '' }, formulario()] }) });
  assert.equal(r.status, 200);
  const { resultados } = await r.json();
  assert.equal(resultados.length, 3);
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[0].resultado.totais.total, 42.72);
  assert.equal(resultados[1].ok, false);
  assert.match(resultados[1].erro, /Escolha o estado/);
  assert.equal(resultados[2].ok, true);
  const uso = await (await fetch(base + '/usage', { headers: { authorization: `Bearer ${t}` } })).json();
  assert.equal(uso.uso.calculo.usado, 2);
});

test('lote: rejeita regime inválido, lote vazio e lote grande demais', async () => {
  const t = await token();
  const enviar = (corpo) => fetch(`${base}/v1/simulacoes/lote`, { method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  assert.equal((await enviar({ regime: 'x', operacoes: [{}] })).status, 400);
  assert.equal((await enviar({ regime: 'regime-normal', operacoes: [] })).status, 400);
  assert.equal((await enviar({ regime: 'regime-normal', operacoes: new Array(201).fill({}) })).status, 400);
});
