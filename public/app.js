import { Engine } from "./engine.js";
import { classify } from "./gestures.js";
import { Cpu, judge, MOVES, EMOJI, LABEL, VERB, BEATS, LEVEL_DEFAULTS } from "./cpu.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const DWELL_MS = 1200;      // segurar o indicador sobre um cartão
const EXIT_MS = 1000;       // segurar a joia para sair
const SAMPLE_FROM = 120, SAMPLE_TO = 620;  // janela (ms após o "JÁ!") em que a jogada é lida
const SHOW_MS = 2600;

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
let dwellEl = null, dwellStart = 0, menuSince = 0;
let g = null;                              // estado do jogo

function newEngine() { return new Engine({ fist_hold: 1e9 }); }   // sem pausa por punho aqui

// ---------------------------------------------------------------- telas
function show(name) {
  mode = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
  cursorEl.hidden = !(name === "menu" && camOn);
  panel.hidden = !camOn || name === "start";
  setLegend(name);
}

function setLegend(name) {
  const rows = name === "game"
    ? [["✊ Punho", "Pedra"], ["✋ Mão aberta", "Papel"], ["✌️ Dois dedos", "Tesoura"], ["👍 Polegar p/ cima (1 s)", "Sair"]]
    : [["☝️ Indicador esticado", "Mover o cursor"], ["☝️ Segurar sobre o cartão", "Escolher nível"], ["🤏 Pinça", "Clicar"]];
  $("#legend").innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>→ ${b}</td></tr>`).join("");
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
function goMenu() {
  engine = newEngine();
  clearDwell();
  menuSince = performance.now();
  $("#menu-hint").textContent = camOn
    ? "Aponte o indicador para um cartão e segure por um instante. Ou use o mouse."
    : "Clique em um nível (ou use Tab + Enter).";
  show("menu");
}

function setProgress(el, p) { const s = el?.querySelector(".dwell span"); if (s) s.style.width = Math.min(100, p * 100) + "%"; }
function clearDwell() { dwellEl?.classList.remove("hot"); setProgress(dwellEl, 0); dwellEl = null; }

const px = (pos) => [pos[0] * innerWidth, pos[1] * innerHeight];

function menuStep(lm, t) {
  const { actions, info } = engine.update(lm, t / 1000);
  for (const [k, arg] of actions) {
    if (k === "move" || k === "drag" || k === "click" || k === "dclick") {
      const [x, y] = px(arg);
      cursorEl.style.left = x + "px"; cursorEl.style.top = y + "px";
      if (k === "click" || k === "dclick") {
        const el = document.elementFromPoint(x, y)?.closest(".level");
        if (el) { clearDwell(); startGame(el.dataset.level); return; }
      }
    }
  }
  $("#status").textContent = "MENU | " + info.mode;
  const [x, y] = px(engine.cursor);
  const el = t - menuSince > 700 && info.mode === "CURSOR" ? document.elementFromPoint(x, y)?.closest(".level") : null;
  if (el !== dwellEl) { clearDwell(); dwellEl = el; dwellStart = t; el?.classList.add("hot"); }
  if (dwellEl) {
    const p = (t - dwellStart) / DWELL_MS;
    setProgress(dwellEl, p);
    if (p >= 1) { const lv = dwellEl.dataset.level; clearDwell(); startGame(lv); }
  }
}

// ---------------------------------------------------------------- jogo
function bestKey(l) { return "jokenpo:best:" + l; }
function loadBest(l) { try { return +localStorage.getItem(bestKey(l)) || 0; } catch { return 0; } }
function saveBest(l, v) { try { localStorage.setItem(bestKey(l), String(v)); } catch { /* ignora */ } }

function startGame(levelKey) {
  const lv = LEVELS[levelKey];
  g = {
    key: levelKey, lv, cpu: new Cpu({ strategy: lv.strategy, p: lv.p }),
    w: 0, d: 0, l: 0, round: 0, streak: 0, best: loadBest(levelKey),
    state: "ready", t0: performance.now(), cpuMove: null, labels: [], joiaSince: null, joiaSeen: 0, hist: [],
  };
  $("#levelname").textContent = `${lv.icon} ${lv.name}`;
  $("#history").innerHTML = "";
  $("#result").textContent = " "; $("#result").className = "result";
  setHands("❔", "❔"); setWinner(null);
  renderScore();
  show("game");
}

function exitGame() { g = null; goMenu(); }

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
  if (who === "cpu") $("#youBox").className = "side lose"; if (who === "you") $("#cpuBox").className = "side lose";
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
  const cpu = g.cpuMove, r = judge(user, cpu);
  g.round++;
  if (r === "vitoria") { g.w++; g.streak++; if (g.streak > g.best) { g.best = g.streak; saveBest(g.key, g.best); } bump(".score.you"); }
  else if (r === "derrota") { g.l++; g.streak = 0; bump(".score.cpu"); }
  else { g.d++; bump(".score.draw"); }
  g.cpu.record(user, cpu);
  setHands(EMOJI[user], EMOJI[cpu]);
  setWinner(r === "vitoria" ? "you" : r === "derrota" ? "cpu" : null);
  const text = { vitoria: "Você venceu! 🎉", derrota: "O computador venceu 🤖", empate: "Empate 🤝" }[r];
  const w = r === "vitoria" ? user : cpu, lo = BEATS[w];
  $("#result").className = "result " + r;
  $("#result").innerHTML = text + (r === "empate" ? "" : `<small>${LABEL[w]} ${VERB[w]} ${LABEL[lo].toLowerCase()}</small>`);
  const dot = document.createElement("span");
  dot.className = r; dot.textContent = r === "vitoria" ? "V" : r === "derrota" ? "D" : "E";
  $("#history").prepend(dot);
  while ($("#history").children.length > 10) $("#history").lastChild.remove();
  renderScore();
}

function gameStep(t) {
  if (!g) return;
  const label = currentLabel(t);
  g.labels.push({ t, label });
  while (g.labels.length && t - g.labels[0].t > 2500) g.labels.shift();
  $("#detected").textContent = label ? `${EMOJI[label]} ${LABEL[label]}` : "—";
  $("#status").textContent = "JOGO | " + (label ? LABEL[label].toUpperCase() : "SEM GESTO");

  // joia (1 s) para sair — tolera falhas curtas de detecção
  if (label === "joia") {
    g.joiaSeen = t;
    if (g.joiaSince === null) g.joiaSince = t;
    const p = (t - g.joiaSince) / EXIT_MS;
    $("#exitbar").style.width = Math.min(100, p * 100) + "%";
    if (p >= 1) { $("#exitbar").style.width = "0"; exitGame(); return; }
  } else if (t - g.joiaSeen > 250) {
    g.joiaSince = null; $("#exitbar").style.width = "0";
  }

  const beat = g.lv.beat;
  if (g.state === "ready") {
    $("#count").textContent = "Prepare-se…";
    if (t - g.t0 > 1500) startRound(t);
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
    if (t - g.tShow > SHOW_MS) startRound(t);
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
    if (mode === "menu") menuStep(lm, t);
  }
  if (mode === "game") gameStep(t);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- entradas
$("#start").addEventListener("click", startCamera);
$("#nocam").addEventListener("click", () => { camOn = false; goMenu(); });
$("#exit").addEventListener("click", exitGame);
document.querySelectorAll(".level").forEach((el) => {
  el.addEventListener("click", () => startGame(el.dataset.level));
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") startGame(el.dataset.level); });
});
// Teclado (acessibilidade / sem câmera): 1 ou R = pedra, 2 ou P = papel, 3 ou T = tesoura, Esc = sair
const KEYS = { 1: "pedra", r: "pedra", 2: "papel", p: "papel", 3: "tesoura", t: "tesoura" };
addEventListener("keydown", (e) => {
  if (mode !== "game") return;
  if (e.key === "Escape") return exitGame();
  const lab = KEYS[e.key.toLowerCase()];
  if (lab) keyLabel = { label: lab, until: performance.now() + 800 };
});
addEventListener("pagehide", stopCamera);

setLegend("menu");
loadLevels();
requestAnimationFrame(loop);
