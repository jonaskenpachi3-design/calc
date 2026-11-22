/**
 * Nexo Fiscal — Auditoria Component
 * ==========================================================================
 * Auditoria e Saneamento de Itens: DataTable com filtros, paginação,
 * edição inline, recálculo item e em massa.
 */

import { el, limpar, aviso, campo, dinheiro, formatCNPJ, toast, debounce, criarModal, spinner, semAcento } from '../utils.js';

export class Auditoria {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
    this.jobId = null;
    this.itens = [];
    this.totalItens = 0;
    this.paginaAtual = 1;
    this.itensPorPagina = 50;
    this.totalPaginas = 1;
    this.filtroStatus = 'todos'; // todos, erro, alerta, calculado
    this.buscaTermo = '';
    this.selecionados = new Set();
    this.cacheClassificacoes = new Map();
    this.cacheNCM = new Map();
    this.cacheNBS = new Map();
    this.ordenacao = { coluna: null, direcao: 'asc' };
  }

  render() {
    const params = this.router.getParams();
    this.jobId = params.jobId || this.jobId;

    const div = el('div', { id: 'aba-auditoria' });
    div.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Observabilidade</div>
        <h1>Auditoria de Itens</h1>
        <p>Corrija itens com erro/alerta usando os retornos da calculadora oficial.</p>
      </div>

      ${this.jobId ? this.renderAuditoria() : this.renderSemJob()}
    `;
    return div;
  }

  renderSemJob() {
    return `
      <div class="card" style="text-align: center; padding: 60px 20px;">
        <div style="font-size: 48px; margin-bottom: 12px;">🔍</div>
        <h2>Auditoria de Itens</h2>
        <p class="mut" style="max-width: 500px; margin: 0 auto 24px;">
          Acesse esta tela a partir do <strong>Simulador em Lote</strong> após processar um arquivo
          que contenha itens com erro ou alerta. O redirecionamento é automático.
        </p>
        <button class="sec" id="ir-lote">Ir para Simulador em Lote</button>
      </div>
    `;
  }

  renderAuditoria() {
    return `
      <div class="card" style="margin-bottom: 16px;">
        <div class="row" style="justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
          <div>
            <h2 style="margin: 0;">Lote #${this.jobId.slice(0, 8)}...</h2>
            <p class="mut small" style="margin: 4px 0 0;">Job de simulação em lote</p>
          </div>
          <div class="row" style="gap: 8px;">
            <button class="sec" id="btn-atualizar">${spinner(16)} Atualizar</button>
            <button id="btn-recalcular-selecionados" disabled style="min-width: 200px;">
              Recalcular Selecionados (0)
            </button>
          </div>
        </div>

        <!-- Filtros -->
        <div class="row" style="gap: 12px; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--bd);">
          <div class="row" style="gap: 8px;" role="tablist" aria-label="Filtros de status">
            <button class="filtro-aba" data-status="todos" role="tab" aria-selected="true">Todos <span class="badge" id="count-todos">0</span></button>
            <button class="filtro-aba" data-status="erro" role="tab" aria-selected="false">Com Erro <span class="badge badge-erro" id="count-erro">0</span></button>
            <button class="filtro-aba" data-status="alerta" role="tab" aria-selected="false">Com Alerta <span class="badge badge-alerta" id="count-alerta">0</span></button>
            <button class="filtro-aba" data-status="calculado" role="tab" aria-selected="false">Calculados <span class="badge" id="count-calculado">0</span></button>
          </div>
          <div style="flex: 1; min-width: 250px;">
            <label for="busca-auditoria" class="mut small">Buscar (nota, produto, NCM, classificação)</label>
            <input type="text" id="busca-auditoria" placeholder="Digite para filtrar..." style="margin-top: 4px;">
          </div>
        </div>
      </div>

      <!-- DataTable -->
      <div class="card" style="overflow: hidden;">
        <div class="scroll" style="margin: -22px -22px 0 -22px; border-radius: 0 0 var(--radius) var(--radius);">
          <table id="tabela-auditoria">
            <thead>
              <tr>
                <th style="width: 48px;">
                  <input type="checkbox" id="check-todos" aria-label="Selecionar todos">
                </th>
                <th data-col="notaNumero">Nº Nota <span class="sort-indicator"></span></th>
                <th data-col="descricao">Produto/Serviço <span class="sort-indicator"></span></th>
                <th data-col="codigo">NCM/NBS <span class="sort-indicator"></span></th>
                <th data-col="classificacao">Classificação <span class="sort-indicator"></span></th>
                <th data-col="valor" class="n">Valor <span class="sort-indicator"></span></th>
                <th data-col="regime">Regime <span class="sort-indicator"></span></th>
                <th data-col="status">Status</th>
                <th style="min-width: 300px;">Motivo do Alerta / Mensagens</th>
                <th style="width: 140px;">Ação</th>
              </tr>
            </thead>
            <tbody id="tbody-auditoria"></tbody>
          </table>
        </div>

        <!-- Paginação -->
        <div id="paginacao" class="row" style="justify-content: center; padding: 16px 22px; gap: 8px;"></div>
      </div>

      <!-- Resumo -->
      <div class="card" style="margin-top: 16px;">
        <h3>Resumo da Auditoria</h3>
        <div class="grid" id="resumo-auditoria" style="margin-top: 12px;"></div>
      </div>
    `;
  }

  mount() {
    if (!this.jobId) {
      document.getElementById('ir-lote')?.addEventListener('click', () => this.router.navigate('lote'));
      return;
    }

    this.carregarItens();
    this.bindEvents();
  }

  bindEvents() {
    // Filtros de aba
    document.querySelectorAll('.filtro-aba').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filtroStatus = btn.dataset.status;
        this.paginaAtual = 1;
        this.atualizarFiltrosUI();
        this.carregarItens();
      });
    });

    // Busca
    const buscaInput = document.getElementById('busca-auditoria');
    buscaInput?.addEventListener('input', debounce((e) => {
      this.buscaTermo = e.target.value;
      this.paginaAtual = 1;
      this.carregarItens();
    }, 300));

    // Ordenação
    document.querySelectorAll('#tabela-auditoria th[data-col]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => this.ordenarPor(th.dataset.col));
    });

    // Checkbox todos
    document.getElementById('check-todos')?.addEventListener('change', (e) => {
      this.selecionarTodos(e.target.checked);
    });

    // Atualizar
    document.getElementById('btn-atualizar')?.addEventListener('click', () => this.carregarItens());

    // Recalcular selecionados
    document.getElementById('btn-recalcular-selecionados')?.addEventListener('click', () => this.recalcularSelecionados());
  }

  async carregarItens() {
    const btnAtualizar = document.getElementById('btn-atualizar');
    if (btnAtualizar) {
      btnAtualizar.disabled = true;
      btnAtualizar.innerHTML = `${spinner(16)} Carregando...`;
    }

    try {
      const params = new URLSearchParams({
        status: this.filtroStatus,
        page: this.paginaAtual,
        size: this.itensPorPagina
      });
      if (this.buscaTermo) params.set('busca', this.buscaTermo);
      if (this.ordenacao.coluna) {
        params.set('sort', this.ordenacao.coluna);
        params.set('order', this.ordenacao.direcao);
      }

      const data = await this.api.get(`/simulacoes/lote/${this.jobId}/itens?${params}`);

      this.itens = data.itens || [];
      this.totalItens = data.total || 0;
      this.totalPaginas = data.totalPages || 1;

      this.renderTabela();
      this.renderPaginacao();
      this.renderResumo();
      this.atualizarContadoresFiltros();
      this.atualizarBotaoRecalcular();

    } catch (e) {
      console.error('Erro ao carregar itens:', e);
      toast('Erro ao carregar itens: ' + e.message, 'err');
    } finally {
      if (btnAtualizar) {
        btnAtualizar.disabled = false;
        btnAtualizar.innerHTML = `${spinner(16)} Atualizar`;
      }
    }
  }

  renderTabela() {
    const tbody = document.getElementById('tbody-auditoria');
    limpar(tbody);

    if (this.itens.length === 0) {
      tbody.appendChild(el('tr', {},
        el('td', { colspan: 10, style: 'text-align: center; padding: 40px; color: var(--mut);' },
          'Nenhum item encontrado para este filtro.'
        )
      ));
      return;
    }

    for (const item of this.itens) {
      const tr = el('tr', { 'data-id': item.id });
      const selecionado = this.selecionados.has(item.id);

      // Checkbox
      const checkbox = el('input', {
        type: 'checkbox',
        checked: selecionado,
        onchange: (e) => this.toggleSelecao(item.id, e.target.checked),
        'aria-label': `Selecionar item ${item.notaNumero}-${item.itemIndice}`
      });

      // Nota
      const nota = el('td', {},
        el('strong', {}, item.notaNumero || '—'),
        item.notaData ? el('div', { class: 'mut small' }, formatDataBR(item.notaData)) : null
      );

      // Descrição
      const descricao = el('td', {},
        el('strong', {}, item.descricao || '—'),
        item.itemIndice !== undefined ? el('div', { class: 'mut small' }, `Item ${item.itemIndice + 1}`) : null
      );

      // Código (NCM/NBS) - editável
      const codigoCell = el('td', {});
      const codigoInput = el('input', {
        type: 'text',
        value: item.codigo || '',
        placeholder: item.codigo ? '' : 'Código...',
        inputmode: 'numeric',
        maxlength: 12,
        style: 'width: 100%; min-width: 100px;',
        title: 'Clique para editar. Enter para salvar.'
      });
      codigoInput.addEventListener('blur', () => this.salvarEdicao(item.id, 'codigo', codigoInput.value));
      codigoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') codigoInput.blur(); });
      // Busca type-ahead
      codigoInput.addEventListener('input', debounce(async (e) => {
        const val = e.target.value.trim();
        if (val.length >= 3) {
          await this.mostrarSugestoesCodigo(item, val, codigoInput);
        }
      }, 300));
      codigoCell.appendChild(codigoInput);

      // Classificação - editável (select)
      const classifCell = el('td', {});
      const classificacoes = await this.getClassificacoes();
      const classifSelect = el('select', {
        style: 'width: 100%; min-width: 160px;',
        title: 'Selecione a classificação tributária'
      });
      classifSelect.appendChild(el('option', { value: '' }, '— Selecione —'));
      for (const c of classificacoes) {
        classifSelect.appendChild(el('option', {
          value: c.codigo,
          selected: item.classificacao === c.codigo
        }, `${c.codigo} – ${(c.descricao || c.descricaoTratamentoTributario || '').slice(0, 80)}`));
      }
      classifSelect.addEventListener('change', () => this.salvarEdicao(item.id, 'classificacao', classifSelect.value));
      classifCell.appendChild(classifSelect);

      // Valor - editável
      const valorCell = el('td', { class: 'n' });
      const valorInput = el('input', {
        type: 'text',
        value: item.valor ? numero(item.valor) : '',
        inputmode: 'decimal',
        placeholder: '0,00',
        style: 'width: 100%; min-width: 100px; text-align: right;',
        title: 'Clique para editar. Enter para salvar.'
      });
      valorInput.addEventListener('blur', () => this.salvarEdicao(item.id, 'valor', valorInput.value.replace(',', '.')));
      valorInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') valorInput.blur(); });
      valorCell.appendChild(valorInput);

      // Regime
      const regime = el('td', {},
        el('span', { class: 'pill ' + (item.regime === 'simples-nacional' ? 'pill-blue' : 'pill-gray') },
          this.formatRegime(item.regime)
        )
      );

      // Status badge
      const statusClass = item.status === 'erro' ? 'badge-erro' : item.status === 'alerta' ? 'badge-alerta' : 'badge-calculado';
      const statusTexto = item.status === 'erro' ? 'Erro' : item.status === 'alerta' ? 'Alerta' : 'Calculado';
      const status = el('td', {},
        el('span', { class: 'badge ' + statusClass }, statusTexto)
      );

      // Motivo/Mensagens
      const mensagens = item.mensagens || [];
      const motivo = item.motivoAlerta || (mensagens.length > 0 ? mensagens.join('; ') : '—');
      const motivoCell = el('td', { style: 'max-width: 300px;' },
        motivo !== '—' ? el('div', { class: 'mut small', style: 'color: var(--red);' }, motivo) : el('span', { class: 'mut' }, '—')
      );

      // Ações
      const acoes = el('td', {});
      const btnRecalcular = el('button', {
        class: 'sec',
        style: 'min-width: 100px; font-size: 12px; padding: 6px 10px;',
        onclick: () => this.recalcularItem(item.id)
      }, 'Recalcular');
      acoes.appendChild(btnRecalcular);

      // Sugestão de classificação se houver
      if (item.sugestaoClassificacao && item.classificacao !== item.sugestaoClassificacao) {
        const btnSugerir = el('button', {
          class: 'link',
          style: 'font-size: 11px; margin-top: 4px;',
          onclick: () => this.aplicarSugestao(item.id, item.sugestaoClassificacao)
        }, `Usar sugestão: ${item.sugestaoClassificacao}`);
        acoes.appendChild(el('br'));
        acoes.appendChild(btnSugerir);
      }

      tr.append(
        el('td', { style: 'display: flex; align-items: center; justify-content: center;' }, checkbox),
        nota, descricao, codigoCell, classifCell, valorCell, regime, status, motivoCell, acoes
      );

      tbody.appendChild(tr);
    }
  }

  async getClassificacoes() {
    if (!this.cacheClassificacoes.has('todas')) {
      try {
        const data = await this.api.get(`/v1/dados/classificacoes-tributarias/cbs-ibs?data=${this.hoje()}`);
        this.cacheClassificacoes.set('todas', data || []);
      } catch {
        this.cacheClassificacoes.set('todas', []);
      }
    }
    return this.cacheClassificacoes.get('todas');
  }

  async mostrarSugestoesCodigo(item, termo, input) {
    // Remover sugestões anteriores
    const existente = input.parentNode.querySelector('.sugestoes-codigo');
    if (existente) existente.remove();

    const tipo = item.codigo?.length === 9 ? 'servico' : 'produto';
    const cacheKey = `${tipo}-${termo}`;
    let sugestoes = [];

    if (this.cacheNCM.has(cacheKey) || this.cacheNBS.has(cacheKey)) {
      sugestoes = tipo === 'servico' ? this.cacheNBS.get(cacheKey) : this.cacheNCM.get(cacheKey);
    } else {
      try {
        const url = tipo === 'servico'
          ? `/v1/dados/nbs/lista?data=${this.hoje()}`
          : `/v1/dados/ncm/vigentes?data=${this.hoje()}`;
        const data = await this.api.get(url);
        const palavras = semAcento(termo).split(/\s+/).filter(Boolean);
        sugestoes = (data || []).filter(c => {
          const alvo = semAcento(`${c.ncm || c.codigo || ''} ${c.descricao || ''}`);
          return palavras.every(p => alvo.includes(p));
        }).slice(0, 8);

        if (tipo === 'servico') this.cacheNBS.set(cacheKey, sugestoes);
        else this.cacheNCM.set(cacheKey, sugestoes);
      } catch {
        sugestoes = [];
      }
    }

    if (sugestoes.length === 0) return;

    const container = el('div', { class: 'sugestoes-codigo achados', style: 'position: absolute; z-index: 100; max-height: 200px; overflow-y: auto; width: 100%;' });
    for (const s of sugestoes) {
      const cod = String(s.ncm || s.codigo);
      container.appendChild(el('button', {
        type: 'button',
        class: 'achado',
        onclick: () => {
          input.value = cod;
          this.salvarEdicao(item.id, 'codigo', cod);
          container.remove();
        }
      }, el('strong', {}, cod), ' – ', String(s.descricao || '').slice(0, 100)));
    }
    input.parentNode.style.position = 'relative';
    input.parentNode.appendChild(container);
  }

  async salvarEdicao(itemId, campo, valor) {
    const item = this.itens.find(i => i.id === itemId);
    if (!item) return;

    const valorAntigo = item[campo];
    if (String(valorAntigo) === String(valor)) return;

    item[campo] = valor;
    item.status = 'calculado'; // Marcar como modificado

    // Re-render apenas a linha
    this.renderTabela();
    this.atualizarBotaoRecalcular();
  }

  async aplicarSugestao(itemId, sugestao) {
    const item = this.itens.find(i => i.id === itemId);
    if (!item) return;

    item.classificacao = sugestao;
    item.status = 'calculado';
    this.renderTabela();
    this.atualizarBotaoRecalcular();
    toast('Classificação atualizada para sugestão da calculadora', 'ok');
  }

  toggleSelecao(itemId, selecionado) {
    if (selecionado) this.selecionados.add(itemId);
    else this.selecionados.delete(itemId);
    this.atualizarBotaoRecalcular();
    this.atualizarCheckboxTodos();
  }

  selecionarTodos(selecionado) {
    if (selecionado) {
      this.itens.forEach(i => this.selecionados.add(i.id));
    } else {
      this.selecionados.clear();
    }
    this.renderTabela(); // Re-render para atualizar checkboxes
    this.atualizarBotaoRecalcular();
  }

  atualizarCheckboxTodos() {
    const checkTodos = document.getElementById('check-todos');
    if (checkTodos) {
      checkTodos.checked = this.itens.length > 0 && this.selecionados.size === this.itens.length;
      checkTodos.indeterminate = this.selecionados.size > 0 && this.selecionados.size < this.itens.length;
    }
  }

  atualizarBotaoRecalcular() {
    const btn = document.getElementById('btn-recalcular-selecionados');
    if (btn) {
      btn.disabled = this.selecionados.size === 0;
      btn.textContent = `Recalcular Selecionados (${this.selecionados.size})`;
    }
  }

  async recalcularItem(itemId) {
    const item = this.itens.find(i => i.id === itemId);
    if (!item) return;

    const btn = event.target;
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
      await this.recalcularItens([item]);
      toast('Item recalculado com sucesso', 'ok');
    } catch (e) {
      toast('Erro ao recalcular: ' + e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  }

  async recalcularSelecionados() {
    if (this.selecionados.size === 0) return;

    const itensRecalcular = this.itens.filter(i => this.selecionados.has(i.id));
    const btn = document.getElementById('btn-recalcular-selecionados');
    const textoOriginal = btn.textContent;

    btn.disabled = true;
    btn.textContent = `${spinner(16)} Recalculando ${itensRecalcular.length}...`;

    try {
      await this.recalcularItens(itensRecalcular);
      this.selecionados.clear();
      toast(`${itensRecalcular.length} item(ns) recalculado(s) com sucesso`, 'ok');
      await this.carregarItens(); // Recarregar para pegar status atualizados
    } catch (e) {
      toast('Erro ao recalcular: ' + e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  }

  async recalcularItens(itens) {
    const payload = { itens: itens.map((item, idx) => ({
      indice: idx,
      codigo: item.codigo,
      classificacao: item.classificacao,
      valor: String(item.valor || 0)
    })) };

    await this.api.post(`/simulacoes/lote/${this.jobId}/recalcular`, payload);
  }

  renderPaginacao() {
    const container = document.getElementById('paginacao');
    limpar(container);

    if (this.totalPaginas <= 1) return;

    const maxVisiveis = 5;
    let inicio = Math.max(1, this.paginaAtual - Math.floor(maxVisiveis / 2));
    let fim = Math.min(this.totalPaginas, inicio + maxVisiveis - 1);

    if (fim - inicio + 1 < maxVisiveis) {
      inicio = Math.max(1, fim - maxVisiveis + 1);
    }

    // Primeira
    if (inicio > 1) {
      container.appendChild(this.criarBtnPagina(1, '« Primeira'));
    }
    // Anterior
    if (this.paginaAtual > 1) {
      container.appendChild(this.criarBtnPagina(this.paginaAtual - 1, '‹ Anterior'));
    }

    // Páginas
    for (let i = inicio; i <= fim; i++) {
      container.appendChild(this.criarBtnPagina(i, String(i), i === this.paginaAtual));
    }

    // Próxima
    if (this.paginaAtual < this.totalPaginas) {
      container.appendChild(this.criarBtnPagina(this.paginaAtual + 1, 'Próxima ›'));
    }
    // Última
    if (fim < this.totalPaginas) {
      container.appendChild(this.criarBtnPagina(this.totalPaginas, 'Última »'));
    }
  }

  criarBtnPagina(pagina, texto, ativo = false) {
    const btn = el('button', {
      class: ativo ? '' : 'sec',
      style: 'min-width: 40px;',
      disabled: ativo,
      onclick: () => {
        this.paginaAtual = pagina;
        this.carregarItens();
      }
    }, texto);
    if (ativo) btn.setAttribute('aria-current', 'page');
    return btn;
  }

  renderResumo() {
    const container = document.getElementById('resumo-auditoria');
    limpar(container);

    const total = this.totalItens;
    const erros = this.itens.filter(i => i.status === 'erro').length;
    const alertas = this.itens.filter(i => i.status === 'alerta').length;
    const calculados = this.itens.filter(i => i.status === 'calculado').length;

    const cards = [
      { label: 'Total de Itens', valor: total, principal: true },
      { label: 'Com Erro', valor: erros, cor: 'var(--red)' },
      { label: 'Com Alerta', valor: alertas, cor: 'var(--amber)' },
      { label: 'Calculados', valor: calculados, cor: 'var(--green)' }
    ];

    for (const c of cards) {
      const card = el('div', { class: 'kpi' + (c.principal ? ' main' : '') });
      card.innerHTML = `
        <div class="v" style="${c.cor ? `color: ${c.cor};` : ''}">${c.valor.toLocaleString('pt-BR')}</div>
        <div class="l">${c.label}</div>
      `;
      container.appendChild(card);
    }
  }

  atualizarContadoresFiltros() {
    // Contar todos os status (precisaria de query separada ou usar cache)
    // Por simplicidade, usar contadores da página atual
    const counts = {
      todos: this.totalItens,
      erro: this.itens.filter(i => i.status === 'erro').length,
      alerta: this.itens.filter(i => i.status === 'alerta').length,
      calculado: this.itens.filter(i => i.status === 'calculado').length
    };

    for (const [status, count] of Object.entries(counts)) {
      const el = document.getElementById(`count-${status}`);
      if (el) el.textContent = count.toLocaleString('pt-BR');
    }
  }

  atualizarFiltrosUI() {
    document.querySelectorAll('.filtro-aba').forEach(btn => {
      btn.setAttribute('aria-selected', btn.dataset.status === this.filtroStatus);
    });
  }

  ordenarPor(coluna) {
    if (this.ordenacao.coluna === coluna) {
      this.ordenacao.direcao = this.ordenacao.direcao === 'asc' ? 'desc' : 'asc';
    } else {
      this.ordenacao.coluna = coluna;
      this.ordenacao.direcao = 'asc';
    }

    // Atualizar indicadores visuais
    document.querySelectorAll('#tabela-auditoria th[data-col]').forEach(th => {
      const indicator = th.querySelector('.sort-indicator');
      if (indicator) {
        if (th.dataset.col === this.ordenacao.coluna) {
          indicator.textContent = this.ordenacao.direcao === 'asc' ? ' ↑' : ' ↓';
        } else {
          indicator.textContent = '';
        }
      }
    });

    this.paginaAtual = 1;
    this.carregarItens();
  }

  hoje() {
    return new Date().toISOString().slice(0, 10);
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
    // Limpeza se necessário
  }
}

// Helper para formatar número BR
function numero(v) {
  return String(v ?? '').replace('.', ',');
}

function formatDataBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}