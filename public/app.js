import { Engine } from "./engine.js";
import { scrollDelta } from "./autoscroll.js";
import { classify } from "./gestures.js";
import { Cpu, judge, EMOJI, LABEL, VERB, BEATS, LEVEL_DEFAULTS } from "./cpu.js";
import {
  LEVEL_ORDER, WIN_TARGET, defaultSave, starsFor, unlockedLevels, roundXp, matchXp,
  rankFor, ACHIEVEMENTS, newAchievements, survivalParams, livesAfterWin, SURVIVAL_LIVES,
} from "./progress.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// ?speed=0.2 acelera todas as temporizações (usado nos testes automáticos)
const SPEED = +new URLSearchParams(location.search).get("speed") || 1;
const DWELL_MS = 1200 * SPEED;      // segurar o indicador sobre um cartão/botão
const EXIT_MS = 1000 * SPEED;       // segurar a joia para sair
const SAMPLE_FROM = 120 * SPEED, SAMPLE_TO = 620 * SPEED;   // janela (ms após o "JÁ!") em que a jogada é lida
const SHOW_MS = 2600 * SPEED;
const SAVE_KEY = "jokenpo:save:v1";

const $ = (s) => document.querySelector(s);
const video = $("#video"), overlay = $("#overlay"), octx = overlay.getContext("2d");
const cursorEl = $("#cursor"), panel = $("#panel"), msg = $("#msg");
const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

let LEVELS = structuredClone(LEVEL_DEFAULTS);
let mode = "start";                       // start | menu | game
let engine = newEngine();
let landmarker = null, stream = null, camOn = false, lastVT = -1;
let camLabel = null, camLabelT = 0, keyLabel = null;
let dwellEl = null, dwellStart = 0, pointerSince = 0;
let g = null;                              // estado da partida
let camPt = null, mousePt = null, lastFrame = 0, scrollAcc = 0;   // ponteiros para a rolagem por faixa
let save = loadSave();

function newEngine() { return new Engine({ fist_hold: 1e9 }); }   // sem pausa por punho aqui

// ---------------------------------------------------------------- progresso salvo
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (s && typeof s === "object") {
      const d = defaultSave();
      return { ...d, ...s, stars: { ...d.stars, ...s.stars }, best: { ...d.best, ...s.best }, ach: { ...s.ach },
        survival: { ...d.survival, ...s.survival } };
    }
  } catch { /* usa o padrão */ }
  return defaultSave();
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignora */ } }

// ---------------------------------------------------------------- telas
function needsPointer() { return mode === "menu" || (mode === "game" && g?.state === "end"); }
function syncCursor() { cursorEl.hidden = !(camOn && needsPointer()); }

function show(name) {
  mode = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
  panel.hidden = !camOn || name === "start";
  setLegend(name);
  syncCursor();
}

