/**
 * Motor do lote (sem tela): lê CSV, XML (NF-e, NFC-e, NFS-e) e ZIP, monta as operações,
 * envia à calculadora em partes e calcula os comparativos. Os dados do cliente ficam só no navegador.
 * `deps` = { dados(caminho) → lista, ufsPorCodigo, cache } fornecido pela tela.
 */
import { lerZip } from './zip.js';

export const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const numBR = (v) => { const t = String(v ?? '').trim(); if (!t) return 0; const x = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t; const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
export const decimalBR = (v) => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
export const MAX_OPERACOES = 500;
export const TIPO_TP = { nfe: '55', nfce: '65', nfse: '91' };

export const COLUNAS = {
  'regime-normal': ['documento', 'data', 'uf', 'municipio', 'tipo', 'codigo', 'classificacao', 'valor', 'descricao', 'tributos_atuais'],
  'simples-nacional': ['documento', 'data', 'tipo_nota', 'aliquota_cbs', 'aliquota_ibs', 'fator_r', 'ultrapassou_sublimite', 'tipo', 'codigo', 'classificacao', 'atividade', 'valor', 'descricao'],
};
export const EXEMPLOS = {
  'regime-normal': [
    ['NF-001', '10/03/2027', 'AC', 'Rio Branco', 'servico', '122011200', '200028', '1200,00', 'Mensalidade escolar', '60,00'],
    ['NF-002', '10/03/2027', 'AC', 'Rio Branco', 'produto', '02013000', '000001', '80,00', 'Carne', ''],
  ],
  'simples-nacional': [['NF-001', '10/03/2027', 'nfe', '1,1612', '0,0129', 'nao', 'nao', 'produto', '22030000', '000001', '01', '10000,00', 'Cerveja']],
};
export const modeloCsv = (regime) => '﻿' + [COLUNAS[regime], ...EXEMPLOS[regime]].map((l) => l.join(';')).join('\r\n') + '\r\n';
export const temProblema = (r) => !r.ok || r.resultado.itens.some((i) => i.situacao === 'erro' || (i.mensagens || []).length);
export const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

export function lerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let linha = []; let campo = ''; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function dataValida(a, m, d) { const t = new Date(Date.UTC(a, m - 1, d)); return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
function dataIso(v) {
  const t = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return dataValida(+m[1], +m[2], +m[3]) ? t : null;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m && dataValida(+m[3], +m[2], +m[1]) ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
/** O servidor só aceita vírgula decimal, sem separador de milhar: normaliza "1.200,50" → "1200,50". */
const valorBR = (v) => (/^[\d.,\s]+$/.test(v) && /\d/.test(v) ? decimalBR(numBR(v)) : v);

async function codigoMunicipio(deps, uf, nome) {
  const n = String(nome || '').trim();
  if (/^\d{7}$/.test(n)) return n;
  const k = 'mun' + uf;
  if (!deps.cache[k]) { try { deps.cache[k] = await deps.dados('/v1/dados/ufs/municipios?siglaUf=' + encodeURIComponent(uf)); } catch { deps.cache[k] = []; } }
  const achado = deps.cache[k].find((m) => semAcento(m.nome) === semAcento(n));
  return achado ? String(achado.codigo) : null;
}

export async function atividadesDe(deps, data, tp) {
  const k = `ativ${data}${tp}`;
  if (!deps.cache[k]) { try { deps.cache[k] = await deps.dados(`/v1/simples-nacional/atividades?data=${data}&tpDoc=${tp}`); } catch { deps.cache[k] = []; } }
  return deps.cache[k];
}
export function anexoDoItem(deps, g, it) {
  const tp = TIPO_TP[g.entrada.documento];
  const a = (deps.cache[`ativ${g.entrada.data}${tp}`] || []).find((x) => x.codigo === it.atividade);
  if (!a) return null;
  return (g.entrada.aliquotas?.fatorR && a.anexoComFatorR) ? a.anexoComFatorR : (a.anexoSemFatorR || null);
}

const sim = (t) => ['sim', 's', 'true', '1'].includes(semAcento(t));

export async function lerPlanilha(texto, regime, deps) {
  const linhas = lerCsv(texto).filter((l) => l.some((c) => String(c).trim() !== ''));
  if (linhas.length < 2) throw new Error('A planilha está vazia ou só tem o cabeçalho.');
  const cab = linhas[0].map((c) => semAcento(c).replace(/\s+/g, '_'));
  const opcionais = ['documento', 'descricao', 'ultrapassou_sublimite', 'fator_r', 'tributos_atuais'];
  const faltando = COLUNAS[regime].filter((c) => !opcionais.includes(c) && !cab.includes(c));
  if (faltando.length) throw new Error('Faltam colunas na planilha: ' + faltando.join(', ') + '. Baixe o modelo para conferir.');
  const idx = Object.fromEntries(cab.map((c, i) => [c, i]));
  const v = (l, c) => (idx[c] === undefined ? '' : String(l[idx[c]] ?? '').trim());
  const grupos = []; const mapa = new Map(); const problemas = [];
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i]; const numero = i + 1; const doc = v(l, 'documento');
    const tipoTxt = semAcento(v(l, 'tipo'));
    const tipo = tipoTxt.startsWith('serv') ? 'servico' : tipoTxt.startsWith('prod') ? 'produto' : null;
    const data = dataIso(v(l, 'data'));
    if (!tipo) { problemas.push({ rot: 'Linha', linha: String(numero), documento: doc, mensagem: 'Tipo deve ser "produto" ou "servico".' }); continue; }
    if (!data) { problemas.push({ rot: 'Linha', linha: String(numero), documento: doc, mensagem: 'Data inválida. Use dia/mês/ano, por exemplo 10/03/2027.' }); continue; }
    const item = { tipo, descricao: v(l, 'descricao'), codigo: v(l, 'codigo'), classificacao: v(l, 'classificacao'), atividade: v(l, 'atividade'), valor: valorBR(v(l, 'valor')) };
    const chave = doc ? `${doc}|${data}` : `linha-${numero}`;
    let g = mapa.get(chave);
    if (!g) {
      g = { documento: doc || `Linha ${numero}`, regime, origem: 'csv', rot: 'Linha', linhas: [], atuais: [], entrada: { data, itens: [] } };
      if (regime === 'regime-normal') {
        const uf = v(l, 'uf').toUpperCase(); const cod = await codigoMunicipio(deps, uf, v(l, 'municipio'));
        if (!uf || !cod) { problemas.push({ rot: 'Linha', linha: String(numero), documento: doc, mensagem: `Município "${v(l, 'municipio')}" não encontrado em ${uf || 'estado não informado'}.` }); continue; }
        g.entrada.uf = uf; g.entrada.municipio = cod;
      } else {
        g.entrada.documento = semAcento(v(l, 'tipo_nota'));
        g.entrada.aliquotas = { porAnexo: {}, impedimentoSublimite: sim(v(l, 'ultrapassou_sublimite')), fatorR: sim(v(l, 'fator_r')) };
      }
      mapa.set(chave, g); grupos.push(g);
    }
    if (regime === 'simples-nacional') {
      const tp = TIPO_TP[g.entrada.documento];
      if (!tp) { problemas.push({ rot: 'Linha', linha: String(numero), documento: doc, mensagem: 'Tipo de nota deve ser nfe, nfce ou nfse.' }); continue; }
      const cod = item.atividade.replace(/\D/g, '').padStart(2, '0');
      const a = (await atividadesDe(deps, data, tp)).find((x) => x.codigo === cod);
      if (!a) { problemas.push({ rot: 'Linha', linha: String(numero), documento: doc, mensagem: `Atividade "${item.atividade}" não existe para esse tipo de nota e data.` }); continue; }
      item.atividade = cod;
      const anexo = (g.entrada.aliquotas.fatorR && a.anexoComFatorR) ? a.anexoComFatorR : a.anexoSemFatorR;
      if (anexo) g.entrada.aliquotas.porAnexo[anexo] = { cbs: v(l, 'aliquota_cbs'), ibs: v(l, 'aliquota_ibs') };
    }
    g.linhas.push(String(numero)); g.entrada.itens.push(item);
    const atu = v(l, 'tributos_atuais'); g.atuais.push(atu === '' ? null : numBR(atu));
  }
  if (grupos.length > MAX_OPERACOES) throw new Error(`A planilha tem mais de ${MAX_OPERACOES} operações. Divida em arquivos menores.`);
  return { grupos, problemas };
}

/* ---------- XML ---------- */
const filhos = (n, nome) => (n ? [...n.children].filter((c) => c.localName === nome) : []);
const f1 = (n, nome) => filhos(n, nome)[0] || null;
const cam = (n, ...nomes) => nomes.reduce((a, nome) => f1(a, nome), n);
const txt = (n, ...nomes) => { const x = cam(n, ...nomes); return x ? x.textContent.trim() : ''; };
const desc = (n, nome) => (n ? [...n.getElementsByTagNameNS('*', nome)] : []);

export function lerXml(texto, arquivo, ufsPorCodigo) {
  const grupos = []; const problemas = [];
  const prob = (documento, mensagem) => problemas.push({ rot: 'Arquivo', linha: arquivo, documento, mensagem });
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) { prob('', 'XML inválido ou corrompido.'); return { grupos, problemas }; }
  const nfes = desc(doc, 'infNFe'); const nfses = desc(doc, 'infNFSe');
  const dps = nfses.length ? [] : desc(doc, 'infDPS');
  if (!nfes.length && !nfses.length && !dps.length) { prob('', 'Não é uma NF-e, NFC-e ou NFS-e reconhecida.'); return { grupos, problemas }; }
  for (const inf of nfes) {
    const ide = f1(inf, 'ide'); const emit = f1(inf, 'emit');
    const rotulo = `${txt(ide, 'mod') === '65' ? 'NFC-e' : 'NF-e'} ${txt(ide, 'nNF')}`;
    const data = (txt(ide, 'dhEmi') || txt(ide, 'dEmi')).slice(0, 10);
    const mun = txt(ide, 'cMunFG') || txt(emit, 'enderEmit', 'cMun'); const uf = ufsPorCodigo[mun.slice(0, 2)];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{7}$/.test(mun) || !uf) { prob(rotulo, 'Não foi possível ler a data ou o município da nota.'); continue; }
    const simplesEmitente = ['1', '2'].includes(txt(emit, 'CRT'));
    const g = { documento: rotulo, regime: 'regime-normal', origem: 'xml', rot: 'Item', arquivo, linhas: [], atuais: [], atuaisParcial: false, entrada: { data, uf, municipio: mun, itens: [] } };
    for (const det of filhos(inf, 'det')) {
      const prod = f1(det, 'prod'); const imp = f1(det, 'imposto');
      const soma = (...nomes) => nomes.reduce((a, n) => a + desc(imp, n).reduce((b, x) => b + numBR(x.textContent), 0), 0);
      const valor = numBR(txt(prod, 'vProd')) - numBR(txt(prod, 'vDesc')) + numBR(txt(prod, 'vFrete')) + numBR(txt(prod, 'vSeg')) + numBR(txt(prod, 'vOutro'));
      const traz = imp && (f1(imp, 'ICMS') || f1(imp, 'PIS') || f1(imp, 'COFINS') || f1(imp, 'ISSQN'));
      g.linhas.push(det.getAttribute('nItem') || String(g.linhas.length + 1));
      g.atuais.push(traz && !simplesEmitente ? soma('vICMS', 'vPIS', 'vCOFINS', 'vISSQN') : null);
      g.entrada.itens.push({ tipo: 'produto', descricao: txt(prod, 'xProd').slice(0, 60), codigo: txt(prod, 'NCM'), classificacao: txt(imp, 'IBSCBS', 'cClassTrib'), atividade: '', valor: decimalBR(valor) });
    }
    if (!g.entrada.itens.length) { prob(rotulo, 'A nota não tem itens.'); continue; }
    grupos.push(g);
  }
  for (const inf of (nfses.length ? nfses : dps)) {
    const ehNfse = inf.localName === 'infNFSe';
    const infDps = ehNfse ? desc(inf, 'infDPS')[0] : inf;
    const rotulo = `${ehNfse ? 'NFS-e' : 'DPS'} ${ehNfse ? txt(inf, 'nNFSe') : txt(inf, 'nDPS')}`;
    if (!infDps) { prob(rotulo, 'Esta NFS-e não traz os dados do serviço (DPS).'); continue; }
    const data = (txt(infDps, 'dCompet') || txt(infDps, 'dhEmi')).slice(0, 10);
    const mun = (ehNfse ? txt(inf, 'cLocIncid') : '') || desc(inf, 'cLocalidadeIncid')[0]?.textContent.trim() || txt(infDps, 'serv', 'locPrest', 'cLocPrestacao') || txt(infDps, 'cLocEmi');
    const uf = ufsPorCodigo[String(mun).slice(0, 2)];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{7}$/.test(mun) || !uf) { prob(rotulo, 'Não foi possível ler a data ou o município do serviço.'); continue; }
    const iss = ehNfse ? txt(inf, 'valores', 'vISSQN') : '';
    grupos.push({ documento: rotulo, regime: 'regime-normal', origem: 'xml', rot: 'Item', arquivo, linhas: ['1'], atuais: [iss === '' ? null : numBR(iss)], atuaisParcial: true,
      entrada: { data, uf, municipio: mun, itens: [{ tipo: 'servico', descricao: txt(infDps, 'serv', 'cServ', 'xDescServ').slice(0, 60), codigo: txt(infDps, 'serv', 'cServ', 'cNBS'),
        classificacao: desc(infDps, 'cClassTrib')[0]?.textContent.trim() || '', atividade: '', valor: decimalBR(numBR(txt(infDps, 'valores', 'vServPrest', 'vServ'))) }] } });
  }
  return { grupos, problemas };
}

