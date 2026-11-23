/**
 * Monta o relatório (resumo executivo e memória de cálculo) como DOM, para a tela e para a impressão em PDF.
 * Todo texto entra por textContent (el), então nada vindo de notas ou planilhas vira HTML.
 */
import { el, dinheiro, pct, downloadBlob } from './utils.js';
import { lote } from './lote-store.js';
import { gerarXlsx } from './xlsx.js';
import { totais, comparativoAtual, comparativoRegimes, temProblema, dataBR, decimalBR } from './lote-engine.js';

const ROTULO = { 'regime-normal': 'Regime normal (lucro presumido ou real)', 'simples-nacional': 'Simples Nacional' };
const AVISO = 'Valores informativos, calculados com as calculadoras publicadas pela Receita Federal. Não substituem a apuração oficial nem a orientação do contador.';

export const cargaEstimadaNum = () => (String(lote.cargaEstimada).trim() === '' ? null : parseFloat(String(lote.cargaEstimada).replace(',', '.')));

/** Dados do relatório a partir do lote atual. */
export function dadosDoRelatorio() {
  const t = totais(lote.res); const comp = lote.regime === 'regime-normal' ? comparativoAtual(lote.res, cargaEstimadaNum()) : null;
  const regimes = lote.resAlt.length ? comparativoRegimes(lote.res, lote.resAlt) : null;
  return { t, comp, regimes };
}

const tabela = (cab, linhas) => el('table', {}, el('thead', {}, el('tr', {}, cab.map((c, k) => el('th', { class: k ? 'n' : '' }, c)))), el('tbody', {}, linhas.map((l) => el('tr', {}, l.map((c, k) => el('td', { class: k ? 'n' : '' }, c))))));
const barras = (lista) => { const max = Math.max(...lista.map((b) => b.valor), 0.01); return lista.map((b) => el('div', { class: 'rel-barra' }, el('span', { class: 'r' }, b.rotulo), el('span', { class: 'b' + (b.alt ? ' alt' : ''), style: `width:${Math.max(1, Math.round((b.valor / max) * 60))}%` }), dinheiro(b.valor))); };

export function secaoResumo(d) {
  const { t, comp, regimes } = d; const nos = [];
  nos.push(el('div', { class: 'rel-kpis' }, [['Total de CBS + IBS', dinheiro(t.total)], ['CBS (federal)', dinheiro(t.cbs)], ['IBS (estados e municípios)', dinheiro(t.ibs)], ['Operações sem problemas', `${t.ok} de ${t.operacoes}`]].map(([r, v]) => el('div', { class: 'rel-kpi' }, el('b', {}, v), el('span', {}, r)))));
  if (comp && comp.linhas.length && comp.comparavel) {
    nos.push(el('h2', {}, 'Comparativo: tributos atuais × CBS e IBS'), ...barras([{ rotulo: 'Tributos atuais', valor: comp.atual, alt: true }, { rotulo: 'CBS + IBS simulados', valor: comp.novo }]),
      el('div', { class: 'rel-kpis' }, [['Tributos atuais', dinheiro(comp.atual)], ['CBS + IBS', dinheiro(comp.novo)], [comp.diferenca > 0 ? 'Aumento estimado' : 'Redução estimada', dinheiro(Math.abs(comp.diferenca))]].map(([r, v]) => el('div', { class: 'rel-kpi' }, el('b', {}, v), el('span', {}, r)))),
      el('div', { class: 'rel-nota' }, 'Comparação bruta, sem créditos. Tributos atuais (ICMS, ISS, PIS e COFINS) conforme informado nas notas ou na planilha; nenhuma calculadora da Receita calcula o modelo atual.'
        + (comp.estimadas ? ` ${comp.estimadas} operação(ões) com carga estimada de ${pct.format(comp.pct)}%.` : '') + (comp.semDados ? ` ${comp.semDados} operação(ões) sem tributos atuais ficaram fora.` : '') + (comp.parcial ? ' Nas NFS-e só o ISS é conhecido, então a carga atual dessas notas está subestimada.' : '') + ' Entre 2026 e 2033 os dois sistemas convivem; aqui a CBS e o IBS aparecem com as alíquotas de referência, como se já estivessem plenos.'));
  }
  if (regimes && regimes.comparadas) {
    nos.push(el('h2', {}, 'Comparativo: Simples Nacional × regime normal (CBS e IBS)'), ...barras([{ rotulo: 'Regime normal', valor: regimes.regular }, { rotulo: 'Simples Nacional', valor: regimes.simples, alt: true }]),
      tabela(['Documento', 'Regime normal', 'Simples Nacional', 'Diferença (Simples − normal)'], regimes.linhas.filter((l) => !l.fora).map((l) => [l.documento, dinheiro(l.regular), dinheiro(l.simples), dinheiro(l.simples - l.regular)]).concat([['Total', dinheiro(regimes.regular), dinheiro(regimes.simples), dinheiro(regimes.diferenca)]])),
      el('div', { class: 'rel-nota' }, `Compara só CBS e IBS, com as alíquotas efetivas informadas para o Simples. Não inclui os demais tributos do DAS nem os créditos de CBS e IBS aproveitáveis no regime normal, que costumam ser o principal motivo de optar por ele.${regimes.fora ? ` ${regimes.fora} nota(s) ficaram fora por problema.` : ''}`));
  }
  if (t.comProblema) nos.push(el('div', { class: 'rel-nota' }, `${t.comProblema} operação(ões) com problema ficaram fora dos totais até serem corrigidas.`));
  return nos;
}

