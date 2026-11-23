/**
 * Nexo Fiscal — Dashboard
 * Números reais das análises salvas (só totais). Sem dados inventados e sem biblioteca externa:
 * o gráfico é feito com barras CSS. Todo texto vindo do servidor entra por textContent (el()).
 */

import { el, limpar, dinheiro, formatCNPJ } from '../utils.js';

const REGIMES = { 'simples-nacional': 'Simples Nacional', 'lucro-presumido': 'Lucro Presumido', 'lucro-real': 'Lucro Real', 'regime-normal': 'Regime Normal' };
const pctTxt = (v) => (v === null || v === undefined ? '' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

export class Dashboard {
  constructor(state, api, router) {
    this.state = state; this.api = api; this.router = router;
  }

  render() {
    const empresa = this.state.empresaAtiva;
    const div = el('div', { id: 'aba-dashboard' });
    div.append(
      el('div', { class: 'page-head' },
        el('div', { class: 'eyebrow' }, 'Visão geral'),
        el('h1', {}, empresa?.razao_social || 'Empresa'),
        el('p', {}, `CNPJ ${formatCNPJ(empresa?.cnpj)} · ${REGIMES[empresa?.regime_atual] || empresa?.regime_atual || ''}`)),
      el('div', { id: 'dash-alerta' }),
      el('div', { class: 'stats', id: 'kpi-cards' }),
      el('div', { class: 'two' },
        el('div', { class: 'card' }, el('h2', {}, 'Comparativo por mês'), el('div', { id: 'grafico' })),
        el('div', { class: 'card' },
          el('h2', {}, 'Próximos passos'),
          el('div', { class: 'actions' },
            this.acao('simular', '＋ Nova simulação'), this.acao('lote', '⇧ Simulador em lote'),
            this.acao('relatorio', '▤ Relatório'), this.acao('danfse', '▧ Central DANFSe')),
          el('div', { style: 'margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)' },
            el('h3', {}, 'Uso do plano neste mês'), el('div', { class: 'grid', id: 'uso-plano' })),
          el('div', { class: 'row', style: 'margin-top:16px' },
            el('button', { class: 'sec', id: 'trocar-empresa-dash' }, 'Trocar de empresa')))));
    return div;
  }

  acao(aba, texto) { return el('button', { class: 'sec', 'data-ir': aba }, texto); }

  async mount() {
    document.getElementById('trocar-empresa-dash')?.addEventListener('click', () => { this.state.setEmpresaAtiva(null); this.router.navigate('dashboard'); });
    document.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => this.router.navigate(b.dataset.ir)));
    const empresa = this.state.empresaAtiva;
    if (!empresa) return;
    try {
      const d = await this.api.get(`/empresas/${empresa.cnpj}/dashboard`);
      this.kpis(d); this.alertas(d); this.grafico(d); this.uso(d.uso);
    } catch (e) {
      const c = document.getElementById('kpi-cards');
      if (c) c.append(el('div', { class: 'msg err' }, 'Não foi possível carregar a visão geral. Tente recarregar a página.'));
    }
  }

  kpis(d) {
    const c = document.getElementById('kpi-cards'); if (!c) return; limpar(c);
    const card = (rotulo, valor, detalhe, cor) => el('div', { class: 'kpi' },
      el('div', { class: 'v', style: cor ? `color:${cor}` : null }, valor),
      el('div', { class: 'l' }, rotulo), detalhe ? el('div', { class: 'hint' }, detalhe) : null);
    const dif = d.diferenca;
    c.append(
      card('Faturamento analisado', dinheiro(d.faturamentoAnalisado.valor), d.vazio ? 'nenhuma análise ainda' : `${d.faturamentoAnalisado.qtdNotas.toLocaleString('pt-BR')} documento(s)`),
      card('Carga atual', d.cargaAtual.analises ? dinheiro(d.cargaAtual.valor) : '—', d.cargaAtual.analises ? `${pctTxt(d.cargaAtual.percentual)} · valores informados nos XML/CSV` : 'precisa de tributos atuais informados'),
      card('Projeção CBS + IBS', d.vazio ? '—' : dinheiro(d.projecaoReforma.valor), d.vazio ? '' : pctTxt(d.projecaoReforma.percentual)),
      card(dif.comparavel ? (dif.tipo === 'aumento' ? 'Aumento estimado' : 'Economia estimada') : 'Diferença', dif.comparavel ? dinheiro(Math.abs(dif.valor)) : '—',
        dif.comparavel ? 'bruto, sem créditos' : 'sem análise comparável', dif.comparavel ? (dif.tipo === 'aumento' ? 'var(--red)' : 'var(--green)') : null));
  }

  alertas(d) {
    const c = document.getElementById('dash-alerta'); if (!c) return; limpar(c);
    for (const a of d.alertas) c.append(el('div', { class: 'msg warn' }, a.mensagem));
    if (d.vazio) c.append(el('div', { class: 'msg' }, 'Ainda não há análises desta empresa. Faça uma simulação ou envie um lote para preencher esta tela.'));
  }

  grafico(d) {
    const c = document.getElementById('grafico'); if (!c) return; limpar(c);
    const { labels, series } = d.grafico;
    const max = Math.max(1, ...series.flatMap((s) => s.valores));
    const leg = el('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap;margin-bottom:10px' },
      series.map((s) => el('span', { class: 'hint' }, el('i', { style: `display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;background:${s.cor}` }), s.nome)));
    const area = el('div', { style: 'display:flex;gap:10px;align-items:flex-end;height:240px;border-bottom:1px solid var(--bd)' });
    labels.forEach((rot, i) => {
      const grupo = el('div', { style: 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%' },
        el('div', { style: 'display:flex;gap:3px;align-items:flex-end;height:100%;width:100%;justify-content:center' },
          series.map((s) => el('div', { title: `${s.nome}: ${dinheiro(s.valores[i])}`, style: `width:22%;max-width:26px;min-height:${s.valores[i] > 0 ? 2 : 0}px;height:${(s.valores[i] / max) * 100}%;background:${s.cor};border-radius:4px 4px 0 0` }))));
      area.append(grupo);
    });
    const eixo = el('div', { style: 'display:flex;gap:10px;margin-top:6px' }, labels.map((r) => el('div', { class: 'hint', style: 'flex:1;text-align:center' }, r)));
    c.append(leg, area, eixo);
    if (d.vazio) c.append(el('p', { class: 'hint', style: 'margin-top:10px' }, 'Sem dados no período.'));
  }

  uso(uso) {
    const c = document.getElementById('uso-plano'); if (!c || !uso) return; limpar(c);
    const nomes = { calculo: 'Simulações', danfse: 'PDFs DANFSe' };
    for (const [rec, v] of Object.entries(uso)) {
      const pct = v.limite === null ? 0 : Math.min(100, (v.usado / v.limite) * 100);
      c.append(el('div', {},
        el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:4px' },
          el('span', {}, nomes[rec] || rec), el('strong', {}, `${v.usado.toLocaleString('pt-BR')}${v.limite === null ? ' (sem limite)' : ' / ' + v.limite.toLocaleString('pt-BR')}`)),
        el('div', { class: 'bar' }, el('i', { style: `width:${pct}%;background:${pct > 80 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--teal)'}` }))));
    }
  }

  unmount() {}
}