/** Recebe arquivos (File[]): CSV, XML(s) e/ou ZIP de XMLs. regimeCsv = regime da planilha (da empresa). */
export async function lerArquivos(arquivos, regimeCsv, deps) {
  if (arquivos.reduce((a, f) => a + f.size, 0) > 60 * 1024 * 1024) throw new Error('Os arquivos passam de 60 MB no total. Envie em partes.');
  const csvs = arquivos.filter((f) => /\.csv$/i.test(f.name));
  if (csvs.length) {
    if (csvs.length !== arquivos.length) throw new Error('Envie só uma planilha CSV, ou só XML/ZIP. Não misture os dois.');
    if (csvs.length > 1) throw new Error('Envie uma planilha CSV por vez.');
    if (csvs[0].size > 2 * 1024 * 1024) throw new Error('A planilha tem mais de 2 MB. Divida em partes.');
    const r = await lerPlanilha(await csvs[0].text(), regimeCsv, deps);
    return { ...r, regime: regimeCsv, formato: 'csv', arquivos: 1 };
  }
  const xmls = [];
  for (const f of arquivos) {
    if (/\.zip$/i.test(f.name)) { for (const e of await lerZip(await f.arrayBuffer())) if (/\.xml$/i.test(e.nome)) xmls.push({ nome: e.nome, texto: new TextDecoder().decode(e.bytes) }); }
    else if (/\.xml$/i.test(f.name)) xmls.push({ nome: f.name, texto: await f.text() });
    else throw new Error(`Formato não suportado: ${f.name}. Use XML, ZIP ou CSV.`);
  }
  if (!xmls.length) throw new Error('Nenhum arquivo XML encontrado.');
  const grupos = []; const problemas = [];
  for (const x of xmls) { const r = lerXml(x.texto, x.nome, deps.ufsPorCodigo); grupos.push(...r.grupos); problemas.push(...r.problemas); }
  if (grupos.length > MAX_OPERACOES) throw new Error(`Os arquivos têm mais de ${MAX_OPERACOES} notas. Envie em partes.`);
  return { grupos, problemas, regime: 'regime-normal', formato: 'xml', arquivos: xmls.length };
}

