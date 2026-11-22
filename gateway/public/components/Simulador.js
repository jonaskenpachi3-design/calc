/**
 * Nexo Fiscal — Simulador Component (Migração Completa)
 * ==========================================================================
 * Simulação item-a-item: Regime Normal + Simples Nacional
 * Busca NCM/NBS, validação classificação, cálculo CBS/IBS/IS
 */

import { el, limpar, aviso, campo, dinheiro, pct, semAcento, debounce, toast, criarModal } from '../utils.js';

export class Simulador {
  constructor(state, api, router) {
    this.state = state;
    this.api = api;
    this.router = router;
    this.regime = 'regime-normal';
    this.itens = [];
    this.cache = {};
    this.catCache = {};
    this.taxas = {}; // aliquotas Simples por anexo
  }

  render() {
    const div = el('div', { id: 'aba-simular' });
    div.innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Simulação</div>
        <h1>Simular tributos</h1>
        <p>Preencha os dados da operação e veja a CBS e o IBS de cada item.</p>
      </div>

      <div id="passo-form" class="card">
        <h2>1. Para quem é a simulação?</h2>
        <div class="choice" id="escolha-regime">
          <button data-regime="regime-normal" aria-pressed="true"><span><strong>Empresa no regime normal</strong><span class="mut small">Lucro presumido ou lucro real</span></span></button>
          <button data-regime="simples-nacional" aria-pressed="false"><span><strong>Empresa do Simples Nacional</strong><span class="mut small">ME, EPP e demais optantes</span></span></button>
        </div>

        <h2>2. Dados da operação</h2>
        <div class="grid" id="dados-operacao">
          <div><label for="f-data">Data da venda ou do serviço</label><input id="f-data" type="date"></div>
          <div class="so-normal"><label for="f-uf">Estado</label><select id="f-uf"><option value="">Carregando…</option></select></div>
          <div class="so-normal"><label for="f-mun">Município</label><select id="f-mun" disabled><option value="">Escolha o estado</option></select></div>
          <div class="so-simples"><label for="f-doc">Tipo de nota</label>
            <select id="f-doc"><option value="nfe">NF-e (venda de produtos)</option><option value="nfce">NFC-e (venda ao consumidor)</option><option value="nfse">NFS-e (serviços)</option></select></div>
        </div>

        <div class="so-simples" id="bloco-simples" hidden>
          <div class="msg warn small">A alíquota efetiva do Simples Nacional é calculada pela Receita a partir do seu faturamento dos últimos 12 meses. Informe abaixo os valores que constam no seu extrato do Simples (PGDAS-D) ou que seu contador passar.</div>
          <div id="bloco-aliquotas"></div>
          <div class="row" style="margin-bottom:14px">
            <label style="font-weight:400"><input type="checkbox" id="f-sublimite" style="width:auto;min-height:0"> Ultrapassei o sublimite de receita</label>
            <label style="font-weight:400"><input type="checkbox" id="f-fatorr" style="width:auto;min-height:0"> Meu fator "r" é 28% ou mais (só para a atividade 09)</label>
          </div>
        </div>

        <h2>3. O que foi vendido?</h2>
        <div id="itens"></div>
        <div class="row" style="margin-bottom:8px"><button class="sec" id="add-item">+ Adicionar outro item</button></div>
        <div id="f-msg" role="alert"></div>
        <div class="row"><button id="calcular">Calcular tributos</button></div>
      </div>
      <div id="passo-resultado" hidden></div>
    `;
    return div;
  }

  async mount() {
    this.bindEvents();
    await this.inicializar();
  }

  bindEvents() {
    // Regime selection
    document.querySelectorAll('#escolha-regime button').forEach(btn => {
      btn.onclick = () => { this.regime = btn.dataset.regime; this.aplicarRegime(); };
    });

    // Document type change (Simples)
    document.getElementById('f-doc')?.addEventListener('change', () => {
      if (this.regime === 'simples-nacional') { this.itens = []; this.novoItem(); this.desenharItens(); this.carregarListas(); }
    });

    // Date change
    document.getElementById('f-data')?.addEventListener('change', () => this.carregarListas());

    // UF change
    document.getElementById('f-uf')?.addEventListener('change', async () => {
      const uf = document.getElementById('f-uf').value;
      const s = document.getElementById('f-mun'); limpar(s);
      if (!uf) { s.append(el('option', { value: '' }, 'Escolha o estado')); s.disabled = true; return; }
      s.append(el('option', { value: '' }, 'Carregando…'));
      try {
        const ms = await this.api.get(`/v1/dados/ufs/municipios?siglaUf=${encodeURIComponent(uf)}`);
        const lista = Array.isArray(ms) ? ms : (ms.atividades || ms.itens || []);
        limpar(s); s.append(el('option', { value: '' }, 'Escolha o município'));
        lista.slice().sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach(m => s.append(el('option', { value: String(m.codigo) }, m.nome)));
        s.disabled = false;
      } catch (e) { limpar(s); s.append(el('option', { value: '' }, 'Não foi possível carregar')); aviso('f-msg', e.message, 'err'); }
    });

    // Add item
    document.getElementById('add-item')?.addEventListener('click', () => { this.novoItem(); this.desenharItens(); });

    // Calcular
    document.getElementById('calcular')?.addEventListener('click', () => this.calcular());

    // Fator R change
    document.getElementById('f-fatorr')?.addEventListener('change', () => this.desenharAliquotas());
  }

  async inicializar() {
    if (!document.getElementById('f-data').value) document.getElementById('f-data').value = this.hoje();
    await this.carregarUfs();
    this.aplicarRegime();
  }

  hoje() { return new Date().toISOString().slice(0, 10); }

  async carregarUfs() {
    if (!this.cache.ufs) {
      try { this.cache.ufs = await this.api.get('/v1/dados/ufs'); } catch { this.cache.ufs = []; }
    }
    const s = document.getElementById('f-uf'); limpar(s);
    s.append(el('option', { value: '' }, 'Escolha o estado'));
    (this.cache.ufs || []).slice().sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach(u => s.append(el('option', { value: u.sigla }, u.nome)));
  }

  aplicarRegime() {
    document.querySelectorAll('#escolha-regime button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.regime === this.regime)));
    document.querySelectorAll('.so-normal').forEach(n => n.hidden = this.regime !== 'regime-normal');
    document.querySelectorAll('.so-simples').forEach(n => n.hidden = this.regime !== 'simples-nacional');
    this.itens = []; this.novoItem(); this.desenharItens(); this.carregarListas();
  }

  novoItem() {
    this.itens.push({ tipo: this.regime === 'simples-nacional' && document.getElementById('f-doc')?.value !== 'nfse' ? 'servico' : 'produto', descricao: '', codigo: '', classificacao: '', atividade: '', valor: '' });
  }

  async carregarListas() {
    const d = document.getElementById('f-data').value || this.hoje();
    const k = 'cl' + d;
    if (!this.cache[k]) {
      try { this.cache[k] = await this.api.get(`/v1/dados/classificacoes-tributarias/cbs-ibs?data=${d}`); } catch { this.cache[k] = []; }
    }
    this.cache.atual = this.cache[k];

    if (this.regime === 'simples-nacional') {
      const tp = { nfe: '55', nfce: '65', nfse: '91' }[document.getElementById('f-doc').value];
      const ka = `at${d}${tp}`;
      if (!this.cache[ka]) {
        try { this.cache[ka] = await this.api.get(`/v1/simples-nacional/atividades?data=${d}&tpDoc=${tp}`); } catch { this.cache[ka] = []; }
      }
      this.cache.atividades = this.cache[ka];
    }
    this.desenharItens();
  }

  // ========== BUSCA NCM/NBS ==========
  async catalogo(tipo, data) {
    const k = tipo + data;
    if (!this.catCache[k]) {
      try { this.catCache[k] = await this.api.get(tipo === 'servico' ? `/v1/dados/nbs/lista?data=${data}` : `/v1/dados/ncm/vigentes?data=${data}`); } catch { return null; }
    }
    return this.catCache[k];
  }

  buscarNoCatalogo(cat, texto, max = 8) {
    const palavras = semAcento(texto).split(/\s+/).filter(Boolean);
    const achados = [];
    if (!palavras.length) return achados;
    for (const c of cat) {
      const alvo = semAcento(`${c.ncm || c.codigo || ''} ${c.descricao || ''}`);
      if (palavras.every(p => alvo.includes(p))) { achados.push(c); if (achados.length >= max) break; }
    }
    return achados;
  }

  campoBusca(tipo, dataAtual, escolher, id) {
    const saida = el('div', { class: 'achados' });
    let espera;
    const entrada = el('input', { id, autocomplete: 'off', placeholder: tipo === 'servico' ? 'Ex.: ensino fundamental' : 'Ex.: carne bovina' });
    entrada.addEventListener('input', () => {
      clearTimeout(espera);
      espera = setTimeout(async () => {
        limpar(saida);
        const q = entrada.value.trim();
        if (q.length < 3) return;
        const cat = await this.catalogo(tipo, dataAtual());
        if (!cat) { saida.append(el('div', { class: 'small mut' }, 'A lista de produtos não está disponível agora. Digite o código.')); return; }
        const r = this.buscarNoCatalogo(cat, q);
        if (!r.length) { saida.append(el('div', { class: 'small mut' }, 'Nada encontrado. Tente outras palavras.')); return; }
        r.forEach(c => {
          const cod = String(c.ncm || c.codigo);
          saida.append(el('button', { type: 'button', class: 'achado', onclick: () => { escolher(cod); limpar(saida); entrada.value = ''; } },
            el('strong', {}, cod), ' – ', String(c.descricao || '').slice(0, 120)));
        });
      }, 250);
    });
    return el('div', {}, entrada, saida);
  }

  // ========== VALIDAÇÃO CLASSIFICAÇÃO ==========
  async aplicavel(tipo, data, codigo, cls) {
    const dig = String(codigo || '').replace(/\D/g, '');
    if (!cls || dig.length !== (tipo === 'servico' ? 9 : 8)) return null;
    const k = `ap${tipo}${data}${dig}${cls}`;
    if (!(k in this.catCache)) {
      const par = tipo === 'servico' ? 'nbs' : 'ncm';
      try {
        const r = await this.api.get(`/v1/dados/classificacoes-tributarias/${par}-aplicavel?cClassTrib=${encodeURIComponent(cls)}&${par}=${dig}&dataOcorrenciaFatoGerador=${data}`);
        this.catCache[k] = typeof r.valido === 'boolean' ? r.valido : null;
      } catch { return null; }
    }
    return this.catCache[k];
  }

  async conferirItem(it, data, caixa) {
    const ok = await this.aplicavel(it.tipo, data, it.codigo, it.classificacao);
    caixa.hidden = ok !== false;
    if (ok === false) caixa.textContent = 'A calculadora informa que essa classificação não se aplica a esse código. Você pode continuar, mas o resultado provavelmente terá erro. Confira o cadastro ou pergunte ao seu contador.';
  }

  // ========== DESENHAR ITENS ==========
  desenharItens() {
    const alvo = document.getElementById('itens'); limpar(alvo);
    const servicoFixo = this.regime === 'simples-nacional' && document.getElementById('f-doc').value === 'nfse';

    this.itens.forEach((it, i) => {
      if (servicoFixo) it.tipo = 'servico';
      const id = (n) => `i${i}-${n}`;
      const tipo = el('select', { id: id('tipo'), onchange: (e) => { it.tipo = e.target.value; this.desenharItens(); } },
        el('option', { value: 'produto', selected: it.tipo === 'produto' }, 'Produto (mercadoria)'),
        el('option', { value: 'servico', selected: it.tipo === 'servico' }, 'Serviço'));
      if (servicoFixo) tipo.disabled = true;

      const classes = (this.cache.atual || []).map(c => el('option', { value: c.codigo, selected: it.classificacao === c.codigo }, `${c.codigo} – ${c.descricao || c.descricaoTratamentoTributario || ''}`.slice(0, 120)));
      const cls = el('select', { id: id('cls'), onchange: (e) => { it.classificacao = e.target.value; this.conferir(); } },
        el('option', { value: '' }, classes.length ? 'Escolha a classificação' : 'Lista indisponível'), classes);

      const linha1 = [
        campo('Tipo', null, tipo, id('tipo')),
        campo('Descrição (opcional)', 'Só para você identificar', el('input', { id: id('desc'), value: it.descricao, maxlength: 60, oninput: (e) => { it.descricao = e.target.value; } }), id('desc')),
        campo(it.tipo === 'servico' ? 'Código NBS do serviço' : 'Código NCM do produto',
          it.tipo === 'servico' ? '9 números, consta no cadastro do serviço' : '8 números, consta no cadastro do produto',
          el('input', { id: id('cod'), value: it.codigo, inputmode: 'numeric', maxlength: 12, oninput: (e) => { it.codigo = e.target.value; }, onchange: () => this.conferir() }), id('cod')),
        campo('Valor total (R$)', 'Valor do item na nota', el('input', { id: id('val'), value: it.valor, inputmode: 'decimal', placeholder: '0,00', oninput: (e) => { it.valor = e.target.value; } }), id('val')),
      ];

      const caixa = el('div', { class: 'msg warn small', id: id('aviso') }); caixa.hidden = true;
      const dataForm = () => document.getElementById('f-data').value || this.hoje();
      const conferir = () => this.conferirItem(it, dataForm(), caixa);

      const linhaBusca = [campo(it.tipo === 'servico' ? 'Não sabe o código? Busque pelo nome do serviço' : 'Não sabe o código? Busque pelo nome do produto', 'Digite 3 letras ou mais e escolha na lista',
        this.campoBusca(it.tipo, dataForm, (cod) => { it.codigo = cod; document.getElementById(id('cod')).value = cod; conferir(); }, id('busca')), id('busca'))];

      const linha2 = [campo('Classificação tributária', 'Como esse item é tratado pela lei. Em caso de dúvida, pergunte ao seu contador.', cls, id('cls'))];

      if (this.regime === 'simples-nacional') {
        const ats = (this.cache.atividades || []).map(a => el('option', { value: a.codigo, selected: it.atividade === a.codigo }, `${a.codigo} – ${a.descricao}${a.rotuloCurtoAnexo ? ' (Anexo ' + a.rotuloCurtoAnexo + ')' : ''}`.slice(0, 140)));
        linha2.push(campo('Atividade no Simples Nacional', 'O anexo do Simples é definido pela atividade', el('select', { id: id('ativ'), onchange: (e) => { it.atividade = e.target.value; this.desenharAliquotas(); } },
          el('option', { value: '' }, ats.length ? 'Escolha a atividade' : 'Lista indisponível'), ats), id('ativ')));
      }

      alvo.append(el('div', { class: 'item' },
        el('div', { class: 'head' }, el('span', {}, `Item ${i + 1}`),
          this.itens.length > 1 ? el('button', { class: 'link', type: 'button', onclick: () => { this.itens.splice(i, 1); this.desenharItens(); } }, 'Remover') : null),
        el('div', { class: 'grid' }, linha1), el('div', { class: 'grid' }, linhaBusca), el('div', { class: 'grid' }, linha2), caixa));

      if (it.codigo && it.classificacao) conferir();
    });

    document.getElementById('add-item').hidden = servicoFixo;
    this.desenharAliquotas();
  }

  // ========== ALÍQUOTAS SIMPLES ==========
  anexoDaAtividade(cod) {
    const a = (this.cache.atividades || []).find(x => x.codigo === cod);
    if (!a) return null;
    return (document.getElementById('f-fatorr')?.checked && a.anexoComFatorR) ? a.anexoComFatorR : (a.anexoSemFatorR || null);
  }

  anexosNecessarios() {
    return [...new Set(this.itens.map(it => this.anexoDaAtividade(it.atividade)).filter(Boolean))].sort();
  }

  desenharAliquotas() {
    const alvo = document.getElementById('bloco-aliquotas'); if (!alvo) return; limpar(alvo);
    if (this.regime !== 'simples-nacional') return;
    const anexos = this.anexosNecessarios();
    if (!anexos.length) { alvo.append(el('p', { class: 'mut small' }, 'Escolha a atividade de cada item para informar as alíquotas efetivas do anexo correspondente.')); return; }
    for (const a of anexos) {
      this.taxas[a] = this.taxas[a] || { cbs: '', ibs: '' };
      alvo.append(el('div', { class: 'grid' },
        campo(`Alíquota efetiva de CBS (%) — Anexo ${a}`, 'Exemplo: 1,1612', el('input', { id: `r-${a}-cbs`, inputmode: 'decimal', placeholder: '0,0000', value: this.taxas[a].cbs, oninput: (e) => { this.taxas[a].cbs = e.target.value; } }), `r-${a}-cbs`),
        campo(`Alíquota efetiva de IBS (%) — Anexo ${a}`, 'Exemplo: 0,0129', el('input', { id: `r-${a}-ibs`, inputmode: 'decimal', placeholder: '0,0000', value: this.taxas[a].ibs, oninput: (e) => { this.taxas[a].ibs = e.target.value; } }), `r-${a}-ibs`)));
    }
  }

  // ========== MONTAR ENTRADA PARA API ==========
  montarEntrada() {
    const base = { data: document.getElementById('f-data').value, itens: this.itens.map(it => ({ ...it })) };
    if (this.regime === 'regime-normal') return { ...base, uf: document.getElementById('f-uf').value, municipio: document.getElementById('f-mun').value };
    return {
      ...base, documento: document.getElementById('f-doc').value,
      aliquotas: { porAnexo: Object.fromEntries(this.anexosNecessarios().map(a => [a, { ...this.taxas[a] }])), impedimentoSublimite: document.getElementById('f-sublimite').checked, fatorR: document.getElementById('f-fatorr').checked ? true : (this.itens.some(it => it.atividade === '09') ? false : undefined) },
    };
  }

  // ========== CALCULAR ==========
  async calcular() {
    aviso('f-msg'); const b = document.getElementById('calcular'); b.disabled = true; b.textContent = 'Calculando…';
    try {
      const r = await this.api.post('/v1/simulacoes/' + this.regime, this.montarEntrada());
      this.mostrarResultado(r);
    } catch (e) { aviso('f-msg', e.message, 'err'); }
    b.disabled = false; b.textContent = 'Calcular tributos';
  }

  mostrarResultado(r) {
    const alvo = document.getElementById('passo-resultado'); limpar(alvo);
    const t = r.totais;
    const comIs = r.itens.some(i => i.impostoSeletivo);
    const temProblema = r.itens.some(i => i.situacao === 'erro' || (i.mensagens || []).length);
    const cabecalho = ['Item', 'Situação', 'Base', 'CBS', 'IBS'].concat(comIs ? ['Imp. Seletivo'] : [], ['Total']);

    const linhas = r.itens.map(i => el('tr', {},
      el('td', {}, el('strong', {}, i.descricao), i.mensagens.map(m => el('div', { class: 'small', style: 'color:var(--red)' }, m)),
        i.reducaoPercentual ? el('div', { class: 'small mut' }, `Redução de ${pct.format(i.reducaoPercentual)}% na alíquota`) : null),
      el('td', {}, el('span', { class: 'badge ' + i.situacao }, i.situacaoTexto)),
      el('td', { class: 'n' }, dinheiro(i.base)), el('td', { class: 'n' }, dinheiro(i.cbs)), el('td', { class: 'n' }, dinheiro(i.ibs)),
      comIs ? el('td', { class: 'n' }, dinheiro(i.impostoSeletivo)) : null,
      el('td', { class: 'n' }, el('strong', {}, dinheiro(i.total)))));

    alvo.append(el('div', { class: 'card' },
      el('h2', {}, 'Resultado da simulação'),
      (r.avisos || []).map(a => el('div', { class: 'msg warn small' }, a)),
      temProblema ? el('div', { class: 'msg err small' }, 'Algum item teve problema. Volte, corrija o código ou a classificação desse item (use a busca pelo nome, se precisar) e calcule de novo.') : null,
      el('div', { class: 'totals' }, kpi('Total de tributos', t.total, true), kpi('CBS (federal)', t.cbs), kpi('IBS (estados e municípios)', t.ibs), comIs ? kpi('Imposto Seletivo', t.impostoSeletivo) : null),
      el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, cabecalho.map((c, k) => el('th', { class: k >= 2 ? 'n' : '' }, c)))), el('tbody', {}, linhas))),
      el('div', { class: 'row noprint', style: 'margin-top:16px' },
        el('button', { onclick: () => window.print() }, 'Imprimir ou salvar em PDF'),
        temProblema ? el('button', { id: 'corrigir-sim', onclick: () => { document.getElementById('passo-resultado').hidden = true; document.getElementById('passo-form').hidden = false; window.scrollTo(0, 0); } }, 'Corrigir os dados e calcular de novo') : null,
        el('button', { class: 'sec', onclick: () => { document.getElementById('passo-resultado').hidden = true; document.getElementById('passo-form').hidden = false; window.scrollTo(0, 0); } }, 'Fazer outra simulação'))));

    document.getElementById('passo-form').hidden = true; alvo.hidden = false; window.scrollTo(0, 0);
  }

  unmount() {}
}