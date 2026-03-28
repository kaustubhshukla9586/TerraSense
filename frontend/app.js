/* ═══════════════════════════════════════════════════════════════
   TerraSense Dashboard — app.js
   Wires all dashboard panels to the FastAPI backend.
   ═══════════════════════════════════════════════════════════════ */

const API = "http://localhost:8000";
const SPECTRAL_FEATURES = 401;
const GPS_BASE = { lat: 31.1048, lng: 75.3412 };
const STORAGE_KEY = "terrasense_history";
const MAX_HISTORY = 50;

// Wavelength labels 900nm → 1700nm
const WAVELENGTHS = Array.from(
  { length: SPECTRAL_FEATURES },
  (_, i) => Math.round(900 + (i * 800) / (SPECTRAL_FEATURES - 1))
);

/* ── State ── */
let scanHistory = [];
let lastAdvisory = null;
let lastScanData = null;
let spectralChart = null;
let trendChart = null;
let isScanning = false;

/* ── DOM refs ── */
const $ = (id) => document.getElementById(id);

/* ═══════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  loadHistory();
  initSidebar();
  initScanButton();
  initExportButton();
  initRegenButton();
  refreshAllPanels();
});

/* ═══════════════════════════════════════════════
   SIDEBAR / PANEL NAVIGATION
   ═══════════════════════════════════════════════ */
function initSidebar() {
  const sidebarItems = document.querySelectorAll(".sidebar__item");
  const mobileItems = document.querySelectorAll(".mobile-nav__item");

  function switchPanel(panelName) {
    // Fade out current
    document.querySelectorAll(".panel--active").forEach((p) => {
      p.style.opacity = "0";
      setTimeout(() => {
        p.classList.remove("panel--active");
        // Fade in new
        const target = $("panel-" + panelName);
        if (target) {
          target.classList.add("panel--active");
          requestAnimationFrame(() => { target.style.opacity = "1"; });
        }
      }, 150);
    });

    // Update sidebar active states
    sidebarItems.forEach((btn) => {
      btn.classList.toggle("sidebar__item--active", btn.dataset.panel === panelName);
    });
    mobileItems.forEach((btn) => {
      btn.classList.toggle("mobile-nav__item--active", btn.dataset.panel === panelName);
    });
  }

  sidebarItems.forEach((btn) => {
    btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
  });

  mobileItems.forEach((btn) => {
    btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
  });
}

/* ═══════════════════════════════════════════════
   LOCALSTORAGE
   ═══════════════════════════════════════════════ */
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) scanHistory = JSON.parse(raw);
  } catch { scanHistory = []; }
}

function saveHistory() {
  while (scanHistory.length > MAX_HISTORY) scanHistory.shift();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scanHistory));
}

/* ═══════════════════════════════════════════════
   NUTRIENT HELPERS
   ═══════════════════════════════════════════════ */
function getStatus(nutrient, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { label: "\u2014", cls: "", score: 0 };

  if (nutrient === "N") {
    if (v >= 2) return { label: "Optimal", cls: "chip--optimal", score: 100 };
    if (v >= 1) return { label: "Low", cls: "chip--low", score: 50 };
    return { label: "Deficient", cls: "chip--deficient", score: 0 };
  }
  if (nutrient === "P") {
    if (v >= 200) return { label: "Optimal", cls: "chip--optimal", score: 100 };
    if (v >= 50) return { label: "Low", cls: "chip--low", score: 50 };
    return { label: "Deficient", cls: "chip--deficient", score: 0 };
  }
  if (nutrient === "K") {
    if (v >= 400) return { label: "Optimal", cls: "chip--optimal", score: 100 };
    if (v >= 100) return { label: "Low", cls: "chip--low", score: 50 };
    return { label: "Deficient", cls: "chip--deficient", score: 0 };
  }
  // OC
  if (v >= 3) return { label: "Optimal", cls: "chip--optimal", score: 100 };
  if (v >= 1) return { label: "Low", cls: "chip--low", score: 50 };
  return { label: "Deficient", cls: "chip--deficient", score: 0 };
}

function calcHealthScore(data) {
  const nutrients = ["N", "P", "K", "OC"];
  const total = nutrients.reduce((sum, n) => sum + getStatus(n, data[n]).score, 0);
  return Math.round(total / 4);
}

