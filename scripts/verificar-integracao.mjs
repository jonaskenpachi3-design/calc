#!/usr/bin/env node
/**
 * Verificação de integração com as calculadoras OFICIAIS (rode com o stack no ar: docker compose up --build).
 *
 *   node scripts/verificar-integracao.mjs [--url http://localhost:3000] [--xml nota-nfse.xml] [--total 300] [--conc 8]
 *
 * O que faz:
 *   1. Cria uma conta descartável (integracao-<hora>@teste.local) e usa só a API do gateway.
 *   2. Confere se cada resposta real tem o formato que as telas esperam (tabelas, regime normal, Simples, lote, DANFSe).
 *   3. Valida uma conta conhecida do Simples: 10.000,00 × 1,1612% = 116,12 de CBS.
 *   4. Roda uma carga e mede a memória de cada contêiner (docker stats), os reinícios e se algum foi morto por falta de memória.
 *   5. Grava integracao-resultado.json (sem senha nem token) para você guardar ou enviar.
 *
 * Gasta cerca de (total + 400) simulações da cota da conta descartável. No plano gratuito (500) isso estoura:
 * defina ADMIN_TOKEN no ambiente e o script passa a conta para o plano "ilimitado" antes da carga.
 * Sem dependências além do Node 22 (e do docker na linha de comando, para a parte de memória).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : padrao; };
const BASE = arg('url', 'http://localhost:3000').replace(/\/$/, '');
const TOTAL = Number(arg('total', 300)); const CONC = Number(arg('conc', 8));
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = '2027-03-10';
const checks = []; const brutas = {};

const cor = { ok: '\x1b[32m', atencao: '\x1b[33m', falha: '\x1b[31m', fim: '\x1b[0m' };
function marcar(estado, nome, detalhe = '') { checks.push({ estado, nome, detalhe }); console.log(`${cor[estado]}${estado.toUpperCase().padEnd(7)}${cor.fim} ${nome}${detalhe ? ' — ' + detalhe : ''}`); }
const ok = (n, d) => marcar('ok', n, d); const atencao = (n, d) => marcar('atencao', n, d); const falha = (n, d) => marcar('falha', n, d);
const perto = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

let token = null;
async function req(metodo, caminho, corpo, extra = {}) {
  const t0 = performance.now();
  const r = await fetch(BASE + caminho, { method: metodo, headers: { ...(corpo !== undefined && !extra.cru ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(extra.headers || {}) },
    body: corpo === undefined ? undefined : (extra.cru ? corpo : JSON.stringify(corpo)), signal: AbortSignal.timeout(extra.timeout || 60_000) });
  const buf = Buffer.from(await r.arrayBuffer()); const ms = Math.round(performance.now() - t0);
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* corpo não é JSON */ }
  return { status: r.status, ms, json, buf, tipo: r.headers.get('content-type') || '' };
}
const lista = (x) => (Array.isArray(x) ? x : x?.atividades || x?.itens || []);
const nums = (o, campos) => campos.every((c) => typeof o?.[c] === 'number' && Number.isFinite(o[c]));

