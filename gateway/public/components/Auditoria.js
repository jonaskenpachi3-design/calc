/**
 * Nexo Fiscal — Auditoria do lote
 * Lista as operações do último lote com filtro (Todos / Com erro / Validados), permite corrigir
 * código, classificação e valor na própria tela e recalcular — uma a uma ou todas as corrigidas.
 */
import { el, limpar, aviso, campo, dinheiro, downloadBlob, toast } from '../utils.js';
import { lote, temLote, depsDoLote, persistirLote } from '../lote-store.js';
import { temProblema, totais, recalcular, gruposSimples, planilhaCorrigida, resultadoCsv, anexoDoItem, atividadesDe, dataBR, TIPO_TP } from '../lote-engine.js';
import { campoBusca, conferirItem } from '../catalogo.js';

const lista = (x) => (Array.isArray(x) ? x : x?.itens || x?.atividades || []);

export class Auditoria {
  constructor(state, api, router) { this.state = state; this.api = api; this.router = router; this.filtro = 'todos'; this.aberto = null; }

  render() {
    const div = el('div', { id: 'aba-auditoria' });
    div.append(el('div', { class: 'page-head' }, el('div', { class: 'eyebrow' }, 'Conferência'), el('h1', {}, 'Auditoria'),
      el('p', {}, 'Confira o resultado de cada nota, corrija o que a calculadora recusou e recalcule sem refazer o lote.')), el('div', { id: 'aud' }));
    return div;
  }

  async mount() { this.deps = await depsDoLote(this.api); this.desenhar(); }

  desenhar() {
    const a = document.getElementById('aud'); if (!a) return; limpar(a);
    persistirLote(this.state.user?.id); // guarda as correções feitas até aqui
    if (!temLote()) {
      a.append(el('div', { class: 'card' }, el('h2', {}, 'Nenhum lote para auditar'), el('p', { class: 'mut' }, 'Processe um lote primeiro. Os resultados ficam guardados neste computador por até 7 dias, até você clicar em Sair.'),
        el('button', { id: 'ir-lote' }, 'Ir para o simulador em lote')));
      document.getElementById('ir-lote').onclick = () => this.router.navigate('lote'); return;
    }
    const t = totais(lote.res);
    const ilegiveis = lote.problemas.length;
    const linhas = lote.res.filter((x) => this.filtro === 'todos' || (this.filtro === 'erro' ? temProblema(x) : !temProblema(x)));
    const sujos = lote.res.filter((x) => x.grupo.sujo).length;

    const filtro = (id, rotulo, n) => el('button', { class: 'seg-b', type: 'button', 'aria-pressed': String(this.filtro === id), 'data-filtro': id, onclick: () => { this.filtro = id; this.aberto = null; this.desenhar(); } }, rotulo, el('span', { class: 'seg-n' }, String(n)));
    const pct = t.operacoes ? Math.round((t.ok / t.operacoes) * 100) : 0;
    a.append(el('div', { class: 'card' },
      el('div', { class: 'totals aud-kpis' },
        el('div', { class: 'kpi main' }, el('div', { class: 'l' }, 'Total de CBS + IBS'), el('div', { class: 'v' }, dinheiro(t.total)), el('div', { class: 'l' }, 'somando só as operações sem problema')),
        el('div', { class: 'kpi' }, el('div', { class: 'l' }, 'Validadas'), el('div', { class: 'v' }, `${t.ok} de ${t.operacoes}`),
          el('div', { class: 'bar', role: 'img', 'aria-label': `${pct}% validadas` }, el('span', { style: `width:${pct}%` }))),
        el('div', { class: 'kpi' + (t.comProblema ? ' alerta' : '') }, el('div', { class: 'l' }, 'Com erro'), el('div', { class: 'v' }, String(t.comProblema)),
          el('div', { class: 'l' }, t.comProblema ? 'corrija e recalcule abaixo' : 'nada a corrigir'))),
      el('div', { class: 'aud-barra noprint' },
        el('div', { class: 'seg', role: 'group', 'aria-label': 'Filtrar operações' }, filtro('todos', 'Todos', t.operacoes), filtro('erro', 'Com erro', t.comProblema), filtro('ok', 'Validados', t.ok)),
        el('div', { class: 'aud-acoes' },
          el('button', { class: 'sec', id: 'recalc-todos', disabled: !sujos, title: sujos ? '' : 'Corrija alguma nota para habilitar' }, `↻ Recalcular corrigidos (${sujos})`),
          el('button', { class: 'sec', id: 'baixar-planilha' }, '⇩ Planilha'), el('button', { class: 'sec', id: 'baixar-csv' }, '⇩ CSV'),
          el('button', { id: 'ir-relatorio' }, 'Gerar relatório'))),
      el('div', { id: 'aud-msg', role: 'alert' }),
      lote.cenarioAlt ? el('p', { class: 'mut small' }, 'O comparativo com o Simples Nacional é recalculado junto, com as mesmas alíquotas e atividades informadas no lote.') : null));

    if (ilegiveis && this.filtro !== 'ok') {
      a.append(el('div', { class: 'card' }, el('h2', {}, `Não puderam ser lidos (${ilegiveis})`),
        el('p', { class: 'mut small' }, 'Corrija na planilha ou no sistema que emitiu a nota e envie de novo.'),
        lote.problemas.map((p) => el('div', { class: 'prob' }, el('div', { class: 's' }, '!'), el('div', {}, el('strong', {}, `${p.rot} ${p.linha}${p.documento ? ' · ' + p.documento : ''}`), el('div', { class: 'small', style: 'color:var(--red)' }, p.mensagem))))));
    }

    a.append(el('div', { class: 'card' }, el('div', { class: 'scroll' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Documento', 'Data', 'Situação', 'CBS', 'IBS', 'Total', ''].map((c, k) => el('th', { class: k >= 3 && k < 6 ? 'n' : '' }, c)))),
      el('tbody', {}, linhas.flatMap((x) => this.linha(x)))))));
    if (!linhas.length) a.lastChild.append(el('p', { class: 'mut' }, 'Nada neste filtro.'));

    document.getElementById('recalc-todos').onclick = () => this.recalcularTodos();
    document.getElementById('baixar-planilha').onclick = () => downloadBlob(new Blob([planilhaCorrigida(lote.res, lote.regime, this.deps)], { type: 'text/csv;charset=utf-8' }), 'planilha-corrigida.csv');
    document.getElementById('baixar-csv').onclick = () => downloadBlob(new Blob([resultadoCsv(lote.res)], { type: 'text/csv;charset=utf-8' }), 'resultado-lote.csv');
    document.getElementById('ir-relatorio').onclick = () => this.router.navigate('relatorio');
  }