function fmtNum(v, decimals) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(decimals) : "\u2014";
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "\u2014";
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

/* ═══════════════════════════════════════════════
   SCAN BUTTON
   ═══════════════════════════════════════════════ */
function initScanButton() {
  $("scan-btn").addEventListener("click", runScan);
}

async function runScan() {
  if (isScanning) return;
  isScanning = true;

  const wrap = $("scan-btn-wrap");
  const btn = $("scan-btn");
  const steps = $("progress-steps");
  const error = $("scan-error");

  btn.disabled = true;
  wrap.classList.remove("scan-btn-wrap--idle");
  wrap.classList.add("scan-btn-wrap--scanning");
  steps.classList.remove("hidden");
  error.classList.remove("scan-error--visible");

  const stepEls = steps.querySelectorAll(".progress-step");
  const lineEls = steps.querySelectorAll(".progress-line");

  function setStep(idx) {
    stepEls.forEach((el, i) => {
      el.classList.remove("progress-step--active", "progress-step--done");
      if (i < idx) el.classList.add("progress-step--done");
      else if (i === idx) el.classList.add("progress-step--active");
    });
    lineEls.forEach((el, i) => {
      el.classList.toggle("progress-line--done", i < idx);
    });
  }

  try {
    // Step 0: Capture spectrum
    setStep(0);
    let vec;
    try {
      const res = await fetch(API + "/api/v1/demo-spectrum");
      const data = await res.json();
      vec = data.spectral_vector;
    } catch {
      vec = Array.from({ length: SPECTRAL_FEATURES }, () => Math.random() * 0.8 + 0.1);
    }

    // Step 1: Process
    await delay(800);
    setStep(1);
    let prediction;
    try {
      const res = await fetch(API + "/api/v1/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spectral_vector: vec }),
      });
      if (!res.ok) throw new Error("Predict failed");
      prediction = await res.json();
    } catch (err) {
      error.classList.add("scan-error--visible");
      resetScanButton();
      return;
    }

    // Step 2: Analyse
    await delay(800);
    setStep(2);

    const nStatus = getStatus("N", prediction.N);
    const pStatus = getStatus("P", prediction.P);
    const kStatus = getStatus("K", prediction.K);
    const ocStatus = getStatus("OC", prediction.OC);
    const healthScore = calcHealthScore(prediction);

    const scanEntry = {
      scan_id: prediction.scan_id || ("TS" + Date.now().toString(36).toUpperCase()),
      timestamp: prediction.timestamp || new Date().toISOString(),
      N: prediction.N,
      P: prediction.P,
      K: prediction.K,
      OC: prediction.OC,
      health_score: healthScore,
      n_status: nStatus.label,
      p_status: pStatus.label,
      k_status: kStatus.label,
      oc_status: ocStatus.label,
      lat: GPS_BASE.lat + (Math.random() - 0.5) * 0.01,
      lng: GPS_BASE.lng + (Math.random() - 0.5) * 0.01,
      spectral_vector: vec,
    };

    // Step 3: Complete
    await delay(600);
    setStep(3);

    // Save
    scanHistory.push(scanEntry);
    saveHistory();
    lastScanData = scanEntry;

    // Update all UI
    updateMetricCards(scanEntry);
    updateSpectralChart(vec);
    updateHealthGauge(healthScore);
    refreshAllPanels();

    // Animate metric cards in
    animateMetricCards();

    // Async: fetch advisory
    fetchAdvisory(scanEntry);

  } catch (err) {
    error.classList.add("scan-error--visible");
  } finally {
    resetScanButton();
  }
}

