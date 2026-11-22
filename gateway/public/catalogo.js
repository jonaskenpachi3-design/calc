/** Busca de NCM/NBS por nome e conferência de classificação, compartilhadas pelas telas de correção. */
import { el, limpar, semAcento } from './utils.js';

const cache = {};
export const TEXTO_NAO_APLICAVEL = 'A calculadora informa que essa classificação não se aplica a esse código. Você pode continuar, mas o resultado provavelmente terá erro. Confira o cadastro ou pergunte ao seu contador.';

export async function catalogo(api, tipo, data) {
  const k = tipo + data;
  if (!cache[k]) { try { cache[k] = await api.get(tipo === 'servico' ? `/v1/dados/nbs/lista?data=${data}` : `/v1/dados/ncm/vigentes?data=${data}`); } catch { return null; } }
  return cache[k];
}
export function buscar(cat, texto, max = 8) {
  const palavras = semAcento(texto).split(/\s+/).filter(Boolean); const achados = [];
  if (!palavras.length) return achados;
  for (const c of cat) { const alvo = semAcento(`${c.ncm || c.codigo || ''} ${c.descricao || ''}`); if (palavras.every((p) => alvo.includes(p))) { achados.push(c); if (achados.length >= max) break; } }
  return achados;
}
export function campoBusca(api, tipo, dataAtual, escolher, id) {
  const saida = el('div', { class: 'achados' }); let espera;
  const entrada = el('input', { id, autocomplete: 'off', placeholder: tipo === 'servico' ? 'Ex.: ensino fundamental' : 'Ex.: carne bovina' });
  entrada.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(async () => {
      limpar(saida); const q = entrada.value.trim(); if (q.length < 3) return;
      const cat = await catalogo(api, tipo, dataAtual());
      if (!cat) { saida.append(el('div', { class: 'small mut' }, 'A lista de produtos não está disponível agora. Digite o código.')); return; }
      const r = buscar(cat, q);
      if (!r.length) { saida.append(el('div', { class: 'small mut' }, 'Nada encontrado. Tente outras palavras.')); return; }
      r.forEach((c) => { const cod = String(c.ncm || c.codigo); saida.append(el('button', { type: 'button', class: 'achado', onclick: () => { escolher(cod); limpar(saida); entrada.value = ''; } }, el('strong', {}, cod), ' – ', String(c.descricao || '').slice(0, 120))); });
    }, 250);
  });
  return el('div', {}, entrada, saida);
}
export async function aplicavel(api, tipo, data, codigo, cls) {
  const dig = String(codigo || '').replace(/\D/g, '');
  if (!cls || dig.length !== (tipo === 'servico' ? 9 : 8)) return null;
  const k = `ap${tipo}${data}${dig}${cls}`;
  if (!(k in cache)) {
    const par = tipo === 'servico' ? 'nbs' : 'ncm';
    try { const r = await api.get(`/v1/dados/classificacoes-tributarias/${par}-aplicavel?cClassTrib=${encodeURIComponent(cls)}&${par}=${dig}&dataOcorrenciaFatoGerador=${data}`); cache[k] = typeof r.valido === 'boolean' ? r.valido : null; } catch { return null; }
  }
  return cache[k];
}
export async function conferirItem(api, it, data, caixa) {
  const ok = await aplicavel(api, it.tipo, data, it.codigo, it.classificacao);
  caixa.hidden = ok !== false;
  if (ok === false) caixa.textContent = TEXTO_NAO_APLICAVEL;
}
