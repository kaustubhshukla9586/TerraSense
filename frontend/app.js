/* global Chart */

const API = "http://localhost:8000";

const WAVE_COUNT = 228;
const WAVE_START = 900;
const WAVE_END = 1700;

let trendChart = null;
let spectralChart = null;

let lastHistory = [];
let scansCompleted = 0;
let lastScanId = null;
let isOnline = false;

const el = {
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),

  scanBtn: document.getElementById("scanBtn"),
  rings: document.getElementById("rings"),
  scanError: document.getElementById("scanError"),

  progressWrap: document.getElementById("progressWrap"),
  progressFill: document.getElementById("progressFill"),
  progressLabel: document.getElementById("progressLabel"),
  stage0: document.getElementById("stage0"),
  stage1: document.getElementById("stage1"),
  stage2: document.getElementById("stage2"),
  stage3: document.getElementById("stage3"),

  scanCountText: document.getElementById("scanCountText"),

  meta: document.getElementById("scanMeta"),
  metaConfidence: document.getElementById("metaConfidence"),
  metaModel: document.getElementById("metaModel"),
  metaLatency: document.getElementById("metaLatency"),

  summaryEmpty: document.getElementById("summaryEmpty"),
  summaryBody: document.getElementById("summaryBody"),
  sumScanId: document.getElementById("sumScanId"),
  sumTimestamp: document.getElementById("sumTimestamp"),
  sumConfidenceText: document.getElementById("sumConfidenceText"),
  sumConfidenceFill: document.getElementById("sumConfidenceFill"),

  cardN: document.getElementById("cardN"),
  cardP: document.getElementById("cardP"),
  cardK: document.getElementById("cardK"),
  cardOC: document.getElementById("cardOC"),

  valueN: document.getElementById("valueN"),
  valueP: document.getElementById("valueP"),
  valueK: document.getElementById("valueK"),
  valueOC: document.getElementById("valueOC"),

  badgeN: document.getElementById("badgeN"),
  badgeP: document.getElementById("badgeP"),
  badgeK: document.getElementById("badgeK"),
  badgeOC: document.getElementById("badgeOC"),

  trendN: document.getElementById("trendN"),
  trendP: document.getElementById("trendP"),
  trendK: document.getElementById("trendK"),
  trendOC: document.getElementById("trendOC"),

  trendOverlay: document.getElementById("trendOverlay"),
  spectralOverlay: document.getElementById("spectralOverlay"),
  trendCanvas: document.getElementById("trendChart"),
  spectralCanvas: document.getElementById("spectralChart"),

  tableEmpty: document.getElementById("tableEmpty"),
  tableScroll: document.getElementById("tableScroll"),
  historyBody: document.getElementById("historyBody"),
};

const nutrientDefs = {
  N: { label: "Nitrogen", green: 2, amber: 1, valueEl: el.valueN, badgeEl: el.badgeN, trendEl: el.trendN, cardEl: el.cardN },
  P: { label: "Phosphorus", green: 200, amber: 50, valueEl: el.valueP, badgeEl: el.badgeP, trendEl: el.trendP, cardEl: el.cardP },
  K: { label: "Potassium", green: 400, amber: 100, valueEl: el.valueK, badgeEl: el.badgeK, trendEl: el.trendK, cardEl: el.cardK },
  OC: { label: "Organic Carbon", green: 3, amber: 1, valueEl: el.valueOC, badgeEl: el.badgeOC, trendEl: el.trendOC, cardEl: el.cardOC },
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showScanError(message) {
  if (!message) {
    el.scanError.style.display = "none";
    el.scanError.textContent = "";
    return;
  }
  el.scanError.style.display = "block";
  el.scanError.textContent = message;
}

function setSystemStatus(online) {
  isOnline = !!online;
  el.statusDot.classList.remove("status__dot--online", "status__dot--offline");
  el.statusDot.classList.add(online ? "status__dot--online" : "status__dot--offline");
  el.statusText.textContent = online ? "System Online" : "System Offline";
}

function setScanningState(scanning) {
  el.rings.classList.toggle("rings--scanning", scanning);
  el.scanBtn.disabled = scanning;
}

function setStageActive(stageIdx) {
  const stages = [el.stage0, el.stage1, el.stage2, el.stage3];
  stages.forEach((node, i) => {
    node.classList.remove("progress__stage--active", "progress__stage--done");
    if (i < stageIdx) node.classList.add("progress__stage--done");
    if (i === stageIdx) node.classList.add("progress__stage--active");
  });
}

function resetProgress() {
  el.progressFill.style.width = "0%";
  el.progressLabel.textContent = "—";
  setStageActive(-1);
}

function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  const digits = Math.abs(num) >= 100 ? 1 : 2;
  return num.toFixed(digits);
}