function setLegend(name) {
  const rows = name === "game" && g?.state !== "end"
    ? [["✊ Punho", "Pedra"], ["✋ Mão aberta", "Papel"], ["✌️ Dois dedos", "Tesoura"], ["👍 Polegar p/ cima (1 s)", "Sair"]]
    : [["☝️ Indicador esticado", "Mover o cursor"], ["☝️ Segurar sobre o botão", "Escolher"], ["🤏 Pinça", "Clicar"]];
  $("#legend").innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>→ ${b}</td></tr>`).join("");
}

let toastQ = [], toastBusy = false;
function toast(text) { toastQ.push(text); if (!toastBusy) nextToast(); }
function nextToast() {
  const text = toastQ.shift();
  if (!text) { toastBusy = false; return; }
  toastBusy = true;
  const el = $("#toast");
  el.textContent = text; el.classList.add("show");
  setTimeout(() => { el.classList.remove("show"); setTimeout(nextToast, 400 * SPEED); }, 2600 * SPEED);
}

// ---------------------------------------------------------------- câmera
async function loadLevels() {
  try {
    const r = await fetch("/api/levels");
    if (r.ok) {
      const data = await r.json();
      for (const k of Object.keys(LEVELS)) if (data[k]) LEVELS[k] = { ...LEVELS[k], ...data[k] };
    }
  } catch { /* usa os padrões embutidos */ }
}

function explain(e) {
  if (!navigator.mediaDevices?.getUserMedia) return "Este navegador/contexto não permite câmera (é necessário HTTPS).";
  switch (e?.name) {
    case "NotAllowedError": return "Permissão da câmera negada. Clique no ícone de câmera na barra de endereço, permita e tente de novo.";
    case "NotFoundError": return "Nenhuma câmera encontrada neste dispositivo.";
    case "NotReadableError": return "A câmera está em uso por outro aplicativo.";
    default: return "Não foi possível acessar a câmera: " + (e?.message || e);
  }
}

async function startCamera() {
  const btn = $("#start");
  btn.disabled = true;
  msg.textContent = "Solicitando permissão da câmera…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
  } catch (e) { msg.textContent = explain(e); btn.disabled = false; return; }
  video.srcObject = stream;
  await video.play();

  msg.textContent = "Carregando o modelo de mãos (MediaPipe)…";
  try {
    const { HandLandmarker, FilesetResolver } = await import(`${VISION}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numHands: 1,
      minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.6,
    });
    try { landmarker = await make("GPU"); } catch { landmarker = await make("CPU"); }
  } catch (e) {
    msg.textContent = "Falha ao carregar o MediaPipe: " + (e?.message || e);
    stream.getTracks().forEach((t) => t.stop());
    btn.disabled = false;
    return;
  }
  camOn = true;
  goMenu();
}

function stopCamera() {
  camOn = false;
  stream?.getTracks().forEach((t) => t.stop());
  landmarker?.close?.();
}

// ---------------------------------------------------------------- menu
const levelName = (k) => LEVELS[k]?.name ?? k;
const isOpen = (k) => unlockedLevels(save).includes(k);

function renderMenu() {
  const r = rankFor(save.xp);
  $("#rankname").textContent = `${r.icon} ${r.title}`;
  $("#xptext").textContent = r.next !== null ? `${save.xp} / ${r.next} XP` : `${save.xp} XP · título máximo`;
  $("#xpfill").style.width = r.pct * 100 + "%";
  const open = unlockedLevels(save);
  document.querySelectorAll(".level").forEach((el) => {
    const k = el.dataset.level, ok = open.includes(k), n = save.stars[k] || 0;
    el.classList.toggle("locked", !ok);
    el.classList.toggle("dwellable", ok);
    el.setAttribute("aria-disabled", String(!ok));
    el.querySelector(".stars").textContent = ok
      ? "⭐".repeat(n) + "☆".repeat(3 - n)
      : `🔒 Vença o ${levelName(LEVEL_ORDER[LEVEL_ORDER.indexOf(k) - 1])} para liberar`;
  });
  $("#achcount").textContent = `${Object.keys(save.ach).length}/${ACHIEVEMENTS.length}`;
  $("#unlockall").hidden = open.length === LEVEL_ORDER.length;
  $("#survbest").textContent = save.survival.best ? `recorde ${save.survival.best}` : "novo";
}

function goMenu() {
  engine = newEngine();
  clearDwell();
  pointerSince = performance.now();
  $("#menu-hint").textContent = camOn
    ? "Aponte o indicador para um cartão e segure por um instante. Ou use o mouse."
    : "Clique em um nível (ou use Tab + Enter).";
  renderMenu();
  show("menu");
}

function setProgress(el, p) { const s = el?.querySelector(".dwell span"); if (s) s.style.width = Math.min(100, p * 100) + "%"; }
function clearDwell() { dwellEl?.classList.remove("hot"); setProgress(dwellEl, 0); dwellEl = null; }
const px = (pos) => [pos[0] * innerWidth, pos[1] * innerHeight];

