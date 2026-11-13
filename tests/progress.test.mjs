// node tests/progress.test.mjs
import assert from "node:assert/strict";
import { starsFor, unlockedLevels, roundXp, matchXp, rankFor, newAchievements, defaultSave, ACHIEVEMENTS } from "../public/progress.js";

// estrelas
assert.equal(starsFor(3, 0), 3);
assert.equal(starsFor(3, 1), 2);
assert.equal(starsFor(3, 2), 1);
assert.equal(starsFor(2, 3), 0);   // derrota
assert.equal(starsFor(2, 1), 0);   // partida não terminou

// desbloqueio em cadeia
let s = defaultSave();
assert.deepEqual(unlockedLevels(s), ["aprendiz"]);
s.stars.aprendiz = 1;
assert.deepEqual(unlockedLevels(s), ["aprendiz", "jovem"]);
s.stars.mestre = 3;                 // não abre nada sozinho: precisa do Jovem
assert.deepEqual(unlockedLevels(s), ["aprendiz", "jovem"]);
s.stars.jovem = 2;
assert.deepEqual(unlockedLevels(s), ["aprendiz", "jovem", "mestre"]);
assert.deepEqual(unlockedLevels({ ...defaultSave(), all: true }), ["aprendiz", "jovem", "mestre"]);

// XP: nível mais difícil vale mais; sequência dá bônus limitado
assert.equal(roundXp("vitoria", 1, 0), 10);
assert.equal(roundXp("vitoria", 1, 2), 30);
assert.equal(roundXp("vitoria", 3, 0), 15);
assert.equal(roundXp("vitoria", 99, 0), 20);     // teto de +100%
assert.ok(roundXp("empate", 0, 0) > roundXp("derrota", 0, 0));
assert.ok(matchXp(true, 3, 2) > matchXp(true, 1, 2) && matchXp(true, 1, 0) > matchXp(false, 0, 0));

// títulos
assert.equal(rankFor(0).title, "Novato");
assert.equal(rankFor(99).title, "Novato");
assert.equal(rankFor(100).title, "Praticante");
assert.equal(rankFor(5000).title, "Samurai");
assert.equal(rankFor(5000).next, null);
assert.ok(Math.abs(rankFor(225).pct - 0.5) < 1e-9);   // metade do caminho entre 100 e 350

// conquistas
s = defaultSave();
assert.deepEqual(newAchievements(s, { type: "round", result: "vitoria", streak: 1, level: "aprendiz" }), ["first_win"]);
s.ach.first_win = 1;
assert.deepEqual(newAchievements(s, { type: "round", result: "vitoria", streak: 5, level: "aprendiz" }), ["streak5"]);
assert.deepEqual(newAchievements(s, { type: "round", result: "derrota", streak: 0, level: "aprendiz" }), []);
s.matches = 1;
const mestre30 = newAchievements(s, { type: "match", won: true, myW: 3, oppW: 0, level: "mestre", comeback: false });
assert.deepEqual(mestre30.sort(), ["beat_mestre", "champion", "legend", "perfect"]);
assert.deepEqual(newAchievements(s, { type: "match", won: true, myW: 3, oppW: 2, level: "jovem", comeback: true }).sort(),
  ["beat_jovem", "champion", "comeback"]);
assert.deepEqual(newAchievements(s, { type: "match", won: false, myW: 1, oppW: 3, level: "mestre", comeback: false }), []);
s.matches = 10;
assert.ok(newAchievements(s, { type: "match", won: false, myW: 0, oppW: 3, level: "aprendiz" }).includes("veteran"));
// não repete conquista já ganha
s.ach.champion = 1;
assert.ok(!newAchievements(s, { type: "match", won: true, myW: 3, oppW: 0, level: "aprendiz" }).includes("champion"));
assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);

console.log("progress.js OK");
