/**
 * Tingle Trading Terminal
 * Full MT5-style frontend logic:
 * - TradingView Lightweight Charts (candlestick + indicators)
 * - Watchlist with live LTP polling
 * - Order form & confirmation
 * - Strategy builder (no-code condition editor)
 * - Positions / Orders / Holdings tables
 * - Broker connect/disconnect
 */

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
const state = {
  symbol: null,
  token: null,
  exchange: "NSE",
  timeframe: "5m",
  side: "BUY",
  brokerConnected: false,
  watchlist: [],           // [{symbol, token, exchange}]
  activeIndicators: new Set(),
  candleSeries: null,
  rsiSeries: null,
  macdSeries: null,
  indicatorSeries: {},     // name → series object
  ltpPollTimer: null,
  searchTimer: null,
};

/* ══════════════════════════════════════════════════════════
   CHART SETUP
══════════════════════════════════════════════════════════ */
const mainChart = LightweightCharts.createChart(document.getElementById("main-chart"), {
  layout: { background: { color: "#0d1117" }, textColor: "#e6edf3" },
  grid: { vertLines: { color: "#161b22" }, horzLines: { color: "#161b22" } },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  rightPriceScale: { borderColor: "#30363d" },
  timeScale: { borderColor: "#30363d", timeVisible: true, secondsVisible: false },
  handleScroll: true,
  handleScale: true,
});

const rsiChart = LightweightCharts.createChart(document.getElementById("rsi-chart"), {
  layout: { background: { color: "#0d1117" }, textColor: "#8b949e" },
  grid: { vertLines: { color: "#161b22" }, horzLines: { color: "#161b22" } },
  rightPriceScale: { borderColor: "#30363d", scaleMargins: { top: 0.1, bottom: 0.1 } },
  timeScale: { borderColor: "#30363d", timeVisible: true },
  height: 120,
});

const macdChart = LightweightCharts.createChart(document.getElementById("macd-chart"), {
  layout: { background: { color: "#0d1117" }, textColor: "#8b949e" },
  grid: { vertLines: { color: "#161b22" }, horzLines: { color: "#161b22" } },
  rightPriceScale: { borderColor: "#30363d" },
  timeScale: { borderColor: "#30363d", timeVisible: true },
  height: 120,
});

// Resize charts when window resizes
function resizeCharts() {
  const el = document.getElementById("main-chart");
  if (el) mainChart.resize(el.clientWidth, el.clientHeight);
}
window.addEventListener("resize", resizeCharts);

// Sync timescales
mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
  if (range) {
    rsiChart.timeScale().setVisibleLogicalRange(range);
    macdChart.timeScale().setVisibleLogicalRange(range);
  }
});

/* ══════════════════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════════════════ */
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString("en-IN", { hour12: false });
  document.getElementById("clock").textContent = t;
}
setInterval(updateClock, 1000);
updateClock();

/* ══════════════════════════════════════════════════════════
   BROKER
══════════════════════════════════════════════════════════ */
async function checkBrokerStatus() {
  try {
    const data = await api("/broker/status");
    state.brokerConnected = data.status === "connected";
    const badge = document.getElementById("broker-badge");
    if (state.brokerConnected) {
      badge.className = "badge badge-connected";
      badge.textContent = `● ${data.client_id}`;
    } else {
      badge.className = "badge badge-disconnected";
      badge.textContent = "● Disconnected";
    }
  } catch (_) {}
}

async function connectBroker() {
  const payload = {
    api_key:      document.getElementById("b-apikey").value.trim(),
    client_id:    document.getElementById("b-clientid").value.trim(),
    password:     document.getElementById("b-password").value.trim(),
    totp_secret:  document.getElementById("b-totp").value.trim(),
  };

  if (!payload.api_key || !payload.client_id || !payload.password || !payload.totp_secret) {
    showBrokerMsg("All fields are required", "error");
    return;
  }

  showBrokerMsg("Connecting…", "");
  try {
    const data = await api("/broker/connect", "POST", payload);
    if (data.error) {
      showBrokerMsg(data.error, "error");
    } else {
      showBrokerMsg("Connected successfully!", "success");
      state.brokerConnected = true;
      checkBrokerStatus();
      setTimeout(() => closeModal("modal-broker"), 1500);
    }
  } catch (e) {
    showBrokerMsg("Connection failed", "error");
  }
}

async function disconnectBroker() {
  await api("/broker/disconnect", "POST", {});
  state.brokerConnected = false;
  checkBrokerStatus();
  showBrokerMsg("Disconnected", "success");
}

