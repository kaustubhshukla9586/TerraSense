const API = "http://localhost:8000";
const SPECTRAL_FEATURES = 401;

// Wavelength labels from 900nm to 1700nm (401 evenly spaced points).
const WAVELENGTHS = Array.from(
  { length: SPECTRAL_FEATURES },
  (_, i) => Math.round(900 + (i * (1700 - 900)) / (SPECTRAL_FEATURES - 1))
);

let trendChart = null;
let spectralChart = null;

let scanCount = 0;
let lastResults = [];

const el = {
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),

  scanBtn: document.getElementById("scan-btn"),
  scanPanel: document.getElementById("scan-panel"),
  scanCounter: document.getElementById("scan-counter"),
  scanError: document.getElementById("scan-error"),

  progressContainer: document.getElementById("progress-container"),
  progressBarFill: document.getElementById("progress-bar-fill"),
  progressLabel: document.getElementById("progress-label"),

  scanMeta: document.getElementById("scan-meta"),
  metaConfidence: document.getElementById("meta-confidence"),
  metaLatency: document.getElementById("meta-latency"),

  statsEmpty: document.getElementById("stats-empty"),
  statsContent: document.getElementById("stats-content"),

  statId: document.getElementById("stat-id"),
  statTime: document.getElementById("stat-time"),
  statConfidence: document.getElementById("stat-confidence"),
  statStatus: document.getElementById("stat-status"),
  confidenceBarFill: document.getElementById("confidence-bar-fill"),

  trendOverlay: document.getElementById("trend-overlay"),
  spectralOverlay: document.getElementById("spectral-overlay"),
  trendCanvas: document.getElementById("trendChart"),
  spectralCanvas: document.getElementById("spectralChart"),

  historyEmpty: document.getElementById("history-empty"),
  historyTable: document.getElementById("history-table"),
  historyTbody: document.getElementById("history-tbody"),

  cardValue: {
    N: document.getElementById("val-N"),
    P: document.getElementById("val-P"),
    K: document.getElementById("val-K"),
    OC: document.getElementById("val-OC"),
  },
  cardBadge: {
    N: document.getElementById("badge-N"),
    P: document.getElementById("badge-P"),
    K: document.getElementById("badge-K"),
    OC: document.getElementById("badge-OC"),
  },
  cardTrend: {
    N: document.getElementById("trend-N"),
    P: document.getElementById("trend-P"),
    K: document.getElementById("trend-K"),
    OC: document.getElementById("trend-OC"),
  },
  cardEl: {
    N: document.getElementById("card-N"),
    P: document.getElementById("card-P"),
    K: document.getElementById("card-K"),
    OC: document.getElementById("card-OC"),
  },
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls GET /health and updates the navbar system status dot + text.
 */
async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(`Health failed with status ${res.status}`);
    const data = await res.json();
    if (data && data.status === "ok") {
      el.statusDot.classList.remove("offline");
      el.statusDot.classList.add("online");
      el.statusText.textContent = "System Online";
      return;
    }
    throw new Error("Unexpected health payload");
  } catch (err) {
    el.statusDot.classList.remove("online");
    el.statusDot.classList.add("offline");
    el.statusText.textContent = "System Offline";
  }
}