/* ---------- cálculo ---------- */
export async function processar(grupos, api, onProgresso, tam = 50) {
  const todos = [];
  for (const regime of ['regime-normal', 'simples-nacional']) {
    const doRegime = grupos.filter((g) => g.regime === regime);
    for (let i = 0; i < doRegime.length; i += tam) {
      onProgresso?.(todos.length, grupos.length);
      const parte = doRegime.slice(i, i + tam);
      const r = await api.post('/v1/simulacoes/lote', { regime, operacoes: parte.map((g) => g.entrada) });
      r.resultados.forEach((x) => todos.push({ grupo: parte[x.indice], ok: x.ok, resultado: x.resultado, erro: x.erro }));
    }
  }
  onProgresso?.(todos.length, grupos.length);
  return todos;
}

export async function recalcular(api, res, g) {
  let novo;
  try { novo = { ok: true, resultado: await api.post('/v1/simulacoes/' + g.regime, g.entrada) }; } catch (e) { novo = { ok: false, erro: e.message }; }
  const pos = res.findIndex((x) => x.grupo === g);
  const entrada = { grupo: g, ...novo };
  if (pos >= 0) res[pos] = entrada; else res.push(entrada);
  return entrada;
}

export function totais(res) {
  let cbs = 0; let ibs = 0; let total = 0; let base = 0; let ok = 0; let comProblema = 0; let itensComProblema = 0; let itens = 0;
  for (const x of res) {
    if (x.ok) { const t = x.resultado.totais; if (!temProblema(x)) { cbs += t.cbs || 0; ibs += t.ibs || 0; total += t.total || 0; base += t.base || 0; } itens += x.resultado.itens.length; itensComProblema += x.resultado.itens.filter((i) => i.situacao === 'erro' || (i.mensagens || []).length).length; }
    else { itens += x.grupo.entrada.itens.length; itensComProblema += x.grupo.entrada.itens.length; }
    if (temProblema(x)) comProblema++; else ok++;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return { cbs: r2(cbs), ibs: r2(ibs), total: r2(total), base: r2(base), operacoes: res.length, ok, comProblema, itens, itensComProblema };
}

/** Comparativo tributos atuais × CBS+IBS (só operações sem problema). pctEst = carga estimada (%) ou null. */
export function comparativoAtual(res, pctEst) {
  const linhas = []; let atual = 0; let novo = 0; let semDados = 0; let estimadas = 0; let parcial = false; let base = 0;
  for (const x of res) {
    if (!x.ok || temProblema(x)) continue;
    const g = x.grupo; let a = 0; let estimado = false; let falta = false;
    g.entrada.itens.forEach((it, k) => { const v = g.atuais?.[k]; if (v != null) a += v; else if (pctEst != null) { a += numBR(it.valor) * pctEst / 100; estimado = true; } else falta = true; });
    const n = (x.resultado.totais.cbs || 0) + (x.resultado.totais.ibs || 0);
    if (falta) { semDados++; linhas.push({ g, atual: null, novo: n }); continue; }
    if (estimado) estimadas++;
    if (g.atuaisParcial) parcial = true;
    atual += a; novo += n; base += x.resultado.totais.base || 0; linhas.push({ g, atual: a, novo: n, estimado });
  }
  return { linhas, atual, novo, base, diferenca: novo - atual, semDados, estimadas, parcial, pct: pctEst, comparavel: linhas.some((l) => l.atual != null) };
}

/** Compara regime normal × Simples por documento (casados pela posição do grupo de origem). */
export function comparativoRegimes(resNormal, resSimples) {
  const porGrupo = new Map(resSimples.map((x) => [x.grupo.origemGrupo, x]));
  const linhas = []; let tReg = 0; let tSim = 0;
  for (const x of resNormal) {
    const y = porGrupo.get(x.grupo);
    if (!y || !x.ok || !y.ok || temProblema(x) || temProblema(y)) { linhas.push({ documento: x.grupo.documento, regular: x.ok ? (x.resultado.totais.cbs || 0) + (x.resultado.totais.ibs || 0) : null, simples: null, fora: true }); continue; }
    const r = (x.resultado.totais.cbs || 0) + (x.resultado.totais.ibs || 0); const s = (y.resultado.totais.cbs || 0) + (y.resultado.totais.ibs || 0);
    tReg += r; tSim += s; linhas.push({ documento: x.grupo.documento, regular: r, simples: s });
  }
  return { linhas, regular: tReg, simples: tSim, diferenca: tSim - tReg, comparadas: linhas.filter((l) => !l.fora).length, fora: linhas.filter((l) => l.fora).length };
}

/** Constrói as operações do cenário Simples a partir das de regime normal. cfg = { cbs, ibs, fatorR, sublimite, ativProduto, ativServico } */
export async function gruposSimples(grupos, cfg, deps) {
  const saida = []; const problemas = [];
  for (const g of grupos) {
    const tipos = new Set(g.entrada.itens.map((i) => i.tipo));
    const documento = tipos.has('servico') && !tipos.has('produto') ? 'nfse' : 'nfe';
    if (tipos.size > 1) { problemas.push({ rot: g.rot, linha: g.linhas.join(', '), documento: g.documento, mensagem: 'Documento com produto e serviço juntos não entra no comparativo do Simples.' }); continue; }
    const tp = TIPO_TP[documento]; const ativ = documento === 'nfse' ? cfg.ativServico : cfg.ativProduto;
    const ativs = await atividadesDe(deps, g.entrada.data, tp); const a = ativs.find((x) => x.codigo === ativ);
    if (!a) { problemas.push({ rot: g.rot, linha: g.linhas.join(', '), documento: g.documento, mensagem: `Atividade ${ativ || '(não escolhida)'} não existe para esse tipo de nota na data ${dataBR(g.entrada.data)}.` }); continue; }
    const anexo = (cfg.fatorR && a.anexoComFatorR) ? a.anexoComFatorR : a.anexoSemFatorR;
    saida.push({ documento: g.documento, regime: 'simples-nacional', origem: g.origem, origemGrupo: g, rot: g.rot, linhas: g.linhas, atuais: g.atuais,
      entrada: { data: g.entrada.data, documento, aliquotas: { porAnexo: anexo ? { [anexo]: { cbs: cfg.cbs, ibs: cfg.ibs } } : {}, impedimentoSublimite: !!cfg.sublimite, fatorR: !!cfg.fatorR },
        itens: g.entrada.itens.map((i) => ({ tipo: i.tipo, descricao: i.descricao, codigo: i.codigo, classificacao: i.classificacao, atividade: ativ, valor: i.valor })) } });
  }
  return { grupos: saida, problemas };
}

/** Planilha no formato do modelo, com as correções feitas na tela. */
export function planilhaCorrigida(res, regime, deps) {
  const cel = (v) => String(v ?? '').replace(/;/g, ',').replace(/[\r\n]+/g, ' ');
  const cab = COLUNAS[regime]; const linhas = [];
  for (const { grupo: g } of res) {
    if (g.regime !== regime) continue;
    const e = g.entrada;
    for (const [k, it] of e.itens.entries()) {
      const anexo = regime === 'simples-nacional' ? anexoDoItem(deps, g, it) : null; const tx = (anexo && e.aliquotas.porAnexo[anexo]) || {};
      const v = { documento: g.documento, data: dataBR(e.data), uf: e.uf, municipio: e.municipio, tipo: it.tipo, codigo: it.codigo, classificacao: it.classificacao, valor: it.valor, descricao: it.descricao, atividade: it.atividade,
        tributos_atuais: g.atuais?.[k] == null ? '' : String(g.atuais[k]).replace('.', ','), tipo_nota: e.documento, aliquota_cbs: tx.cbs, aliquota_ibs: tx.ibs, fator_r: e.aliquotas?.fatorR ? 'sim' : 'nao', ultrapassou_sublimite: e.aliquotas?.impedimentoSublimite ? 'sim' : 'nao' };
      linhas.push(cab.map((c) => cel(v[c])).join(';'));
    }
  }
  return '﻿' + [cab.join(';'), ...linhas].join('\r\n') + '\r\n';
}

export function resultadoCsv(res) {
  const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const cel = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return '﻿' + [['documento', 'data', 'situacao', 'cbs', 'ibs', 'total'].join(';')].concat(res.map((x) => {
    const t = x.ok ? x.resultado.totais : null;
    return [x.grupo.documento, x.grupo.entrada.data, temProblema(x) ? 'com problema' : 'calculado', num(t?.cbs), num(t?.ibs), num(t?.total)].map(cel).join(';');
  })).join('\r\n');
}