function showBrokerMsg(msg, type) {
  const el = document.getElementById("broker-msg");
  el.textContent = msg;
  el.className = "msg " + type;
}

/* ══════════════════════════════════════════════════════════
   SYMBOL SEARCH (top bar)
══════════════════════════════════════════════════════════ */
document.getElementById("symbol-search").addEventListener("input", function () {
  clearTimeout(state.searchTimer);
  const q = this.value.trim();
  if (q.length < 2) {
    document.getElementById("search-results").classList.add("hidden");
    return;
  }
  state.searchTimer = setTimeout(() => doSymbolSearch(q), 300);
});

async function doSymbolSearch(q) {
  const el = document.getElementById("search-results");
  try {
    const data = await api(`/market/search?q=${encodeURIComponent(q)}&exchange=NSE`);
    if (!data.results || !data.results.length) {
      el.classList.add("hidden");
      return;
    }
    el.innerHTML = data.results.map(r => `
      <div class="search-item" onclick="selectSymbol('${r.symbol}','${r.token}','${r.exchange}')">
        <span class="sym">${r.symbol}</span>
        <span class="exch">${r.exchange} · ${r.name || ""}</span>
      </div>
    `).join("");
    el.classList.remove("hidden");
  } catch (_) {}
}

function selectSymbol(symbol, token, exchange) {
  document.getElementById("search-results").classList.add("hidden");
  document.getElementById("symbol-search").value = "";
  loadChart(symbol, token, exchange);
  // Pre-fill order form
  document.getElementById("order-symbol").value = symbol;
  document.getElementById("order-token").value = token;
  document.getElementById("order-exchange").value = exchange;
}

// Close search on outside click
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) {
    document.getElementById("search-results").classList.add("hidden");
  }
});

/* ══════════════════════════════════════════════════════════
   CHART LOADING
══════════════════════════════════════════════════════════ */
async function loadChart(symbol, token, exchange) {
  state.symbol = symbol;
  state.token = token;
  state.exchange = exchange;

  document.getElementById("chart-symbol").textContent = symbol;
  document.getElementById("chart-ltp").textContent = "Loading…";

  // Highlight active watchlist item
  document.querySelectorAll(".wl-item").forEach(el => el.classList.remove("active"));
  const match = document.querySelector(`.wl-item[data-symbol="${symbol}"]`);
  if (match) match.classList.add("active");

  // Fetch candles
  try {
    const url = `/market/candles?symbol=${symbol}&token=${token}&exchange=${exchange}&timeframe=${state.timeframe}`;
    const data = await api(url);
    if (data.error) { toast(data.error, "error"); return; }

    // Render candlestick
    if (state.candleSeries) { mainChart.removeSeries(state.candleSeries); }
    state.candleSeries = mainChart.addCandlestickSeries({
      upColor: "#3fb950", downColor: "#f85149",
      borderUpColor: "#3fb950", borderDownColor: "#f85149",
      wickUpColor: "#3fb950", wickDownColor: "#f85149",
    });
    state.candleSeries.setData(data.candles);
    mainChart.timeScale().fitContent();

    // Fetch & apply active indicators
    if (state.activeIndicators.size > 0) {
      await applyIndicators(symbol, exchange);
    }

    // Update OHLC header from last candle
    if (data.candles.length > 0) {
      const last = data.candles[data.candles.length - 1];
      updateOHLCHeader(last);
    }

    // Start LTP polling
    startLTPPoll(symbol, token, exchange);

  } catch (e) {
    toast("Failed to load chart: " + e.message, "error");
  }
}

function updateOHLCHeader(candle) {
  document.getElementById("c-open").textContent  = fmt(candle.open);
  document.getElementById("c-high").textContent  = fmt(candle.high);
  document.getElementById("c-low").textContent   = fmt(candle.low);
  document.getElementById("c-close").textContent = fmt(candle.close);
}

/* ══════════════════════════════════════════════════════════
   TIMEFRAME SWITCHING
══════════════════════════════════════════════════════════ */
document.querySelectorAll(".tf-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.timeframe = btn.dataset.tf;
    if (state.symbol) loadChart(state.symbol, state.token, state.exchange);
  });
});