export function secaoMemoria() {
  const linhas = [];
  for (const x of lote.res) {
    const prob = temProblema(x);
    if (!x.ok) { linhas.push([`${x.grupo.documento} (${dataBR(x.grupo.entrada.data)})`, x.erro || 'Erro', '', '', '', '', 'Fora dos totais']); continue; }
    x.resultado.itens.forEach((it, k) => {
      const orig = x.grupo.entrada.itens[k] || {};
      linhas.push([`${x.grupo.documento} · item ${x.grupo.linhas[k] ?? k + 1}`, `${it.descricao || orig.descricao || ''}${orig.codigo ? ' [' + orig.codigo + (orig.classificacao ? ' / ' + orig.classificacao : '') + ']' : ''}`,
        dinheiro(it.base), dinheiro(it.cbs), dinheiro(it.ibs), dinheiro(it.total), (it.situacao === 'erro' || (it.mensagens || []).length) ? `Problema: ${(it.mensagens || [])[0] || it.situacaoTexto || ''}` : prob ? 'Fora dos totais' : 'Calculado']);
    });
  }
  return [el('h2', {}, 'Memória de cálculo'), el('div', { class: 'rel-nota' }, 'Resultado de cada item, como devolvido pela calculadora oficial. Itens de operações com problema não entram nos totais.'),
    tabela(['Documento / item', 'Descrição [NCM/NBS / classificação]', 'Base', 'CBS', 'IBS', 'Total', 'Situação'], linhas)];
}

/** Folha completa. opcoes = { aba: 'resumo'|'memoria'|'tudo', parecer, escritorio, empresa } */
export function montarFolha(d, { aba = 'tudo', parecer = '', escritorio = {}, empresa = null } = {}) {
  const cor = /^#[0-9a-f]{6}$/i.test(escritorio.cor || '') ? escritorio.cor : '#0f766e';
  const f = el('div', { class: 'folha', style: `--marca:${cor}` });
  f.append(el('div', { class: 'rel-cab' }, escritorio.logo ? el('img', { src: escritorio.logo, alt: '' }) : null,
    el('div', {}, el('div', { class: 'nome' }, escritorio.nome || 'Simulador CBS e IBS'), el('div', { class: 'sub' }, `Relatório gerado em ${new Date().toLocaleDateString('pt-BR')}`))));
  f.append(el('h1', {}, aba === 'memoria' ? 'Memória de cálculo — CBS e IBS' : 'Simulação em lote de CBS e IBS'));
  const meta = [empresa ? `Cliente: ${empresa.razao_social} (CNPJ ${empresa.cnpj})` : null, ROTULO[lote.regime], `${lote.res.length} operação(ões)`].filter(Boolean);
  f.append(el('div', { class: 'rel-nota' }, meta.join(' · ')));
  if (aba !== 'memoria') f.append(...secaoResumo(d));
  if (parecer.trim() && aba !== 'memoria') f.append(el('h2', {}, 'Parecer do contador'), el('div', { class: 'rel-parecer' }, parecer.trim()));
  if (aba !== 'resumo') f.append(...secaoMemoria());
  const assin = [escritorio.responsavel ? `Responsável técnico: ${escritorio.responsavel}` : null, escritorio.crc ? `CRC: ${escritorio.crc}` : null, escritorio.contato].filter(Boolean);
  f.append(el('div', { class: 'rel-rodape' }, [assin.join(' · '), AVISO].filter(Boolean).join(' — ')));
  return f;
}

