// node tests/rps.test.mjs
import assert from "node:assert/strict";
import { classify } from "../public/gestures.js";
import { Cpu, judge, MOVES, COUNTER, LEVEL_DEFAULTS } from "../public/cpu.js";

// ---------- classificador de gestos (mão sintética; punho em (0.5,0.9), palma = 0.2)
const FX = { idx: 0.46, mid: 0.50, ring: 0.54, pinky: 0.58 }, BASE = { idx: 5, mid: 9, ring: 13, pinky: 17 };
function hand({ idx, mid, ring, pinky, thumb = "side" }) {
  const lm = Array.from({ length: 21 }, () => [0.5, 0.9]);
  for (const [n, ext] of Object.entries({ idx, mid, ring, pinky })) {
    const x = FX[n], b = BASE[n];
    lm[b] = [x, 0.70]; lm[b + 1] = [x, 0.55];
    lm[b + 2] = [x, ext ? 0.45 : 0.60]; lm[b + 3] = [x, ext ? 0.35 : 0.64];
  }
  if (thumb === "up") { lm[2] = [0.40, 0.72]; lm[3] = [0.40, 0.60]; lm[4] = [0.40, 0.48]; }
  else { lm[2] = [0.42, 0.78]; lm[3] = [0.43, 0.72]; lm[4] = [0.45, 0.66]; }
  return lm;
}
assert.equal(classify(hand({ idx: 0, mid: 0, ring: 0, pinky: 0 })), "pedra");
assert.equal(classify(hand({ idx: 1, mid: 1, ring: 1, pinky: 1 })), "papel");
assert.equal(classify(hand({ idx: 1, mid: 1, ring: 0, pinky: 0 })), "tesoura");
assert.equal(classify(hand({ idx: 0, mid: 0, ring: 0, pinky: 0, thumb: "up" })), "joia");
assert.equal(classify(hand({ idx: 1, mid: 0, ring: 0, pinky: 0 })), null);       // só o indicador: não é jogada
assert.equal(classify(hand({ idx: 1, mid: 1, ring: 1, pinky: 1, thumb: "up" })), "papel"); // polegar p/ cima com mão aberta ≠ joia
assert.equal(classify(null), null);

// ---------- regras
assert.equal(judge("pedra", "tesoura"), "vitoria");
assert.equal(judge("papel", "pedra"), "vitoria");
assert.equal(judge("tesoura", "papel"), "vitoria");
assert.equal(judge("pedra", "papel"), "derrota");
assert.equal(judge("papel", "papel"), "empate");

// ---------- IA (rng determinístico)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function play(levelKey, userFn, rounds = 600, seed = 7) {
  const lv = LEVEL_DEFAULTS[levelKey];
  const cpu = new Cpu({ strategy: lv.strategy, p: lv.p }, mulberry32(seed));
  const rng = mulberry32(seed + 1);
  const r = { vitoria: 0, derrota: 0, empate: 0 };
  const hist = [];
  for (let i = 0; i < rounds; i++) {
    const c = cpu.pick();                 // decide antes de ver a jogada do usuário
    const u = userFn(i, hist, rng);
    r[judge(u, c)]++; cpu.record(u, c); hist.push([u, c]);
  }
  return r;
}
const rate = (r, k) => r[k] / (r.vitoria + r.derrota + r.empate);

// Aprendiz é aleatório: ~1/3 para cada resultado, mesmo contra jogador previsível
const ap = play("aprendiz", () => "pedra");
assert.ok(Math.abs(rate(ap, "derrota") - 1 / 3) < 0.07, "aprendiz deve ser ~aleatório: " + JSON.stringify(ap));

// Jovem pune quem repete a mesma jogada
const jo = play("jovem", () => "pedra");
assert.ok(rate(jo, "derrota") > 0.55, "jovem deve explorar frequência: " + JSON.stringify(jo));

// Mestre pune ciclos (pedra→papel→tesoura…) e "ganhou-fica / perdeu-troca"
const ciclo = play("mestre", (i) => MOVES[i % 3]);
assert.ok(rate(ciclo, "derrota") > 0.7, "mestre deve decifrar ciclos: " + JSON.stringify(ciclo));
const wsls = play("mestre", (i, h) => (h.length ? (judge(h.at(-1)[0], h.at(-1)[1]) === "vitoria" ? h.at(-1)[0] : COUNTER[h.at(-1)[1]]) : "pedra"));
assert.ok(rate(wsls, "derrota") > 0.55, "mestre deve decifrar reação ao resultado: " + JSON.stringify(wsls));

// Contra um jogador verdadeiramente aleatório ninguém tem vantagem
const aleat = play("mestre", (i, h, rng) => MOVES[Math.floor(rng() * 3)], 3000);
assert.ok(Math.abs(rate(aleat, "derrota") - 1 / 3) < 0.05, "contra aleatório deve ser ~1/3: " + JSON.stringify(aleat));

console.log("gestures.js + cpu.js OK");