/* ══════════════════════════════════════════════════════════
   INDICATORS
══════════════════════════════════════════════════════════ */
document.querySelectorAll(".ind-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const ind = btn.dataset.ind;
    if (state.activeIndicators.has(ind)) {
      state.activeIndicators.delete(ind);
      btn.classList.remove("active");
      removeIndicatorSeries(ind);
      if (ind === "RSI")  toggleSubChart("rsi-chart", false);
      if (ind === "MACD") toggleSubChart("macd-chart", false);
    } else {
      state.activeIndicators.add(ind);
      btn.classList.add("active");
      if (state.symbol) await applyIndicators(state.symbol, state.exchange);
    }
  });
});

async function applyIndicators(symbol, exchange) {
  try {
    const data = await api(`/strategy/indicators?symbol=${symbol}&exchange=${exchange}&timeframe=${state.timeframe}`);
    if (data.error) return;

    // Remove old series
    Object.values(state.indicatorSeries).forEach(s => {
      try { mainChart.removeSeries(s); } catch (_) {}
      try { rsiChart.removeSeries(s); } catch (_) {}
      try { macdChart.removeSeries(s); } catch (_) {}
    });
    state.indicatorSeries = {};

    if (state.activeIndicators.has("EMA_20") && data.EMA_20?.length) {
      state.indicatorSeries.EMA_20 = mainChart.addLineSeries({ color: "#f0883e", lineWidth: 1 });
      state.indicatorSeries.EMA_20.setData(data.EMA_20);
    }
    if (state.activeIndicators.has("EMA_50") && data.EMA_50?.length) {
      state.indicatorSeries.EMA_50 = mainChart.addLineSeries({ color: "#bc8cff", lineWidth: 1 });
      state.indicatorSeries.EMA_50.setData(data.EMA_50);
    }
    if (state.activeIndicators.has("BB") && data.BB_upper?.length) {
      state.indicatorSeries.BB_upper  = mainChart.addLineSeries({ color: "#388bfd44", lineWidth: 1 });
      state.indicatorSeries.BB_middle = mainChart.addLineSeries({ color: "#388bfd", lineWidth: 1, lineStyle: 1 });
      state.indicatorSeries.BB_lower  = mainChart.addLineSeries({ color: "#388bfd44", lineWidth: 1 });
      state.indicatorSeries.BB_upper.setData(data.BB_upper);
      state.indicatorSeries.BB_middle.setData(data.BB_middle);
      state.indicatorSeries.BB_lower.setData(data.BB_lower);
    }
    if (state.activeIndicators.has("RSI") && data.RSI_14?.length) {
      toggleSubChart("rsi-chart", true);
      state.indicatorSeries.RSI = rsiChart.addLineSeries({ color: "#f0883e", lineWidth: 1 });
      state.indicatorSeries.RSI.setData(data.RSI_14);
      // Overbought/oversold lines
      state.indicatorSeries.RSI70 = rsiChart.addLineSeries({ color: "#f8514966", lineWidth: 1, lineStyle: 2 });
      state.indicatorSeries.RSI30 = rsiChart.addLineSeries({ color: "#3fb95066", lineWidth: 1, lineStyle: 2 });
      if (data.RSI_14.length) {
        const t1 = data.RSI_14[0].time;
        const t2 = data.RSI_14[data.RSI_14.length - 1].time;
        state.indicatorSeries.RSI70.setData([{time: t1, value: 70}, {time: t2, value: 70}]);
        state.indicatorSeries.RSI30.setData([{time: t1, value: 30}, {time: t2, value: 30}]);
      }
    }
    if (state.activeIndicators.has("MACD") && data.MACD_line?.length) {
      toggleSubChart("macd-chart", true);
      state.indicatorSeries.MACD_line   = macdChart.addLineSeries({ color: "#388bfd", lineWidth: 1 });
      state.indicatorSeries.MACD_signal = macdChart.addLineSeries({ color: "#f0883e", lineWidth: 1 });
      state.indicatorSeries.MACD_hist   = macdChart.addHistogramSeries({ color: "#3fb950" });
      state.indicatorSeries.MACD_line.setData(data.MACD_line);
      state.indicatorSeries.MACD_signal.setData(data.MACD_signal);
      const histColored = data.MACD_histogram.map(p => ({
        ...p,
        color: p.value >= 0 ? "#3fb950" : "#f85149",
      }));
      state.indicatorSeries.MACD_hist.setData(histColored);
    }
  } catch (_) {}
}