  mensagens(x) {
    if (!x.ok) return [x.erro];
    return x.resultado.itens.flatMap((it, k) => (it.situacao === 'erro' || (it.mensagens || []).length) ? [`Item ${x.grupo.linhas[k] ?? k + 1}: ${(it.mensagens && it.mensagens[0]) || it.situacaoTexto}`] : []);
  }

  linha(x) {
    const g = x.grupo; const prob = temProblema(x); const t = x.ok ? x.resultado.totais : null;
    const msgs = this.mensagens(x);
    const principal = el('tr', { 'data-doc': g.documento },
      el('td', {}, el('strong', {}, g.documento), g.sujo ? el('span', { class: 'pill pill-blue', style: 'margin-left:6px' }, 'editado') : null,
        msgs.map((m) => el('div', { class: 'small', style: 'color:var(--red)' }, m))),
      el('td', {}, dataBR(g.entrada.data)),
      el('td', {}, el('span', { class: 'badge ' + (prob ? 'erro' : 'calculado') }, prob ? 'Com problema' : 'Validado')),
      el('td', { class: 'n' }, dinheiro(t?.cbs)), el('td', { class: 'n' }, dinheiro(t?.ibs)), el('td', { class: 'n' }, el('strong', {}, dinheiro(t?.total))),
      el('td', { class: 'noprint' }, el('button', { class: 'link', onclick: () => { this.aberto = this.aberto === g ? null : g; this.desenhar(); } }, this.aberto === g ? 'Fechar' : 'Editar e recalcular')));
    return this.aberto === g ? [principal, el('tr', {}, el('td', { colspan: 7 }, this.editor(g)))] : [principal];
  }

