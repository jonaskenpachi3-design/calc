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
import { esc } from './utils.js';
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
  // Verificar token salvo
  const savedToken = sessionStorage.getItem('rtc_token');
  if (savedToken) {
    state.setToken(savedToken);
  }

  // Carregar empresas do contador (se logado)
  if (state.token) {
    try {
      await state.loadEmpresas();
    } catch (e) {
      console.warn('Falha ao carregar empresas:', e);
      state.clearToken();
    }
  }

  // Iniciar roteador
  router.start();

  // Render inicial
  renderApp();
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

  // Logado mas sem empresa selecionada → Seletor de Empresas
  if (!state.empresaAtiva) {
    if (!components.companySelector) {
      components.companySelector = new CompanySelector(state, api, router);
    }
    appRoot.innerHTML = '';
    appRoot.appendChild(components.companySelector.render());
    components.companySelector.mount();
    return;
  }

  // Logado com empresa → App Principal (Sidebar + Conteúdo)
  renderMainApp(appRoot);
}

function renderMainApp(root) {
  root.innerHTML = `
    <div class="app" id="main-app">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="main">
        <header class="topbar" id="topbar"></header>
        <main class="content" id="content"></main>
        <div class="foot">As simulações usam as calculadoras publicadas pela Receita Federal e têm caráter informativo: não substituem a orientação do seu contador nem a apuração oficial dos tributos.</div>
      </div>
    </div>
  `;

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
      <button class="nav-item" disabled style="justify-content: flex-start;">
        <span class="nav-num">${esc(inicial)}</span>
        <span>
          <div class="nav-text">${esc(empresa?.razao_social || 'Empresa')}</div>
          <div class="nav-cap">${formatRegime(empresa?.regime_atual)}</div>
        </span>
        <span class="pill pill-blue" style="margin-left: auto; font-size: 11px;">${empresa?.cnpj ? formatCNPJ(empresa.cnpj) : ''}</span>
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
    <div id="sessao" class="row">
      <span class="pill pill-blue" id="plano-pill">Plano ${formatPlano(state.user?.plano)}</span>
      <button class="sec" id="sair">Sair</button>
    </div>
  `;

  document.getElementById('sair')?.addEventListener('click', () => {
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