function removeIndicatorSeries(ind) {
  const keys = {
    "EMA_20": ["EMA_20"],
    "EMA_50": ["EMA_50"],
    "BB": ["BB_upper", "BB_middle", "BB_lower"],
    "RSI": ["RSI", "RSI70", "RSI30"],
    "MACD": ["MACD_line", "MACD_signal", "MACD_hist"],
  };
  (keys[ind] || []).forEach(k => {
    if (state.indicatorSeries[k]) {
      try { mainChart.removeSeries(state.indicatorSeries[k]); } catch (_) {}
      try { rsiChart.removeSeries(state.indicatorSeries[k]); } catch (_) {}
      try { macdChart.removeSeries(state.indicatorSeries[k]); } catch (_) {}
      delete state.indicatorSeries[k];
    }
  });
}

function toggleSubChart(id, show) {
  const el = document.getElementById(id);
  if (show) el.classList.remove("hidden");
  else el.classList.add("hidden");
  resizeCharts();
}

/* ══════════════════════════════════════════════════════════
   LIVE LTP POLLING
══════════════════════════════════════════════════════════ */
function startLTPPoll(symbol, token, exchange) {
  clearInterval(state.ltpPollTimer);
  state.ltpPollTimer = setInterval(() => pollLTP(symbol, token, exchange), 5000);
  pollLTP(symbol, token, exchange);
}

async function pollLTP(symbol, token, exchange) {
  try {
    const data = await api(`/market/ltp?symbol=${symbol}&token=${token}&exchange=${exchange}`);
    if (data.ltp !== undefined) {
      const ltpEl = document.getElementById("chart-ltp");
      const prevLtp = parseFloat(ltpEl.dataset.prev || data.ltp);
      ltpEl.textContent = fmt(data.ltp);
      ltpEl.dataset.prev = data.ltp;

      const change = data.ltp - (data.close || data.ltp);
      const pct = data.close ? ((change / data.close) * 100) : 0;
      const chgEl = document.getElementById("chart-change");
      chgEl.textContent = `${change >= 0 ? "+" : ""}${fmt(change)} (${pct.toFixed(2)}%)`;
      chgEl.className = "change " + (change >= 0 ? "up" : "down");
      ltpEl.className = "ltp " + (data.ltp >= prevLtp ? "up" : "down");

      // Update watchlist LTP for this symbol
      updateWatchlistLTP(symbol, data.ltp, change);
    }
  } catch (_) {}
}

function updateWatchlistLTP(symbol, ltp, change) {
  const item = document.querySelector(`.wl-item[data-symbol="${symbol}"]`);
  if (!item) return;
  const ltpEl = item.querySelector(".wl-ltp");
  const chgEl = item.querySelector(".wl-chg");
  if (ltpEl) {
    ltpEl.textContent = fmt(ltp);
    ltpEl.className = "wl-ltp " + (change >= 0 ? "up" : "down");
  }
  if (chgEl) {
    chgEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
    chgEl.className = "wl-chg " + (change >= 0 ? "up" : "down");
  }
}

/* ══════════════════════════════════════════════════════════
   WATCHLIST
══════════════════════════════════════════════════════════ */
async function loadWatchlist() {
  try {
    const data = await api("/market/watchlist");
    state.watchlist = data.watchlist || [];
    renderWatchlist();
  } catch (_) {}
}

function renderWatchlist() {
  const ul = document.getElementById("watchlist");
  ul.innerHTML = "";
  state.watchlist.forEach(item => {
    const li = document.createElement("li");
    li.className = "wl-item";
    li.dataset.symbol = item.symbol;
    li.innerHTML = `
      <div>
        <div class="wl-sym">${item.symbol}</div>
        <div class="wl-exch">${item.exchange}</div>
      </div>
      <div style="text-align:right">
        <div class="wl-ltp">--</div>
        <div class="wl-chg">--</div>
      </div>
      <button class="wl-remove" onclick="removeFromWatchlist('${item.symbol}','${item.exchange}',event)">✕</button>
    `;
    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("wl-remove")) return;
      loadChart(item.symbol, item.token, item.exchange);
    });
    ul.appendChild(li);
  });
}

async function removeFromWatchlist(symbol, exchange, e) {
  e.stopPropagation();
  await api("/market/watchlist/remove", "POST", { symbol, exchange });
  state.watchlist = state.watchlist.filter(i => !(i.symbol === symbol && i.exchange === exchange));
  renderWatchlist();
  toast("Removed from watchlist");
}

document.getElementById("add-watchlist-btn").onclick = () => openModal("modal-watchlist");

let wlSearchTimer = null;
function searchWatchlistSymbol() {
  clearTimeout(wlSearchTimer);
  const q = document.getElementById("wl-search-input").value.trim();
  if (q.length < 2) { document.getElementById("wl-search-results").innerHTML = ""; return; }
  wlSearchTimer = setTimeout(() => doWLSearch(q), 300);
}

