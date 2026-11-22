/**
 * Nexo Fiscal — DanfseCentral Component (Placeholder Fase 1)
 * ==========================================================================
 * Central DANFSe — implementação na Fase 4.
 */

import { el, limpar, aviso } from '../utils.js';

export class DanfseCentral {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
  }

  render() {
    const div = el('div', { id: 'aba-danfse' });
    div.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Documento Auxiliar</div>
        <h1>Central de DANFSe</h1>
        <p>Gere PDFs de notas de serviço (DANFSe) a partir de XMLs autorizados.</p>
      </div>

      <div class="card" style="margin-bottom: 20px; padding: 20px; text-align: center; background: var(--green-soft); border-color: var(--green);">
        <div style="font-size: 48px; margin-bottom: 12px;">📄</div>
        <h2 style="margin: 0 0 8px; color: var(--green);">Central DANFSe — Fase 4</h2>
        <p class="mut" style="max-width: 600px; margin: 0 auto;">
          O gerador DANFSe (serviço Go) já existe. Esta tela adicionará:
          <br>• Lote: upload ZIP/XMLs → download ZIP com PDFs
          <br>• Avulso: formulário simples → prévia PDF
          <br>• Histórico com visualização e envio por e-mail
        </p>
      </div>

      <div class="card">
        <h3>Endpoint Atual Disponível</h3>
        <p class="mut">O endpoint <code>POST /v1/danfse</code> já funciona no gateway (proxy para serviço Go).</p>
        <div class="row" style="margin-top: 16px;">
          <button class="sec" id="teste-danfse">Testar Endpoint Atual</button>
        </div>
      </div>
    `;
    return div;
  }

  mount() {
    document.getElementById('teste-danfse')?.addEventListener('click', () => {
      alert('Endpoint: POST /v1/danfse\nParâmetros: stc (0|1|2), canhoto (true|false)\nBody: XML da NFS-e\nRetorna: PDF (blob)');
    });
  }

  unmount() {}
}