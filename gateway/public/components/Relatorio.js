/**
 * Nexo Fiscal — Relatório white-label
 * Abas Resumo executivo / Memória de cálculo, painel com logotipo e parecer do contador,
 * PDF pela impressão do navegador ("Salvar como PDF") e planilha Excel (.xlsx) e CSV.
 */
import { el, limpar, aviso, campo, dinheiro } from '../utils.js';
import { lote, temLote } from '../lote-store.js';
import { dadosDoRelatorio, montarFolha, imprimir, exportarXlsx, exportarPlanilha, cargaEstimadaNum } from '../relatorio-doc.js';
import { carregarEscritorio, salvarEscritorio, reduzirLogo } from '../escritorio.js';

export class Relatorio {
  constructor(state, api, router) { this.state = state; this.api = api; this.router = router; this.aba = 'resumo'; this.parecer = ''; this.escritorio = {}; }

  render() {
    const div = el('div', { id: 'aba-relatorio' });
    div.append(el('div', { class: 'page-head' }, el('div', { class: 'eyebrow' }, 'Exportação'), el('h1', {}, 'Relatório com a marca do escritório'),
      el('p', {}, 'Resumo para o cliente e memória de cálculo, prontos para PDF ou planilha.')), el('div', { id: 'rel' }));
    return div;
  }

  async mount() { this.escritorio = await carregarEscritorio(this.api); this.desenhar(); }

  desenhar() {
    const r = document.getElementById('rel'); if (!r) return; limpar(r);
    if (!temLote()) {
      r.append(el('div', { class: 'card' }, el('h2', {}, 'Nenhum lote para o relatório'), el('p', { class: 'mut' }, 'Processe um lote para gerar o relatório. Os resultados ficam só neste navegador.'), el('button', { id: 'ir-lote' }, 'Ir para o simulador em lote')));
      document.getElementById('ir-lote').onclick = () => this.router.navigate('lote'); return;
    }
    const d = dadosDoRelatorio();
    const aba = (id, rotulo) => el('button', { class: this.aba === id ? '' : 'sec', 'data-aba-rel': id, onclick: () => { this.aba = id; this.desenhar(); } }, rotulo);
    const previa = el('div', { id: 'previa-rel' }, montarFolha(d, { aba: this.aba, parecer: this.parecer, escritorio: this.escritorio, empresa: this.state.empresaAtiva }));
    const col = el('div', {}, el('div', { class: 'row noprint' }, aba('resumo', 'Resumo executivo'), aba('memoria', 'Memória de cálculo')));
    if (this.aba === 'resumo' && d.comp && lote.regime === 'regime-normal') {
      const pctIn = el('input', { id: 'carga-est', inputmode: 'decimal', placeholder: 'ex.: 18', value: lote.cargaEstimada, style: 'max-width:120px' });
      pctIn.addEventListener('change', () => { lote.cargaEstimada = pctIn.value; this.desenhar(); });
      col.append(el('div', { class: 'card noprint' }, campo('Carga atual estimada (%) para notas sem tributos informados', 'Opcional. Sem isso, essas notas ficam fora do comparativo.', pctIn, 'carga-est')));
    }
    col.append(previa);
    r.append(el('div', { class: 'rel-layout' }, col, this.painel(d)));
  }

  painel(d) {
    const e = this.escritorio; const msg = el('div', { id: 'painel-msg', role: 'alert' });
    const logo = el('img', { class: 'logo-previa', alt: 'Logotipo', src: e.logo || '', hidden: !e.logo });
    const arq = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'logo-arq', hidden: true });
    arq.onchange = async () => {
      const f = arq.files[0]; if (!f) return;
      try { const dataUrl = await reduzirLogo(f); await salvarEscritorio(this.api, { ...e, logo: dataUrl }); this.escritorio = { ...e, logo: dataUrl }; this.desenhar(); }
      catch (err) { aviso('painel-msg', err.message, 'err'); }
    };
    const parecer = el('textarea', { id: 'parecer', rows: 6, maxlength: 1500, placeholder: 'Escreva aqui sua análise para o cliente. Ela aparece no resumo do PDF.' });
    parecer.value = this.parecer;
    parecer.addEventListener('input', () => { this.parecer = parecer.value; });
    parecer.addEventListener('change', () => this.desenhar());
    const memoria = el('input', { type: 'checkbox', id: 'pdf-memoria', checked: true });
    const dadosFaltando = !e.nome;
    return el('aside', { class: 'card noprint' }, el('h3', {}, 'Personalizar'),
      dadosFaltando ? el('div', { class: 'msg warn small' }, 'Cadastre o nome do escritório, responsável e CRC em Configurações para saírem no relatório.') : null,
      logo, el('div', { class: 'row' }, el('button', { class: 'sec', id: 'logo-btn', onclick: () => arq.click() }, e.logo ? 'Trocar logotipo' : 'Enviar logotipo'), e.logo ? el('button', { class: 'sec', id: 'logo-remover', onclick: async () => { try { await salvarEscritorio(this.api, { ...e, logo: null }); this.escritorio = { ...e, logo: null }; this.desenhar(); } catch (err) { aviso('painel-msg', err.message, 'err'); } } }, 'Remover') : null), arq,
      campo('Parecer do contador', 'Opcional. Vale só para este relatório.', parecer, 'parecer'),
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0' }, memoria, 'Incluir memória de cálculo no PDF'),
      msg,
      el('div', { class: 'row' }, el('button', { id: 'baixar-pdf', onclick: () => imprimir(montarFolha(d, { aba: memoria.checked ? 'tudo' : 'resumo', parecer: this.parecer, escritorio: this.escritorio, empresa: this.state.empresaAtiva })) }, '⇩ Baixar relatório em PDF'),
        el('button', { class: 'sec', id: 'baixar-xls', onclick: () => exportarXlsx(d) }, '⇩ Exportar Excel (.xlsx)'),
        el('button', { class: 'sec', id: 'baixar-csv', onclick: () => exportarPlanilha(d) }, '⇩ CSV')),
      el('p', { class: 'mut small' }, 'No PDF, escolha "Salvar como PDF" na janela de impressão. O Excel traz duas abas (Resumo e Operações) com os valores como números.'),
      el('button', { class: 'link', onclick: () => this.router.navigate('configuracoes') }, 'Editar dados do escritório'));
  }

  unmount() {}
}
