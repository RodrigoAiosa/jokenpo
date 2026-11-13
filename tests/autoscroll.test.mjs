// node tests/autoscroll.test.mjs
import assert from "node:assert/strict";
import { scrollDelta, railRect, RAIL_W } from "../public/autoscroll.js";

const list = { left: 100, right: 700, top: 200, bottom: 600 };   // lista 600×400
const xIn = 700 - RAIL_W / 2;                                   // dentro da faixa
const dt = 1;                                                    // 1 s, para ler px/s direto

assert.deepEqual(railRect(list), { left: 700 - RAIL_W, right: 700, top: 200, bottom: 600 });

// metade de cima rola para cima; metade de baixo rola para baixo
assert.ok(scrollDelta(list, xIn, 230, dt) < 0, "metade de cima deve subir");
assert.ok(scrollDelta(list, xIn, 570, dt) > 0, "metade de baixo deve descer");
assert.ok(scrollDelta(list, xIn, 201, dt) < 0 && scrollDelta(list, xIn, 599, dt) > 0);

// perto do meio: parado (zona morta)
assert.equal(scrollDelta(list, xIn, 400, dt), 0);
assert.equal(scrollDelta(list, xIn, 410, dt), 0);

// quanto mais perto da ponta, mais rápido; simétrico em cima e embaixo
const near = Math.abs(scrollDelta(list, xIn, 360, dt));
const far = Math.abs(scrollDelta(list, xIn, 210, dt));
assert.ok(far > near && near > 0, `far ${far} > near ${near}`);
assert.ok(Math.abs(scrollDelta(list, xIn, 230, dt) + scrollDelta(list, xIn, 570, dt)) < 1e-9);
assert.ok(far <= 950 && near >= 140);                           // dentro dos limites de velocidade

// proporcional ao tempo do quadro
assert.ok(Math.abs(scrollDelta(list, xIn, 570, 0.5) * 2 - scrollDelta(list, xIn, 570, 1)) < 1e-9);

// fora da faixa (à esquerda, acima, abaixo): nada
assert.equal(scrollDelta(list, 300, 570, dt), 0);
assert.equal(scrollDelta(list, xIn, 150, dt), 0);
assert.equal(scrollDelta(list, xIn, 650, dt), 0);
assert.equal(scrollDelta(list, 701, 570, dt), 0);
assert.equal(scrollDelta({ left: 0, right: 100, top: 5, bottom: 5 }, 90, 5, dt), 0);   // lista sem altura

console.log("autoscroll.js OK");