function resetScanButton() {
  isScanning = false;
  const wrap = $("scan-btn-wrap");
  const btn = $("scan-btn");
  wrap.classList.remove("scan-btn-wrap--scanning");
  wrap.classList.add("scan-btn-wrap--idle");
  btn.disabled = false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ═══════════════════════════════════════════════
   METRIC CARDS
   ═══════════════════════════════════════════════ */
function updateMetricCards(data) {
  ["N", "P", "K", "OC"].forEach((n) => {
    const val = $("val-" + n);
    const chip = $("chip-" + n);
    const status = getStatus(n, data[n]);

    if (n === "N" || n === "OC") {
      val.textContent = fmtNum(data[n], 3);
    } else {
      val.textContent = fmtNum(data[n], 1);
    }

    chip.textContent = status.label;
    chip.className = "chip " + status.cls;
  });
}

function animateMetricCards() {
  const cards = document.querySelectorAll(".metric-card");
  cards.forEach((card, i) => {
    card.style.opacity = "0";
    card.style.transform = "translateY(16px)";
    setTimeout(() => {
      card.style.transition = "all 400ms ease";
      card.style.opacity = "1";
      card.style.transform = "translateY(0)";
    }, i * 100);
  });
}

/* ═══════════════════════════════════════════════
   SPECTRAL CHART
   ═══════════════════════════════════════════════ */
function updateSpectralChart(vec) {
  $("spectral-empty").classList.add("hidden");

  if (spectralChart) spectralChart.destroy();

  const ctx = $("spectral-chart").getContext("2d");
  spectralChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: WAVELENGTHS.map((w) => w + "nm"),
      datasets: [{
        label: "Reflectance",
        data: vec,
        borderColor: "#609966",
        backgroundColor: "rgba(96,153,102,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800 },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: "'Chivo Mono', monospace", size: 11 },
            color: "#40513B",
            callback: (_, i) => i % 40 === 0 ? WAVELENGTHS[i] + "nm" : "",
          },
          title: { display: true, text: "Wavelength (nm)", font: { family: "'Chivo Mono', monospace" } },
        },
        y: {
          min: 0, max: 1,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { font: { family: "'Chivo Mono', monospace", size: 11 }, color: "#40513B" },
          title: { display: true, text: "Reflectance", font: { family: "'Chivo Mono', monospace" } },
        },
      },
    },
  });
}

/* ═══════════════════════════════════════════════
   HEALTH GAUGE
   ═══════════════════════════════════════════════ */
function updateHealthGauge(score) {
  const arc = $("gauge-arc");
  const text = $("gauge-text");
  const circumference = 2 * Math.PI * 70; // ~440

  const offset = circumference - (circumference * score) / 100;

  let color = "#40513B";
  if (score >= 70) color = "#609966";
  else if (score >= 40) color = "#9DC08B";

  arc.style.transition = "stroke-dashoffset 800ms ease, stroke 300ms ease";
  arc.setAttribute("stroke-dasharray", circumference);
  arc.setAttribute("stroke-dashoffset", offset);
  arc.setAttribute("stroke", color);
  text.textContent = score;
}

/* ═══════════════════════════════════════════════
   TREND CHART (History panel)
   ═══════════════════════════════════════════════ */
function updateTrendChart() {
  const last20 = scanHistory.slice(-20);

  if (last20.length === 0) {
    $("trend-empty").classList.remove("hidden");
    return;
  }

  $("trend-empty").classList.add("hidden");

  if (trendChart) trendChart.destroy();

  const ctx = $("trend-chart").getContext("2d");
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: last20.map((s) => fmtTime(s.timestamp).split(",")[0]),
      datasets: [
        { label: "N (%)", data: last20.map((s) => s.N), borderColor: "#609966", tension: 0.4, pointRadius: 3, borderWidth: 2 },
        { label: "P (mg/kg)", data: last20.map((s) => s.P), borderColor: "#9DC08B", tension: 0.4, pointRadius: 3, borderWidth: 2 },
        { label: "K (mg/kg)", data: last20.map((s) => s.K), borderColor: "#40513B", tension: 0.4, pointRadius: 3, borderWidth: 2 },
        { label: "OC (%)", data: last20.map((s) => s.OC), borderColor: "#8B6914", tension: 0.4, pointRadius: 3, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800 },
      plugins: { legend: { position: "top" } },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: "'Chivo Mono', monospace", size: 11 }, color: "#40513B" },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { font: { family: "'Chivo Mono', monospace", size: 11 }, color: "#40513B" },
        },
      },
    },
  });
}

/* ═══════════════════════════════════════════════
   HISTORY TABLE
   ═══════════════════════════════════════════════ */
