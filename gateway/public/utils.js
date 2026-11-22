/**
 * Nexo Fiscal — Utilitários
 * ==========================================================================
 * Funções helper reutilizadas em todos os componentes.
 */

// Formatadores
export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
export const dinheiro = (v) => (v === null || v === undefined ? '—' : brl.format(v));
export const numero = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
export const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Criação de elementos
export function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f != null) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return e;
}

export const limpar = (n) => n.replaceChildren();

// Avisos/Mensagens
export function aviso(id, texto, tipo) {
  const n = document.getElementById(id);
  if (!n) return;
  limpar(n);
  if (texto) n.append(el('div', { class: 'msg ' + (tipo || '') }, texto));
}

// KPI Card
export function kpi(rotulo, valor, principal = false) {
  return el('div', { class: 'kpi' + (principal ? ' main' : '') },
    el('div', { class: 'v' }, dinheiro(valor)),
    el('div', { class: 'l' }, rotulo)
  );
}

// Campo de formulário padronizado
export function campo(rotulo, dica, controle, id) {
  return el('div', {},
    el('label', { for: id }, rotulo, dica ? el('span', { class: 'hint' }, dica) : null),
    controle
  );
}

// Badge de status
export function badge(texto, tipo = 'calculado') {
  return el('span', { class: 'badge ' + tipo }, texto);
}

// Loading spinner
export function spinner(tamanho = 20) {
  return el('span', {
    class: 'spinner',
    style: `width:${tamanho}px;height:${tamanho}px;border:2px solid var(--bd);border-top-color:var(--teal);border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;margin-right:8px;`
  });
}

// Adicionar keyframes do spinner se não existir
if (!document.getElementById('spinner-style')) {
  const style = document.createElement('style');
  style.id = 'spinner-style';
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}

// Formatação de data
export const hoje = () => new Date().toISOString().slice(0, 10);

export function dataIso(v) {
  const t = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function formatDataBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Formatação CNPJ
export function formatCNPJ(cnpj) {
  const n = String(cnpj).replace(/\D/g, '').padStart(14, '0');
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// Debounce
export function debounce(fn, ms) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

// Throttle
export function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

// Toast simples
export function toast(mensagem, tipo = 'ok', duracao = 3000) {
  const container = getOrCreateToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.style.cssText = `
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 8px;
    background: var(--card);
    border: 1px solid var(--bd);
    box-shadow: var(--shadow);
    animation: slideIn 0.3s ease;
  `;
  el.textContent = mensagem;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duracao);
}

function getOrCreateToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      max-width: 360px;
    `;
    document.body.appendChild(container);
  }
  return container;
}

// Modal helper
export function criarModal(titulo, conteudo, botoes = []) {
  const overlay = el('div', {
    class: 'modal-overlay',
    style: `
      position: fixed;
      inset: 0;
      background: rgba(20, 38, 61, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 1000;
      animation: fadeIn 0.2s ease;
    `
  });

  const modal = el('div', {
    class: 'modal',
    style: `
      background: var(--card);
      border-radius: var(--radius);
      box-shadow: 0 20px 40px rgba(26, 48, 72, 0.2);
      max-width: 520px;
      width: 100%;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: slideUp 0.2s ease;
    `
  });

  modal.innerHTML = `
    <div style="padding: 20px 24px; border-bottom: 1px solid var(--bd); display: flex; justify-content: space-between; align-items: center;">
      <h2 style="margin: 0;">${titulo}</h2>
      <button class="modal-close" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--mut); line-height: 1;">×</button>
    </div>
    <div class="modal-body" style="padding: 24px; overflow-y: auto; flex: 1;"></div>
    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid var(--bd); display: flex; justify-content: flex-end; gap: 10px;"></div>
  `;

  modal.querySelector('.modal-body').append(conteudo.nodeType ? conteudo : document.createTextNode(String(conteudo)));

  const footer = modal.querySelector('.modal-footer');
  for (const btn of botoes) {
    const b = el('button', { class: btn.class || 'sec', onclick: () => { btn.onClick?.(); if (!btn.keepOpen) closeModal(overlay); } }, btn.texto);
    footer.appendChild(b);
  }

  modal.querySelector('.modal-close').onclick = () => closeModal(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(overlay); };

  // IMPORTANTE: append modal ao overlay!
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function closeModal(ov) {
    ov.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => ov.remove(), 200);
  }

  return { close: () => closeModal(overlay) };
}

// Adicionar estilos de modal se não existirem
if (!document.getElementById('modal-styles')) {
  const style = document.createElement('style');
  style.id = 'modal-styles';
  style.textContent = `
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  `;
  document.head.appendChild(style);
}

// Download helper
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parse CSV robusto (suporta ; e , aspas, quebras de linha)
export function parseCSV(texto) {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Gerar CSV para download
export function gerarCSV(cabecalho, linhas, separador = ';') {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const cab = cabecalho.map(esc).join(separador);
  const corpo = linhas.map(l => l.map(esc).join(separador)).join('\r\n');
  return '﻿' + cab + '\r\n' + corpo + '\r\n';
}