async function doWLSearch(q) {
  const exch = document.getElementById("wl-exchange").value;
  try {
    const data = await api(`/market/search?q=${encodeURIComponent(q)}&exchange=${exch}`);
    const results = data.results || [];
    const el = document.getElementById("wl-search-results");
    el.innerHTML = results.map(r => `
      <div class="wl-result-item" onclick="addToWatchlist('${r.symbol}','${r.token}','${r.exchange}')">
        <span>${r.symbol}</span>
        <span style="color:var(--text2);font-size:11px">${r.name || ""}</span>
      </div>
    `).join("");
  } catch (_) {}
}

async function addToWatchlist(symbol, token, exchange) {
  const result = await api("/market/watchlist/add", "POST", { symbol, token, exchange });
  if (result.success) {
    closeModal("modal-watchlist");
    toast(`${symbol} added to watchlist`, "success");
    state.watchlist.push({ symbol, token, exchange });
    renderWatchlist();
  } else {
    toast(result.error || "Failed", "error");
  }
}

/* ══════════════════════════════════════════════════════════
   ORDER FORM
══════════════════════════════════════════════════════════ */
// Side toggle
document.querySelectorAll(".o-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".o-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.side = btn.dataset.side;
    const placeBtn = document.getElementById("place-order-btn");
    placeBtn.style.background = state.side === "BUY" ? "#3fb950" : "#f85149";
    placeBtn.textContent = state.side === "BUY" ? "▲ PLACE BUY ORDER" : "▼ PLACE SELL ORDER";
  });
});

document.getElementById("place-order-btn").addEventListener("click", showOrderConfirm);

document.getElementById("quick-buy-btn").addEventListener("click", () => {
  setOrderSide("BUY");
  showOrderConfirm();
});
document.getElementById("quick-sell-btn").addEventListener("click", () => {
  setOrderSide("SELL");
  showOrderConfirm();
});

function setOrderSide(side) {
  state.side = side;
  document.querySelectorAll(".o-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.side === side);
  });
}