function updateHistoryTable() {
  const tbody = $("history-tbody");
  const table = $("history-table");
  const empty = $("history-empty");

  if (scanHistory.length === 0) {
    empty.classList.remove("hidden");
    table.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  table.classList.remove("hidden");
  tbody.innerHTML = "";

  const items = [...scanHistory].reverse();
  items.forEach((s) => {
    const statusLabel = s.health_score >= 70 ? "Optimal" : s.health_score >= 40 ? "Low" : "Deficient";
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + (s.scan_id || "\u2014") + "</td>" +
      "<td>" + fmtTime(s.timestamp) + "</td>" +
      "<td>" + fmtNum(s.N, 3) + "</td>" +
      "<td>" + fmtNum(s.P, 1) + "</td>" +
      "<td>" + fmtNum(s.K, 1) + "</td>" +
      "<td>" + fmtNum(s.OC, 3) + "</td>" +
      "<td>" + (s.health_score || 0) + "</td>" +
      "<td>" + statusLabel + "</td>";
    tbody.appendChild(tr);
  });
}

/* ═══════════════════════════════════════════════
   ADVISORY
   ═══════════════════════════════════════════════ */
async function fetchAdvisory(scanEntry) {
  const skeleton = $("advisory-skeleton");
  const sections = $("advisory-sections");
  const emptyEl = $("advisory-empty");
  const regenBtn = $("regen-btn");

  emptyEl.classList.add("hidden");
  sections.classList.add("hidden");
  skeleton.classList.remove("hidden");

  // Update summary bar
  updateAdvisorySummary(scanEntry);

  try {
    const res = await fetch(API + "/api/v1/advisory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        N: scanEntry.N,
        P: scanEntry.P,
        K: scanEntry.K,
        OC: scanEntry.OC,
        n_status: scanEntry.n_status,
        p_status: scanEntry.p_status,
        k_status: scanEntry.k_status,
        oc_status: scanEntry.oc_status,
      }),
    });

    if (!res.ok) throw new Error("Advisory failed");
    const data = await res.json();
    lastAdvisory = data.advisory;
    renderAdvisory(data.advisory);
    regenBtn.classList.remove("hidden");
  } catch {
    skeleton.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    emptyEl.textContent = "Could not fetch advisory. Check that GROQ_API_KEY is configured.";
  }
}

function updateAdvisorySummary(scan) {
  const el = $("advisory-summary");
  el.innerHTML =
    '<span class="chip">' + "N: " + fmtNum(scan.N, 2) + "%" + '</span>' +
    '<span class="chip">' + "P: " + fmtNum(scan.P, 1) + '</span>' +
    '<span class="chip">' + "K: " + fmtNum(scan.K, 1) + '</span>' +
    '<span class="chip">' + "OC: " + fmtNum(scan.OC, 2) + "%" + '</span>' +
    '<span class="advisory-summary__label">Based on scan #' + scan.scan_id + '</span>';
}

function renderAdvisory(text) {
  const skeleton = $("advisory-skeleton");
  const sections = $("advisory-sections");

  skeleton.classList.add("hidden");
  sections.classList.remove("hidden");

  // Parse into 3 sections
  const parts = parseAdvisoryText(text);

  sections.innerHTML =
    buildAdvisorySection("Recommended Crops",
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1 0 1.5-.5 1.5-1v-1.5c0-.5.5-1 1-1H17c2.8 0 5-2.2 5-5 0-5-4.5-9.5-10-11.5z"/></svg>',
      parts[0]) +
    buildAdvisorySection("Fertilizer Plan",
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2v8L4 16v2h16v-2l-6-6V2"/><path d="M8.5 2h7"/></svg>',
      parts[1]) +
    buildAdvisorySection("Urgent Action",
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      parts[2]);
}

function buildAdvisorySection(title, iconSvg, content) {
  return '<div class="advisory-section">' +
    '<div class="advisory-section__header">' +
      '<span class="advisory-section__icon">' + iconSvg + '</span>' +
      '<span class="advisory-section__title">' + title + '</span>' +
    '</div>' +
    '<div class="advisory-section__content">' + escapeHtml(content) + '</div>' +
  '</div>';
}

