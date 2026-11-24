/**
 * Nexo Fiscal — App Bootstrap
 * ==========================================================================
 * Ponto de entrada da SPA. Carrega componentes, gerencia estado global e roteamento.
 */

// Desregistra Service Worker antigo se existir
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for (var registration of registrations) {
      registration.unregister();
      console.log('[SW] Service Worker antigo desregistrado');
    }
  });
}

import { State } from './state.js';
import { Router } from './router.js';
import { API } from './api.js';
import { esc, el, toast } from './utils.js';
import { restaurarLote, persistirLote, apagarTodosOsLotes } from './lote-store.js';
import { Theme } from './theme.js';
import { CompanySelector } from './components/CompanySelector.js';
import { Dashboard } from './components/Dashboard.js';
import { Simulador } from './components/Simulador.js';
import { LoteSimulador } from './components/LoteSimulador.js';
import { DanfseCentral } from './components/DanfseCentral.js';
import { Auditoria } from './components/Auditoria.js';
import { Relatorio } from './components/Relatorio.js';
import { Configuracoes } from './components/Configuracoes.js';
import { LoginScreen } from './components/LoginScreen.js';

// ==========================================================================
// Estado Global
// ==========================================================================

const state = new State();
const api = new API(state);
const router = new Router(state, api);

// Registrar rotas do roteador
const abasPrincipais = ['dashboard', 'simular', 'lote', 'auditoria', 'relatorio', 'danfse', 'configuracoes'];

// Rota raiz - renderiza app completo (login/seletor/main)
router.addRoute('', () => renderApp());

// Rotas das abas principais - se já no main app, só troca aba; senão renderiza app completo
for (const aba of abasPrincipais) {
  router.addRoute(aba, () => {
    if (state.empresaAtiva && document.getElementById('content')) {
      // Já no main app: só troca a aba ativa
      state.setAba(aba);
      renderActiveTab();
    } else {
      // Não está no main app (ex: veio do seletor de empresas): renderiza app completo
      renderApp();
    }
  });
}

// Componentes (instanciados sob demanda)
let components = {};

// ==========================================================================
// Inicialização
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Link de confirmação de e-mail (#/confirmar-email?token=...): o token sai da barra de endereço na hora.
  let avisoInicial = null;
  const mc = /^#\/confirmar-email\?token=([\w-]+)/.exec(window.location.hash);
  if (mc) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    try { await api.post('/auth/confirmar', { token: mc[1] }); avisoInicial = ['E-mail confirmado. Obrigado!', 'ok']; }
    catch (e) { avisoInicial = [e.message, 'err']; }
  }

  // Verificar token salvo
  const savedToken = sessionStorage.getItem('rtc_token');
  if (savedToken) {
    state.setToken(savedToken);
  }

  // Carregar a conta e as empresas do contador (se logado)
  if (state.token) {
    try {
      await state.loadUser();
      if (!emailPendenteObrigatorio()) await state.loadEmpresas();
    } catch (e) {
      console.warn('Falha ao carregar a conta:', e);
      state.clearToken();
    }
  }

  // Lote guardado neste computador: volta ao escolher a empresa; guarda de novo ao fechar a página.
  state.on('empresa:change', async () => {
    const emp = state.empresaAtiva;
    const quando = emp && await restaurarLote(state.user?.id, emp.cnpj);
    if (quando) {
      if (document.getElementById('content')) renderActiveTab();
      toast(`Lote anterior desta empresa recuperado (${new Date(quando).toLocaleString('pt-BR')}).`, 'ok', 6000);
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistirLote(state.user?.id); });
  window.addEventListener('pagehide', () => persistirLote(state.user?.id));

  // Iniciar roteador
  router.start();

  // Render inicial
  renderApp();
  if (avisoInicial) toast(avisoInicial[0], avisoInicial[1], 6000);
});

// ==========================================================================
// Render Principal
// ==========================================================================