function showOrderConfirm() {
  const sym = document.getElementById("order-symbol").value;
  const qty = document.getElementById("order-qty").value;
  const price = document.getElementById("order-price").value || "Market";
  const otype = document.getElementById("order-type").value;
  const product = document.getElementById("order-product").value;

  if (!sym) { toast("Select a symbol first", "error"); return; }

  const confirmBody = document.getElementById("order-confirm-body");
  const color = state.side === "BUY" ? "#3fb950" : "#f85149";
  confirmBody.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="color:var(--text2);padding:6px 0">Action</td>
          <td style="color:${color};font-weight:700;font-size:16px">${state.side}</td></tr>
      <tr><td style="color:var(--text2);padding:6px 0">Symbol</td><td><b>${sym}</b></td></tr>
      <tr><td style="color:var(--text2);padding:6px 0">Order Type</td><td>${otype}</td></tr>
      <tr><td style="color:var(--text2);padding:6px 0">Product</td><td>${product}</td></tr>
      <tr><td style="color:var(--text2);padding:6px 0">Quantity</td><td>${qty}</td></tr>
      <tr><td style="color:var(--text2);padding:6px 0">Price</td><td>${price}</td></tr>
    </table>
  `;
  document.getElementById("confirm-place-btn").onclick = placeOrder;
  openModal("modal-order");
}

async function placeOrder() {
  closeModal("modal-order");
  const payload = {
    symbol: document.getElementById("order-symbol").value,
    token: document.getElementById("order-token").value,
    exchange: document.getElementById("order-exchange").value,
    transaction_type: state.side,
    quantity: parseInt(document.getElementById("order-qty").value),
    order_type: document.getElementById("order-type").value,
    product_type: document.getElementById("order-product").value,
    price: parseFloat(document.getElementById("order-price").value || 0),
    trigger_price: parseFloat(document.getElementById("order-trigger").value || 0),
  };

  try {
    const result = await api("/execution/place", "POST", payload);
    if (result.error && !result.local_order_id) {
      toast(result.error, "error");
    } else {
      toast(`Order placed! ID: ${result.broker_order_id || result.local_order_id}`, "success");
      setTimeout(refreshOrders, 500);
    }
  } catch (e) {
    toast("Order failed: " + e.message, "error");
  }
}

/* ══════════════════════════════════════════════════════════
   RISK CALCULATOR
══════════════════════════════════════════════════════════ */
async function calculateRisk() {
  const ltpText = document.getElementById("chart-ltp").textContent;
  const entry = parseFloat(ltpText.replace(/,/g, "")) || 0;
  const sl = parseFloat(document.getElementById("risk-sl").value || 2);
  const target = parseFloat(document.getElementById("risk-target").value || 5);

  if (!entry) { document.getElementById("risk-result").innerHTML = "Load a chart first"; return; }

  const result = await api("/risk/calculate", "POST", {
    entry_price: entry,
    sl_percent: sl,
    target_percent: target,
    transaction_type: state.side,
  });

  document.getElementById("risk-result").innerHTML = `
    SL:       ${fmt(result.stoploss_price)}<br>
    Target:   ${fmt(result.target_price)}<br>
    Qty:      ${result.quantity}<br>
    Risk:     ₹${fmt(result.risk_amount)}<br>
    Reward:   ₹${fmt(result.reward_amount)}<br>
    R:R       1 : ${result.risk_reward_ratio}
  `;

  // Auto-fill order form
  document.getElementById("order-qty").value = result.quantity;
  document.getElementById("order-trigger").value = result.stoploss_price;
}

/* ══════════════════════════════════════════════════════════
   POSITIONS / ORDERS / HOLDINGS
══════════════════════════════════════════════════════════ */
async function refreshPositions() {
  try {
    const data = await api("/execution/positions");
    const tbody = document.getElementById("positions-body");
    const positions = data.positions || [];
    tbody.innerHTML = positions.map(p => {
      const pnl = parseFloat(p.unrealised || p.pnl || 0);
      const qty = parseInt(p.netqty || p.quantity || 0);
      return `<tr>
        <td>${p.tradingsymbol || p.symbol}</td>
        <td>${qty}</td>
        <td>${fmt(p.netavgprice || p.average_price)}</td>
        <td>${fmt(p.ltp)}</td>
        <td class="${pnl >= 0 ? "text-green" : "text-red"}">${fmt(pnl)}</td>
        <td>
          <button class="small-btn" onclick="squareOff('${p.tradingsymbol||p.symbol}','${p.symboltoken||""}',${Math.abs(qty)},'${"BUY"===(p.buyqty>0?"BUY":"SELL")?"SELL":"BUY"}')">Exit</button>
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:16px">No open positions</td></tr>`;

    // Update portfolio total
    const totalPnL = positions.reduce((s, p) => s + parseFloat(p.unrealised || p.pnl || 0), 0);
    document.getElementById("total-pnl").textContent = `Total P&L: ${totalPnL >= 0 ? "+" : ""}₹${fmt(totalPnL)}`;
    document.getElementById("total-pnl").className = `pnl-total ${totalPnL >= 0 ? "text-green" : "text-red"}`;
    document.getElementById("port-pnl").textContent = `₹${fmt(totalPnL)}`;
    document.getElementById("port-pnl").className = `val ${totalPnL >= 0 ? "text-green" : "text-red"}`;
    document.getElementById("port-positions").textContent = positions.length;
  } catch (e) {
    console.error("positions error", e);
  }
}

async function squareOff(symbol, token, qty, side) {
  if (!confirm(`Exit ${symbol} (${qty} qty)?`)) return;
  const result = await api("/execution/place", "POST", {
    symbol, token, exchange: state.exchange,
    transaction_type: side,
    quantity: qty,
    order_type: "MARKET",
    product_type: "INTRADAY",
    price: 0,
  });
  toast(result.error || `Exit order placed for ${symbol}`, result.error ? "error" : "success");
  setTimeout(refreshPositions, 1000);
}

async function refreshOrders() {
  try {
    const data = await api("/execution/orderbook");
    const orders = data.orders || [];
    const tbody = document.getElementById("orders-body");
    tbody.innerHTML = orders.map(o => `
      <tr>
        <td>${(o.updatetime || o.ordertime || "").slice(0, 19)}</td>
        <td>${o.tradingsymbol}</td>
        <td class="${o.transactiontype==='BUY'?'text-green':'text-red'}">${o.transactiontype} ${o.ordertype}</td>
        <td>${o.quantity}</td>
        <td>${fmt(o.price || 0)}</td>
        <td class="${statusColor(o.status)}">${o.status}</td>
        <td>${o.status === "open" || o.status === "pending" ? `<button class="small-btn" onclick="cancelOrder('${o.orderid}')">Cancel</button>` : ""}</td>
      </tr>
    `).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:16px">No orders today</td></tr>`;
    document.getElementById("port-orders").textContent = orders.filter(o => o.status === "open").length;
  } catch (_) {}
}

