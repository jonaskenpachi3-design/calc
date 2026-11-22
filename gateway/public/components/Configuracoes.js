/**
 * Nexo Fiscal — Configuracoes Component (Placeholder Fase 1)
 * ==========================================================================
 * Configurações & Assinatura — implementação na Fase 4.
 */

import { el, limpar, aviso, formatCNPJ } from '../utils.js';

export class Configuracoes {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
  }

  render() {
    const empresa = this.state.empresaAtiva;
    const user = this.state.user;
    const div = el('div', { id: 'aba-configuracoes' });
    div.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Conta</div>
        <h1>Configurações & Assinatura</h1>
        <p>Gerencie seu plano, dados do escritório e chaves de API.</p>
      </div>

      <div class="card" style="margin-bottom: 20px; padding: 20px; text-align: center; background: var(--amber-soft); border-color: var(--amber);">
        <div style="font-size: 48px; margin-bottom: 12px;">⚙️</div>
        <h2 style="margin: 0 0 8px; color: var(--amber);">Configurações — Fase 4</h2>
        <p class="mut" style="max-width: 600px; margin: 0 auto;">
          Barra de uso do plano, upgrade, dados do escritório (logo, CRC, responsável) para white-label.
        </p>
      </div>

      <div class="card">
        <h2>Plano Atual</h2>
        <div class="row" style="align-items: center; gap: 16px; margin-bottom: 16px;">
          <div style="flex: 1;">
            <div class="mut small">Plano</div>
            <strong>${this.formatPlano(user?.plano)}</strong>
          </div>
          <div style="flex: 1;">
            <div class="mut small">CNPJs Usados / Limite</div>
            <strong>— / —</strong>
          </div>
          <button class="sec" id="btn-upgrade">Aumentar Limite</button>
        </div>
        <div class="bar" style="height: 8px; background: #edf1f4; border-radius: 99px; overflow: hidden;">
          <i style="display: block; height: 100%; width: 0%; background: var(--amber);"></i>
        </div>
      </div>

      <div class="card">
        <h2>Dados do Escritório (White-Label)</h2>
        <p class="mut">Estes dados aparecem no rodapé de todos os relatórios e PDFs gerados.</p>
        <div class="grid" style="margin-top: 12px;">
          <div>
            <label>Logo</label>
            <div class="row" style="align-items: center; gap: 12px;">
              <div id="logo-preview" style="width: 80px; height: 80px; border: 1px dashed var(--bd); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--mut); font-size: 12px;">Sem logo</div>
              <div>
                <input type="file" id="logo-upload" accept="image/*" style="display: none;">
                <button class="sec" id="btn-logo-upload">Selecionar Logo</button>
                <span class="mut small">PNG/JPG, máx 500KB</span>
              </div>
            </div>
          </div>
          <div>${this.campo('Nome do Escritório', 'ex: Sousa Contabilidade Ltda', 'c-nome-escritorio').outerHTML}</div>
          <div>${this.campo('Responsável Técnico', 'ex: João Sousa', 'c-responsavel').outerHTML}</div>
          <div>${this.campo('CRC', 'ex: 1SP123456/O-7', 'c-crc').outerHTML}</div>
          <div>${this.campo('E-mail Contato', 'ex: contato@sousa.com.br', 'c-email-escritorio').outerHTML}</div>
        </div>
        <div class="row" style="margin-top: 16px;">
          <button class="sec" id="btn-salvar-escritorio">Salvar Dados</button>
        </div>
      </div>

      <div class="card">
        <h2>Chaves de API (Integração)</h2>
        <p class="mut">Para conectar seu sistema de gestão ao simulador. Peça ao responsável de TI.</p>
        <details>
          <summary>Gerenciar Chaves</summary>
          <div class="grid" style="margin-top: 10px">
            <div>${this.campo('Nome para a nova chave', 'ex: Sistema de Vendas', 'k-nome').outerHTML}</div>
          </div>
          <div class="row"><button class="sec" id="k-criar">Criar Chave</button></div>
          <div id="k-msg" role="status"></div>
          <div class="scroll"><table><thead><tr><th>Nome</th><th>Último Uso</th><th></th></tr></thead><tbody id="k-lista"></tbody></table></div>
        </details>
      </div>
    `;
    return div;
  }

  mount() {
    document.getElementById('btn-logo-upload')?.addEventListener('click', () => {
      document.getElementById('logo-upload').click();
    });

    document.getElementById('logo-upload')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const preview = document.getElementById('logo-preview');
          preview.innerHTML = `<img src="${ev.target.result}" style="max-width: 100%; max-height: 100%; border-radius: 4px;">`;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  campo(label, placeholder, id) {
    return el('div', {},
      el('label', { for: id }, label),
      el('input', { id, placeholder })
    );
  }

  formatPlano(plano) {
    const map = {
      gratuito: 'Gratuito',
      profissional: 'Profissional',
      ilimitado: 'Ilimitado',
      escritorio: 'Escritório'
    };
    return map[plano] || plano || '—';
  }

  unmount() {}
}