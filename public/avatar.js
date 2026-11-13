// Avatares em pixel art para o painel da câmera. Sprites 16x16 definidos em texto.
// Letras: K contorno, E olhos, M boca, demais = cores da paleta de cada personagem.
export const AVATARS = {
  robo: {
    name: "ROBÔ", base: "#24e5ff", eye: "#ffe45e",
    pal: { K: "#1a0845", B: "#24e5ff", D: "#0e6f88", Y: "#ffe45e", M: "#1a0845" },
    rows: [
      "................", "......KYYK......", ".......KK.......", "..KKKKKKKKKKKK..",
      ".KBBBBBBBBBBBBK.", ".KBBBBBBBBBBBBK.", ".KBEEEBBBBEEEBK.", ".KBEEEBBBBEEEBK.",
      ".KBBBBBBBBBBBBK.", ".KBBMMMMMMMMBBK.", ".KBBBBBBBBBBBBK.", "..KKKKKKKKKKKK..",
      "...KDDDDDDDDK...", ".KKDDDDDDDDDDKK.", "KDDDDDDDDDDDDDDK", "KDDDDDDDDDDDDDDK",
    ],
  },
  ninja: {
    name: "NINJA", base: "#f3c9a0", eye: "#1a0845",
    pal: { K: "#0a0624", P: "#5a1bb8", R: "#ff3df2", S: "#f3c9a0", M: "#0a0624" },
    rows: [
      "................", "................", "...KKKKKKKKKK...", "..KPPPPPPPPPPK..",
      "..KPPPPPPPPPPK..", "..KRRRRRRRRRRK..", "..KSSSSSSSSSSK..", "..KSEESSSSEESK..",
      "..KSSSSSSSSSSK..", "..KPPPPPPPPPPK..", "...KPPPPPPPPK...", "....KKKKKKKK....",
      "...KPPPPPPPPK...", ".KKPPPPPPPPPPKK.", "KPPPPPPPPPPPPPPK", "KPPPPPPPPPPPPPPK",
    ],
  },
  alien: {
    name: "ALIEN", base: "#5dff9a", eye: "#0a0624",
    pal: { K: "#0a2a1a", G: "#5dff9a", g: "#2fa86a", M: "#0a2a1a" },
    rows: [
      "................", "...KKKKKKKKKK...", "..KGGGGGGGGGGK..", ".KGGGGGGGGGGGGK.",
      ".KGGGGGGGGGGGGK.", ".KGEEEGGGGEEEGK.", ".KGEEEGGGGEEEGK.", ".KGGGGGGGGGGGGK.",
      ".KGGGGMMMMGGGGK.", "..KGGGGGGGGGGK..", "...KKGGGGGGKK...", "....KKKKKKKK....",
      "...KggggggggK...", "..KKggggggggKK..", ".KggggggggggggK.", "KggggggggggggggK",
    ],
  },
  gato: {
    name: "GATO", base: "#ff9a4d", eye: "#1a0845",
    pal: { K: "#3a1200", O: "#ff9a4d", R: "#ff3df2", M: "#3a1200" },
    rows: [
      "................", "..K..........K..", ".KOK........KOK.", ".KOOKKKKKKKKOOK.",
      ".KOOOOOOOOOOOOK.", ".KOOOOOOOOOOOOK.", ".KOOEEOOOOEEOOK.", ".KOOEEOOOOEEOOK.",
      ".KOOOOOKKOOOOOK.", ".KOOOOOMMOOOOOK.", "..KOOOOOOOOOOK..", "...KKKKKKKKKK...",
      "...KRRRRRRRRK...", ".KKRRRRRRRRRRKK.", "KOOOOOOOOOOOOOOK", "KOOOOOOOOOOOOOOK",
    ],
  },
};
export const AVATAR_IDS = Object.keys(AVATARS);

const HANDS = {
  pedra: ["..KKKKKK..", ".KSSSSSSK.", "KSSSSSSSSK", "KSKSKSKSSK", "KSSSSSSSSK", "KSSSSSSSSK", ".KSSSSSSK.", "..KSSSSK..", "...KKKK..."],
  papel: ["..K.K.K...", ".KSKSKSK..", ".KSKSKSKK.", ".KSSSSSSSK", ".KSSSSSSSK", ".KSSSSSSSK", "..KSSSSSK.", "...KSSSK..", "...KKKKK.."],
  tesoura: ["KK....KK..", "KSK..KSK..", "KSK..KSK..", ".KSKKSK...", ".KSSSSSK..", ".KSSSSSK..", "..KSSSSK..", "...KKKK..."],
};
const HAND_PAL = { K: "#1a0845", S: "#ffd9b0" };

function sprite(ctx, rows, pal, x, y, s, over = {}) {
  rows.forEach((row, j) => [...row].forEach((c, i) => {
    if (c === ".") return;
    const col = over[c] ?? pal[c];
    if (!col) return;
    ctx.fillStyle = col; ctx.fillRect(x + i * s, y + j * s, s, s);
  }));
}

/** Desenha a cena (128x96 lógicos) com o avatar; mostra a mão do gesto detectado. */
export function drawAvatar(ctx, id, label, t) {
  const a = AVATARS[id]; if (!a) return;
  const W = 128, H = 96;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0a0624"); g.addColorStop(.55, "#5a1b9a"); g.addColorStop(.8, "#ff4f9a"); g.addColorStop(1, "#14042e");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  for (const [x, y] of [[10, 8], [40, 16], [96, 10], [118, 30], [70, 6], [20, 36]]) if (((t / 500 + x) | 0) % 3) ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = "#14042e"; ctx.fillRect(0, 78, W, 18);
  ctx.fillStyle = "#24e5ff"; ctx.fillRect(0, 78, W, 1);
  ctx.fillStyle = "#ff3df2"; for (let x = -((t / 60) | 0) % 16; x < W; x += 16) ctx.fillRect(x, 79, 1, 17);
  const bob = ((t / 350) | 0) % 2 ? 1 : 0;
  const blink = (t % 3200) < 140;
  const over = { E: blink ? a.base : a.eye };
  sprite(ctx, a.rows, a.pal, 16, 6 + bob * 2, 5, over);
  const hand = HANDS[label];
  if (hand) {
    const hy = 54 + ((t / 120) % 2 < 1 ? 0 : 2);
    sprite(ctx, hand, HAND_PAL, 86, hy, 4);
  }
}

/** Miniatura de seleção. */
export function drawThumb(ctx, id) {
  const a = AVATARS[id];
  ctx.clearRect(0, 0, 16, 16);
  sprite(ctx, a.rows, a.pal, 0, 0, 1, { E: a.eye });
}
