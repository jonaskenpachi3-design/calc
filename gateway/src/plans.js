// Limites mensais por plano. Valores de partida: ajuste ao seu modelo comercial.
// null = ilimitado.
export const PLANOS = {
  gratuito: { calculo: 500, danfse: 50, empresas: 2 },
  profissional: { calculo: 20000, danfse: 2000, empresas: 15 },
  ilimitado: { calculo: null, danfse: null, empresas: null },
};

export const RECURSOS = ['calculo', 'danfse'];
// 'empresas' (CNPJs cadastrados) é um limite de quantidade, não mensal.

export function limiteDoPlano(plano, recurso) {
  const p = PLANOS[plano];
  if (!p) return 0;
  return p[recurso] ?? null;
}

export function inicioDoMes(agora = new Date()) {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
}