function formatNumberOrDash(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function showScanError(show) {
  if (show) {
    el.scanError.classList.remove("hidden");
  } else {
    el.scanError.classList.add("hidden");
  }
}

function setScanning(scanning) {
  el.scanPanel.classList.toggle("scanning", scanning);
  el.scanBtn.disabled = scanning;
}

function formatTimestamp(isoString) {
  const d = new Date(isoString);
  if (!Number.isFinite(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date}, ${time}`;
}

/**
 * Returns the badge information for a nutrient and its health thresholds.
 * @param {"N"|"P"|"K"|"OC"} nutrient
 * @param {number} value
 * @returns {{label: string, className: string}}
 */
function getBadge(nutrient, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { label: "—", className: "badge-deficient" };

  if (nutrient === "N") {
    if (v >= 2) return { label: "Optimal", className: "badge-optimal" };
    if (v >= 1) return { label: "Low", className: "badge-low" };
    return { label: "Deficient", className: "badge-deficient" };
  }

  if (nutrient === "P") {
    if (v >= 200) return { label: "Optimal", className: "badge-optimal" };
    if (v >= 50) return { label: "Low", className: "badge-low" };
    return { label: "Deficient", className: "badge-deficient" };
  }

  if (nutrient === "K") {
    if (v >= 400) return { label: "Optimal", className: "badge-optimal" };
    if (v >= 100) return { label: "Low", className: "badge-low" };
    return { label: "Deficient", className: "badge-deficient" };
  }

  // OC
  if (v >= 3) return { label: "Optimal", className: "badge-optimal" };
  if (v >= 1) return { label: "Low", className: "badge-low" };
  return { label: "Deficient", className: "badge-deficient" };
}

/**
 * Compares the last two scans and returns an arrow for nutrient trend.
 * @param {"N"|"P"|"K"|"OC"} nutrient
 * @returns {"↑"|"↓"|"—"|""}
 */
function getTrendArrow(nutrient) {
  if (lastResults.length < 2) return "";
  const prev = lastResults[lastResults.length - 2][nutrient];
  const curr = lastResults[lastResults.length - 1][nutrient];

  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return "";
  if (curr > prev) return "↑";
  if (curr < prev) return "↓";
  return "—";
}

/**
 * Updates the nutrient metric cards (values, badges, trend arrows).
 * Also stores current values in `lastResults` (keeps last 2).
 */
function updateCards(data) {
  const current = {
    N: Number(data?.N),
    P: Number(data?.P),
    K: Number(data?.K),
    OC: Number(data?.OC),
  };

  lastResults.push(current);
  while (lastResults.length > 2) lastResults.shift();

  const order = ["N", "P", "K", "OC"];
  order.forEach((nutrient) => {
    const value = current[nutrient];

    // Values formatting: N/OC => 3 decimals, P/K => 1 decimal.
    if (nutrient === "N" || nutrient === "OC") {
      el.cardValue[nutrient].textContent = formatNumberOrDash(value, 3);
    } else {
      el.cardValue[nutrient].textContent = formatNumberOrDash(value, 1);
    }

    const badge = getBadge(nutrient, value);
    const badgeEl = el.cardBadge[nutrient];
    badgeEl.textContent = badge.label;
    badgeEl.classList.remove("hidden", "badge-optimal", "badge-low", "badge-deficient");
    badgeEl.classList.add(badge.className);

    el.cardEl[nutrient].classList.add("active");

    const arrow = getTrendArrow(nutrient);
    const trendEl = el.cardTrend[nutrient];
    trendEl.classList.remove("hidden", "trend-up", "trend-down");
    trendEl.textContent = "";

    if (!arrow) {
      trendEl.classList.add("hidden");
      return;
    }

    trendEl.textContent = arrow;
    if (arrow === "↑") trendEl.classList.add("trend-up");
    if (arrow === "↓") trendEl.classList.add("trend-down");
  });
}

/**
 * Destroys and recreates the nutrient history chart.
 * @param {Array<any>} history
 */
function updateTrendChart(history) {
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }

  el.trendOverlay.classList.add("hidden");

  const safeHistory = Array.isArray(history) ? history : [];
  const labels = safeHistory.map((_, i) => "Scan " + (i + 1));

  const ctx = el.trendCanvas.getContext("2d");
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Nitrogen",
          data: safeHistory.map((x) => Number(x?.N)),
          borderColor: "#059669",
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: "Phosphorus",
          data: safeHistory.map((x) => Number(x?.P)),
          borderColor: "#7C3AED",
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: "Potassium",
          data: safeHistory.map((x) => Number(x?.K)),
          borderColor: "#D97706",
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: "Organic Carbon",
          data: safeHistory.map((x) => Number(x?.OC)),
          borderColor: "#1B6B6B",
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { color: "#6B7280", font: { weight: 600 } },
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
 * Destroys and recreates the raw spectral curve chart using the 401-float vector.
 * @param {number[]} vec
 */
function updateSpectralChart(vec) {
  if (spectralChart) {
    spectralChart.destroy();
    spectralChart = null;
  }

  el.spectralOverlay.classList.add("hidden");

  const safeVec = Array.isArray(vec) && vec.length === SPECTRAL_FEATURES ? vec.map((v) => Number(v)) : [];
  const labels = WAVELENGTHS.map((w) => `${w}nm`);

  const ctx = el.spectralCanvas.getContext("2d");
  spectralChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Reflectance",
          data: safeVec,
          borderColor: "#1B6B6B",
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#6B7280",
            font: { weight: 600 },
            callback: function (value, index) {
              return index % 10 === 0 ? labels[index] : "";
            },
          },
          title: {
            display: true,
            text: "Wavelength (nm)",
          },
        },
        y: {
          min: 0,
          max: 1,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { color: "#6B7280" },
          title: {
            display: true,
            text: "Reflectance",
          },
        },
      },
    },
  });
}

/**
 * Renders the last 5 scans into the scan history table.
 * @param {Array<any>} history
 */
function updateHistoryTable(history) {
  const safeHistory = Array.isArray(history) ? history : [];
  const last5 = safeHistory.slice(-5).reverse();

  if (last5.length === 0) {
    el.historyEmpty.classList.remove("hidden");
    el.historyTable.classList.add("hidden");
    el.historyTbody.innerHTML = "";
    return;
  }

  el.historyEmpty.classList.add("hidden");
  el.historyTable.classList.remove("hidden");
  el.historyTbody.innerHTML = "";

  last5.forEach((item, index) => {
    const nBadge = getBadge("N", item?.N);
    const pBadge = getBadge("P", item?.P);
    const kBadge = getBadge("K", item?.K);
    const ocBadge = getBadge("OC", item?.OC);

    const nClass = nBadge.className.replace("badge-", "val-");
    const pClass = pBadge.className.replace("badge-", "val-");
    const kClass = kBadge.className.replace("badge-", "val-");
    const ocClass = ocBadge.className.replace("badge-", "val-");

    const confidence = Number(item?.confidence);
    const confidencePct = Number.isFinite(confidence) ? confidence * 100 : NaN;
    const confidenceText = Number.isFinite(confidencePct) ? `${confidencePct.toFixed(0)}%` : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${item?.scan_id ?? "—"}</td>
      <td>${formatTimestamp(item?.timestamp)}</td>
      <td class="${nClass}">${formatNumberOrDash(item?.N, 3)}</td>
      <td class="${pClass}">${formatNumberOrDash(item?.P, 1)}</td>
      <td class="${kClass}">${formatNumberOrDash(item?.K, 1)}</td>
      <td class="${ocClass}">${formatNumberOrDash(item?.OC, 3)}</td>
      <td>${confidenceText}</td>
      <td><span class="complete-pill">Complete</span></td>
    `;
    el.historyTbody.appendChild(tr);
  });
}