async function cancelOrder(orderId) {
  if (!confirm("Cancel this order?")) return;
  const result = await api("/execution/cancel", "POST", { broker_order_id: orderId });
  toast(result.error || "Order cancelled", result.error ? "error" : "success");
  setTimeout(refreshOrders, 500);
}

async function refreshHoldings() {
  try {
    const data = await api("/execution/holdings");
    const holdings = data.holdings || [];
    const tbody = document.getElementById("holdings-body");
    tbody.innerHTML = holdings.map(h => {
      const pnl = parseFloat(h.profitandloss || 0);
      return `<tr>
        <td>${h.tradingsymbol}</td>
        <td>${h.quantity}</td>
        <td>${fmt(h.averageprice)}</td>
        <td>${fmt(h.ltp)}</td>
        <td class="${pnl >= 0 ? "text-green" : "text-red"}">${fmt(pnl)}</td>
        <td class="${pnl >= 0 ? "text-green" : "text-red"}">${(parseFloat(h.pnlpercentage || 0)).toFixed(2)}%</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:16px">No holdings</td></tr>`;
  } catch (_) {}
}

function statusColor(s) {
  const map = { complete: "text-green", cancelled: "text-red", rejected: "text-red", open: "text-yellow" };
  return map[(s || "").toLowerCase()] || "";
}

/* ══════════════════════════════════════════════════════════
   STRATEGIES
══════════════════════════════════════════════════════════ */
let conditionCount = 0;

function openStrategyBuilder() {
  conditionCount = 0;
  document.getElementById("conditions-list").innerHTML = "";
  document.getElementById("sb-msg").textContent = "";
  document.getElementById("sb-name").value = "";
  document.getElementById("sb-symbol").value = state.symbol || "";
  addConditionRow();
  openModal("modal-strategy");
}

function addConditionRow() {
  conditionCount++;
  const id = conditionCount;
  const row = document.createElement("div");
  row.className = "condition-row";
  row.id = `cond-${id}`;
  row.innerHTML = `
    <select id="cind-${id}">
      <option value="RSI">RSI</option>
      <option value="EMA">EMA</option>
      <option value="SMA">SMA</option>
      <option value="MACD">MACD</option>
    </select>
    <input type="number" id="cperiod-${id}" value="14" min="1" max="200" style="width:60px" placeholder="Period">
    <select id="cop-${id}">
      <option value="<">&lt;</option>
      <option value=">">&gt;</option>
      <option value="<=">&lt;=</option>
      <option value=">=">&gt;=</option>
      <option value="crosses_above">Crosses ↑</option>
      <option value="crosses_below">Crosses ↓</option>
    </select>
    <input type="number" id="cval-${id}" placeholder="Value (e.g. 30)" style="width:100px">
    <span style="color:var(--text2);font-size:11px">or compare to:</span>
    <select id="ccmpind-${id}">
      <option value="">-- none --</option>
      <option value="EMA">EMA</option>
      <option value="SMA">SMA</option>
    </select>
    <input type="number" id="ccmpperiod-${id}" placeholder="Period" style="width:60px">
    <button class="small-btn" onclick="document.getElementById('cond-${id}').remove()" style="color:var(--red)">✕</button>
  `;
  document.getElementById("conditions-list").appendChild(row);
  updateStrategyJSON();
  row.querySelectorAll("select, input").forEach(el => el.addEventListener("change", updateStrategyJSON));
}

function buildStrategyLogic() {
  const conditions = [];
  document.querySelectorAll(".condition-row").forEach(row => {
    const id = row.id.split("-")[1];
    const ind = document.getElementById(`cind-${id}`)?.value;
    const period = parseInt(document.getElementById(`cperiod-${id}`)?.value || 14);
    const op = document.getElementById(`cop-${id}`)?.value;
    const val = document.getElementById(`cval-${id}`)?.value;
    const cmpInd = document.getElementById(`ccmpind-${id}`)?.value;
    const cmpPeriod = parseInt(document.getElementById(`ccmpperiod-${id}`)?.value || 20);

    const cond = { indicator: ind, period, operator: op };
    if (val) cond.value = parseFloat(val);
    if (cmpInd) { cond.compare_indicator = cmpInd; cond.compare_period = cmpPeriod; }
    conditions.push(cond);
  });

  return {
    conditions,
    action: document.getElementById("sb-action").value,
    stoploss: parseFloat(document.getElementById("sb-sl").value || 2),
    target: parseFloat(document.getElementById("sb-target").value || 5),
    quantity: parseInt(document.getElementById("sb-qty").value || 1),
    product_type: document.getElementById("sb-product").value,
  };
}

function updateStrategyJSON() {
  const logic = buildStrategyLogic();
  document.getElementById("strategy-json-preview").textContent = JSON.stringify(logic, null, 2);
}

async function saveStrategy() {
  const name = document.getElementById("sb-name").value.trim();
  const symbol = document.getElementById("sb-symbol").value.trim().toUpperCase();
  if (!name || !symbol) {
    document.getElementById("sb-msg").textContent = "Name and symbol are required";
    document.getElementById("sb-msg").className = "msg error";
    return;
  }

  const logic = buildStrategyLogic();
  const result = await api("/strategy/save", "POST", {
    name, symbol,
    exchange: document.getElementById("sb-exchange").value,
    timeframe: document.getElementById("sb-timeframe").value,
    logic,
  });

  if (result.error) {
    document.getElementById("sb-msg").textContent = result.error;
    document.getElementById("sb-msg").className = "msg error";
  } else {
    document.getElementById("sb-msg").textContent = "Strategy saved!";
    document.getElementById("sb-msg").className = "msg success";
    setTimeout(() => { closeModal("modal-strategy"); loadStrategies(); }, 1200);
  }
}

async function loadStrategies() {
  const data = await api("/strategy/list");
  const list = document.getElementById("strategies-list");
  const strategies = data.strategies || [];
  list.innerHTML = strategies.map(s => `
    <div class="strategy-card">
      <div class="strategy-card-header">
        <div>
          <span class="strategy-name">${s.strategy_name}</span>
          <span class="strategy-meta"> · ${s.symbol} · ${s.timeframe}</span>
        </div>
        <div class="strategy-actions">
          <button class="toggle-btn ${s.active_status ? 'active' : 'inactive'}"
            onclick="toggleStrategy(${s.id})">
            ${s.active_status ? "● Active" : "○ Inactive"}
          </button>
          <button class="small-btn" onclick="evaluateStrategy(${s.id})">Run</button>
          <button class="small-btn" style="color:var(--red)" onclick="deleteStrategy(${s.id})">✕</button>
        </div>
      </div>
      <div class="strategy-meta">
        ${s.strategy_logic.conditions?.length || 0} conditions ·
        ${s.strategy_logic.action} · SL: ${s.strategy_logic.stoploss}% · TP: ${s.strategy_logic.target}%
      </div>
    </div>
  `).join("") || `<div style="padding:16px;color:var(--text2);text-align:center">No strategies yet. Create one!</div>`;
}

async function toggleStrategy(id) {
  const result = await api(`/strategy/toggle/${id}`, "POST", {});
  toast(result.active ? "Strategy activated" : "Strategy paused", "success");
  loadStrategies();
}

async function deleteStrategy(id) {
  if (!confirm("Delete this strategy?")) return;
  await api(`/strategy/delete/${id}`, "DELETE");
  toast("Strategy deleted");
  loadStrategies();
}

async function evaluateStrategy(id) {
  const token = state.token || "";
  const data = await api(`/strategy/evaluate/${id}?token=${token}&exchange=${state.exchange}`);
  if (data.error) {
    toast(data.error, "error");
  } else {
    const signal = data.signal ? `🟢 Signal: ${data.signal}` : "⚪ No signal";
    toast(`${data.strategy_name}: ${signal} — ${data.reason}`, data.signal ? "success" : "");
  }
}

/* ══════════════════════════════════════════════════════════
   BOTTOM TABS
══════════════════════════════════════════════════════════ */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`).classList.remove("hidden");

    if (tab === "positions") refreshPositions();
    else if (tab === "orders") refreshOrders();
    else if (tab === "holdings") refreshHoldings();
    else if (tab === "strategies") loadStrategies();
  });
});

/* ══════════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════════ */
function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

document.getElementById("broker-connect-btn").onclick = () => openModal("modal-broker");

document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.add("hidden");
  });
});

/* ══════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════════════════════════════ */
let toastTimer = null;
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

/* ══════════════════════════════════════════════════════════
   API HELPER
══════════════════════════════════════════════════════════ */
async function api(url, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

/* ══════════════════════════════════════════════════════════
   FORMATTING
══════════════════════════════════════════════════════════ */
function fmt(n) {
  if (n === undefined || n === null || n === "" || n === "--") return "--";
  return parseFloat(n).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
(async function init() {
  await checkBrokerStatus();
  await loadWatchlist();
  resizeCharts();
})();