function renderApp() {
  const appRoot = document.getElementById('app-root');
  if (!appRoot) return;

  // Link de redefinição de senha: abre a tela mesmo com sessão ativa.
  if (/^#\/redefinir\?token=/.test(window.location.hash)) components.login = null;
  if (!state.token || components.login?.modo === 'redefinir') {
    // Não logado → Tela de Login/Planos
    if (!components.login) {
      components.login = new LoginScreen(state, api, router);
    }
    appRoot.innerHTML = '';
    appRoot.appendChild(components.login.render());
    components.login.mount();
    return;
  }

  // Operador exige e-mail confirmado: nada funciona até confirmar.
  if (emailPendenteObrigatorio()) {
    appRoot.innerHTML = '';
    appRoot.appendChild(telaConfirmeEmail());
    return;
  }

  // Logado mas sem empresa selecionada → Seletor de Empresas
  if (!state.empresaAtiva) {
    if (!components.companySelector) {
      components.companySelector = new CompanySelector(state, api, router);
    }
    appRoot.innerHTML = '';
    appRoot.appendChild(avisoEmail());
    appRoot.appendChild(components.companySelector.render());
    components.companySelector.mount();
    return;
  }

  // Logado com empresa → App Principal (Sidebar + Conteúdo)
  renderMainApp(appRoot);
}

// ==========================================================================
// Confirmação de e-mail
// ==========================================================================

const emailPendente = () => state.user && state.user.email_confirmado === false;
const emailPendenteObrigatorio = () => emailPendente() && state.user.confirmacao_obrigatoria === true;

async function reenviarConfirmacao(botao) {
  botao.disabled = true;
  try { const r = await api.post('/me/reenviar-confirmacao', {}); toast(r.mensagem, 'ok', 5000); }
  catch (e) { toast(e.message, 'err', 5000); }
  botao.disabled = false;
}

/** Faixa discreta no topo enquanto o e-mail não foi confirmado (quando a confirmação não é obrigatória). */
function avisoEmail() {
  const caixa = el('div');
  if (!emailPendente()) return caixa;
  const botao = el('button', { class: 'sec', style: 'margin-left:12px' }, 'Reenviar link');
  botao.addEventListener('click', () => reenviarConfirmacao(botao));
  caixa.append(el('div', { class: 'msg warn', style: 'margin:12px 20px 0' }, 'Confirme seu e-mail: enviamos um link para o endereço do cadastro. ', botao));
  return caixa;
}

function telaConfirmeEmail() {
  const reenviar = el('button', { class: 'sec' }, 'Reenviar link');
  reenviar.addEventListener('click', () => reenviarConfirmacao(reenviar));
  const jaConfirmei = el('button', {}, 'Já confirmei');
  jaConfirmei.addEventListener('click', async () => {
    try { await state.loadUser(); } catch { /* sessão caiu: volta ao login */ }
    if (emailPendenteObrigatorio()) { toast('Ainda não consta a confirmação. Abra o link do e-mail.', 'err', 5000); return; }
    try { await state.loadEmpresas(); } catch { /* o seletor trata */ }
    renderApp();
  });
  const sair = el('button', { class: 'sec' }, 'Sair');
  sair.addEventListener('click', async () => { await apagarTodosOsLotes(); state.clearToken(); renderApp(); });
  return el('div', { class: 'card', style: 'max-width:520px;margin:12vh auto;padding:28px' },
    el('div', { class: 'eyebrow' }, 'Quase lá'),
    el('h1', {}, 'Confirme seu e-mail'),
    el('p', {}, 'Enviamos um link de confirmação para o e-mail do cadastro. Abra o link e depois clique em "Já confirmei". Se não encontrar a mensagem, olhe a caixa de spam ou peça um novo link.'),
    el('div', { class: 'row', style: 'margin-top:16px;gap:10px' }, jaConfirmei, reenviar, sair));
}

function renderMainApp(root) {
  root.innerHTML = `
    <div class="app" id="main-app">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="main">
        <header class="topbar" id="topbar"></header>
        <div id="aviso-email"></div>
        <main class="content" id="content"></main>
        <div class="foot">As simulações usam as calculadoras publicadas pela Receita Federal e têm caráter informativo: não substituem a orientação do seu contador nem a apuração oficial dos tributos.</div>
      </div>
    </div>
  `;

  document.getElementById('aviso-email')?.append(avisoEmail());

  // Renderizar Sidebar
  renderSidebar();

  // Renderizar Topbar
  renderTopbar();

  // Renderizar Conteúdo da aba ativa
  renderActiveTab();
}

function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const empresa = state.empresaAtiva;
  const inicial = (empresa?.razao_social || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  sidebar.innerHTML = `
    <div class="brand">
      <div class="brand-mark">N</div>
      <div>
        <div class="brand-name">nexo fiscal</div>
        <div class="brand-sub">simulador CBS e IBS</div>
      </div>
    </div>
    <div class="side-label">Empresa</div>
    <div class="nav" aria-label="Empresa ativa">
      <button class="nav-item" disabled style="justify-content: flex-start; gap: 10px;">
        <span class="nav-num">${esc(inicial)}</span>
        <span style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
          <div class="nav-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(empresa?.razao_social || 'Empresa')}</div>
          <div class="nav-cap">${formatRegime(empresa?.regime_atual)}</div>
        </span>
        <span class="pill pill-blue" style="flex-shrink: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${empresa?.cnpj ? formatCNPJ(empresa.cnpj) : ''}</span>
      </button>
      <button class="link" id="trocar-empresa" style="margin-top: 8px; width: 100%; text-align: left;">Trocar de empresa</button>
    </div>

    <div class="side-label">Menu</div>
    <nav class="nav" aria-label="Menu principal" id="menu-nav">
      <button class="nav-item" data-aba="dashboard" aria-selected="true"><span class="nav-num">01</span><span><div class="nav-text">Dashboard</div><div class="nav-cap">Visão executiva</div></span></button>
      <button class="nav-item" data-aba="simular" aria-selected="false"><span class="nav-num">02</span><span><div class="nav-text">Simular tributos</div><div class="nav-cap">CBS e IBS por item</div></span></button>
      <button class="nav-item" data-aba="lote" aria-selected="false"><span class="nav-num">03</span><span><div class="nav-text">Simulador em lote</div><div class="nav-cap">XML, ZIP ou CSV</div></span></button>
      <button class="nav-item" data-aba="auditoria" aria-selected="false"><span class="nav-num">04</span><span><div class="nav-text">Auditoria</div><div class="nav-cap">Itens com erro/alerta</div></span></button>
      <button class="nav-item" data-aba="relatorio" aria-selected="false"><span class="nav-num">05</span><span><div class="nav-text">Relatório</div><div class="nav-cap">White-label PDF/Excel</div></span></button>
      <button class="nav-item" data-aba="danfse" aria-selected="false"><span class="nav-num">06</span><span><div class="nav-text">Central DANFSe</div><div class="nav-cap">PDFs de nota em lote</div></span></button>
      <button class="nav-item" data-aba="configuracoes" aria-selected="false"><span class="nav-num">07</span><span><div class="nav-text">Configurações</div><div class="nav-cap">Plano e escritório</div></span></button>
    </nav>

    <div class="sidebar-bottom">
      <div class="avatar" id="avatar">${esc(inicial)}</div>
      <div>
        <div class="user-name" id="quem">${esc(state.user?.nome || 'Sua conta')}</div>
        <div class="user-role" id="papel">Plano ${formatPlano(state.user?.plano)}</div>
      </div>
    </div>
  `;

  // Event listeners
  document.getElementById('trocar-empresa')?.addEventListener('click', () => {
    state.setEmpresaAtiva(null);
    renderApp();
  });

  document.querySelectorAll('#menu-nav .nav-item[data-aba]').forEach(btn => {
    btn.addEventListener('click', () => {
      router.navigate(btn.dataset.aba);
    });
  });

  // Atualizar aria-selected
  document.querySelectorAll('#menu-nav .nav-item[data-aba]').forEach(btn => {
    btn.setAttribute('aria-selected', btn.dataset.aba === state.abaAtiva);
  });
}

function renderTopbar() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;

  const titulos = {
    dashboard: 'Dashboard',
    simular: 'Simular tributos',
    lote: 'Simulador em lote',
    auditoria: 'Auditoria',
    relatorio: 'Relatório White-Label',
    danfse: 'Central DANFSe',
    configuracoes: 'Configurações'
  };

  topbar.innerHTML = `
    <div class="breadcrumb">Nexo Fiscal <span style="padding:0 7px;color:#bdc7d1">/</span> <strong id="crumb">${titulos[state.abaAtiva] || 'Dashboard'}</strong></div>
    <div id="sessao" class="row" style="gap: 12px; align-items: center;">
      <span class="pill pill-blue" id="plano-pill">Plano ${formatPlano(state.user?.plano)}</span>
      <div id="theme-toggle-container"></div>
      <button class="sec" id="sair">Sair</button>
    </div>
  `;

  // Inserir o seletor de tema
  const themeContainer = document.getElementById('theme-toggle-container');
  if (themeContainer) {
    themeContainer.appendChild(Theme.createDropdown());
  }

  document.getElementById('sair')?.addEventListener('click', async () => {
    await apagarTodosOsLotes();
    state.clearToken();
    renderApp();
  });
}