function getValueFromScan(scan, nutrient) {
  if (!scan) return NaN;
  const keysByNutrient = {
    N: ["N", "n"],
    P: ["P", "p"],
    K: ["K", "k"],
    OC: ["OC", "oc", "organic_carbon", "organicCarbon"],
  };
  const keys = keysByNutrient[nutrient] || [nutrient];
  for (const k of keys) {
    if (scan[k] !== undefined && scan[k] !== null) {
      const v = Number(scan[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return NaN;
}

/**
 * Calls GET /health and updates the navbar indicator.
 * Runs on load and every 30 seconds.
 */
async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(`Health status ${res.status}`);
    const data = await res.json();
    setSystemStatus(!!(data && data.status === "ok"));
  } catch (err) {
    setSystemStatus(false);
  }
}

/**
 * Formats an ISO timestamp to "27 Mar 2026, 14:32:05".
 * @param {string} isoString
 * @returns {string}
 */
function formatTimestamp(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "short" });
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}:${ss}`;
}

/**
 * Returns a badge label + CSS class for a nutrient value.
 * @param {"N"|"P"|"K"|"OC"} nutrient
 * @param {number} value
 * @returns {{label: string, color: "green"|"amber"|"red"}}
 */
function getBadge(nutrient, value) {
  const cfg = nutrientDefs[nutrient];
  const v = Number(value);
  if (!Number.isFinite(v)) return { label: "—", color: "red" };
  if (v >= cfg.green) return { label: "Optimal", color: "green" };
  if (v >= cfg.amber) return { label: "Low", color: "amber" };
  return { label: "Deficient", color: "red" };
}

/**
 * Compares the last two scans for a nutrient and returns ↑, ↓, or —.
 * @param {"N"|"P"|"K"|"OC"} nutrient
 * @param {Array<any>} history
 * @returns {"↑"|"↓"|"—"}
 */
function getTrendArrow(nutrient, history) {
  if (!Array.isArray(history) || history.length < 2) return "—";
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  const va = getValueFromScan(a, nutrient);
  const vb = getValueFromScan(b, nutrient);
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return "—";
  if (vb > va) return "↑";
  if (vb < va) return "↓";
  return "—";
}

function setBadgeEl(badgeEl, badge) {
  badgeEl.classList.remove("badge--hidden", "badge--green", "badge--amber", "badge--red");
  badgeEl.classList.add(`badge--${badge.color}`);
  badgeEl.textContent = badge.label;
  badgeEl.setAttribute("aria-hidden", "false");
}

function setTrendEl(trendEl, arrow) {
  trendEl.classList.remove("trend--hidden");
  trendEl.setAttribute("aria-hidden", "false");
  const cls =
    arrow === "↑" ? "trend__arrow--up" : arrow === "↓" ? "trend__arrow--down" : "trend__arrow--flat";
  trendEl.innerHTML = `<span class="trend__arrow ${cls}">${arrow}</span><span>vs previous</span>`;
}

/**
 * Updates metric card values, badge pills, and trend arrows.
 * @param {any} data API response from POST /api/v1/predict
 */
function updateCards(data) {
  const mapping = {
    N: getValueFromScan(data, "N"),
    P: getValueFromScan(data, "P"),
    K: getValueFromScan(data, "K"),
    OC: getValueFromScan(data, "OC"),
  };

  Object.entries(mapping).forEach(([nutrient, value]) => {
    const cfg = nutrientDefs[nutrient];
    cfg.valueEl.textContent = formatNumber(value);
    setBadgeEl(cfg.badgeEl, getBadge(nutrient, value));
    cfg.cardEl.classList.add("metric--active");
  });

  // Trend arrows appear only once there are at least 2 scans in this session.
  if (scansCompleted >= 2 && Array.isArray(lastHistory) && lastHistory.length >= 2) {
    (/** @type {Array<"N"|"P"|"K"|"OC">} */ (["N", "P", "K", "OC"])).forEach((nutrient) => {
      const arrow = getTrendArrow(nutrient, lastHistory);
      setTrendEl(nutrientDefs[nutrient].trendEl, arrow);
    });
  }
}

function buildWavelengthLabels() {
  const step = (WAVE_END - WAVE_START) / (WAVE_COUNT - 1);
  return Array.from({ length: WAVE_COUNT }, (_, i) => `${(WAVE_START + i * step).toFixed(1)}nm`);
}

/**
 * Destroys and recreates the nutrient trend chart with last 20 scans.
 * @param {Array<any>} history
 */
function updateTrendChart(history) {
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }

  const hasData = Array.isArray(history) && history.length > 0;
  el.trendOverlay.classList.toggle("chartbox__overlay--hidden", hasData);

  const scans = hasData ? history.slice(-20) : [];
  const labels = scans.map((_, idx) => `Scan ${idx + 1}`);

  const ds = (nutrient, color) => ({
    label: nutrientDefs[nutrient].label,
    data: scans.map((s) => getValueFromScan(s, nutrient)),
    borderColor: color,
    backgroundColor: "transparent",
    borderWidth: 2,
    tension: 0.4,
    pointRadius: 3,
    pointHoverRadius: 4,
  });

  const ctx = el.trendCanvas.getContext("2d");
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        ds("N", "#059669"),
        ds("P", "#7C3AED"),
        ds("K", "#D97706"),
        ds("OC", "#1B6B6B"),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { usePointStyle: true, boxWidth: 10 },
        },
        tooltip: {
          backgroundColor: "rgba(17,24,39,0.92)",
          titleColor: "#fff",
          bodyColor: "rgba(255,255,255,0.92)",
          borderColor: "rgba(255,255,255,0.12)",
          borderWidth: 1,
          padding: 10,
          displayColors: true,
        },
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { color: "rgba(229,231,235,0.7)" },
          ticks: { color: "#6B7280", maxTicksLimit: 10 },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#6B7280" },
        },
      },
    },
  });
}

/**
 * Destroys and recreates the spectral curve chart using the given 228-float vector.
 * @param {number[]} vec
 */
function updateSpectralChart(vec) {
  if (spectralChart) {
    spectralChart.destroy();
    spectralChart = null;
  }

  const hasVec = Array.isArray(vec) && vec.length === WAVE_COUNT;
  el.spectralOverlay.classList.toggle("chartbox__overlay--hidden", hasVec);

  const labels = buildWavelengthLabels();
  const data = hasVec ? vec.map((v) => Number(v)) : Array.from({ length: WAVE_COUNT }, () => null);

  const ctx = el.spectralCanvas.getContext("2d");
  spectralChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Reflectance",
          data,
          borderColor: "#1B6B6B",
          backgroundColor: "transparent",
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(17,24,39,0.92)",
          titleColor: "#fff",
          bodyColor: "rgba(255,255,255,0.92)",
          borderColor: "rgba(255,255,255,0.12)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items) => items?.[0]?.label ?? "",
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#6B7280", maxTicksLimit: 10, autoSkip: true, maxRotation: 0 },
        },
        y: {
          min: 0,
          max: 1,
          grid: { color: "rgba(229,231,235,0.7)" },
          ticks: { color: "#6B7280" },
        },
      },
    },
  });
}

function valueColorClass(nutrient, value) {
  const badge = getBadge(nutrient, value);
  return badge.color === "green" ? "val--green" : badge.color === "amber" ? "val--amber" : "val--red";
}

/**
 * Renders the last 5 scans into the history table.
 * @param {Array<any>} history
 */
function updateHistoryTable(history) {
  const maxRows = Array.isArray(history) ? Math.min(5, scansCompleted, history.length) : 0;
  const hasData = maxRows > 0;
  el.tableEmpty.style.display = hasData ? "none" : "block";
  el.tableScroll.classList.toggle("tablewrap__scroll--hidden", !hasData);
  el.historyBody.innerHTML = "";

  if (!hasData) return;

  const last5 = history.slice(-maxRows).reverse();
  last5.forEach((scan, idx) => {
    const scanNumber = scansCompleted - idx;
    const ts = formatTimestamp(scan.timestamp);
    const n = getValueFromScan(scan, "N");
    const p = getValueFromScan(scan, "P");
    const k = getValueFromScan(scan, "K");
    const oc = getValueFromScan(scan, "OC");
    const conf = Number(scan.confidence);
    const confPct = Number.isFinite(conf) ? (conf <= 1 ? conf * 100 : conf) : NaN;

    const row = document.createElement("div");
    row.className = "tablegrid trow";
    row.innerHTML = `
      <div>${scanNumber}</div>
      <div>${ts}</div>
      <div class="${valueColorClass("N", n)}">${formatNumber(n)}</div>
      <div class="${valueColorClass("P", p)}">${formatNumber(p)}</div>
      <div class="${valueColorClass("K", k)}">${formatNumber(k)}</div>
      <div class="${valueColorClass("OC", oc)}">${formatNumber(oc)}</div>
      <div>${Number.isFinite(confPct) ? `${confPct.toFixed(0)}%` : "—"}</div>
      <div><span class="pill pill--green">Complete</span></div>
    `;
    el.historyBody.appendChild(row);
  });
}

function randomScanId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function setScanCounter() {
  el.scanCountText.textContent = `Scans completed: ${scansCompleted}`;
}

function setSummaryPanel(pred, scanId) {
  el.summaryEmpty.style.display = "none";
  el.summaryBody.classList.remove("stats__body--hidden");
  el.sumScanId.textContent = scanId || "—";
  el.sumTimestamp.textContent = formatTimestamp(pred?.timestamp);

  const conf = Number(pred?.confidence);
  const confPct = Number.isFinite(conf) ? (conf <= 1 ? conf * 100 : conf) : NaN;
  const pctText = Number.isFinite(confPct) ? `${confPct.toFixed(0)}%` : "—";
  el.sumConfidenceText.textContent = pctText;
  el.sumConfidenceFill.style.width = Number.isFinite(confPct) ? `${Math.max(0, Math.min(100, confPct))}%` : "0%";
}

function setScanMeta(pred) {
  el.meta.classList.remove("meta--hidden");
  const conf = Number(pred?.confidence);
  const confPct = Number.isFinite(conf) ? (conf <= 1 ? conf * 100 : conf) : NaN;
  el.metaConfidence.textContent = Number.isFinite(confPct) ? `${confPct.toFixed(0)}%` : "—";
  el.metaModel.textContent = "PLSR v1.0";
  el.metaLatency.textContent = "~2.4s";
}

function showProgressUI() {
  el.progressWrap.classList.remove("progress--hidden");
}

function setProgress(stageIdx, totalStages, label) {
  setStageActive(stageIdx);
  el.progressFill.style.width = `${((stageIdx + 1) / totalStages) * 100}%`;
  el.progressLabel.textContent = label;
}

/**
 * Full scan flow: progress animation, POST /predict, UI updates, chart updates, GET /history.
 */
async function simulateScan() {
  showScanError("");

  // If backend is offline, show message and stop.
  if (!isOnline) {
    showScanError("Backend unreachable. Start the server and refresh.");
    return;
  }

  setScanningState(true);
  showProgressUI();
  resetProgress();

  const stages = ["Acquiring Signal", "Preprocessing", "Running Inference", "Complete"];
  const stageDelay = 700;

  try {
    for (let i = 0; i < stages.length; i++) {
      setProgress(i, stages.length, stages[i]);
      await wait(stageDelay);
    }

    const vec = Array.from({ length: WAVE_COUNT }, () => Math.random());

    let pred;
    try {
      const res = await fetch(`${API}/api/v1/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spectral_vector: vec }),
      });
      if (!res.ok) throw new Error(`Predict status ${res.status}`);
      pred = await res.json();
    } catch (err) {
      showScanError("Backend unreachable. Start the server and refresh.");
      return;
    }

    // Update counters + summary.
    scansCompleted += 1;
    setScanCounter();
    if (!lastScanId) lastScanId = randomScanId();
    else lastScanId = randomScanId();
    setSummaryPanel(pred, lastScanId);
    setScanMeta(pred);

    // Update cards immediately with current prediction.
    updateCards(pred);

    // Plot spectral curve using the exact vector sent to the API.
    updateSpectralChart(vec);

    // Fetch history and update trend chart + table, then update trends on cards.
    try {
      const res = await fetch(`${API}/api/v1/history`);
      if (!res.ok) throw new Error(`History status ${res.status}`);
      const history = await res.json();
      const safeHistory = Array.isArray(history) ? history : [];
      const visibleCount = Math.min(20, scansCompleted, safeHistory.length);
      lastHistory = safeHistory.slice(-visibleCount);
      updateTrendChart(lastHistory);
      updateHistoryTable(lastHistory);

      // Now that we have at least 2 scans, trend arrows can appear.
      updateCards(pred);
    } catch (err) {
      showScanError("Backend unreachable. Start the server and refresh.");
      // Keep current UI stable even if history fails.
    }
  } finally {
    setScanningState(false);
  }
}

function initCharts() {
  updateTrendChart([]);
  updateSpectralChart([]);
}

function bindUI() {
  el.scanBtn.addEventListener("click", simulateScan);
}

(function init() {
  bindUI();
  initCharts();
  setScanCounter();
  checkHealth();
  setInterval(checkHealth, 30000);
})();