function parseAdvisoryText(text) {
  // Try to split by numbered sections
  const sections = ["", "", ""];
  const lines = text.split("\n");
  let current = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[#*]*\s*1[.):]/.test(trimmed) || /crop/i.test(trimmed) && current < 0) {
      current = 0;
    } else if (/^[#*]*\s*2[.):]/.test(trimmed) || /fertilizer/i.test(trimmed) && current <= 0) {
      current = 1;
    } else if (/^[#*]*\s*3[.):]/.test(trimmed) || /urgent/i.test(trimmed) && current <= 1) {
      current = 2;
    }
    if (current >= 0 && current < 3) {
      sections[current] += trimmed + "\n";
    }
  }

  // If parsing fails, put all text in first section
  if (sections[0].trim() === "" && sections[1].trim() === "" && sections[2].trim() === "") {
    sections[0] = text;
  }

  return sections.map((s) => s.trim());
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function initRegenButton() {
  $("regen-btn").addEventListener("click", () => {
    if (lastScanData) fetchAdvisory(lastScanData);
  });
}

/* ═══════════════════════════════════════════════
   GPS PANEL
   ═══════════════════════════════════════════════ */
function updateGPSPanel() {
  const count = scanHistory.length;
  const placeholder = $("gps-placeholder");
  const mapEl = $("gps-map");

  if (count < 5) {
    placeholder.classList.remove("hidden");
    mapEl.classList.add("hidden");
    $("gps-remaining").textContent = 5 - count;
    $("gps-fill").style.width = (count / 5 * 100) + "%";
    return;
  }

  placeholder.classList.add("hidden");
  mapEl.classList.remove("hidden");

  // Build 10x10 grid
  const grid = $("gps-grid");
  grid.innerHTML = "";

  for (let i = 0; i < 100; i++) {
    const cell = document.createElement("div");
    cell.className = "gps-cell";

    // Map scan to cell if available
    const scanIdx = i % count;
    const scan = scanHistory[scanIdx];
    const score = scan ? (scan.health_score || 0) : 0;

    if (score >= 70) {
      cell.style.background = "#609966";
    } else if (score >= 40) {
      cell.style.background = "#9DC08B";
    } else {
      cell.style.background = "rgba(64,81,59,0.6)";
    }

    // Tooltip
    if (scan) {
      const tooltip = document.createElement("div");
      tooltip.className = "gps-tooltip";
      tooltip.textContent = "#" + scan.scan_id + " | " +
        (scan.lat ? scan.lat.toFixed(4) : GPS_BASE.lat.toFixed(4)) + "\u00B0N, " +
        (scan.lng ? scan.lng.toFixed(4) : GPS_BASE.lng.toFixed(4)) + "\u00B0E | Score: " + score;
      cell.appendChild(tooltip);
    }

    grid.appendChild(cell);
  }

  $("gps-caption").textContent = "Simulated Punjab Field \u00B7 " + count + " scan points";
}

/* ═══════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════ */
function initExportButton() {
  $("export-btn").addEventListener("click", exportCSV);
}

function updateExportPanel() {
  $("export-total").textContent = scanHistory.length;

  if (scanHistory.length > 0) {
    const first = fmtTime(scanHistory[0].timestamp).split(",")[0];
    const last = fmtTime(scanHistory[scanHistory.length - 1].timestamp).split(",")[0];
    $("export-range").textContent = first + " \u2013 " + last;
  } else {
    $("export-range").textContent = "\u2014";
  }
}

function exportCSV() {
  if (scanHistory.length === 0) {
    showToast("No data to export");
    return;
  }

  const headers = ["scan_id", "timestamp", "N", "P", "K", "OC", "health_score",
    "n_status", "p_status", "k_status", "oc_status", "latitude", "longitude"];
  const rows = scanHistory.map((s) =>
    [s.scan_id, s.timestamp, s.N, s.P, s.K, s.OC, s.health_score,
      s.n_status, s.p_status, s.k_status, s.oc_status, s.lat, s.lng].join(",")
  );

  const csv = headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "terrasense_export_" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);

  $("export-last").textContent = fmtTime(new Date().toISOString());
  showToast("CSV exported successfully");
}

/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
function showToast(msg) {
  const toast = $("toast");
  toast.textContent = msg;
  toast.classList.add("toast--visible");
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

/* ═══════════════════════════════════════════════
   REFRESH ALL PANELS
   ═══════════════════════════════════════════════ */
function refreshAllPanels() {
  // Metric cards from last scan
  if (scanHistory.length > 0) {
    const last = scanHistory[scanHistory.length - 1];
    lastScanData = last;
    updateMetricCards(last);
    updateHealthGauge(last.health_score || 0);

    if (last.spectral_vector) {
      updateSpectralChart(last.spectral_vector);
    }
  }

  updateTrendChart();
  updateHistoryTable();
  updateGPSPanel();
  updateExportPanel();
}
