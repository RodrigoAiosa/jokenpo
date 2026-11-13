import { Engine } from "./engine.js";
import { classify } from "./gestures.js";
import { Cpu, judge, EMOJI, LABEL, VERB, BEATS, LEVEL_DEFAULTS } from "./cpu.js";
import {
  LEVEL_ORDER, WIN_TARGET, defaultSave, starsFor, unlockedLevels, roundXp, matchXp,
  rankFor, ACHIEVEMENTS, newAchievements,
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
let save = loadSave();

function newEngine() { return new Engine({ fist_hold: 1e9 }); }   // sem pausa por punho aqui

// ---------------------------------------------------------------- progresso salvo
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (s && typeof s === "object") {
      const d = defaultSave();
      return { ...d, ...s, stars: { ...d.stars, ...s.stars }, best: { ...d.best, ...s.best }, ach: { ...s.ach } };
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
    case "retry": startGame(g.key); break;
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
    key: levelKey, lv, cpu: new Cpu({ strategy: lv.strategy, p: lv.p }),
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
  const cpu = g.cpuMove, r = judge(user, cpu), lvIdx = LEVEL_ORDER.indexOf(g.key);
  g.round++;
  if (r === "vitoria") { g.w++; g.streak++; bump(".score.you"); }
  else if (r === "derrota") { g.l++; g.streak = 0; bump(".score.cpu"); }
  else { g.d++; bump(".score.draw"); }
  if (g.w === 0 && g.l === 2) g.trailed = true;
  if (g.streak > (save.best[g.key] || 0)) save.best[g.key] = g.streak;
  g.best = save.best[g.key] || 0;
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

  g.state = "end";
  $("#end").hidden = false;
  engine = newEngine(); clearDwell(); pointerSince = performance.now();
  setLegend("game");
  syncCursor();
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

  const beat = g.lv.beat * SPEED;
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
    if (t - g.tShow > SHOW_MS) { if (g.w >= WIN_TARGET || g.l >= WIN_TARGET) endMatch(); else startRound(t); }
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

function loop() {
  const t = performance.now();
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

setLegend("menu");
loadLevels();
requestAnimationFrame(loop);