async function principal() {
  console.log(`Gateway: ${BASE}\n`);
  // 0. no ar
  try { const h = await req('GET', '/health'); h.status === 200 ? ok('Gateway responde em /health') : falha('Gateway em /health', `status ${h.status}`); }
  catch (e) { falha('Gateway inacessível', `${e.message}. Suba o stack: docker compose up --build`); return; }

  // 1. conta descartável
  const email = `integracao-${Date.now()}@teste.local`; const senha = `senha-${Math.random().toString(36).slice(2)}-integracao`;
  const reg = await req('POST', '/auth/register', { nome: 'Teste de integração', email, senha });
  if (reg.status !== 201 || !reg.json?.token) { falha('Cadastro da conta descartável', `status ${reg.status} ${JSON.stringify(reg.json)?.slice(0, 200)}`); return; }
  token = reg.json.token; ok('Conta descartável criada', email);
  if (process.env.ADMIN_TOKEN) {
    const me = await req('GET', '/me'); const tid = me.json?.tenantId ?? me.json?.tenant_id ?? me.json?.tenant?.id ?? me.json?.usuario?.tenant_id;
    const p = tid ? await req('PUT', `/admin/tenants/${tid}/plano`, { plano: 'ilimitado' }, { headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } }) : { status: 0 };
    p.status === 200 ? ok('Conta passada para o plano ilimitado') : atencao('Não consegui mudar o plano', `status ${p.status}: a carga pode bater na cota gratuita`);
  } else atencao('ADMIN_TOKEN não definido', 'no plano gratuito (500 simulações) a carga vai estourar a cota; defina ADMIN_TOKEN para liberar');

  // 2. versões dos serviços oficiais
  const v = await req('GET', '/v1/versao'); brutas.versao = v.json;
  if (v.json) for (const [k, x] of Object.entries(v.json)) (x?.status === 200 || x?.status === 'ok') ? ok(`Serviço oficial no ar: ${k}`, JSON.stringify(x).slice(0, 120)) : falha(`Serviço oficial fora do ar: ${k}`, JSON.stringify(x));
  else falha('/v1/versao', `status ${v.status}`);

  // 3. tabelas
  const ufs = await req('GET', '/v1/dados/ufs'); const ufL = lista(ufs.json);
  ufL.length >= 27 && ufL.every((u) => u.sigla && u.nome && u.codigo !== undefined) ? ok('Tabela de UFs', `${ufL.length} UFs (${ufs.ms} ms)`) : falha('Tabela de UFs fora do formato (sigla, nome, codigo)', JSON.stringify(ufs.json)?.slice(0, 160));
  const mun = await req('GET', '/v1/dados/ufs/municipios?siglaUf=AC'); const munL = lista(mun.json); const rb = munL.find((m) => /rio branco/i.test(m.nome));
  rb && String(rb.codigo) === '1200401' ? ok('Municípios do AC', `${munL.length}, Rio Branco = ${rb.codigo}`) : falha('Municípios do AC (esperava Rio Branco 1200401, com campos nome e codigo)', JSON.stringify(munL[0]));
  const ncm = await req('GET', `/v1/dados/ncm/vigentes?data=${DATA}`, undefined, { timeout: 120_000 }); const ncmL = lista(ncm.json);
  ncmL.length > 1000 && ncmL[0].descricao && (ncmL[0].ncm || ncmL[0].codigo) ? ok('Lista de NCM (busca por nome)', `${ncmL.length} itens, ${Math.round(ncm.buf.length / 1024)} KB, ${ncm.ms} ms`) : falha('Lista de NCM fora do esperado (campos ncm/descricao)', JSON.stringify(ncmL[0]));
  const nbs = await req('GET', `/v1/dados/nbs/lista?data=${DATA}`, undefined, { timeout: 120_000 }); const nbsL = lista(nbs.json);
  nbsL.length > 100 && nbsL[0].descricao && (nbsL[0].codigo || nbsL[0].nbs) ? ok('Lista de NBS (busca por nome)', `${nbsL.length} itens, ${nbs.ms} ms`) : falha('Lista de NBS fora do esperado', JSON.stringify(nbsL[0]));
  const cls = await req('GET', `/v1/dados/classificacoes-tributarias/cbs-ibs?data=${DATA}`); const clsL = lista(cls.json);
  clsL.length > 5 && clsL[0].codigo ? ok('Classificações tributárias', `${clsL.length}`) : falha('Classificações tributárias fora do esperado', JSON.stringify(cls.json)?.slice(0, 160));
  const ap = await req('GET', `/v1/dados/classificacoes-tributarias/ncm-aplicavel?cClassTrib=000001&ncm=02013000&dataOcorrenciaFatoGerador=${DATA}`);
  typeof ap.json?.valido === 'boolean' ? ok('Conferência NCM × classificação (campo "valido" booleano)', `valido=${ap.json.valido}`) : falha('Conferência NCM × classificação sem campo "valido" booleano (o aviso amarelo depende dele)', JSON.stringify(ap.json)?.slice(0, 160));
  const apN = await req('GET', `/v1/dados/classificacoes-tributarias/nbs-aplicavel?cClassTrib=200028&nbs=122011200&dataOcorrenciaFatoGerador=${DATA}`);
  typeof apN.json?.valido === 'boolean' ? ok('Conferência NBS × classificação', `valido=${apN.json.valido}`) : falha('Conferência NBS × classificação sem campo "valido"', JSON.stringify(apN.json)?.slice(0, 160));

  // 4. regime normal
  const base = { data: DATA, uf: 'AC', municipio: '1200401' };
  const caso = (itens) => ({ ...base, itens });
  const servico = { tipo: 'servico', descricao: 'Mensalidade escolar', codigo: '122011200', classificacao: '200028', atividade: '', valor: '1200,00' };
  const produto = { tipo: 'produto', descricao: 'Carne bovina', codigo: '02013000', classificacao: '000001', atividade: '', valor: '1000,00' };
  const A = await req('POST', '/v1/simulacoes/regime-normal', caso([servico])); brutas.regimeNormalServico = A.json;
  const itA = A.json?.itens?.[0];
  if (A.status === 200 && itA && nums(itA, ['base', 'cbs', 'ibs', 'total']) && nums(A.json.totais, ['base', 'cbs', 'ibs', 'total']) && Array.isArray(A.json.avisos)) {
    ok('Regime normal: formato da resposta (itens, totais, avisos)', `situação "${itA.situacao}", CBS ${itA.cbs}, IBS ${itA.ibs}, total ${A.json.totais.total} (${A.ms} ms)`);
    perto(A.json.totais.total, A.json.totais.cbs + A.json.totais.ibs + (A.json.totais.impostoSeletivo || 0), 0.02) ? ok('Regime normal: total = CBS + IBS + Imposto Seletivo') : falha('Regime normal: total não fecha com CBS + IBS + IS', JSON.stringify(A.json.totais));
    itA.situacao === 'calculado' ? ok('Regime normal: serviço de ensino calculado sem problema') : atencao('Regime normal: o serviço de ensino voltou com problema', `${itA.situacao}: ${(itA.mensagens || []).join(' | ')} — confira se NBS 122011200 + 200028 vale na data ${DATA}`);
    itA.base && Math.abs(itA.base - 1200) < 0.01 ? ok('Regime normal: base = valor informado (1.200,00)') : falha('Regime normal: base diferente do valor informado', `base ${itA.base}`);
  } else falha('Regime normal: resposta fora do formato esperado', `status ${A.status} ${JSON.stringify(A.json)?.slice(0, 300)}`);
  const B = await req('POST', '/v1/simulacoes/regime-normal', caso([produto])); brutas.regimeNormalProduto = B.json;
  B.status === 200 && B.json?.itens?.[0] ? ok('Regime normal: produto', `situação "${B.json.itens[0].situacao}", total ${B.json.totais?.total}`) : falha('Regime normal: produto', `status ${B.status} ${JSON.stringify(B.json)?.slice(0, 200)}`);
  const E = await req('POST', '/v1/simulacoes/regime-normal', caso([{ ...produto, codigo: '99999999', classificacao: '999999' }])); brutas.regimeNormalErro = E.json;
  const itE = E.json?.itens?.[0];
  if (E.status === 200 && itE?.situacao === 'erro' && (itE.mensagens || []).length) ok('Regime normal: item inválido vira "erro" com mensagem em português', itE.mensagens[0].slice(0, 140));
  else if (E.status >= 400 && E.json?.erro?.mensagem) ok('Regime normal: item inválido recusado com mensagem', `${E.status}: ${E.json.erro.mensagem.slice(0, 140)}`);
  else falha('Regime normal: item inválido não gerou erro legível (a Auditoria depende disso)', `status ${E.status} ${JSON.stringify(E.json)?.slice(0, 300)}`);

  // 5. Simples Nacional com conta conhecida
  const at = await req('GET', `/v1/simples-nacional/atividades?data=${DATA}&tpDoc=55`); const atL = lista(at.json); const a0 = atL.find((a) => a.anexoSemFatorR);
  if (!a0) falha('Simples: lista de atividades (campos codigo, anexoSemFatorR)', JSON.stringify(atL[0] ?? at.json)?.slice(0, 200));
  else {
    ok('Simples: lista de atividades', `${atL.length}, usando "${a0.codigo}" (anexo ${a0.anexoSemFatorR})`);
    const S = await req('POST', '/v1/simulacoes/simples-nacional', { data: DATA, documento: 'nfe', aliquotas: { porAnexo: { [a0.anexoSemFatorR]: { cbs: '1,1612', ibs: '0,0129' } }, impedimentoSublimite: false, fatorR: false },
      itens: [{ tipo: 'produto', descricao: 'Cerveja', codigo: '22030000', classificacao: '000001', atividade: a0.codigo, valor: '10000,00' }] }); brutas.simples = S.json;
    const t = S.json?.totais;
    if (S.status === 200 && t) (perto(t.cbs, 116.12) && perto(t.ibs, 1.29)) ? ok('Simples: conta conhecida confere (10.000 × 1,1612% = 116,12 de CBS; × 0,0129% = 1,29 de IBS)', `CBS ${t.cbs}, IBS ${t.ibs}`) : falha('Simples: valores diferentes do esperado (116,12 e 1,29)', JSON.stringify(t));
    else falha('Simples: resposta fora do formato', `status ${S.status} ${JSON.stringify(S.json)?.slice(0, 300)}`);
  }

  // 6. lote
  const L = await req('POST', '/v1/simulacoes/lote', { regime: 'regime-normal', operacoes: Array.from({ length: 120 }, () => caso([servico, produto])) }, { timeout: 180_000 });
  if (L.status === 200 && Array.isArray(L.json?.resultados) && L.json.resultados.length === 120) {
    const certos = L.json.resultados.filter((r) => r.ok && r.resultado?.itens?.length === 2).length;
    certos === 120 ? ok('Lote de 120 operações', `${L.ms} ms (${Math.round(L.ms / 120)} ms por operação), todas ok`) : falha('Lote: algumas operações falharam', `${certos}/120 ok. Exemplo: ${JSON.stringify(L.json.resultados.find((r) => !r.ok))?.slice(0, 250)}`);
  } else falha('Lote: formato inesperado', `status ${L.status} ${JSON.stringify(L.json)?.slice(0, 250)}`);
  const L2 = await req('POST', '/v1/simulacoes/lote', { regime: 'regime-normal', operacoes: Array.from({ length: 201 }, () => caso([servico])) });
  L2.status === 400 ? ok('Lote acima de 200 operações é recusado com 400') : atencao('Lote de 201 operações não foi recusado', `status ${L2.status}`);

  // 7. DANFSe
  let xml = arg('xml', null);
  if (!xml) for (const d of ['vendor/calculadora-rtc-regime-regular/src/test/resources/xml/nfse/valido/nota', 'vendor/calculadora-rtc-gerador-danfse']) { const p = join(RAIZ, d); if (existsSync(p)) { const f = readdirSync(p).find((n) => /\.xml$/i.test(n)); if (f) { xml = join(p, f); break; } } }
  if (!xml || !existsSync(xml)) atencao('DANFSe não testado', 'passe --xml caminho-de-uma-nfse-autorizada.xml');
  else {
    const corpo = readFileSync(xml);
    for (const canhoto of [false, true]) {
      const D = await req('POST', `/v1/danfse?canhoto=${canhoto}`, corpo, { cru: true, headers: { 'content-type': 'application/xml' }, timeout: 120_000 });
      D.status === 200 && D.buf.subarray(0, 4).toString() === '%PDF' ? ok(`DANFSe (canhoto=${canhoto}) gera PDF`, `${Math.round(D.buf.length / 1024)} KB, ${D.ms} ms`) : atencao(`DANFSe (canhoto=${canhoto}) não gerou PDF`, `status ${D.status} ${D.buf.toString('utf8').slice(0, 200)} — confira se o XML é uma NFS-e autorizada`);
    }
  }

  // 8. carga + memória
  console.log(`\nCarga: ${TOTAL} simulações, ${CONC} em paralelo, mais consultas pesadas às tabelas…`);
  const mem = iniciarMedicao();
  const tarefas = Array.from({ length: TOTAL }, (_, i) => () => req('POST', '/v1/simulacoes/regime-normal', caso([i % 2 ? servico : produto])));
  for (let i = 0; i < 6; i++) tarefas.push(() => req('GET', `/v1/dados/ncm/vigentes?data=${DATA}`, undefined, { timeout: 120_000 }));
  tarefas.push(() => req('POST', '/v1/simulacoes/lote', { regime: 'regime-normal', operacoes: Array.from({ length: 200 }, () => caso([servico, produto])) }, { timeout: 180_000 }));
  const tempos = []; let erros = 0; let fila = [...tarefas]; const t0 = performance.now();
  await Promise.all(Array.from({ length: CONC }, async () => { while (fila.length) { const f = fila.shift(); try { const r = await f(); if (r.status >= 400) erros++; else tempos.push(r.ms); } catch { erros++; } } }));
  const seg = (performance.now() - t0) / 1000; tempos.sort((a, b) => a - b); const pc = (p) => tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * p))];
  erros === 0 ? ok('Carga sem erros', `${tarefas.length} chamadas em ${seg.toFixed(1)} s; mediana ${pc(0.5)} ms, p95 ${pc(0.95)} ms`) : falha('Carga com erros', `${erros} de ${tarefas.length} falharam (429 = limite de requisições por minuto do gateway; 402 = cota)`);
  const resumoMem = await mem.encerrar(); brutas.memoria = resumoMem;
  relatarMemoria(resumoMem);
}

