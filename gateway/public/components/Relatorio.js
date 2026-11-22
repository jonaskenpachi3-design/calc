/**
 * Nexo Fiscal — Relatorio Component (Placeholder Fase 1)
 * ==========================================================================
 * Relatório White-Label — implementação na Fase 3.
 */

import { el, limpar, aviso } from '../utils.js';

export class Relatorio {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
  }

  render() {
    const div = el('div', { id: 'aba-relatorio' });
    div.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Exportação</div>
        <h1>Relatório Comparativo White-Label</h1>
        <p>Gere relatórios profissionais com logo do escritório e parecer do contador.</p>
      </div>

      <div class="card" style="margin-bottom: 20px; padding: 20px; text-align: center; background: var(--blue-soft); border-color: var(--blue);">
        <div style="font-size: 48px; margin-bottom: 12px;">📊</div>
        <h2 style="margin: 0 0 8px; color: var(--blue);">Relatório White-Label — Fase 3</h2>
        <p class="mut" style="max-width: 600px; margin: 0 auto;">
          Duas abas + painel lateral de personalização PDF.
          <br>PDF via Puppeteer (pixel-perfect) + Excel via ExcelJS.
        </p>
      </div>

      <div class="card">
        <h3>Estrutura</h3>
        <div class="grid" style="margin-top: 12px;">
          <div>
            <strong>Aba 1: Resumo Executivo</strong>
            <ul style="margin: 8px 0; padding-left: 20px;">
              <li>Gráfico de impacto (Chart.js)</li>
              <li>Recomendação de melhor regime</li>
              <li>Cards: Economia, % Redução</li>
            </ul>
          </div>
          <div>
            <strong>Aba 2: Memória de Cálculo</strong>
            <ul style="margin: 8px 0; padding-left: 20px;">
              <li>Tabela nota a nota</li>
              <li>Base, CBS, IBS, IS, Total</li>
              <li>Base legal (LC 116, etc.)</li>
            </ul>
          </div>
          <div>
            <strong>Painel PDF (Lateral)</strong>
            <ul style="margin: 8px 0; padding-left: 20px;">
              <li>Upload Logo do escritório</li>
              <li>Parecer do contador (textarea)</li>
              <li>[Baixar PDF] [Exportar Excel]</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Tecnologia</h3>
        <p class="mut">Puppeteer no gateway (Chromium Alpine ~150MB) renderiza HTML → PDF com header/footer personalizados (logo, CRC, paginação).</p>
      </div>
    `;
    return div;
  }

  mount() {}
  unmount() {}
}