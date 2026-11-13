// Regras e "cérebro" do computador.
// Justiça: o computador escolhe a jogada ANTES da contagem, usando apenas o
// histórico de rodadas anteriores. Ele nunca olha a sua mão da rodada atual.

export const MOVES = ["pedra", "papel", "tesoura"];
export const EMOJI = { pedra: "✊", papel: "✋", tesoura: "✌️", joia: "👍" };
export const LABEL = { pedra: "Pedra", papel: "Papel", tesoura: "Tesoura", joia: "Joia" };
export const VERB = { pedra: "quebra", papel: "cobre", tesoura: "corta" };

// BEATS[x] = o que x vence  ·  COUNTER[x] = o que vence x
export const BEATS = { pedra: "tesoura", papel: "pedra", tesoura: "papel" };
export const COUNTER = { pedra: "papel", papel: "tesoura", tesoura: "pedra" };

/** 'vitoria' | 'derrota' | 'empate' do ponto de vista do jogador. */
export function judge(user, cpu) {
  if (user === cpu) return "empate";
  return BEATS[user] === cpu ? "vitoria" : "derrota";
}

export const LEVEL_DEFAULTS = {
  aprendiz: { name: "Aprendiz", icon: "🌱", beat: 900, strategy: "random", p: 0 },
  jovem: { name: "Jovem", icon: "⚔️", beat: 700, strategy: "freq", p: 0.5 },
  mestre: { name: "Mestre", icon: "🐉", beat: 550, strategy: "markov", p: 0.85 },
};

function argmax(scores, rng) {
  const best = Math.max(...MOVES.map((m) => scores[m]));
  const tied = MOVES.filter((m) => scores[m] === best);
  return tied[Math.floor(rng() * tied.length)];
}

export class Cpu {
  /**
   * strategy: 'random' | 'freq' (conta frequências) | 'markov' (padrões de sequência)
   * p: probabilidade de usar a previsão (senão joga aleatório, para não ser 100% previsível)
   */
  constructor({ strategy = "random", p = 0 } = {}, rng = Math.random) {
    this.strategy = strategy;
    this.p = p;
    this.rng = rng;
    this.user = [];
    this.cpu = [];
    this.freq = { pedra: 0, papel: 0, tesoura: 0 };
    this.ctx = new Map(); // "ctx|..." -> contagem da próxima jogada do usuário
  }

  _bump(key, move) {
    const c = this.ctx.get(key) || { pedra: 0, papel: 0, tesoura: 0 };
    c[move]++;
    this.ctx.set(key, c);
  }

  /** Registra uma rodada concluída (depois de revelar as jogadas). */
  record(user, cpu) {
    const u = this.user, c = this.cpu, n = u.length;
    if (n >= 2) this._bump(`2|${u[n - 2]}|${u[n - 1]}`, user);
    if (n >= 1) {
      this._bump(`uc|${u[n - 1]}|${c[n - 1]}`, user);
      this._bump(`1|${u[n - 1]}`, user);
    }
    this.freq[user]++;
    u.push(user);
    c.push(cpu);
  }

  /** Prevê a próxima jogada do usuário. */
  predict() {
    const u = this.user, c = this.cpu, n = u.length;
    const score = { pedra: 0, papel: 0, tesoura: 0 };
    const add = (key, w) => {
      const t = this.ctx.get(key);
      if (!t) return;
      const sum = t.pedra + t.papel + t.tesoura;
      for (const m of MOVES) score[m] += (w * t[m]) / sum * Math.min(sum, 3);
    };
    if (this.strategy === "markov") {
      if (n >= 2) add(`2|${u[n - 2]}|${u[n - 1]}`, 3);
      if (n >= 1) { add(`uc|${u[n - 1]}|${c[n - 1]}`, 2); add(`1|${u[n - 1]}`, 1.5); }
      const total = n || 1;
      for (const m of MOVES) score[m] += 0.5 * (this.freq[m] / total);
    } else {
      for (const m of MOVES) score[m] = this.freq[m];
    }
    return argmax(score, this.rng);
  }

  /** Escolhe a jogada da próxima rodada. */
  pick() {
    const rand = () => MOVES[Math.floor(this.rng() * 3)];
    const need = this.strategy === "markov" ? 2 : 3;
    if (this.strategy === "random" || this.user.length < need) return rand();
    if (this.rng() >= this.p) return rand();
    return COUNTER[this.predict()];
  }
}
