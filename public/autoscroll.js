// Rolagem por ponteiro: ao posicionar o cursor na faixa da barra de rolagem,
// a lista sobe se ele estiver na metade de cima e desce se estiver na de baixo.
// Quanto mais perto da ponta, mais rápido; perto do meio, fica parado.
// Lógica pura (sem DOM) para poder ser testada em Node.

export const RAIL_W = 56;   // largura da faixa sensível, em px (inclui a barra de rolagem nativa)

/** Retângulo da faixa: a borda direita da lista. `r` é o getBoundingClientRect() da lista. */
export function railRect(r) {
  return { left: r.right - RAIL_W, right: r.right, top: r.top, bottom: r.bottom };
}

/**
 * Quantos pixels rolar neste quadro (negativo = para cima, positivo = para baixo).
 * @param rect  retângulo da lista (getBoundingClientRect)
 * @param x,y   posição do ponteiro na tela
 * @param dt    segundos desde o quadro anterior
 */
export function scrollDelta(rect, x, y, dt, { dead = 0.12, min = 140, max = 950 } = {}) {
  const z = railRect(rect);
  if (x < z.left || x > z.right || y < z.top || y > z.bottom) return 0;
  const half = (z.bottom - z.top) / 2;
  if (half <= 0) return 0;
  const off = (y - (z.top + half)) / half;      // -1 no topo … +1 na base
  const a = Math.abs(off);
  if (a < dead) return 0;                       // zona morta no meio
  const k = (a - dead) / (1 - dead);
  return Math.sign(off) * (min + (max - min) * k) * dt;
}