function renderActiveTab() {
  const content = document.getElementById('content');
  if (!content) return;

  // Limpar componente anterior se aba mudou
  if (components[state.abaAtiva] && components[state.abaAtiva].unmount) {
    components[state.abaAtiva].unmount();
  }

  // Instanciar componente se necessário
  if (!components[state.abaAtiva]) {
    components[state.abaAtiva] = createComponent(state.abaAtiva);
  }

  // Renderizar
  content.innerHTML = '';
  const el = components[state.abaAtiva].render();
  content.appendChild(el);
  components[state.abaAtiva].mount();

  // Atualizar breadcrumb
  const titulos = {
    dashboard: 'Dashboard',
    simular: 'Simular tributos',
    lote: 'Simulador em lote',
    auditoria: 'Auditoria',
    relatorio: 'Relatório White-Label',
    danfse: 'Central DANFSe',
    configuracoes: 'Configurações'
  };
  document.getElementById('crumb').textContent = titulos[state.abaAtiva] || 'Dashboard';

  // Atualizar sidebar selection
  document.querySelectorAll('#menu-nav .nav-item[data-aba]').forEach(btn => {
    btn.setAttribute('aria-selected', btn.dataset.aba === state.abaAtiva);
  });

  window.scrollTo(0, 0);
}