/** Cursor por gesto + "apontar e segurar" (menu, fim de partida e conquistas). */
function pointerStep(lm, t) {
  const { actions, info } = engine.update(lm, t / 1000);
  for (const [k, arg] of actions) {
    if (k === "move" || k === "drag" || k === "click" || k === "dclick") {
      const [x, y] = px(arg);
      cursorEl.style.left = x + "px"; cursorEl.style.top = y + "px";
      if (k === "click" || k === "dclick") {
        const el = document.elementFromPoint(x, y)?.closest("[data-level],[data-act]");
        if (el) { clearDwell(); act(el); return; }
      }
    }
  }
  $("#status").textContent = (mode === "menu" ? "MENU" : "FIM") + " | " + info.mode;
  const [x, y] = px(engine.cursor);
  camPt = info.mode === "CURSOR" || info.mode === "PINCA" ? { x, y } : null;
  const el = t - pointerSince > 700 && info.mode === "CURSOR" ? document.elementFromPoint(x, y)?.closest(".dwellable") : null;
  if (el !== dwellEl) { clearDwell(); dwellEl = el; dwellStart = t; el?.classList.add("hot"); }
  if (dwellEl) {
    const p = (t - dwellStart) / DWELL_MS;
    setProgress(dwellEl, p);
    if (p >= 1) { const chosen = dwellEl; clearDwell(); act(chosen); }
  }
}

function act(el) {
  const { level, act: a } = el.dataset;
  if (level) {
    if (isOpen(level)) startGame(level);
    else toast(`🔒 Vença o ${levelName(LEVEL_ORDER[LEVEL_ORDER.indexOf(level) - 1])} para liberar o ${levelName(level)}`);
    return;
  }
  switch (a) {
    case "retry": g.mode === "survival" ? startSurvival() : startGame(g.key); break;
    case "survival": startSurvival(); break;
    case "share": shareResult(); break;
    case "next": startGame(LEVEL_ORDER[LEVEL_ORDER.indexOf(g.key) + 1]); break;
    case "menu": exitGame(); break;
    case "ach": openAch(); break;
    case "close": closeAch(); break;
    case "unlockall": save.all = true; persist(); renderMenu(); toast("🔓 Todos os níveis destravados"); break;
  }
}

// ---------------------------------------------------------------- conquistas
function openAch() {
  $("#achlist").innerHTML = ACHIEVEMENTS.map((a) => {
    const on = !!save.ach[a.id];
    return `<li class="${on ? "" : "off"}"><span class="ai">${on ? a.icon : "🔒"}</span><span><b>${a.name}</b><small>${a.desc}</small></span></li>`;
  }).join("");
  engine = newEngine(); clearDwell(); pointerSince = performance.now();
  $("#ach").hidden = false;
  $("#achlist").scrollTop = 0; scrollAcc = 0;   // só funciona depois de exibido
}
function closeAch() { $("#ach").hidden = true; clearDwell(); pointerSince = performance.now(); }

function grant(ids) {
  for (const id of ids) {
    save.ach[id] = Date.now();
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    toast(`${a.icon} Conquista: ${a.name}`);
  }
  return ids;
}

// ---------------------------------------------------------------- partida
function startGame(levelKey) {
  const lv = LEVELS[levelKey];
  g = {
    mode: "match", key: levelKey, lv, beat: lv.beat, cpu: new Cpu({ strategy: lv.strategy, p: lv.p }),
    w: 0, d: 0, l: 0, round: 0, streak: 0, best: save.best[levelKey] || 0, trailed: false,
    state: "ready", t0: performance.now(), cpuMove: null, labels: [], joiaSince: null, joiaSeen: 0,
  };
  $("#end").hidden = true; $("#ach").hidden = true;
  $("#levelname").textContent = `${lv.icon} ${lv.name}`;
  $("#history").innerHTML = "";
  $("#result").textContent = " "; $("#result").className = "result";
  setHands("❔", "❔"); setWinner(null);
  clearDwell();
  renderScore();
  show("game");
}