  editor(g) {
    const data = g.entrada.data; const caixa = el('div', {}); const corpo = el('div', {});
    const montar = async () => {
      const k = 'cl' + data;
      this.deps.cache[k] = this.deps.cache[k] || await this.api.get('/v1/dados/classificacoes-tributarias/cbs-ibs?data=' + data).then(lista).catch(() => []);
      const classes = this.deps.cache[k];
      const ativs = g.regime === 'simples-nacional' ? await atividadesDe(this.deps, data, TIPO_TP[g.entrada.documento]) : [];
      limpar(corpo);
      g.entrada.itens.forEach((it, i) => {
        const aviso2 = el('div', { class: 'msg warn small' }); aviso2.hidden = true;
        const conferir = () => conferirItem(this.api, it, data, aviso2);
        const cod = el('input', { value: it.codigo, inputmode: 'numeric', maxlength: 12, 'aria-label': `Código do item ${i + 1}` });
        cod.addEventListener('input', () => { it.codigo = cod.value; g.sujo = true; }); cod.addEventListener('change', conferir);
        const cls = el('select', { 'aria-label': `Classificação do item ${i + 1}`, onchange: (e) => { it.classificacao = e.target.value; g.sujo = true; conferir(); } },
          el('option', { value: '' }, 'Escolha'), classes.map((c) => el('option', { value: c.codigo, selected: it.classificacao === c.codigo }, `${c.codigo} – ${c.descricao || ''}`.slice(0, 110))));
        if (it.classificacao && !classes.some((c) => c.codigo === it.classificacao)) cls.prepend(el('option', { value: it.classificacao, selected: true }, `${it.classificacao} (não consta na lista)`));
        const val = el('input', { value: it.valor, inputmode: 'decimal', 'aria-label': `Valor do item ${i + 1}` });
        val.addEventListener('input', () => { it.valor = val.value; g.sujo = true; });
        const cels = [
          campo(`Item ${g.linhas[i] ?? i + 1}${it.descricao ? ' · ' + it.descricao : ''}`, it.tipo === 'servico' ? 'Código NBS' : 'Código NCM', cod),
          campo('Buscar pelo nome', 'Escolha para preencher o código', campoBusca(this.api, it.tipo, () => data, (c) => { it.codigo = c; cod.value = c; g.sujo = true; conferir(); }, `aud-${i}-busca`)),
          campo('Classificação', null, cls), campo('Valor (R$)', null, val)];
        if (g.regime === 'simples-nacional') cels.push(campo('Atividade', 'Define o anexo', el('select', { onchange: (e) => { it.atividade = e.target.value; g.sujo = true; } }, el('option', { value: '' }, 'Escolha'), ativs.map((a) => el('option', { value: a.codigo, selected: it.atividade === a.codigo }, `${a.codigo} – ${a.descricao}`.slice(0, 110))))));
        corpo.append(el('div', { class: 'item' }, el('div', { class: 'grid' }, cels), aviso2));
        if (it.codigo && it.classificacao) conferir();
      });
    };
    montar();
    const botao = el('button', { class: 'recalcular' }, 'Recalcular');
    botao.onclick = async () => { botao.disabled = true; botao.textContent = 'Calculando…'; try { await this.refazer(g); this.aberto = temProblema(lote.res.find((x) => x.grupo === g)) ? g : null; this.desenhar(); } catch (e) { limpar(caixa); caixa.append(el('div', { class: 'msg err small' }, e.message)); botao.disabled = false; botao.textContent = 'Recalcular'; } };
    return el('div', { class: 'editor' }, el('strong', {}, `Corrigir ${g.documento}`), el('p', { class: 'mut small' }, 'Cada recálculo conta como 1 simulação na sua cota.'), corpo, caixa,
      el('div', { class: 'row' }, botao, el('button', { class: 'sec', onclick: () => { this.aberto = null; this.desenhar(); } }, 'Cancelar')));
  }

  async refazer(g) {
    if (g.regime === 'simples-nacional') {
      const antigas = Object.values(g.entrada.aliquotas.porAnexo)[0] || { cbs: '', ibs: '' }; const novo = {};
      for (const it of g.entrada.itens) { const a = anexoDoItem(this.deps, g, it); if (a) novo[a] = g.entrada.aliquotas.porAnexo[a] || { ...antigas }; }
      g.entrada.aliquotas.porAnexo = novo;
    }
    const r = await recalcular(this.api, lote.res, g); g.sujo = false;
    await this.atualizarSimples(g);
    return r;
  }

  /** Refaz o cenário do Simples Nacional desta operação a partir dos dados corrigidos. */
  async atualizarSimples(g) {
    if (!lote.cenarioAlt || g.regime === 'simples-nacional') return;
    const antes = lote.resAlt.findIndex((x) => x.grupo.origemGrupo === g);
    if (antes >= 0) lote.resAlt.splice(antes, 1);
    lote.gruposAlt = lote.gruposAlt.filter((x) => x.origemGrupo !== g);
    lote.problemasAlt = lote.problemasAlt.filter((p) => !(p.rot === g.rot && p.documento === g.documento));
    const alt = await gruposSimples([g], lote.cfgAlt, this.deps);
    lote.problemasAlt.push(...alt.problemas);
    for (const novo of alt.grupos) { lote.gruposAlt.push(novo); await recalcular(this.api, lote.resAlt, novo); }
  }

  async recalcularTodos() {
    const sujos = lote.res.filter((x) => x.grupo.sujo).map((x) => x.grupo);
    const b = document.getElementById('recalc-todos'); b.disabled = true; let feitos = 0;
    try {
      for (const g of sujos) { aviso('aud-msg', `Recalculando… ${feitos} de ${sujos.length}`, 'warn'); await this.refazer(g); feitos++; }
      toast(`${feitos} operação(ões) recalculada(s).`, 'ok');
    } catch (e) { this.desenhar(); aviso('aud-msg', `${e.message} (${feitos} de ${sujos.length} recalculadas)`, 'err'); return; }
    this.aberto = null; this.desenhar();
  }

  unmount() {}
}