function createComponent(aba) {
  switch (aba) {
    case 'dashboard': return new Dashboard(state, api, router);
    case 'simular': return new Simulador(state, api, router);
    case 'lote': return new LoteSimulador(state, api, router);
    case 'auditoria': return new Auditoria(state, api, router);
    case 'relatorio': return new Relatorio(state, api, router);
    case 'danfse': return new DanfseCentral(state, api, router);
    case 'configuracoes': return new Configuracoes(state, api, router);
    default: return new Dashboard(state, api, router);
  }
}

// ==========================================================================
// Utilitários de Formatação
// ==========================================================================

function formatCNPJ(cnpj) {
  const n = String(cnpj).replace(/\D/g, '').padStart(14, '0');
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatRegime(regime) {
  const map = {
    'simples-nacional': 'Simples Nacional',
    'lucro-presumido': 'Lucro Presumido',
    'lucro-real': 'Lucro Real',
    'regime-normal': 'Regime Normal'
  };
  return map[regime] || regime;
}

function formatPlano(plano) {
  const map = {
    gratuito: 'Gratuito',
    profissional: 'Profissional',
    ilimitado: 'Ilimitado',
    escritorio: 'Escritório'
  };
  return map[plano] || plano || '—';
}

// Expor globalmente para debug
window.__APP__ = { state, api, router, components };