function exitGame() { g = null; $("#end").hidden = true; goMenu(); }

function renderScore() {
  const sv = g.mode === "survival";
  $("#board").hidden = sv; $("#meta").hidden = sv; $("#survboard").hidden = !sv; $("#survmeta").hidden = !sv;
  if (sv) {
    $("#vw").textContent = g.w; $("#vb").textContent = g.best;
    $("#vl").textContent = g.lives > 0 ? "❤️".repeat(g.lives) : "💀";
    $("#vbeat").textContent = (g.beat / 1000).toFixed(2).replace(".", ",") + " s";
    $("#vai").textContent = levelName(LEVEL_ORDER[g.stageIdx || 0]);
    return;
  }
  $("#sw").textContent = g.w; $("#sd").textContent = g.d; $("#sl").textContent = g.l;
  $("#round").textContent = g.round; $("#streak").textContent = g.streak; $("#best").textContent = g.best;
}
function bump(sel) { const el = $(sel); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
function setHands(you, cpu, shaking = false) {
  $("#youHand").textContent = you; $("#cpuHand").textContent = cpu;
  $("#youHand").classList.toggle("shake", shaking); $("#cpuHand").classList.toggle("shake", shaking);
}
function setWinner(who) {
  $("#youBox").className = "side" + (who === "you" ? " win" : who === "cpu" ? " lose" : "");
  $("#cpuBox").className = "side" + (who === "cpu" ? " win" : who === "you" ? " lose" : "");
}

function currentLabel(t) {
  if (keyLabel && t < keyLabel.until) return keyLabel.label;
  return camOn && t - camLabelT < 300 ? camLabel : null;
}

function startRound(t) {
  if (g.mode === "survival") {            // a dificuldade sobe com as vitórias
    const sp = survivalParams(g.w);
    g.cpu.strategy = sp.strategy; g.cpu.p = sp.p; g.beat = sp.beat; g.stageIdx = sp.stage;
    renderScore();
  }
  g.cpuMove = g.cpu.pick();            // decidido ANTES da contagem, só com o histórico
  g.state = "count"; g.t0 = t;
  setWinner(null);
  $("#result").textContent = " "; $("#result").className = "result";
}

function majority(from, to) {
  const votes = { pedra: 0, papel: 0, tesoura: 0 };
  for (const { t, label } of g.labels) if (t >= from && t <= to && label in votes) votes[label]++;
  const [best, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return n >= 3 ? best : null;
}

function finishRound(user) {
  const cpu = g.cpuMove, r = judge(user, cpu);
  const lvIdx = g.mode === "survival" ? g.stageIdx : LEVEL_ORDER.indexOf(g.key);
  g.round++;
  if (r === "vitoria") { g.w++; g.streak++; bump(".score.you"); }
  else if (r === "derrota") { g.l++; g.streak = 0; bump(".score.cpu"); }
  else { g.d++; bump(".score.draw"); }
  if (g.w === 0 && g.l === 2) g.trailed = true;
  if (g.streak > (save.best[g.key] || 0)) save.best[g.key] = g.streak;
  g.best = save.best[g.key] || 0;
  if (g.mode === "survival") {
    if (r === "derrota") g.lives--;
    else if (r === "vitoria") {
      const nl = livesAfterWin(g.lives, g.w);
      if (nl > g.lives) toast("❤️ +1 vida!");
      g.lives = nl;
    }
    if (g.w > save.survival.best) save.survival.best = g.w;
    g.best = save.survival.best;
  }
  const xp = roundXp(r, g.streak, lvIdx);
  save.xp += xp;
  g.cpu.record(user, cpu);
  grant(newAchievements(save, { type: "round", result: r, streak: g.streak, level: g.key }));
  persist();

  setHands(EMOJI[user], EMOJI[cpu]);
  setWinner(r === "vitoria" ? "you" : r === "derrota" ? "cpu" : null);
  const text = { vitoria: "Você venceu! 🎉", derrota: "O computador venceu 🤖", empate: "Empate 🤝" }[r];
  const w = r === "vitoria" ? user : cpu, lo = BEATS[w];
  $("#result").className = "result " + r;
  $("#result").innerHTML = text + `<small>${r === "empate" ? "" : `${LABEL[w]} ${VERB[w]} ${LABEL[lo].toLowerCase()} · `}+${xp} XP</small>`;
  const dot = document.createElement("span");
  dot.className = r; dot.textContent = r === "vitoria" ? "V" : r === "derrota" ? "D" : "E";
  $("#history").prepend(dot);
  while ($("#history").children.length > 10) $("#history").lastChild.remove();
  renderScore();
}

function endMatch() {
  const won = g.w >= WIN_TARGET, lvIdx = LEVEL_ORDER.indexOf(g.key);
  const stars = won ? starsFor(g.w, g.l) : 0;
  const before = { open: unlockedLevels(save), rank: rankFor(save.xp).index };
  save.matches++;
  const newBest = stars > (save.stars[g.key] || 0);
  if (newBest) save.stars[g.key] = stars;
  const gain = matchXp(won, stars, lvIdx);
  save.xp += gain;
  const ach = grant(newAchievements(save, {
    type: "match", won, myW: g.w, oppW: g.l, level: g.key, comeback: won && g.trailed,
  }));
  persist();
  const after = { open: unlockedLevels(save), rank: rankFor(save.xp) };

  $("#endtitle").textContent = won ? "🏆 Você venceu a partida!" : "😤 O computador venceu a partida";
  $("#endscore").textContent = `${g.w} × ${g.l}`;
  $("#endstars").textContent = won
    ? "⭐".repeat(stars) + "☆".repeat(3 - stars)
    : "Sem estrelas desta vez";
  $("#endxp").textContent = `+${gain} XP` + (won && newBest ? " · novo recorde de estrelas!" : "");
  const lines = [];
  if (after.rank.index > before.rank) lines.push(`🎖️ Novo título: <b>${after.rank.title}</b>!`);
  for (const k of after.open) if (!before.open.includes(k)) lines.push(`🔓 Nível <b>${levelName(k)}</b> desbloqueado!`);
  for (const id of ach) { const a = ACHIEVEMENTS.find((x) => x.id === id); lines.push(`${a.icon} Conquista: <b>${a.name}</b>`); }
  $("#endnew").innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  const next = LEVEL_ORDER[lvIdx + 1];
  $("#nextbtn").hidden = !(won && next && after.open.includes(next));

  g.share = {
    tone: won ? "win" : "lose",
    title: won ? `Venci o ${levelName(g.key)}!` : `O ${levelName(g.key)} me venceu`,
    big: `${g.w} × ${g.l}`,
    line: won ? "⭐".repeat(stars) + "☆".repeat(3 - stars) : "Vou tentar de novo 💪",
  };
  $("#endnew").dataset.kind = "match";
  openEnd();
}

function openEnd() {
  g.state = "end";
  $("#end").hidden = false;
  engine = newEngine(); clearDwell(); pointerSince = performance.now();
  setLegend("game");
  syncCursor();
}

// ---------------------------------------------------------------- modo Sobrevivência
function startSurvival() {
  const lv = { name: "Sobrevivência", icon: "♾️", beat: 900 };
  g = {
    mode: "survival", key: "survival", lv, beat: 900, stageIdx: 0,
    cpu: new Cpu({ strategy: "random", p: 0 }),
    w: 0, d: 0, l: 0, lives: SURVIVAL_LIVES, round: 0, streak: 0,
    best: save.survival.best, startBest: save.survival.best, trailed: false,
    state: "ready", t0: performance.now(), cpuMove: null, labels: [], joiaSince: null, joiaSeen: 0,
  };
  $("#end").hidden = true; $("#ach").hidden = true;
  $("#levelname").textContent = `${lv.icon} ${lv.name}`;
  $("#history").innerHTML = "";
  $("#result").textContent = "\u00a0"; $("#result").className = "result";
  setHands("❔", "❔"); setWinner(null);
  clearDwell();
  renderScore();
  show("game");
}

function endSurvival() {
  const wins = g.w, record = wins > g.startBest;
  save.survival.runs++;
  const gain = 5 * wins;
  save.xp += gain;
  const before = rankFor(save.xp - gain).index;
  const ach = grant(newAchievements(save, { type: "survival", wins }));
  persist();
  const after = rankFor(save.xp);

  $("#endtitle").textContent = "💀 Fim da sobrevivência";
  $("#endscore").textContent = `${wins} ${wins === 1 ? "vitória" : "vitórias"}`;
  $("#endstars").textContent = record ? "🏅 Novo recorde!" : `Recorde: ${save.survival.best}`;
  $("#endxp").textContent = `+${gain} XP`;
  const lines = [];
  if (after.index > before) lines.push(`🎖️ Novo título: <b>${after.title}</b>!`);
  for (const id of ach) { const a = ACHIEVEMENTS.find((x) => x.id === id); lines.push(`${a.icon} Conquista: <b>${a.name}</b>`); }
  $("#endnew").innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  $("#nextbtn").hidden = true;
  g.share = {
    tone: "blue", title: "Modo Sobrevivência",
    big: `${wins} ${wins === 1 ? "vitória" : "vitórias"}`,
    line: record ? "🏅 Novo recorde!" : `Recorde: ${save.survival.best}`,
  };
  openEnd();
}

// ---------------------------------------------------------------- compartilhar o placar
function roundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
}

/** Desenha a imagem do placar (1200×630) num canvas. */
function drawShare(d) {
  const W = 1200, H = 630, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const font = (w, sz) => `${w} ${sz}px system-ui, "Segoe UI", "Noto Sans", sans-serif`;
  const fit = (text, w, sz, maxW) => { while (sz > 22) { x.font = font(w, sz); if (x.measureText(text).width <= maxW) break; sz -= 2; } x.font = font(w, sz); };
  const bg = x.createRadialGradient(930, 250, 40, 930, 250, 820);
  bg.addColorStop(0, "#24387a"); bg.addColorStop(1, "#0e1322");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.textBaseline = "alphabetic";

  roundRect(x, 60, 52, 480, 46, 23);
  x.fillStyle = "#5b8cff22"; x.fill(); x.strokeStyle = "#5b8cff"; x.lineWidth = 2; x.stroke();
  x.fillStyle = "#9fbcff"; x.font = font(600, 20); x.fillText("JOKENPO · JOGADO COM A MÃO", 84, 83);

  x.fillStyle = "#ffffff"; fit(d.title, 800, 66, 680); x.fillText(d.title, 60, 190);
  x.fillStyle = d.tone === "win" ? "#3ddc84" : d.tone === "lose" ? "#ff6b5e" : "#7fa6ff";
  fit(d.big, 800, 150, 680); x.fillText(d.big, 60, 340);
  x.fillStyle = "#ffb02e"; fit(d.line, 700, 58, 680); x.fillText(d.line, 60, 430);
  const r = rankFor(save.xp);
  x.fillStyle = "#b8c4dc"; fit(`${r.icon} ${r.title} · ${save.xp} XP`, 500, 32, 680); x.fillText(`${r.icon} ${r.title} · ${save.xp} XP`, 60, 500);

  x.fillStyle = "#7e8db0"; x.font = font(500, 28);
  const ask = "Consegue me vencer?  ";
  x.fillText(ask, 60, 580);
  const askW = x.measureText(ask).width;
  x.fillStyle = "#ffffff"; x.font = font(700, 28); x.fillText(location.host, 60 + askW, 580);

  [["✊", 770, 150, -8, 190], ["✌️", 960, 175, 8, 190], ["✋", 850, 105, 0, 215]].forEach(([e, px, py, rot, sz], i) => {
    x.save(); x.translate(px + sz / 2, py + sz * 0.6); x.rotate((rot * Math.PI) / 180);
    roundRect(x, -sz / 2, -sz * 0.6, sz, sz * 1.2, 30);
    x.fillStyle = "#172036"; x.fill(); x.strokeStyle = i === 2 ? "#5b8cff" : "#2b3a5c"; x.lineWidth = 3; x.stroke();
    x.font = `${Math.round(sz * 0.55)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#fff"; x.fillText(e, 0, 4);
    x.restore();
  });
  return c;
}

function downloadBlob(blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "jokenpo-placar.png";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function shareResult() {
  const d = g?.share;
  if (!d) return;
  const blob = await new Promise((res) => drawShare(d).toBlob(res, "image/png"));
  const file = new File([blob], "jokenpo-placar.png", { type: "image/png" });
  const text = `Joguei Jokenpo só com a mão! ${d.title} ${d.big}. Consegue me vencer? ${location.origin}`;
  // A janela de compartilhar exige um toque/clique real; por gesto da mão, cai para o download.
  if (navigator.userActivation?.isActive && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text, url: location.origin }); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  downloadBlob(blob);
  toast("📥 Imagem salva. É só postar!");
}

function gameStep(t) {
  if (!g) return;
  const label = currentLabel(t);
  g.labels.push({ t, label });
  while (g.labels.length && t - g.labels[0].t > 2500) g.labels.shift();
  $("#detected").textContent = label ? `${EMOJI[label]} ${LABEL[label]}` : "—";
  if (g.state !== "end") $("#status").textContent = "JOGO | " + (label ? LABEL[label].toUpperCase() : "SEM GESTO");

  // joia (1 s) para sair — tolera falhas curtas de detecção
  if (label === "joia") {
    g.joiaSeen = t;
    if (g.joiaSince === null) g.joiaSince = t;
    const p = (t - g.joiaSince) / EXIT_MS;
    $("#exitbar").style.width = Math.min(100, p * 100) + "%";
    if (p >= 1) { $("#exitbar").style.width = "0"; exitGame(); return; }
  } else if (t - g.joiaSeen > 250 * SPEED) {
    g.joiaSince = null; $("#exitbar").style.width = "0";
  }

  const beat = g.beat * SPEED;
  if (g.state === "ready") {
    $("#count").textContent = "Prepare-se…";
    if (t - g.t0 > 1500 * SPEED) startRound(t);
  } else if (g.state === "count") {
    const el = t - g.t0, idx = Math.min(3, Math.floor(el / beat));
    $("#count").textContent = ["PEDRA", "PAPEL", "TESOURA", "JÁ!"][idx];
    if (idx < 3) setHands("✊", "✊", true);                 // "balançando" a mão na contagem
    else setHands(label in EMOJI && label !== "joia" ? EMOJI[label] : "❔", "❔");
    if (el >= 3 * beat + SAMPLE_TO) {
      const user = majority(g.t0 + 3 * beat + SAMPLE_FROM, g.t0 + 3 * beat + SAMPLE_TO);
      if (user) { finishRound(user); $("#count").textContent = "Resultado"; }
      else {
        setHands("❔", "❔");
        $("#count").textContent = "Não vi sua jogada";
        $("#result").className = "result"; $("#result").textContent = "Mostre pedra, papel ou tesoura quando aparecer JÁ!";
      }
      g.state = "show"; g.tShow = t;
    }
  } else if (g.state === "show") {
    if (t - g.tShow > SHOW_MS) {
      const over = g.mode === "survival" ? g.lives <= 0 : g.w >= WIN_TARGET || g.l >= WIN_TARGET;
      if (!over) startRound(t); else if (g.mode === "survival") endSurvival(); else endMatch();
    }
  }
}

// ---------------------------------------------------------------- laço principal
function drawHand(lm) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!lm) return;
  octx.strokeStyle = "#3ddc84"; octx.lineWidth = 2;
  for (const [i, j] of HAND_CONNECTIONS) {
    octx.beginPath();
    octx.moveTo(lm[i][0] * overlay.width, lm[i][1] * overlay.height);
    octx.lineTo(lm[j][0] * overlay.width, lm[j][1] * overlay.height);
    octx.stroke();
  }
  octx.fillStyle = "#ffa500";
  for (const [x, y] of lm) { octx.beginPath(); octx.arc(x * overlay.width, y * overlay.height, 3, 0, 7); octx.fill(); }
}

/** Rola a lista de conquistas quando o ponteiro (mão ou mouse) está na faixa da barra de rolagem. */
function autoScroll(t) {
  const dt = Math.min(0.1, (t - lastFrame) / 1000);
  lastFrame = t;
  if ($("#ach").hidden) { scrollAcc = 0; return; }
  const list = $("#achlist"), rail = $("#ach .rail");
  const p = camPt ?? mousePt;
  const d = p ? scrollDelta(list.getBoundingClientRect(), p.x, p.y, dt) : 0;
  rail.classList.toggle("up", d < 0);
  rail.classList.toggle("down", d > 0);
  scrollAcc += d;
  const whole = Math.trunc(scrollAcc);       // scrollTop só aceita pixels inteiros em alguns navegadores
  if (whole) { list.scrollTop += whole; scrollAcc -= whole; }
}

function loop() {
  const t = performance.now();
  autoScroll(t);
  if (camOn && video.readyState >= 2 && video.currentTime !== lastVT) {
    lastVT = video.currentTime;
    const res = landmarker.detectForVideo(video, t);
    const lm = res.landmarks?.[0]?.map((p) => [p.x, p.y]) ?? null;
    camLabel = lm ? classify(lm) : null; camLabelT = t;
    drawHand(lm);
    if (needsPointer()) pointerStep(lm, t);
  }
  if (mode === "game") gameStep(t);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- entradas
$("#start").addEventListener("click", startCamera);
$("#nocam").addEventListener("click", () => { camOn = false; goMenu(); });
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-level],[data-act]");
  if (el) act(el);
});
document.querySelectorAll(".level").forEach((el) =>
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } }));

// Teclado (acessibilidade / sem câmera): 1 ou R = pedra, 2 ou P = papel, 3 ou T = tesoura, Esc = sair
const KEYS = { 1: "pedra", r: "pedra", 2: "papel", p: "papel", 3: "tesoura", t: "tesoura" };
addEventListener("keydown", (e) => {
  if (!$("#ach").hidden) { if (e.key === "Escape") closeAch(); return; }
  if (mode !== "game") return;
  if (e.key === "Escape") return exitGame();
  if (g?.state === "end") { if (e.key === "Enter") act($('[data-act="retry"]')); return; }
  const lab = KEYS[e.key.toLowerCase()];
  if (lab) keyLabel = { label: lab, until: performance.now() + 800 * SPEED };
});
addEventListener("pagehide", stopCamera);
// Mouse: só rola ao "pairar" na faixa; se estiver arrastando a barra nativa (botão apertado), não interfere.
addEventListener("mousemove", (e) => { mousePt = e.buttons ? null : { x: e.clientX, y: e.clientY }; });
addEventListener("mousedown", () => { mousePt = null; });
addEventListener("mouseup", (e) => { mousePt = { x: e.clientX, y: e.clientY }; });
document.documentElement.addEventListener("mouseleave", () => { mousePt = null; });

setLegend("menu");
loadLevels();
requestAnimationFrame(loop);
