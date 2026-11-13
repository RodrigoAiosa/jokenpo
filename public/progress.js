// Progressão do jogador: partidas, estrelas, desbloqueio, XP, títulos e conquistas.
// Lógica pura (sem DOM), para poder ser testada em Node.

export const LEVEL_ORDER = ["aprendiz", "jovem", "mestre"];
export const WIN_TARGET = 3;   // melhor de 5: vence quem fizer 3 rodadas
export const SURVIVAL_LIVES = 3;
export const SURVIVAL_MAX_LIVES = 5;

export const defaultSave = () => ({
  stars: { aprendiz: 0, jovem: 0, mestre: 0 },
  best: { aprendiz: 0, jovem: 0, mestre: 0 },   // melhor sequência de vitórias por nível
  xp: 0,
  matches: 0,
  ach: {},          // id -> timestamp
  all: false,       // "destravar todos os níveis"
  survival: { best: 0, runs: 0 },   // modo Sobrevivência: recorde de vitórias e nº de tentativas
});

/** ⭐ por partida vencida: 3 = 3×0, 2 = 3×1, 1 = 3×2. Empates não contam. */
export function starsFor(myWins, oppWins) {
  if (myWins < WIN_TARGET || oppWins >= WIN_TARGET) return 0;
  return oppWins === 0 ? 3 : oppWins === 1 ? 2 : 1;
}

/** Aprendiz sempre aberto; cada nível abre ao vencer uma partida no anterior. */
export function unlockedLevels(save) {
  if (save.all) return [...LEVEL_ORDER];
  const out = [LEVEL_ORDER[0]];
  for (let i = 1; i < LEVEL_ORDER.length; i++) {
    if ((save.stars[LEVEL_ORDER[i - 1]] || 0) > 0) out.push(LEVEL_ORDER[i]); else break;
  }
  return out;
}

/**
 * Modo Sobrevivência: quanto mais você vence, mais rápida a contagem e mais esperto o computador.
 *   0–2 vitórias → aleatório · 3–6 → conta suas jogadas · 7+ → lê padrões de sequência
 * A contagem começa em 900 ms e encurta 40 ms por vitória, até o piso de 380 ms.
 * `stage` (0/1/2) equivale a Aprendiz/Jovem/Mestre (usado no XP e no rótulo da IA).
 */
export function survivalParams(wins) {
  const beat = Math.max(380, 900 - 40 * wins);
  if (wins < 3) return { stage: 0, strategy: "random", p: 0, beat };
  if (wins < 7) return { stage: 1, strategy: "freq", p: 0.5, beat };
  return { stage: 2, strategy: "markov", p: 0.85, beat };
}

/** +1 vida a cada 5 vitórias, até o máximo de 5. */
export function livesAfterWin(lives, wins) {
  return wins > 0 && wins % 5 === 0 && lives < SURVIVAL_MAX_LIVES ? lives + 1 : lives;
}

/** XP de uma rodada: níveis mais difíceis valem mais; sequência de vitórias dá bônus (até +100%). */
export function roundXp(result, streak, levelIdx) {
  const m = levelIdx + 1;
  if (result === "vitoria") return Math.round(10 * m * (1 + 0.25 * Math.min(Math.max(streak - 1, 0), 4)));
  if (result === "empate") return 2 * m;
  return 1;
}

/** XP de fim de partida. */
export function matchXp(won, stars, levelIdx) {
  return won ? 50 * (levelIdx + 1) + 25 * (stars - 1) : 5;
}

export const RANKS = [
  { title: "Novato", icon: "🌱", xp: 0 },
  { title: "Praticante", icon: "🥋", xp: 100 },
  { title: "Guerreiro", icon: "⚔️", xp: 350 },
  { title: "Sensei", icon: "🧘", xp: 800 },
  { title: "Samurai", icon: "🏯", xp: 1600 },
];

export function rankFor(xp) {
  let i = 0;
  RANKS.forEach((r, k) => { if (xp >= r.xp) i = k; });
  const cur = RANKS[i].xp, next = RANKS[i + 1]?.xp ?? null;
  return { index: i, title: RANKS[i].title, icon: RANKS[i].icon, next, pct: next === null ? 1 : (xp - cur) / (next - cur) };
}

// ev: { type:'round', result, streak, level } | { type:'match', won, myW, oppW, level, comeback } | { type:'survival', wins }
export const ACHIEVEMENTS = [
  { id: "first_win", icon: "🎯", name: "Primeira vitória", desc: "Vença uma rodada.",
    test: (e) => e.type === "round" && e.result === "vitoria" },
  { id: "streak5", icon: "🔥", name: "Em chamas", desc: "Vença 5 rodadas seguidas.",
    test: (e) => e.type === "round" && e.streak >= 5 },
  { id: "champion", icon: "🏆", name: "Campeão", desc: "Vença uma partida.",
    test: (e) => e.type === "match" && e.won },
  { id: "perfect", icon: "💎", name: "Perfeito", desc: "Vença uma partida por 3 a 0.",
    test: (e) => e.type === "match" && e.won && e.oppW === 0 },
  { id: "comeback", icon: "🔄", name: "Virada", desc: "Vença uma partida depois de estar perdendo por 0 a 2.",
    test: (e) => e.type === "match" && e.won && e.comeback },
  { id: "beat_jovem", icon: "⚔️", name: "Domador de jovens", desc: "Vença uma partida no nível Jovem.",
    test: (e) => e.type === "match" && e.won && e.level === "jovem" },
  { id: "beat_mestre", icon: "🐉", name: "Mestre dos Mestres", desc: "Vença uma partida no nível Mestre.",
    test: (e) => e.type === "match" && e.won && e.level === "mestre" },
  { id: "legend", icon: "👑", name: "Lenda", desc: "Vença o Mestre por 3 a 0.",
    test: (e) => e.type === "match" && e.won && e.level === "mestre" && e.oppW === 0 },
  { id: "veteran", icon: "🎖️", name: "Veterano", desc: "Jogue 10 partidas.",
    test: (e, s) => e.type === "match" && s.matches >= 10 },
  { id: "survivor", icon: "♾️", name: "Sobrevivente", desc: "Vença 10 rodadas numa sobrevivência.",
    test: (e) => e.type === "survival" && e.wins >= 10 },
  { id: "unstoppable", icon: "🚀", name: "Imparável", desc: "Vença 20 rodadas numa sobrevivência.",
    test: (e) => e.type === "survival" && e.wins >= 20 },
];

/** Ids das conquistas que o evento acabou de desbloquear (o chamador grava em save.ach). */
export function newAchievements(save, ev) {
  return ACHIEVEMENTS.filter((a) => !save.ach[a.id] && a.test(ev, save)).map((a) => a.id);
}
