/**
 * Nexo Fiscal — CompanySelector Component
 * ==========================================================================
 * Seletor de Empresas (Multi-CNPJ) — Tela pós-login, pré-dashboard.
 * Permite buscar, listar e cadastrar novas empresas do contador.
 */

import { esc, el, limpar, aviso, campo, formatCNPJ, criarModal, toast, debounce, semAcento } from '../utils.js';

export class CompanySelector {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
    this.empresasFiltradas = [];
    this.buscaDebounced = debounce((termo) => this.filtrarEmpresas(termo), 200);
  }

  render() {
    const section = el('section', { id: 'company-selector' });
    section.innerHTML = `
      <div class="page" style="max-width: 900px;">
        <div class="page-head">
          <div class="eyebrow">Seletor de Empresas</div>
          <h1>Escolha a empresa para acessar</h1>
          <p>Você tem acesso a <strong>${this.state.empresas.length}</strong> empresa(s). Use a busca ou cadastre uma nova.</p>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="row" style="justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="flex: 1; min-width: 280px;">
              <label for="busca-empresa" style="margin-bottom: 6px;">Buscar por Razão Social ou CNPJ</label>
              <div style="position: relative;">
                <input type="text" id="busca-empresa" placeholder="Digite para filtrar..." style="padding-right: 40px;">
                <span id="busca-loading" class="spinner" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); display: none;"></span>
              </div>
            </div>
            <button id="btn-nova-empresa" class="sec" style="min-width: 180px;">+ Cadastrar Nova Empresa</button>
          </div>
        </div>

        <div id="lista-empresas" class="grid" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));"></div>

        <div id="vazio" class="mut" hidden style="text-align: center; padding: 40px; grid-column: 1 / -1;">
          Nenhuma empresa encontrada.
        </div>
      </div>
    `;

    return section;
  }

  mount() {
    this.empresasFiltradas = [...this.state.empresas];
    this.renderLista();

    // Busca
    const inputBusca = document.getElementById('busca-empresa');
    inputBusca.addEventListener('input', (e) => {
      this.buscaDebounced(e.target.value);
    });

    // Botão nova empresa
    document.getElementById('btn-nova-empresa').onclick = () => this.abrirModalCadastro();
  }

  filtrarEmpresas(termo) {
    const t = semAcento(termo);
    if (!t) {
      this.empresasFiltradas = [...this.state.empresas];
    } else {
      this.empresasFiltradas = this.state.empresas.filter(emp =>
        semAcento(emp.razao_social).includes(t) ||
        String(emp.cnpj).includes(t.replace(/\D/g, ''))
      );
    }
    this.renderLista();
  }

  renderLista() {
    const container = document.getElementById('lista-empresas');
    const vazio = document.getElementById('vazio');
    limpar(container);

    if (this.empresasFiltradas.length === 0) {
      vazio.hidden = false;
      vazio.textContent = document.getElementById('busca-empresa').value
        ? 'Nenhuma empresa corresponde à busca.'
        : 'Nenhuma empresa cadastrada. Clique em "Cadastrar Nova Empresa" para começar.';
      return;
    }

    vazio.hidden = true;

    for (const emp of this.empresasFiltradas) {
      container.appendChild(this.criarCardEmpresa(emp));
    }
  }

  criarCardEmpresa(emp) {
    const inicial = (emp.razao_social || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    const regimeLabel = this.formatRegime(emp.regime_atual);
    const ultimaSim = emp.ultima_simulacao_at
      ? new Date(emp.ultima_simulacao_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';

    const card = el('div', { class: 'card', style: 'display: flex; flex-direction: column; height: 100%;' });

    card.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px;">
        <div class="avatar" style="width: 48px; height: 48px; font-size: 16px; flex: none;">${esc(inicial)}</div>
        <div style="flex: 1; min-width: 0;">
          <h3 style="margin: 0 0 4px; font-size: 16px;">${esc(emp.razao_social)}</h3>
          <div class="mut small" style="margin-bottom: 8px;">${formatCNPJ(emp.cnpj)}</div>
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <span class="pill pill-blue">${regimeLabel}</span>
            <span class="pill pill-gray">${esc(emp.cnae_principal || 'CNAE não informado')}</span>
          </div>
        </div>
      </div>
      <div style="margin-top: auto; padding-top: 16px; border-top: 1px solid var(--bd); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <div class="mut small">Última simulação: <strong>${ultimaSim}</strong></div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-excluir sec" data-cnpj="${esc(emp.cnpj)}" style="min-width: 100px;" title="Excluir empresa">Excluir</button>
          <button class="btn-acessar" data-cnpj="${esc(emp.cnpj)}" style="min-width: 140px;">Acessar Painel</button>
        </div>
      </div>
    `;

    card.querySelector('.btn-acessar').onclick = () => {
      this.state.setEmpresaAtiva(emp.cnpj);
      this.router.navigate('dashboard');
    };

    card.querySelector('.btn-excluir').onclick = () => this.excluirEmpresa(emp.cnpj, emp.razao_social);

    return card;
  }

  async excluirEmpresa(cnpj, razaoSocial) {
    if (!confirm(`Tem certeza que deseja excluir a empresa "${razaoSocial}" (${formatCNPJ(cnpj)})? Esta ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await this.state.deleteEmpresa(cnpj);
      toast('Empresa excluída com sucesso!', 'ok');
      this.empresasFiltradas = [...this.state.empresas];
      this.renderLista();
    } catch (e) {
      toast('Erro ao excluir empresa: ' + e.message, 'err');
    }
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

  abrirModalCadastro() {
    try {
      const form = el('form', { id: 'form-nova-empresa' });
      form.innerHTML = `
        <div style="margin-bottom: 16px;">
          ${campo('CNPJ', 'Apenas números. Buscaremos os dados automaticamente.',
            el('input', { id: 'c-cnpj', type: 'text', inputmode: 'numeric', maxlength: 18, placeholder: '00.000.000/0000-00', required: true, autocomplete: 'off' }), 'c-cnpj').outerHTML}
        </div>
        <div id="dados-auto" hidden style="margin-bottom: 16px; padding: 12px; background: var(--blue-soft); border-radius: 8px; border: 1px solid var(--bd);">
          <strong>Dados encontrados:</strong>
          <div id="preview-dados" class="mut small" style="margin-top: 4px;"></div>
        </div>
        <div style="margin-bottom: 16px;">
          ${campo('Razão Social', 'Preenchido automaticamente se CNPJ válido.',
            el('input', { id: 'c-razao', placeholder: 'Nome empresarial', required: true }), 'c-razao').outerHTML}
        </div>
        <div style="margin-bottom: 16px;">
          ${campo('Regime Tributário', 'Selecione o regime atual da empresa.',
            el('select', { id: 'c-regime', required: true },
              el('option', { value: '' }, 'Selecione...'),
              el('option', { value: 'simples-nacional' }, 'Simples Nacional'),
              el('option', { value: 'lucro-presumido' }, 'Lucro Presumido'),
              el('option', { value: 'lucro-real' }, 'Lucro Real')
            ), 'c-regime').outerHTML}
        </div>
        <div id="c-msg" role="alert"></div>
      `;

      const modal = criarModal('Cadastrar Nova Empresa', form, [
        { texto: 'Cancelar', class: 'sec', onClick: () => modal.close() },
        { texto: 'Buscar CNPJ', class: 'sec', keepOpen: true, onClick: () => this.buscarCNPJ() },
        { texto: 'Salvar Empresa', class: '', keepOpen: true, onClick: () => this.salvarEmpresa(form, modal) }
      ]);

      // Auto-busca ao digitar CNPJ (debounced)
      const cnpjInput = form.querySelector('#c-cnpj');
      cnpjInput.addEventListener('input', debounce(() => this.buscarCNPJ(cnpjInput.value), 800));

      // Formatar CNPJ ao digitar
      cnpjInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 14) v = v.slice(0, 14);
        if (v.length > 12) v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, '$1.$2.$3/$4-$5');
        else if (v.length > 8) v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})/, '$1.$2.$3/$4');
        else if (v.length > 5) v = v.replace(/^(\d{2})(\d{3})(\d{0,3})/, '$1.$2.$3');
        else if (v.length > 2) v = v.replace(/^(\d{2})(\d{0,3})/, '$1.$2');
        e.target.value = v;
      });

      // Salvar com Enter
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.salvarEmpresa(form, modal);
      });
    } catch (e) {
      console.error('Erro ao abrir modal de cadastro:', e);
      aviso('c-msg', 'Erro ao abrir formulário: ' + e.message, 'err');
    }
  }

  async buscarCNPJ(cnpjValor) {
    const cnpjInput = document.getElementById('c-cnpj');
    const cnpj = cnpjValor || cnpjInput.value.replace(/\D/g, '');

    if (cnpj.length !== 14) {
      this.esconderPreview();
      return;
    }

    const loading = document.getElementById('busca-loading');
    if (loading) loading.style.display = 'inline-block';

    try {
      // Tentar API pública (ReceitaWS / BrasilAPI / CNPJ.ws)
      const dados = await this.consultarCNPJPublico(cnpj);

      if (dados) {
        document.getElementById('c-razao').value = dados.razao_social || '';
        document.getElementById('c-cnpj').value = formatCNPJ(cnpj);

        // Determinar regime sugerido pelo CNAE
        const regimeSugerido = this.sugerirRegimePorCNAE(dados.cnae_fiscal_principal);
        if (regimeSugerido) {
          document.getElementById('c-regime').value = regimeSugerido;
        }

        this.mostrarPreview(dados);
      } else {
        this.esconderPreview();
        aviso('c-msg', 'CNPJ não encontrado na base pública. Preencha os dados manualmente.', 'warn');
      }
    } catch (e) {
      console.warn('Erro ao consultar CNPJ:', e);
      this.esconderPreview();
      aviso('c-msg', 'Erro ao consultar CNPJ. Preencha os dados manualmente.', 'warn');
    } finally {
      if (loading) loading.style.display = 'none';
    }
  }

  async consultarCNPJPublico(cnpj) {
    // Tentar múltiplas APIs em ordem de preferência
    const apis = [
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      `https://receitaws.com.br/v1/cnpj/${cnpj}`,
      `https://cnpj.ws/cnpj/${cnpj}`
    ];

    for (const url of apis) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();

        // Normalizar resposta
        if (data.razao_social || data.company?.name) {
          return {
            razao_social: data.razao_social || data.company?.name || '',
            nome_fantasia: data.nome_fantasia || data.company?.trade_name || '',
            cnae_fiscal_principal: data.cnae_fiscal_principal || data.main_activity?.code || '',
            endereco: data.logradouro ? {
              logradouro: data.logradouro,
              numero: data.numero,
              complemento: data.complemento,
              bairro: data.bairro,
              municipio: data.municipio,
              uf: data.uf,
              cep: data.cep
            } : null
          };
        }
      } catch (e) {
        continue; // Tentar próxima API
      }
    }
    return null;
  }

  sugerirRegimePorCNAE(cnae) {
    if (!cnae) return null;
    const codigo = String(cnae).slice(0, 2);
    // CNAEs 69-70 (serviços profissionais), 86-87 (saúde), 85 (educação) → tendem a Simples
    // CNAEs 01-03 (agro), 05-33 (indústria), 45-47 (comércio) → tendem a Lucro Presumido/Real
    // Isso é apenas sugestão heurística
    const servicos = ['69', '70', '85', '86', '87', '88', '90', '91', '92', '93', '94', '95', '96'];
    return servicos.includes(codigo) ? 'simples-nacional' : 'lucro-presumido';
  }

  mostrarPreview(dados) {
    const container = document.getElementById('dados-auto');
    const preview = document.getElementById('preview-dados');
    container.hidden = false;
    preview.innerHTML = `
      <strong>Razão Social:</strong> ${esc(dados.razao_social || '—')}<br>
      <strong>Nome Fantasia:</strong> ${esc(dados.nome_fantasia || '—')}<br>
      <strong>CNAE Principal:</strong> ${esc(dados.cnae_fiscal_principal || '—')}<br>
      ${dados.endereco ? `<strong>Endereço:</strong> ${esc(dados.endereco.logradouro)}, ${esc(dados.endereco.numero)} - ${esc(dados.endereco.municipio)}/${esc(dados.endereco.uf)}` : ''}
    `;
  }

  esconderPreview() {
    document.getElementById('dados-auto').hidden = true;
  }

  async salvarEmpresa(form, modal) {
    const cnpj = document.getElementById('c-cnpj').value.replace(/\D/g, '');
    const razao = document.getElementById('c-razao').value.trim();
    const regime = document.getElementById('c-regime').value;

    if (!cnpj || cnpj.length !== 14) {
      aviso('c-msg', 'CNPJ inválido. Deve ter 14 dígitos.', 'err');
      return;
    }
    if (!razao) {
      aviso('c-msg', 'Razão Social é obrigatória.', 'err');
      return;
    }
    if (!regime) {
      aviso('c-msg', 'Selecione o regime tributário.', 'err');
      return;
    }

    // O botão "Salvar Empresa" está no footer do modal, não no form
    const modalEl = document.querySelector('.modal');
    const btn = modalEl?.querySelector('.modal-footer button:last-of-type');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Salvando...';
    }

    try {
      const nova = await this.state.createEmpresa({
        cnpj,
        razao_social: razao,
        regime_atual: regime
      });

      toast('Empresa cadastrada com sucesso!', 'ok');
      this.state.setEmpresaAtiva(nova.cnpj);
      modal?.close();
      this.router.navigate('dashboard');
    } catch (e) {
      aviso('c-msg', e.message, 'err');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Salvar Empresa';
      }
    }
  }

  unmount() {
    // Limpeza se necessário
  }
}