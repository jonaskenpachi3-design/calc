/**
 * Nexo Fiscal — Gerenciador de Temas
 * ==========================================================================
 * Controla a alternância entre temas: claro, escuro e automático (sistema).
 * Persiste a preferência no localStorage.
 */

export const Theme = {
  /** Chave usada no localStorage */
  STORAGE_KEY: 'rtc_theme',

  /** Temas disponíveis */
  MODES: {
    LIGHT: 'light',
    DARK: 'dark',
    AUTO: 'auto'
  },

  /** Rótulos amigáveis para cada modo */
  LABELS: {
    light: 'Claro',
    dark: 'Escuro',
    auto: 'Automático'
  },

  /** Ícones SVG para cada modo */
  ICONS: {
    light: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    dark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    auto: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
  },

  /**
   * Obtém o tema atual salvo ou 'auto' como padrão
   */
  get() {
    return localStorage.getItem(this.STORAGE_KEY) || this.MODES.AUTO;
  },

  /**
   * Define o tema e aplica ao documento
   * @param {string} mode - 'light', 'dark' ou 'auto'
   */
  set(mode) {
    if (!Object.values(this.MODES).includes(mode)) {
      console.warn(`Tema inválido: ${mode}`);
      return;
    }

    localStorage.setItem(this.STORAGE_KEY, mode);
    this.apply(mode);

    // Disparar evento personalizado para componentes reagirem
    window.dispatchEvent(new CustomEvent('theme:change', { detail: { mode } }));
  },

  /**
   * Aplica o tema ao documento (define data-theme no html)
   * @param {string} mode - 'light', 'dark' ou 'auto'
   */
  apply(mode) {
    const root = document.documentElement;

    if (mode === this.MODES.AUTO) {
      // Remover atributo para deixar o CSS @media funcionar
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }
  },

  /**
   * Inicializa o tema na carga da página
   */
  init() {
    const savedMode = this.get();
    this.apply(savedMode);

    // Escutar mudanças na preferência do sistema (quando em modo auto)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (this.get() === this.MODES.AUTO) {
        // O CSS @media já cuida da mudança visual, mas disparamos evento
        window.dispatchEvent(new CustomEvent('theme:change', { detail: { mode: this.MODES.AUTO } }));
      }
    });
  },

  /**
   * Alterna para o próximo tema (útil para atalho de teclado)
   */
  toggle() {
    const modes = [this.MODES.LIGHT, this.MODES.DARK, this.MODES.AUTO];
    const current = this.get();
    const currentIndex = modes.indexOf(current);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.set(modes[nextIndex]);
  },

  /**
   * Verifica se o tema efetivo atual é escuro
   * @returns {boolean}
   */
  isDark() {
    const mode = this.get();
    if (mode === this.MODES.DARK) return true;
    if (mode === this.MODES.LIGHT) return false;
    // Auto: verificar preferência do sistema
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  },

  /**
   * Cria o elemento do dropdown de temas para usar na topbar
   * @param {Function} onChange - Callback quando o tema muda
   * @returns {HTMLElement}
   */
  createDropdown(onChange) {
    const currentMode = this.get();
    const modes = [
      { value: this.MODES.LIGHT, label: this.LABELS.light, icon: this.ICONS.light },
      { value: this.MODES.DARK, label: this.LABELS.dark, icon: this.ICONS.dark },
      { value: this.MODES.AUTO, label: this.LABELS.auto, icon: this.ICONS.auto }
    ];

    // Botão principal
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle sec';
    button.setAttribute('aria-label', 'Alternar tema');
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `
      <span class="theme-toggle-icon">${modes.find(m => m.value === currentMode)?.icon || this.ICONS.auto}</span>
      <span class="theme-toggle-chevron" style="margin-left:6px;font-size:10px;">▼</span>
    `;

    // Dropdown menu
    const dropdown = document.createElement('div');
    dropdown.className = 'theme-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.style.cssText = `
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      background: var(--card);
      border: 1px solid var(--bd);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      min-width: 160px;
      z-index: 100;
      display: none;
      overflow: hidden;
    `;

    modes.forEach(mode => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'theme-dropdown-item' + (mode.value === currentMode ? ' active' : '');
      item.setAttribute('role', 'menuitem');
      item.setAttribute('aria-selected', mode.value === currentMode);
      item.setAttribute('data-mode', mode.value);
      item.style.cssText = `
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: none;
        border: none;
        color: var(--ink);
        font: inherit;
        font-size: var(--fs-sm);
        text-align: left;
        cursor: pointer;
      `;
      item.innerHTML = `
        <span class="theme-dropdown-icon" style="flex:none;">${mode.icon}</span>
        <span>${mode.label}</span>
        <span class="theme-dropdown-check" style="margin-left:auto;color:var(--teal);display:${mode.value === currentMode ? 'block' : 'none'};">✓</span>
      `;

      item.addEventListener('click', () => {
        this.set(mode.value);
        if (onChange) onChange(mode.value);
        closeDropdown();
      });

      item.addEventListener('mouseenter', () => {
        item.style.background = 'var(--bg)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'none';
      });

      dropdown.appendChild(item);
    });

    // Container para posicionamento relativo
    const container = document.createElement('div');
    container.className = 'theme-toggle-container';
    container.style.cssText = 'position: relative; display: inline-flex;';
    container.appendChild(button);
    container.appendChild(dropdown);

    // Função para abrir/fechar dropdown
    let isOpen = false;

    function openDropdown() {
      dropdown.style.display = 'block';
      button.setAttribute('aria-expanded', 'true');
      isOpen = true;
    }

    function closeDropdown() {
      dropdown.style.display = 'none';
      button.setAttribute('aria-expanded', 'false');
      isOpen = false;
    }

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isOpen) closeDropdown();
      else openDropdown();
    });

    // Fechar ao clicar fora
    document.addEventListener('click', (e) => {
      if (isOpen && !container.contains(e.target)) {
        closeDropdown();
      }
    });

    // Fechar com Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeDropdown();
        button.focus();
      }
    });

    // Atualizar UI quando tema muda (incluindo via sistema)
    window.addEventListener('theme:change', (e) => {
      const newMode = e.detail.mode;
      const newModeData = modes.find(m => m.value === newMode);
      if (newModeData) {
        button.querySelector('.theme-toggle-icon').innerHTML = newModeData.icon;
        dropdown.querySelectorAll('.theme-dropdown-item').forEach(item => {
          const isActive = item.dataset.mode === newMode;
          item.classList.toggle('active', isActive);
          item.setAttribute('aria-selected', isActive);
          item.querySelector('.theme-dropdown-check').style.display = isActive ? 'block' : 'none';
        });
      }
    });

    return container;
  }
};

// Inicializar automaticamente quando o módulo carrega
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Theme.init());
} else {
  Theme.init();
}