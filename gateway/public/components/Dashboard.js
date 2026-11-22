/**
 * Nexo Fiscal — Dashboard Component
 * ==========================================================================
 * Dashboard executivo com KPIs, gráfico comparativo e alertas.
 */

import { el, limpar, kpi, dinheiro, aviso, formatCNPJ } from '../utils.js';

export class Dashboard {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
    this.chart = null;
  }

  render() {
    const empresa = this.state.empresaAtiva;
    const div = el('div', { id: 'aba-dashboard' });
    div.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Centro de controle</div>
        <h1>Dashboard — ${empresa?.razao_social || 'Empresa'}</h1>
        <p>Acompanhe o impacto da Reforma Tributária no seu faturamento.</p>
      </div>

      <div class="stats" id="kpi-cards"></div>

      <div class="two">
        <div class="card">
          <h2>Comparativo de Cenários</h2>
          <div style="position: relative; height: 320px;">
            <canvas id="grafico-comparativo"></canvas>
          </div>
        </div>
        <div class="card">
          <h2>Alertas</h2>
          <div id="alertas-container"></div>
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--bd);">
            <h3>Uso do Plano</h3>
            <div class="grid" id="uso-plano"></div>
          </div>
        </div>
      </div>

      <div class="two" style="margin-top: 16px;">
        <div class="card">
          <h2>Empresa Selecionada</h2>
          <div class="grid" style="margin-top: 12px;">
            <div><strong>Razão Social:</strong> ${empresa?.razao_social || '—'}</div>
            <div><strong>CNPJ:</strong> ${formatCNPJ(empresa?.cnpj)}</div>
            <div><strong>Regime:</strong> ${this.formatRegime(empresa?.regime_atual)}</div>
            <div><strong>CNAE Principal:</strong> ${empresa?.cnae_principal || 'Não informado'}</div>
          </div>
          <div class="row" style="margin-top: 16px;">
            <button class="sec" id="trocar-empresa-dash">Trocar de Empresa</button>
          </div>
        </div>
        <div class="card">
          <h2>Ações Rápidas</h2>
          <div class="actions">
            <button data-ir="simular" class="sec">＋ Nova Simulação</button>
            <button data-ir="lote" class="sec">⇧ Simulador em Lote</button>
            <button data-ir="danfse" class="sec">▧ Central DANFSe</button>
            <button data-ir="configuracoes" class="sec">⚙ Configurações</button>
          </div>
        </div>
      </div>
    `;
    return div;
  }

  async mount() {
    await this.carregarDashboard();

    document.getElementById('trocar-empresa-dash')?.addEventListener('click', () => {
      this.state.setEmpresaAtiva(null);
      this.router.navigate('dashboard');
    });

    document.querySelectorAll('[data-ir]').forEach(btn => {
      btn.addEventListener('click', () => this.router.navigate(btn.dataset.ir));
    });
  }

  async carregarDashboard() {
    const empresa = this.state.empresaAtiva;
    if (!empresa) return;

    try {
      const data = await this.api.get(`/empresas/${empresa.cnpj}/dashboard`);
      this.renderKPIs(data);
      this.renderGrafico(data.grafico);
      this.renderAlertas(data.alertas);
      this.renderUsoPlano(data.uso);
    } catch (e) {
      console.error('Erro ao carregar dashboard:', e);
      aviso('kpi-cards', 'Erro ao carregar dados do dashboard. Tente recarregar a página.', 'err');
    }
  }

  renderKPIs(data) {
    const container = document.getElementById('kpi-cards');
    limpar(container);

    const f = data.faturamentoAnalisado;
    const c = data.cargaAtual;
    const p = data.projecaoReforma;
    const d = data.diferenca;

    container.append(
      kpi('Faturamento Analisado', f.valor, false),
      kpi('Carga Tributária Atual', c.valor, false),
      kpi('Projeção Reforma (CBS+IBS)', p.valor, false),
      kpi('Diferença Estimada', d.valor, true)
    );

    // Adicionar detalhes nos KPIs
    const cards = container.querySelectorAll('.kpi');
    if (cards[0]) cards[0].querySelector('.l').textContent = `Faturamento Analisado (${f.qtdNotas.toLocaleString('pt-BR')} notas)`;
    if (cards[1]) cards[1].querySelector('.l').textContent = `Carga Tributária Atual (${c.percentual}%)`;
    if (cards[2]) cards[2].querySelector('.l').textContent = `Projeção Reforma (${p.percentual}%)`;
    if (cards[3]) {
      const isAumento = d.tipo === 'aumento';
      cards[3].querySelector('.l').textContent = isAumento ? 'Aumento Estimado' : 'Economia Estimada';
      cards[3].querySelector('.v').style.color = isAumento ? 'var(--red)' : 'var(--green)';
    }
  }

  renderGrafico(graficoData) {
    const ctx = document.getElementById('grafico-comparativo');
    if (!ctx || !graficoData) return;

    // Destruir gráfico anterior se existir
    if (this.chart) {
      this.chart.destroy();
    }

    // Chart.js global (carregado via CDN no index.html)
    const Chart = window.Chart;
    if (!Chart) {
      console.warn('Chart.js não carregado');
      return;
    }

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: graficoData.labels,
        datasets: graficoData.datasets.map(ds => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: ds.backgroundColor,
          borderRadius: 6,
          borderSkipped: false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${this.formatCurrency(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => this.formatCurrency(v) },
            grid: { color: 'var(--bd)' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  renderAlertas(alertas) {
    const container = document.getElementById('alertas-container');
    limpar(container);

    if (!alertas || alertas.length === 0) {
      container.append(el('div', { class: 'msg ok' }, '✓ Nenhum alerta no momento. Todas as simulações recentes estão consistentes.'));
      return;
    }

    for (const alerta of alertas) {
      container.append(el('div', { class: 'msg warn' },
        el('strong', {}, alerta.mensagem || 'Atenção necessária'),
        alerta.qtd ? el('br') + ` ${alerta.qtd} item(ns) afetado(s)` : ''
      ));
    }
  }

  renderUsoPlano(uso) {
    const container = document.getElementById('uso-plano');
    limpar(container);

    if (!uso) return;

    for (const [recurso, dados] of Object.entries(uso)) {
      const usado = dados.usado || 0;
      const limite = dados.limite;
      const pct = limite === null ? 0 : Math.min(100, (usado / limite) * 100);
      const label = recurso === 'calculo' ? 'Simulações' : 'PDFs DANFSe';

      container.append(el('div', {},
        el('div', { style: 'display: flex; justify-content: space-between; margin-bottom: 4px;' },
          el('span', {}, `${label} neste mês`),
          el('strong', {}, `${usado.toLocaleString('pt-BR')} ${limite === null ? '' : '/ ' + limite.toLocaleString('pt-BR')}`)
        ),
        el('div', { class: 'bar' },
          el('i', { style: `width:${pct}%; background: ${pct > 80 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--teal)'}` })
        )
      ));
    }
  }

  formatCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(val);
  }

  formatRegime(regime) {
    const map = {
      'simples-nacional': 'Simples Nacional',
      'lucro-presumido': 'Lucro Presumido',
      'lucro-real': 'Lucro Real',
      'regime-normal': 'Regime Normal'
    };
    return map[regime] || regime;
  }

  unmount() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}