/* ---------- memória dos contêineres ---------- */
const MIB = { b: 1 / 1048576, kib: 1 / 1024, kb: 1 / 1024, mib: 1, mb: 1, gib: 1024, gb: 1024 };
const paraMiB = (t) => { const m = /([\d.]+)\s*([a-z]+)/i.exec(t || ''); return m ? parseFloat(m[1]) * (MIB[m[2].toLowerCase()] ?? NaN) : NaN; };
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] }); }
function amostrar() {
  try { return docker('stats', '--no-stream', '--format', '{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}').trim().split('\n').filter(Boolean).map((l) => { const [nome, uso, cpu] = l.split('|'); const [u, lim] = uso.split('/'); return { nome, usoMiB: paraMiB(u), limiteMiB: paraMiB(lim), cpu: parseFloat(cpu) }; }); } catch { return null; }
}
function iniciarMedicao() {
  const primeira = amostrar();
  if (!primeira) { atencao('Memória não medida', 'o comando docker não conseguiu ler os contêineres (Docker fora do ar ou sem permissão)'); return { encerrar: async () => null }; }
  const base = Object.fromEntries(primeira.map((c) => [c.nome, c])); const pico = Object.fromEntries(primeira.map((c) => [c.nome, c.usoMiB]));
  let rodando = true; const laco = (async () => { while (rodando) { const a = amostrar(); for (const c of a || []) pico[c.nome] = Math.max(pico[c.nome] ?? 0, c.usoMiB); await new Promise((r) => setTimeout(r, 1500)); } })();
  return { encerrar: async () => { rodando = false; await laco; const fim = amostrar() || []; const saida = {};
    for (const [nome, b] of Object.entries(base)) { let oom = null; let reinicios = null; try { [oom, reinicios] = docker('inspect', '-f', '{{.State.OOMKilled}} {{.RestartCount}}', nome).trim().split(' '); } catch { /* ignora */ }
      saida[nome] = { limiteMiB: Math.round(b.limiteMiB), antesMiB: Math.round(b.usoMiB), picoMiB: Math.round(pico[nome]), depoisMiB: Math.round(fim.find((c) => c.nome === nome)?.usoMiB ?? NaN), oomKilled: oom === 'true', reinicios: Number(reinicios) }; }
    return saida; } };
}
function relatarMemoria(m) {
  if (!m) return;
  console.log('\nMemória por contêiner (MiB; "pico" = maior leitura durante a carga):');
  console.log('contêiner'.padEnd(40) + 'limite'.padStart(8) + 'antes'.padStart(8) + 'pico'.padStart(8) + 'depois'.padStart(8) + '  uso do limite');
  for (const [nome, c] of Object.entries(m)) {
    const pct = Math.round((c.picoMiB / c.limiteMiB) * 100);
    console.log(nome.padEnd(40) + String(c.limiteMiB).padStart(8) + String(c.antesMiB).padStart(8) + String(c.picoMiB).padStart(8) + String(c.depoisMiB).padStart(8) + `  ${pct}%`);
    if (c.oomKilled || c.reinicios > 0) falha(`${nome} foi morto/reiniciado`, `OOMKilled=${c.oomKilled}, reinícios=${c.reinicios}: aumente o limite de memória`);
    else if (pct >= 85) atencao(`${nome} chegou a ${pct}% do limite`, 'sem folga: aumente MEM_* / JAVA_XMX no .env');
    else ok(`${nome} usa até ${pct}% do limite`, `pico ${c.picoMiB} MiB de ${c.limiteMiB}`);
  }
  console.log('\nReferência para o .env: mem_limit ≈ pico × 1,5 arredondado para cima em 128 MiB; JAVA_XMX ≈ 60% do mem_limit (o resto é pilha nativa, metaspace e threads).');
  for (const [nome, c] of Object.entries(m)) if (/regime|simples/.test(nome)) { const lim = Math.ceil((c.picoMiB * 1.5) / 128) * 128; console.log(`  ${nome}: MEM_JAVA=${lim}m  JAVA_XMX=${Math.round((lim * 0.6) / 32) * 32}m`); }
  console.log('Repita com um lote real do seu maior cliente antes de fixar os valores.');
}

try { await principal(); } catch (e) { falha('Erro inesperado no script', e.stack || e.message); }
const resumo = { ok: checks.filter((c) => c.estado === 'ok').length, atencao: checks.filter((c) => c.estado === 'atencao').length, falha: checks.filter((c) => c.estado === 'falha').length };
console.log(`\nResumo: ${cor.ok}${resumo.ok} ok${cor.fim}, ${cor.atencao}${resumo.atencao} atenção${cor.fim}, ${cor.falha}${resumo.falha} falha(s)${cor.fim}`);
writeFileSync('integracao-resultado.json', JSON.stringify({ quando: new Date().toISOString(), gateway: BASE, resumo, checks, respostasBrutas: brutas }, null, 2));
console.log('Relatório gravado em integracao-resultado.json');
process.exit(resumo.falha ? 1 : 0);
