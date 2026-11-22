/**
 * Nexo Fiscal — LoteSimulador Component
 * ==========================================================================
 * Simulador em Lote Avançado: DropZone multi-formato (XML/ZIP/CSV),
 * cenários comparativos, progress bar real com polling, redirecionamento automático.
 */

import { el, limpar, aviso, campo, dinheiro, formatCNPJ, toast, debounce, criarModal, spinner, parseCSV, gerarCSV } from '../utils.js';

export class LoteSimulador {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
    this.arquivos = [];
    this.jobId = null;
    this.pollInterval = null;
    this.cenarios = ['regime-atual'];
    this.etapaAtual = '';
  }

  render() {
    const empresa = this.state.empresaAtiva;
    const div = el('div', { id: 'aba-lote' });
    div.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Processamento em Lote</div>
        <h1>Simulador em Lote Avançado</h1>
        <p>Suba arquivos XML (NF-e/NFS-e), ZIP ou CSV e veja o comparativo de CBS e IBS por cenário.</p>
      </div>

      ${this.jobId ? this.renderProgresso() : this.renderFormulario(empresa)}
    `;
    return div;
  }

  renderFormulario(empresa) {
    return `
      <div class="card" id="drop-zone-container">
        <h2>1. Selecione os arquivos</h2>
        <div class="drop" id="drop-zone">
          <div style="font-size: 48px; margin-bottom: 8px;">📁</div>
          <h3>Arraste arquivos aqui ou clique para selecionar</h3>
          <p class="mut">Suporta: <strong>.xml</strong> (NF-e/NFS-e), <strong>.zip</strong> (múltiplos XMLs), <strong>.csv</strong> (modelo)</p>
          <p class="mut small">Máximo 500 notas • 50MB por arquivo</p>
          <input type="file" id="file-input" multiple accept=".xml,.zip,.csv" style="display: none;">
          <div class="row" style="margin-top: 16px; justify-content: center; gap: 12px;">
            <button class="sec" id="btn-selecionar">Selecionar Arquivos</button>
            <button class="sec" id="btn-baixar-modelo">⬇ Baixar Modelo CSV</button>
          </div>
        </div>
        <div id="arquivos-selecionados" style="margin-top: 16px;"></div>
      </div>

      <div class="card" id="cenarios-container" hidden>
        <h2>2. Cenários de Simulação</h2>
        <div class="choice" id="escolha-cenarios">
          <button data-cenario="regime-atual" aria-pressed="true"><span><strong>Regime Atual da Empresa</strong><span class="mut small">${this.formatRegime(empresa?.regime_atual)}</span></span></button>
          <button data-cenario="regime-alternativo" aria-pressed="false"><span><strong>Regime Alternativo (Comparativo)</strong><span class="mut small">Lucro Presumido + Simples Nacional</span></span></button>
        </div>
        <p class="mut small" style="margin-top: 8px;">O regime atual será sempre simulado. O alternativo roda ambos os regimes para comparação.</p>
      </div>

      <div class="card" id="processar-container" hidden>
        <h2>3. Processar</h2>
        <div id="lote-msg" role="alert"></div>
        <div class="row" style="justify-content: flex-end; gap: 12px;">
          <button class="sec" id="btn-limpar">Limpar</button>
          <button id="btn-processar" style="min-width: 200px;">Processar Lote</button>
        </div>
      </div>
    `;
  }

  renderProgresso() {
    return `
      <div class="card" style="margin-bottom: 20px;">
        <div class="page-head" style="margin-bottom: 0;">
          <div class="eyebrow">Processando</div>
          <h1>Simulador em Lote — Progresso</h1>
          <p>Job ID: <code style="font-size: 13px;">${this.jobId.slice(0, 8)}...</code></p>
        </div>
      </div>

      <div class="card">
        <div class="bar-wrap">
          <i id="progress-bar" style="width: 0%;"></i>
        </div>
        <div class="row" style="justify-content: space-between; margin-top: 8px;">
          <span id="progress-text">Iniciando...</span>
          <span id="progress-count" class="mut">0 / 0 notas</span>
        </div>
        <div class="mut small" id="progress-etapa" style="margin-top: 8px;">Aguardando worker...</div>

        <div id="progress-detalhes" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--bd);">
          <h3>Detalhes</h3>
          <div class="grid" style="margin-top: 12px;">
            <div><strong>Total de notas:</strong> <span id="det-total">—</span></div>
            <div><strong>Processadas:</strong> <span id="det-processadas">0</span></div>
            <div><strong>Com erro:</strong> <span id="det-erros">0</span></div>
            <div><strong>Tempo estimado:</strong> <span id="det-tempo">—</span></div>
          </div>
        </div>

        <div class="row" style="margin-top: 20px; justify-content: flex-end; gap: 12px;">
          <button class="sec" id="btn-cancelar">Cancelar</button>
          <button id="btn-ver-resultados" hidden>Ver Resultados</button>
        </div>
      </div>
    `;
  }

  mount() {
    if (this.jobId) {
      this.iniciarPolling();
      this.bindProgressoEvents();
    } else {
      this.bindFormularioEvents();
    }
  }

  bindFormularioEvents() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    // Click to select
    dropZone.addEventListener('click', (e) => {
      if (e.target === dropZone || e.target.closest('h3') || e.target.closest('p')) {
        fileInput.click();
      }
    });

    document.getElementById('btn-selecionar')?.addEventListener('click', () => fileInput.click());

    // Drag & drop
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('over');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('over');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files);
      this.adicionarArquivos(files);
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      this.adicionarArquivos(files);
      fileInput.value = '';
    });

    // Baixar modelo CSV
    document.getElementById('btn-baixar-modelo')?.addEventListener('click', () => this.baixarModeloCSV());

    // Cenários
    document.querySelectorAll('#escolha-cenarios button').forEach(btn => {
      btn.addEventListener('click', () => {
        const cenario = btn.dataset.cenario;
        if (cenario === 'regime-alternativo') {
          btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
          this.cenarios = btn.getAttribute('aria-pressed') === 'true'
            ? ['regime-atual', 'regime-alternativo']
            : ['regime-atual'];
        }
      });
    });

    // Processar
    document.getElementById('btn-processar')?.addEventListener('click', () => this.processarLote());

    // Limpar
    document.getElementById('btn-limpar')?.addEventListener('click', () => this.limparTudo());
  }

  bindProgressoEvents() {
    document.getElementById('btn-cancelar')?.addEventListener('click', () => this.cancelarJob());
    document.getElementById('btn-ver-resultados')?.addEventListener('click', () => this.irParaResultados());
  }

  adicionarArquivos(files) {
    const validos = files.filter(f => {
      const ext = f.name.toLowerCase().split('.').pop();
      if (!['xml', 'zip', 'csv'].includes(ext)) {
        toast(`Arquivo ignorado: ${f.name} (extensão não suportada)`, 'warn');
        return false;
      }
      if (f.size > 50 * 1024 * 1024) {
        toast(`Arquivo muito grande: ${f.name} (máx 50MB)`, 'err');
        return false;
      }
      return true;
    });

    if (validos.length === 0) return;

    this.arquivos = [...this.arquivos, ...validos];
    this.renderArquivosSelecionados();
    this.atualizarVisibilidadeSecoes();
  }

  renderArquivosSelecionados() {
    const container = document.getElementById('arquivos-selecionados');
    limpar(container);

    if (this.arquivos.length === 0) return;

    let totalNotas = 0;
    const lista = el('div', { style: 'display: flex; flex-direction: column; gap: 8px;' });

    this.arquivos.forEach((file, idx) => {
      const ext = file.name.toLowerCase().split('.').pop();
      const icone = ext === 'zip' ? '📦' : ext === 'csv' ? '📊' : '📄';
      const item = el('div', { class: 'card', style: 'padding: 12px 16px; display: flex; align-items: center; gap: 12px;' });
      item.innerHTML = `
        <span style="font-size: 24px;">${icone}</span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.name}</div>
          <div class="mut small">${(file.size / 1024).toFixed(1)} KB • ${ext.toUpperCase()}</div>
        </div>
        <button class="link" data-idx="${idx}">Remover</button>
      `;
      item.querySelector('button').onclick = () => this.removerArquivo(idx);
      lista.appendChild(item);
    });

    container.appendChild(el('h3', {}, `${this.arquivos.length} arquivo(s) selecionado(s)`));
    container.appendChild(lista);
  }

  removerArquivo(idx) {
    this.arquivos.splice(idx, 1);
    this.renderArquivosSelecionados();
    this.atualizarVisibilidadeSecoes();
  }

  atualizarVisibilidadeSecoes() {
    const temArquivos = this.arquivos.length > 0;
    document.getElementById('cenarios-container').hidden = !temArquivos;
    document.getElementById('processar-container').hidden = !temArquivos;
  }

  async baixarModeloCSV() {
    const cabecalho = ['tipo', 'descricao', 'codigo', 'classificacao', 'valor', 'uf', 'municipio', 'data', 'atividade'];
    const linhas = [
      ['produto', 'Carne bovina fresca', '02011000', '200015', '1500.00', 'SP', '3550308', '2025-01-15', ''],
      ['servico', 'Consultoria em TI', '', '200028', '5000.00', 'SP', '3550308', '2025-01-15', '6201-5/01'],
    ];
    const csv = gerarCSV(cabecalho, linhas);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-lote-simulacao.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('Modelo CSV baixado', 'ok');
  }

  async processarLote() {
    if (this.arquivos.length === 0) {
      aviso('lote-msg', 'Selecione ao menos um arquivo.', 'warn');
      return;
    }

    const empresa = this.state.empresaAtiva;
    if (!empresa) {
      aviso('lote-msg', 'Nenhuma empresa selecionada.', 'err');
      return;
    }

    const btn = document.getElementById('btn-processar');
    btn.disabled = true;
    btn.innerHTML = `${spinner(20)} Enviando...`;
    aviso('lote-msg');

    try {
      const formData = new FormData();
      this.arquivos.forEach(f => formData.append('files', f));
      formData.append('cnpj', empresa.cnpj);
      formData.append('regime_atual', empresa.regime_atual);
      formData.append('cenarios', JSON.stringify(this.cenarios));

      const result = await this.api.upload('/simulacoes/lote/xml', formData);

      this.jobId = result.jobId;
      this.etapaAtual = 'queued';

      // Re-render para mostrar progresso
      const root = document.getElementById('app-root');
      const content = root.querySelector('#content');
      content.innerHTML = '';
      content.appendChild(this.render());
      this.mount();

    } catch (e) {
      aviso('lote-msg', e.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Processar Lote';
    }
  }

  iniciarPolling() {
    this.pollInterval = setInterval(() => this.verificarProgresso(), 2000);
    this.verificarProgresso(); // Imediato
  }

  async verificarProgresso() {
    try {
      const status = await this.api.get(`/simulacoes/lote/${this.jobId}/status`);

      this.atualizarProgressoUI(status);

      if (status.status === 'completed' || status.status === 'failed') {
        this.pararPolling();
        if (status.status === 'completed') {
          this.mostrarConclusao(status);
        } else {
          this.mostrarErro(status);
        }
      }
    } catch (e) {
      console.error('Erro ao verificar progresso:', e);
      // Continua tentando
    }
  }

  atualizarProgressoUI(status) {
    const progress = status.progress || { total: 0, processados: 0, erros: 0 };
    const total = progress.total || 1;
    const processados = progress.processados || 0;
    const pct = Math.round((processados / total) * 100);

    const bar = document.getElementById('progress-bar');
    const text = document.getElementById('progress-text');
    const count = document.getElementById('progress-count');
    const etapa = document.getElementById('progress-etapa');
    const detTotal = document.getElementById('det-total');
    const detProcessadas = document.getElementById('det-processadas');
    const detErros = document.getElementById('det-erros');
    const detTempo = document.getElementById('det-tempo');

    if (bar) bar.style.width = `${pct}%`;
    if (text) text.textContent = this.traduzirStatus(status.status);
    if (count) count.textContent = `${processados.toLocaleString('pt-BR')} / ${total.toLocaleString('pt-BR')} notas`;
    if (etapa) etapa.textContent = status.etapa ? this.traduzirEtapa(status.etapa) : '';
    if (detTotal) detTotal.textContent = total.toLocaleString('pt-BR');
    if (detProcessadas) detProcessadas.textContent = processados.toLocaleString('pt-BR');
    if (detErros) detErros.textContent = (progress.erros || 0).toLocaleString('pt-BR');
    if (detTempo && status.tempoEstimado) detTempo.textContent = `${status.tempoEstimado}s`;

    this.etapaAtual = status.etapa || '';
  }

  traduzirStatus(status) {
    const map = {
      queued: 'Na fila...',
      processing: 'Processando...',
      completed: 'Concluído!',
      failed: 'Falhou',
      cancelled: 'Cancelado'
    };
    return map[status] || status;
  }

  traduzirEtapa(etapa) {
    const map = {
      validando_arquivos: 'Validando arquivos...',
      extraindo_xmls: 'Extraindo XMLs do ZIP...',
      parseando_csv: 'Lendo planilha CSV...',
      validando_regras_cbs_ibs: 'Validando regras CBS/IBS/IS...',
      calculando_regime_atual: 'Calculando regime atual...',
      calculando_regime_alternativo: 'Calculando regime alternativo...',
      consolidando_resultados: 'Consolidando resultados...',
      finalizando: 'Finalizando...'
    };
    return map[etapa] || etapa;
  }

  mostrarConclusao(status) {
    const btnResultados = document.getElementById('btn-ver-resultados');
    const btnCancelar = document.getElementById('btn-cancelar');
    const progressText = document.getElementById('progress-text');
    const bar = document.getElementById('progress-bar');

    if (progressText) progressText.textContent = 'Concluído com sucesso!';
    if (bar) {
      bar.style.width = '100%';
      bar.style.background = 'var(--green)';
    }
    if (btnCancelar) btnCancelar.hidden = true;
    if (btnResultados) btnResultados.hidden = false;

    // Armazenar resultado para redirecionamento
    this.resultadoFinal = status.resultado;
    this.temErros = status.progress?.erros > 0;
  }

  mostrarErro(status) {
    const progressText = document.getElementById('progress-text');
    const bar = document.getElementById('progress-bar');
    const btnCancelar = document.getElementById('btn-cancelar');

    if (progressText) progressText.textContent = 'Erro no processamento';
    if (bar) {
      bar.style.width = '100%';
      bar.style.background = 'var(--red)';
    }
    if (btnCancelar) btnCancelar.textContent = 'Voltar';

    toast(`Erro: ${status.erro_mensagem || 'Falha desconhecida'}`, 'err');
  }

  irParaResultados() {
    this.pararPolling();
    if (this.temErros) {
      this.router.navigate('auditoria', { jobId: this.jobId });
    } else {
      this.router.navigate('relatorio', { jobId: this.jobId });
    }
  }

  cancelarJob() {
    this.pararPolling();
    this.jobId = null;
    this.arquivos = [];
    this.cenarios = ['regime-atual'];

    // Re-render formulário
    const root = document.getElementById('app-root');
    const content = root.querySelector('#content');
    content.innerHTML = '';
    content.appendChild(this.render());
    this.mount();

    toast('Processamento cancelado', 'warn');
  }

  limparTudo() {
    this.arquivos = [];
    this.cenarios = ['regime-atual'];
    this.renderArquivosSelecionados();
    this.atualizarVisibilidadeSecoes();

    // Reset checkboxes
    document.querySelectorAll('#escolha-cenarios button').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.cenario === 'regime-atual' ? 'true' : 'false');
    });
  }

  pararPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  unmount() {
    this.pararPolling();
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
}