export function imprimir(folha) {
  document.getElementById('folha')?.remove();
  const alvo = el('div', { id: 'folha' }); alvo.append(folha); document.body.append(alvo); document.body.classList.add('relat');
  const fim = () => { document.body.classList.remove('relat'); alvo.remove(); window.removeEventListener('afterprint', fim); };
  window.addEventListener('afterprint', fim);
  window.print();
}

/** Resumo e operações do relatório como linhas de planilha (números de verdade, sem formatação). */
export function linhasDoRelatorio(d) {
  const M = (v) => (v === null || v === undefined ? null : { v, e: 'moeda' });
  const resumo = [[{ v: 'Resumo do lote', e: 'titulo' }], [], [{ v: 'Total CBS+IBS', e: 'negrito' }, M(d.t.total)], ['CBS', M(d.t.cbs)], ['IBS', M(d.t.ibs)], ['Operações sem problemas', `${d.t.ok} de ${d.t.operacoes}`]];
  if (d.comp?.comparavel) resumo.push(['Tributos atuais (informados)', M(d.comp.atual)], ['CBS+IBS comparável', M(d.comp.novo)], ['Diferença', M(d.comp.diferenca)]);
  if (d.regimes?.comparadas) resumo.push(['CBS+IBS regime normal (comparadas)', M(d.regimes.regular)], ['CBS+IBS Simples (comparadas)', M(d.regimes.simples)]);
  const ops = [['Documento', 'Data', 'Item', 'Descrição', 'NCM/NBS', 'Classificação', 'Base', 'CBS', 'IBS', 'Total', 'Situação'].map((v) => ({ v, e: 'negrito' }))];
  for (const x of lote.res) {
    if (!x.ok) { ops.push([x.grupo.documento, x.grupo.entrada.data, '', '', '', '', '', '', '', '', x.erro]); continue; }
    x.resultado.itens.forEach((it, k) => { const o = x.grupo.entrada.itens[k] || {}; ops.push([x.grupo.documento, x.grupo.entrada.data, x.grupo.linhas[k] ?? k + 1, it.descricao || o.descricao, o.codigo, o.classificacao, M(it.base), M(it.cbs), M(it.ibs), M(it.total), temProblema(x) ? 'com problema' : 'calculado']); });
  }
  return { resumo, ops };
}

/** Excel de verdade (.xlsx): aba Resumo e aba Operações, com números e formato de moeda. */
export function exportarXlsx(d) {
  const { resumo, ops } = linhasDoRelatorio(d);
  downloadBlob(gerarXlsx([
    { nome: 'Resumo', larguras: [38, 20], linhas: resumo },
    { nome: 'Operações', larguras: [16, 12, 7, 36, 14, 14, 14, 14, 14, 14, 18], linhas: ops },
  ]), 'relatorio-cbs-ibs.xlsx');
}

/** CSV (separador ;) para quem prefere abrir em outro programa. */
export function exportarPlanilha(d) {
  const { resumo, ops } = linhasDoRelatorio(d);
  const txt = (c) => { const v = c && typeof c === 'object' ? c.v : c; return v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); };
  const cel = (c) => '"' + txt(c).replace(/"/g, '""') + '"';
  const linhas = [...resumo, [], ...ops];
  downloadBlob(new Blob(['﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'relatorio-cbs-ibs.csv');
}
