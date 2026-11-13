// Classificador de gestos do Jokenpo.
// Entrada: 21 pontos [x, y] do MediaPipe (normalizados). Saída:
//   'pedra' | 'papel' | 'tesoura' | 'joia' | null

const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Razão ponta/PIP (distância ao pulso) de indicador, médio, anelar e mindinho. */
export function fingerRatios(p) {
  const w = p[0];
  const r = (tip, pip) => d(p[tip], w) / Math.max(d(p[pip], w), 1e-6);
  return [r(8, 6), r(12, 10), r(16, 14), r(20, 18)];
}

export function classify(p, { ext = 1.15 } = {}) {
  if (!p || p.length < 21) return null;
  const palm = Math.max(d(p[0], p[9]), 1e-6);
  const e = fingerRatios(p).map((v) => v > ext);
  const n = e.filter(Boolean).length;

  if (n === 0) {
    // Joia: punho com o polegar apontando para cima, bem acima dos nós dos dedos.
    const topMcp = Math.min(p[5][1], p[9][1], p[13][1], p[17][1]);
    const thumbUp = p[4][1] < topMcp - 0.3 * palm && p[4][1] < p[3][1] && p[3][1] < p[2][1];
    return thumbUp ? "joia" : "pedra";
  }
  if (n === 4 || (n === 3 && e[0] && e[1])) return "papel";
  if (e[0] && e[1] && !e[2] && !e[3]) return "tesoura";
  return null;
}