/**
 * Shows the scan meta row under the progress bar.
 * @param {any} data
 * @param {string} latency
 */
function updateScanMeta(data, latency) {
  el.scanMeta.classList.remove("hidden");

  const confidence = Number(data?.confidence);
  const confidencePct = Number.isFinite(confidence) ? confidence * 100 : NaN;
  el.metaConfidence.textContent = Number.isFinite(confidencePct) ? `${confidencePct.toFixed(0)}%` : "—";
  el.metaLatency.textContent = latency;
}

/**
 * Updates the right-side stats panel after a successful scan.
 * @param {any} data
 */
function updateStatsPanel(data) {
  el.statsEmpty.classList.add("hidden");
  el.statsContent.classList.remove("hidden");

  el.statId.textContent = data?.scan_id ?? "—";
  el.statTime.textContent = formatTimestamp(data?.timestamp);

  const confidence = Number(data?.confidence);
  const confidencePct = Number.isFinite(confidence) ? confidence * 100 : NaN;
  el.statConfidence.textContent = Number.isFinite(confidencePct) ? `${confidencePct.toFixed(0)}%` : "—";

  if (Number.isFinite(confidencePct)) {
    el.confidenceBarFill.style.width = `${Math.max(0, Math.min(100, confidencePct))}%`;
  } else {
    el.confidenceBarFill.style.width = "0%";
  }

  el.statStatus.textContent = "Prediction Complete";
}

/**
 * Full scan flow: progress stages, POST /predict, update cards, charts, scan meta, stats, and history.
 */
async function simulateScan() {
  const startTime = Date.now();

  try {
    setScanning(true);
    el.progressContainer.classList.remove("hidden");
    showScanError(false);
    el.scanMeta.classList.add("hidden");

    const stages = ["Acquiring Signal...", "Preprocessing...", "Running Inference...", "Complete"];

    for (let i = 0; i < stages.length; i++) {
      el.progressLabel.textContent = stages[i];
      el.progressBarFill.style.width = `${((i + 1) / stages.length) * 100}%`;
      await wait(700);
    }

    let vec;
try {
    const specRes = await fetch(API + '/api/v1/demo-spectrum');
    const specData = await specRes.json();
    vec = specData.spectral_vector;
} catch {
    // Fallback to random if endpoint not available
    vec = Array.from({length: SPECTRAL_FEATURES}, () => Math.random());
}

    let data;
    try {
      const res = await fetch(`${API}/api/v1/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spectral_vector: vec }),
      });
      if (!res.ok) throw new Error(`Predict failed with status ${res.status}`);
      data = await res.json();
    } catch (err) {
      showScanError(true);
      return;
    }

    const latency = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    updateCards(data);
    updateSpectralChart(vec);
    updateScanMeta(data, latency);
    updateStatsPanel(data);

    scanCount += 1;
    el.scanCounter.textContent = `Scans completed: ${scanCount}`;

    let history;
    try {
      const res = await fetch(`${API}/api/v1/history`);
      if (!res.ok) throw new Error(`History failed with status ${res.status}`);
      history = await res.json();
    } catch (err) {
      // History failure should not stop the rest of the UI update.
      history = [];
    }

    updateTrendChart(history);
    updateHistoryTable(history);
  } catch (err) {
    showScanError(true);
  } finally {
    setScanning(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  setInterval(checkHealth, 30000);
});

