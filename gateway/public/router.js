/**
 * Nexo Fiscal — Router
 * ==========================================================================
 * Roteador simples baseado em hash (#/rota) para SPA.
 */

export class Router {
  constructor(state, api) {
    this.state = state;
    this.api = api;
    this.routes = new Map();
    this.currentRoute = null;
  }

  start() {
    window.addEventListener('hashchange', () => this.handleHashChange());
    window.addEventListener('load', () => this.handleHashChange());
  }

  handleHashChange() {
    const hash = window.location.hash.slice(1) || '/';
    const [path, queryString] = hash.split('?');
    const query = new URLSearchParams(queryString || '');
    const params = Object.fromEntries(query);

    // Encontrar rota correspondente
    for (const [pattern, handler] of this.routes) {
      const match = this.matchRoute(pattern, path);
      if (match) {
        this.currentRoute = { path, params: { ...match.params, ...params } };
        handler(this.currentRoute);
        return;
      }
    }

    // Rota não encontrada → redirect para dashboard
    if (this.state.token && this.state.empresaAtiva) {
      this.navigate('dashboard');
    }
  }

  matchRoute(pattern, path) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return { params };
  }

  // Registrar rota (para componentes internos se necessário)
  addRoute(pattern, handler) {
    this.routes.set(pattern, handler);
  }

  // Navegação programática
  navigate(aba, params = {}) {
    this.state.setAba(aba);

    const query = new URLSearchParams(params).toString();
    const hash = `#/${aba}${query ? '?' + query : ''}`;
    window.location.hash = hash;
  }

  // Obter parâmetros da rota atual
  getParams() {
    return this.currentRoute?.params || {};
  }
}