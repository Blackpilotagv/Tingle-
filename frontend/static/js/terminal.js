/**
 * Tingle Trade Terminal
 * Handles: symbol search, chart, watchlist, orders, positions, strategy builder, broker panel.
 */

// ═══ STATE ═══════════════════════════════════════════════════════════════════
const S = {
  symbol:    null,
  exchange:  "NSE",
  timeframe: "5m",
  side:      "BUY",
  chart:     null,
  series:    { candle:null, ema20:null, ema50:null, bbU:null, bbL:null },
  rsiChart:  null, rsiSeries: null,
  macdChart: null, macdSeries:null, macdSig:null,
  indicators:{ EMA20:false, EMA50:false, BB:false, RSI:false, MACD:false },
  pollTimer: null,
  ltpTimer:  null,
  searchTimer: null,
  lastCandle: null,
};

// ═══ INIT ════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  initChart();
  loadWatchlist();
  checkBrokerStatus();
  loadStrategies();
  setupSearch();
  setOrderSide("BUY", document.querySelector(".otab"));
});

// ═══ SYMBOL SEARCH ════════════════════════════════════════════════════════════
function setupSearch() {
  const input = document.getElementById("symbolSearch");
  const dropdown = document.getElementById("searchDropdown");

  input.addEventListener("input", () => {
    clearTimeout(S.searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { dropdown.classList.add("hidden"); return; }
    S.searchTimer = setTimeout(() => doSearch(q), 300);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { dropdown.classList.add("hidden"); input.value = ""; }
    if (e.key === "Enter") {
      const first = dropdown.querySelector(".search-item");
      if (first) first.click();
    }
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".search-wrap")) dropdown.classList.add("hidden");
  });
}

async function doSearch(q) {
  const exchange = document.getElementById("exchangeSel").value;
  const dropdown = document.getElementById("searchDropdown");
  dropdown.innerHTML = `<div class="search-loading">Searching…</div>`;
  dropdown.classList.remove("hidden");

  try {
    const resp = await fetch(`/market/search?q=${encodeURIComponent(q)}&exchange=${exchange}`);
    const data = await resp.json();

    if (data.error) {
      dropdown.innerHTML = `<div class="search-error">⚠ ${data.error}</div>`;
      return;
    }
    const results = data.results || [];
    if (!results.length) {
      dropdown.innerHTML = `<div class="search-empty">No results for "${q}"</div>`;
      return;
    }

    dropdown.innerHTML = results.slice(0, 12).map(r => {
      const inWL = !!document.querySelector(`.wl-item[data-sym="${r.tradingsymbol}"]`);
      return `
        <div class="search-item" 
             data-sym="${r.tradingsymbol}" 
             data-exch="${r.exchange}" 
             data-token="${r.symboltoken}"
             onclick="selectFromSearch(this, event)">
          <div class="si-left">
            <span class="si-sym">${r.tradingsymbol}</span>
            <span class="si-exch">${r.exchange}</span>
            <span class="si-name">${r.name || ""}</span>
          </div>
          <button class="si-add-btn ${inWL ? 'added' : ''}" 
                  onclick="addSymbolToWatchlistDirect('${r.tradingsymbol}', '${r.exchange}', '${r.symboltoken}', this, event)"
                  ${inWL ? 'disabled' : ''}>
            ${inWL ? '✓ Added' : '+ Add'}
          </button>
        </div>
      `;
    }).join("");
  } catch(e) {
    dropdown.innerHTML = `<div class="search-error">Search failed</div>`;
  }
}

function selectFromSearch(el, e) {
  if (e && e.target.closest(".si-add-btn")) return;
  const sym   = el.dataset.sym;
  const exch  = el.dataset.exch;
  const token = el.dataset.token;

  document.getElementById("searchDropdown").classList.add("hidden");
  document.getElementById("symbolSearch").value = "";

  selectSymbol(sym, exch, token);
}

async function addSymbolToWatchlistDirect(symbol, exchange, token, btnEl, e) {
  if (e) e.stopPropagation();

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "Adding…";
  }

  try {
    const resp = await fetch("/market/watchlist/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: symbol,
        exchange: exchange || "NSE",
        token: token || ""
      })
    });
    const data = await resp.json();

    if (data.success) {
      if (!document.querySelector(`.wl-item[data-sym="${symbol}"]`)) {
        addWatchlistRow(symbol, exchange || "NSE", token);
      }
      if (btnEl) {
        btnEl.textContent = "✓ Added";
        btnEl.className = "si-add-btn added";
        btnEl.disabled = true;
      }
      showOrderToast(`✅ ${symbol} added to watchlist`, "success");
    } else {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = "+ Add";
      }
      alert(data.error || "Failed to add to watchlist");
    }
  } catch(err) {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "+ Add";
    }
    alert("Request failed: " + err.message);
  }
}

// ═══ CHART INIT ══════════════════════════════════════════════════════════════
function initChart() {
  const el = document.getElementById("mainChart");

  const istTickFormatter = (time, tickType) => {
    const date = new Date(time * 1000);
    if (tickType === 0 || tickType === 1) {
      return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', year: '2-digit' });
    } else if (tickType === 2) {
      return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
    } else {
      return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
    }
  };

  S.chart = LightweightCharts.createChart(el, {
    layout: { background:{color:"#0d0d0d"}, textColor:"#888" },
    grid:   { vertLines:{color:"#1a1a1a"}, horzLines:{color:"#1a1a1a"} },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor:"#2a2a2a", scaleMargins: { top: 0.1, bottom: 0.25 } },
    timeScale: {
      borderColor: "#2a2a2a",
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 12,
      barSpacing: 8,
      minBarSpacing: 0.5,
      fixLeftEdge: false,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: false,
      rightBarStaysOnScroll: false,
      tickMarkFormatter: istTickFormatter,
    },
    localization: {
      locale: 'en-IN',
      timeFormatter: (time) => {
        const date = new Date(time * 1000);
        return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' +
               date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
      },
      dateFormatter: (time) => {
        const date = new Date(time * 1000);
        return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
      }
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  S.series.candle = S.chart.addCandlestickSeries({
    upColor: "#2ecc71", downColor: "#ff4757",
    borderUpColor: "#2ecc71", borderDownColor: "#ff4757",
    wickUpColor: "#2ecc71", wickDownColor: "#ff4757",
  });

  S.series.volume = S.chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  S.series.ema20 = S.chart.addLineSeries({ color:"#e67e22", lineWidth:1.5, visible:false, title:"EMA 20" });
  S.series.ema50 = S.chart.addLineSeries({ color:"#9b59b6", lineWidth:1.5, visible:false, title:"EMA 50" });
  S.series.bbU   = S.chart.addLineSeries({ color:"#3498db", lineWidth:1,   visible:false, title:"BB Upper", lineStyle:2 });
  S.series.bbL   = S.chart.addLineSeries({ color:"#3498db", lineWidth:1,   visible:false, title:"BB Lower", lineStyle:2 });

  // RSI sub-chart
  const rsiEl = document.getElementById("rsiChart");
  S.rsiChart  = LightweightCharts.createChart(rsiEl, subOpts());
  S.rsiSeries = S.rsiChart.addLineSeries({ color:"#e67e22", lineWidth:1.5, title:"RSI (14)" });

  // MACD sub-chart
  const macdEl = document.getElementById("macdChart");
  S.macdChart  = LightweightCharts.createChart(macdEl, subOpts());
  S.macdSeries = S.macdChart.addLineSeries({ color:"#3498db", lineWidth:1.5, title:"MACD" });
  S.macdSig    = S.macdChart.addLineSeries({ color:"#e74c3c", lineWidth:1,   title:"Signal" });

  // Sync time axis
  S.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (range) {
      S.rsiChart?.timeScale().setVisibleLogicalRange(range);
      S.macdChart?.timeScale().setVisibleLogicalRange(range);
    }
  });

  new ResizeObserver(() => {
    S.chart?.applyOptions({ width: el.clientWidth, height: el.clientHeight });
  }).observe(el);

  showChartPlaceholder();
}

function subOpts() {
  const istTickFormatter = (time, tickType) => {
    const date = new Date(time * 1000);
    if (tickType === 0 || tickType === 1) {
      return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', year: '2-digit' });
    } else if (tickType === 2) {
      return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
    } else {
      return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
    }
  };

  return {
    layout: { background:{color:"#0d0d0d"}, textColor:"#888" },
    grid:   { vertLines:{color:"#1a1a1a"}, horzLines:{color:"#1a1a1a"} },
    rightPriceScale: { borderColor:"#2a2a2a" },
    timeScale: {
      borderColor: "#2a2a2a",
      timeVisible: true,
      rightOffset: 12,
      barSpacing: 8,
      minBarSpacing: 0.5,
      fixLeftEdge: false,
      fixRightEdge: false,
      tickMarkFormatter: istTickFormatter,
    },
    localization: {
      locale: 'en-IN',
      timeFormatter: (time) => {
        const date = new Date(time * 1000);
        return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' +
               date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
      }
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  };
}

function showChartPlaceholder() {
  document.getElementById("chartPlaceholder").classList.remove("hidden");
}

function hideChartPlaceholder() {
  document.getElementById("chartPlaceholder").classList.add("hidden");
}

// ═══ SYMBOL SELECT + LOAD CHART ══════════════════════════════════════════════
function selectSymbol(symbol, exchange, token) {
  S.symbol   = symbol.toUpperCase();
  S.exchange = exchange || document.getElementById("exchangeSel").value;
  S.isFirstLoad = true;

  document.getElementById("chartSymbol").textContent   = S.symbol;
  document.getElementById("chartExchange").textContent = S.exchange;
  document.getElementById("orderSymbol").textContent   = S.symbol;
  document.getElementById("orderExchange").textContent = S.exchange;
  document.getElementById("chartLoading").classList.remove("hidden");
  hideChartPlaceholder();

  // Highlight watchlist
  document.querySelectorAll(".wl-item").forEach(el =>
    el.classList.toggle("active", el.dataset.sym === S.symbol)
  );

  loadChartData();
  startLTPPoll();
  stopChartPoll();
  startChartPoll();
}

async function loadChartData(isPoll = false) {
  if (!S.symbol) return;
  setTFButtonActive(S.timeframe);

  if (!isPoll) {
    document.getElementById("chartLoading").classList.remove("hidden");
  }

  try {
    const resp = await fetch(
      `/market/candles/${S.symbol}?timeframe=${S.timeframe}&exchange=${S.exchange}`
    );
    const data = await resp.json();
    if (!isPoll) {
      document.getElementById("chartLoading").classList.add("hidden");
    }

    if (data.error) {
      if (!isPoll) showChartError(data.error);
      return;
    }

    const candles = data.candles || [];
    if (!candles.length) {
      if (!isPoll) showChartError("No candle data returned. Market may be closed.");
      return;
    }

    // Guarantee past candles on left -> live candle on right
    candles.sort((a, b) => a.time - b.time);

    S.series.candle.setData(candles);

    // Set Volume Histogram
    if (S.series.volume) {
      const volumeData = candles.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)'
      }));
      S.series.volume.setData(volumeData);
    }

    if (!isPoll || S.isFirstLoad) {
      S.chart.timeScale().scrollToRealTime();
      S.isFirstLoad = false;
    }
    document.getElementById("chartError").classList.add("hidden");

    // Update last candle stats in toolbar & state for live 1-sec tick updates
    const last = candles[candles.length - 1];
    S.lastCandle = last ? { ...last } : null;
    updateCandleStats(last);

    // Load indicators if enabled
    const anyOn = Object.values(S.indicators).some(Boolean);
    if (anyOn) loadIndicators(candles);

  } catch(e) {
    if (!isPoll) {
      document.getElementById("chartLoading").classList.add("hidden");
      showChartError("Chart fetch failed: " + e.message);
    }
  }
}

function showChartError(msg) {
  const el = document.getElementById("chartError");
  el.textContent = "⚠ " + msg;
  el.classList.remove("hidden");
}

function updateCandleStats(c) {
  if (!c) return;
  document.getElementById("candleO").textContent = `O: ${c.open?.toFixed(2)}`;
  document.getElementById("candleH").textContent = `H: ${c.high?.toFixed(2)}`;
  document.getElementById("candleL").textContent = `L: ${c.low?.toFixed(2)}`;
  document.getElementById("candleC").textContent = `C: ${c.close?.toFixed(2)}`;
}

async function loadIndicators(candles) {
  if (!S.symbol) return;
  try {
    const resp = await fetch(
      `/strategy/indicators/${S.symbol}?timeframe=${S.timeframe}&exchange=${S.exchange}`
    );
    const data = await resp.json();
    if (data.error || !data.indicators) return;
    const inds = data.indicators;

    const toSeries = (arr) =>
      (arr || [])
        .map((v, i) => (v !== null && v !== undefined && candles[i])
          ? { time: candles[i].time, value: parseFloat(v) } : null)
        .filter(Boolean);

    if (S.indicators.EMA20) S.series.ema20.setData(toSeries(inds.ema20));
    if (S.indicators.EMA50) S.series.ema50.setData(toSeries(inds.ema50));
    if (S.indicators.BB && inds.bb) {
      S.series.bbU.setData(toSeries(inds.bb.upper));
      S.series.bbL.setData(toSeries(inds.bb.lower));
    }
    if (S.indicators.RSI && inds.rsi14) {
      S.rsiSeries.setData(toSeries(inds.rsi14));
    }
    if (S.indicators.MACD && inds.macd) {
      S.macdSeries.setData(toSeries(inds.macd.macd));
      if (S.macdSig) S.macdSig.setData(toSeries(inds.macd.signal));
    }
  } catch(e) { console.warn("Indicator load failed:", e); }
}

function toggleIndicator(name) {
  S.indicators[name] = !S.indicators[name];
  const on = S.indicators[name];
  if (name === "EMA20") S.series.ema20.applyOptions({ visible: on });
  if (name === "EMA50") S.series.ema50.applyOptions({ visible: on });
  if (name === "BB") {
    S.series.bbU.applyOptions({ visible: on });
    S.series.bbL.applyOptions({ visible: on });
  }
  if (name === "RSI") {
    document.getElementById("rsiChart").classList.toggle("hidden", !on);
  }
  if (name === "MACD") {
    document.getElementById("macdChart").classList.toggle("hidden", !on);
  }
  if (on && S.symbol) {
    fetch(`/market/candles/${S.symbol}?timeframe=${S.timeframe}&exchange=${S.exchange}`)
      .then(r => r.json())
      .then(d => { if (d.candles) loadIndicators(d.candles); });
  }
}

function setTF(tf) {
  S.timeframe = tf;
  setTFButtonActive(tf);
  if (S.symbol) {
    document.getElementById("chartLoading").classList.remove("hidden");
    loadChartData();
  }
}

function setTFButtonActive(tf) {
  document.querySelectorAll(".tf-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tf === tf)
  );
}

function startChartPoll() {
  stopChartPoll();
  S.pollTimer = setInterval(() => { if (S.symbol) loadChartData(true); }, 3000); // 3-sec candle poll
}
function stopChartPoll() { clearInterval(S.pollTimer); }

// ═══ LTP POLL (1 SECOND) ══════════════════════════════════════════════════════
function startLTPPoll() {
  clearInterval(S.ltpTimer);
  fetchLTP();
  S.ltpTimer = setInterval(fetchLTP, 1000); // 1-second live LTP & chart update
}

async function fetchLTP() {
  if (!S.symbol) return;
  try {
    const resp = await fetch(`/market/ltp/${S.symbol}?exchange=${S.exchange}`);
    const data = await resp.json();
    if (data.error) return;

    const ltp   = parseFloat(data.ltp || 0);
    const close = parseFloat(data.close || ltp) || ltp;
    const chg   = close ? ((ltp - close) / close * 100) : 0;
    const cls   = chg > 0 ? "chg-up" : chg < 0 ? "chg-dn" : "chg-flat";
    const sign  = chg > 0 ? "+" : "";

    document.getElementById("ltpValue").textContent  = `₹${ltp.toFixed(2)}`;
    document.getElementById("ltpChange").textContent = `${sign}${chg.toFixed(2)}%`;
    document.getElementById("ltpChange").className   = cls;
    document.getElementById("ohlcBar").textContent =
      `O:${data.open?.toFixed(2)} H:${data.high?.toFixed(2)} L:${data.low?.toFixed(2)}`;

    updateWatchlistLTP(S.symbol, ltp, chg.toFixed(2), cls);
    calcRisk(ltp);

    // Update active chart candle bar in real-time every 1 second
    if (S.series.candle && S.lastCandle && ltp > 0) {
      S.lastCandle.high  = Math.max(S.lastCandle.high, ltp);
      S.lastCandle.low   = Math.min(S.lastCandle.low, ltp);
      S.lastCandle.close = ltp;
      S.series.candle.update({
        time:  S.lastCandle.time,
        open:  S.lastCandle.open,
        high:  S.lastCandle.high,
        low:   S.lastCandle.low,
        close: S.lastCandle.close,
      });
      if (S.series.volume) {
        S.series.volume.update({
          time: S.lastCandle.time,
          value: S.lastCandle.volume || 0,
          color: S.lastCandle.close >= S.lastCandle.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)'
        });
      }
      updateCandleStats(S.lastCandle);
    }
  } catch(e) {}
}

// ═══ WATCHLIST ═══════════════════════════════════════════════════════════════
async function loadWatchlist() {
  try {
    const resp = await fetch("/market/watchlist");
    const data = await resp.json();
    const items = data.watchlist || [];
    document.getElementById("watchlistItems").innerHTML = "";
    items.forEach(item =>
      addWatchlistRow(item.symbol, item.exchange, item.token)
    );

    // Auto-select symbol & auto-load chart on login if no symbol is selected
    if (!S.symbol) {
      if (items.length > 0) {
        selectSymbol(items[0].symbol, items[0].exchange || "NSE", items[0].token);
      } else {
        selectSymbol("RELIANCE", "NSE", "");
      }
    }
  } catch(e) {
    if (!S.symbol) selectSymbol("RELIANCE", "NSE", "");
  }
}

function addWatchlistRow(symbol, exchange, token) {
  const el = document.getElementById("watchlistItems");
  const div = document.createElement("div");
  div.className   = "wl-item";
  div.dataset.sym  = symbol;
  div.dataset.exch = exchange || "NSE";
  div.dataset.token = token || "";
  div.innerHTML = `
    <div class="wl-info">
      <div class="wl-sym">${symbol}</div>
      <div class="wl-exch">${exchange || "NSE"}</div>
    </div>
    <div class="wl-right">
      <div class="wl-price">
        <div class="wl-ltp-val" id="ltp-${symbol}">–</div>
        <div class="wl-chg"    id="chg-${symbol}">–</div>
      </div>
      <button class="wl-remove" onclick="removeFromWatchlist('${symbol}',event)" title="Remove symbol">×</button>
    </div>
  `;
  div.addEventListener("click", e => {
    if (e.target.classList.contains("wl-remove")) return;
    selectSymbol(symbol, exchange || "NSE", token);
  });
  el.appendChild(div);
}

function updateWatchlistLTP(symbol, ltp, chg, cls) {
  const lEl = document.getElementById(`ltp-${symbol}`);
  const cEl = document.getElementById(`chg-${symbol}`);
  if (lEl) lEl.textContent = `₹${ltp.toFixed(2)}`;
  if (cEl) { cEl.textContent = `${chg > 0 ? "+" : ""}${chg}%`; cEl.className = `wl-chg ${cls}`; }
}

function openAddSymbol()  {
  document.getElementById("addSymbolBar").classList.remove("hidden");
  document.getElementById("newSymbol").focus();
}
function closeAddSymbol() { document.getElementById("addSymbolBar").classList.add("hidden"); }

async function addToWatchlist() {
  const sym    = document.getElementById("newSymbol").value.trim().toUpperCase();
  const exchange = document.getElementById("exchangeSel").value;
  if (!sym) return;

  // Search to get the token first
  const sr = await fetch(`/market/search?q=${sym}&exchange=${exchange}`);
  const sd = await sr.json();
  const match = (sd.results || []).find(r => r.tradingsymbol === sym) || (sd.results || [])[0];

  const resp = await fetch("/market/watchlist/add", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: sym, exchange: exchange,
      token: match?.symboltoken || ""
    })
  });
  const data = await resp.json();
  if (data.success) {
    addWatchlistRow(sym, exchange, match?.symboltoken);
    closeAddSymbol();
    document.getElementById("newSymbol").value = "";
  } else {
    alert(data.error || "Failed to add");
  }
}

async function removeFromWatchlist(symbol, e) {
  e.stopPropagation();
  await fetch("/market/watchlist/remove", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol })
  });
  document.querySelector(`.wl-item[data-sym="${symbol}"]`)?.remove();
}

// ═══ EXPANDABLE RIGHT PANEL & TABS ═════════════════════════════════════════════
let currentRightTab = null;

function toggleRightPanel(tabName) {
  const panel = document.getElementById("rightExpandedPanel");
  if (!panel) return;
  const buttons = document.querySelectorAll(".r-icon-btn");

  if (tabName === "portfolio") tabName = "holdings";
  if (tabName === "order-form") tabName = "order-ticket";

  if (currentRightTab === tabName && !panel.classList.contains("hidden")) {
    closeRightPanel();
    return;
  }

  currentRightTab = tabName;
  panel.classList.remove("hidden");

  buttons.forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });

  document.querySelectorAll(".rp-content").forEach(el => el.classList.add("hidden"));

  const titleEl = document.getElementById("rightPanelTitle");

  if (tabName === "positions") {
    if (titleEl) titleEl.textContent = "Positions";
    document.getElementById("rp-positions")?.classList.remove("hidden");
    loadPositions();
  } else if (tabName === "orders") {
    if (titleEl) titleEl.textContent = "Orders";
    document.getElementById("rp-orders")?.classList.remove("hidden");
    loadOrders();
  } else if (tabName === "holdings") {
    if (titleEl) titleEl.textContent = "Holdings";
    document.getElementById("rp-holdings")?.classList.remove("hidden");
    loadHoldings();
  } else if (tabName === "order-ticket") {
    if (titleEl) titleEl.textContent = "Order Ticket";
    document.getElementById("rp-order-ticket")?.classList.remove("hidden");
  } else if (tabName === "strategies" || tabName === "builder") {
    if (titleEl) titleEl.textContent = "Strategies";
    document.getElementById("rp-strategies")?.classList.remove("hidden");
    loadStrategies();
  }

  setTimeout(() => {
    const el = document.getElementById("mainChart");
    if (S.chart && el) {
      S.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    }
  }, 50);
}

function closeRightPanel() {
  const panel = document.getElementById("rightExpandedPanel");
  if (panel) panel.classList.add("hidden");
  document.querySelectorAll(".r-icon-btn").forEach(b => b.classList.remove("active"));
  currentRightTab = null;

  setTimeout(() => {
    const el = document.getElementById("mainChart");
    if (S.chart && el) {
      S.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    }
  }, 50);
}

function showBTab(name) {
  toggleRightPanel(name);
}

// ═══ POSITIONS / ORDERS / HOLDINGS ═══════════════════════════════════════════
async function loadPositions() {
  const resp = await fetch("/execution/positions");
  const data = await resp.json();
  const tbody = document.getElementById("positionsBody");
  if (data.error) { tbody.innerHTML = errRow(6, data.error); return; }
  const pos = data.positions || [];
  if (!pos.length) { tbody.innerHTML = emptyRow(6, "No open positions"); return; }
  tbody.innerHTML = pos.map(p => {
    const pnl = parseFloat(p.unrealised ?? p.pnl ?? 0);
    const cls = pnl >= 0 ? "chg-up" : "chg-dn";
    return `<tr>
      <td>${p.tradingsymbol || p.symbol}</td>
      <td>${p.netqty ?? p.quantity}</td>
      <td>₹${fmtN(p.averageprice ?? p.average_price)}</td>
      <td>₹${fmtN(p.ltp ?? 0)}</td>
      <td class="${cls}">₹${pnl.toFixed(2)}</td>
      <td>${p.producttype ?? p.product_type ?? ""}</td>
    </tr>`;
  }).join("");
}

async function loadOrders() {
  const resp = await fetch("/execution/orders/history");
  const data = await resp.json();
  const tbody = document.getElementById("ordersBody");
  if (data.error) { tbody.innerHTML = errRow(7, data.error); return; }
  const orders = data.orders || [];
  if (!orders.length) { tbody.innerHTML = emptyRow(7, "No orders today"); return; }
  tbody.innerHTML = orders.slice(0, 50).map(o => `<tr>
    <td>${(o.created_at || "").substring(11,16)}</td>
    <td>${o.symbol}</td>
    <td class="${o.transaction_type === "BUY" ? "chg-up" : "chg-dn"}">${o.transaction_type} ${o.order_type}</td>
    <td>${o.quantity}</td>
    <td>₹${fmtN(o.price)}</td>
    <td>${o.status}</td>
    <td>${o.broker_order_id ? `<button class="btn-sm" onclick="cancelOrder('${o.broker_order_id}')">Cancel</button>` : "–"}</td>
  </tr>`).join("");
}

async function loadHoldings() {
  const resp = await fetch("/execution/holdings");
  const data = await resp.json();
  const tbody = document.getElementById("holdingsBody");
  if (data.error) { tbody.innerHTML = errRow(6, data.error); return; }
  const h = data.holdings || [];
  if (!h.length) { tbody.innerHTML = emptyRow(6, "No holdings"); return; }
  tbody.innerHTML = h.map(r => {
    const pnl = parseFloat(r.profitandloss ?? 0);
    const pct = parseFloat(r.pnlpercentage ?? 0).toFixed(2);
    const cls = pnl >= 0 ? "chg-up" : "chg-dn";
    return `<tr>
      <td>${r.tradingsymbol}</td><td>${r.quantity}</td>
      <td>₹${fmtN(r.averageprice)}</td><td>₹${fmtN(r.ltp)}</td>
      <td class="${cls}">₹${pnl.toFixed(2)}</td>
      <td class="${cls}">${pct}%</td>
    </tr>`;
  }).join("");
}

async function cancelOrder(bid) {
  if (!confirm("Cancel this order?")) return;
  const resp = await fetch("/execution/cancel", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ broker_order_id: bid })
  });
  const data = await resp.json();
  if (data.success) loadOrders(); else alert(data.error);
}

// ═══ ORDER PANEL ══════════════════════════════════════════════════════════════
function setOrderSide(side, btn) {
  S.side = side;
  document.querySelectorAll(".otab").forEach(t => t.className = "otab");
  if (btn) btn.className = `otab ${side === "BUY" ? "buy-active" : "sell-active"}`;
  const pb = document.getElementById("placeBtn");
  pb.textContent = `PLACE ${side}`;
  pb.className   = side === "BUY" ? "place-btn buy-btn" : "place-btn sell-btn";
  calcRisk();
}

function togglePriceField() {
  const ot = document.getElementById("orderType").value;
  const needPrice   = ["LIMIT","STOPLOSS_LIMIT"].includes(ot);
  const needTrigger = ["STOPLOSS_MARKET","STOPLOSS_LIMIT"].includes(ot);
  document.getElementById("priceRow").classList.toggle("hidden", !needPrice);
  document.getElementById("trigRow").classList.toggle("hidden",  !needTrigger);
}

function calcRisk(ltpOverride) {
  const ltp = ltpOverride || parseFloat(
    document.getElementById("ltpValue").textContent.replace("₹","")
  ) || 0;
  if (!ltp) return;
  const qty  = parseInt(document.getElementById("qty").value) || 1;
  const sl   = parseFloat(document.getElementById("riskSL").value) || 2;
  const tp   = parseFloat(document.getElementById("riskTP").value) || 4;

  const slP  = S.side === "BUY" ? ltp * (1 - sl/100) : ltp * (1 + sl/100);
  const tpP  = S.side === "BUY" ? ltp * (1 + tp/100) : ltp * (1 - tp/100);
  const loss = Math.abs(ltp - slP) * qty;
  const gain = Math.abs(tpP - ltp)  * qty;
  const rr   = loss > 0 ? (gain/loss).toFixed(1) : "–";

  document.getElementById("riskOutput").innerHTML = `
    <div class="ro-row"><span>Stop Loss</span><span class="chg-dn">₹${slP.toFixed(2)}</span></div>
    <div class="ro-row"><span>Target</span><span class="chg-up">₹${tpP.toFixed(2)}</span></div>
    <div class="ro-row"><span>Max Loss</span><span class="chg-dn">₹${loss.toFixed(2)}</span></div>
    <div class="ro-row"><span>Max Profit</span><span class="chg-up">₹${gain.toFixed(2)}</span></div>
    <div class="ro-row"><span>R:R</span><span>1 : ${rr}</span></div>
  `;
}

async function placeOrder() {
  if (!S.symbol) { alert("Select a symbol first"); return; }
  const ot   = document.getElementById("orderType").value;
  const qty  = parseInt(document.getElementById("qty").value);
  const prc  = parseFloat(document.getElementById("orderPrice").value) || 0;
  const tprc = parseFloat(document.getElementById("trigPrice").value)  || 0;
  const prod = document.getElementById("productType").value;

  if (qty <= 0) { alert("Quantity must be > 0"); return; }

  // Confirmation dialog with full details
  const ltp = document.getElementById("ltpValue").textContent;
  const msg = [
    `Symbol:   ${S.symbol} (${S.exchange})`,
    `Action:   ${S.side} ${qty} qty`,
    `Type:     ${ot} @ ${ot === "MARKET" ? "Market Price" : "₹"+prc}`,
    `Product:  ${prod}`,
    `Approx.   ${ltp}`,
    ``,
    `Confirm order?`
  ].join("\n");
  if (!confirm(msg)) return;

  const placeBtn = document.getElementById("placeBtn");
  placeBtn.textContent = "Placing…";
  placeBtn.disabled = true;

  try {
    const resp = await fetch("/execution/place", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: S.symbol, exchange: S.exchange,
        transaction_type: S.side,
        quantity: qty, order_type: ot,
        price: prc, trigger_price: tprc,
        product_type: prod,
      })
    });
    const data = await resp.json();

    if (data.success) {
      showOrderToast(`✅ ${S.side} order placed! ID: ${data.data.broker_order_id}`, "success");
      loadOrders();
    } else {
      showOrderToast(`❌ ${data.error}`, "error");
    }
  } catch(e) {
    showOrderToast(`❌ Request failed: ${e.message}`, "error");
  } finally {
    setOrderSide(S.side, document.querySelector(`.otab.${S.side === "BUY" ? "buy" : "sell"}-active`));
    placeBtn.disabled = false;
  }
}

async function placeOrderQuick() {
  if (!S.symbol) { alert("Select a symbol first"); return; }
  const qty = parseInt(document.getElementById("qty")?.value) || 1;
  const prod = document.getElementById("productType")?.value || "INTRADAY";

  if (!confirm(`Quick ${S.side} Market Order:\n${qty} qty of ${S.symbol} (${S.exchange})?`)) return;

  try {
    const resp = await fetch("/execution/place", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: S.symbol, exchange: S.exchange,
        transaction_type: S.side,
        quantity: qty, order_type: "MARKET",
        price: 0, trigger_price: 0,
        product_type: prod,
      })
    });
    const data = await resp.json();
    if (data.success) {
      showOrderToast(`✅ Quick ${S.side} Placed! Order ID: ${data.data.broker_order_id}`, "success");
      loadOrders();
    } else {
      showOrderToast(`❌ ${data.error}`, "error");
    }
  } catch(e) {
    showOrderToast(`❌ Quick order failed: ${e.message}`, "error");
  }
}

function showOrderToast(msg, type) {
  const t = document.getElementById("orderToast");
  t.textContent = msg;
  t.className   = `order-toast ${type}`;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 5000);
}

// ═══ STRATEGY BUILDER ═════════════════════════════════════════════════════════
const IND_LIST = ["RSI14","EMA20","EMA50","EMA9","SMA20","MACD","MACD_SIGNAL","BB_UPPER","BB_LOWER"];
const OP_LIST  = [">","<",">=","<=","==","crosses_above","crosses_below"];

function addCondition() {
  const row = document.createElement("div");
  row.className = "condition-row";
  row.innerHTML = `
    <select class="ci" onchange="updateStratPreview()">
      ${IND_LIST.map(i=>`<option>${i}</option>`).join("")}
    </select>
    <select class="co" onchange="updateStratPreview()">
      ${OP_LIST.map(o=>`<option>${o}</option>`).join("")}
    </select>
    <input type="text" class="cv" value="30" oninput="updateStratPreview()" style="width:80px">
    <button class="del-btn" onclick="this.closest('.condition-row').remove(); updateStratPreview()">✕</button>
  `;
  document.getElementById("conditions").appendChild(row);
  updateStratPreview();
}

function buildStratLogic() {
  const conditions = [];
  document.querySelectorAll(".condition-row").forEach(r => {
    let val = r.querySelector(".cv").value.trim();
    if (!isNaN(val)) val = parseFloat(val);
    conditions.push({
      indicator: r.querySelector(".ci").value,
      operator:  r.querySelector(".co").value,
      value: val
    });
  });
  return {
    conditions,
    action:   document.getElementById("signalAction").value,
    stoploss: parseFloat(document.getElementById("sl").value) || 2,
    target:   parseFloat(document.getElementById("tp").value) || 4,
  };
}

function updateStratPreview() {
  document.getElementById("stratPreview").textContent =
    JSON.stringify(buildStratLogic(), null, 2);
}

async function saveStrategy() {
  const name = document.getElementById("stratName").value.trim();
  if (!name) { alert("Enter a strategy name"); return; }
  const resp = await fetch("/strategy/save", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, logic: buildStratLogic() })
  });
  const data = await resp.json();
  if (data.success) { showOrderToast("✅ Strategy saved!", "success"); loadStrategies(); }
  else alert(data.error);
}

async function testSignal() {
  if (!S.symbol) { alert("Select a symbol first"); return; }
  const resp = await fetch("/strategy/signal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: S.symbol, timeframe: S.timeframe, strategy: buildStratLogic() })
  });
  const data = await resp.json();
  const box = document.getElementById("signalBox");
  box.className = `signal-box signal-${data.signal || "ERR"}`;
  box.textContent = data.error ? `⚠ ${data.error}` : `Signal: ${data.signal}`;
}

async function loadStrategies() {
  const resp = await fetch("/strategy/list");
  const data = await resp.json();
  const cont = document.getElementById("strategiesList");
  if (!cont) return;
  const list = data.strategies || [];
  if (!list.length) {
    cont.innerHTML = `<p class="empty-msg">No strategies yet. Use the Builder tab to create one.</p>`;
    return;
  }
  cont.innerHTML = list.map(s => `
    <div class="strat-card">
      <div class="strat-info">
        <div class="strat-name">${s.strategy_name}</div>
        <div class="strat-meta">${(s.created_at||"").substring(0,10)}</div>
      </div>
      <button class="btn-danger-sm" onclick="deleteStrategy(${s.id})">🗑</button>
    </div>
  `).join("");
}

async function deleteStrategy(id) {
  if (!confirm("Delete this strategy?")) return;
  await fetch(`/strategy/delete/${id}`, { method: "DELETE" });
  loadStrategies();
}

// ═══ BROKER PANEL ════════════════════════════════════════════════════════════
function openPanel(name)  { document.getElementById(`${name}Overlay`).classList.remove("hidden"); checkBrokerStatus(); }
function closePanel(name) { document.getElementById(`${name}Overlay`).classList.add("hidden"); }

async function checkBrokerStatus() {
  try {
    const resp = await fetch("/broker/status");
    const data = await resp.json();
    const ok = data.status === "connected";
    document.getElementById("brokerDot").className = `dot ${ok ? "connected" : "disconnected"}`;
    document.getElementById("brokerLabel").textContent = ok ? `${data.client_id} ✓` : "Disconnected";
    const el = document.getElementById("brokerStatus");
    if (el) el.innerHTML = ok
      ? `<span class="status-ok">✅ Connected as <strong>${data.client_id}</strong> since ${(data.connected_at||"").substring(0,19)}</span>`
      : `<span class="status-err">⚠ Not connected. Enter your Angel One credentials below.</span>`;

    if (ok) {
      document.getElementById("navAccountName").textContent = data.client_id || "Account";
      loadAccountFunds();
    } else {
      document.getElementById("navAccountBalance").textContent = "₹0.00";
    }
  } catch(e) {}
}

async function loadAccountFunds() {
  try {
    const resp = await fetch("/broker/funds");
    const data = await resp.json();
    if (data.success && data.data) {
      const funds = data.data;
      const net = parseFloat(funds.net || funds.availablecash || funds.availablelimitmargin || 0);
      document.getElementById("navAccountBalance").textContent = `₹${fmtN(net)}`;
      if (funds.name || funds.clientcode) {
        document.getElementById("navAccountName").textContent = funds.name || funds.clientcode;
      }
    }
  } catch(e) {}
}

async function connectBroker(e) {
  e.preventDefault();
  const payload = {
    api_key:     document.getElementById("bApiKey").value.trim(),
    client_id:   document.getElementById("bClientId").value.trim(),
    password:    document.getElementById("bPassword").value,
    totp_secret: document.getElementById("bTOTP").value.trim(),
  };
  if (!payload.api_key || !payload.client_id || !payload.password || !payload.totp_secret) {
    setMsg("brokerMsg", "All fields are required", "err");
    return;
  }
  setMsg("brokerMsg", "Connecting to Angel One…", "");
  const resp = await fetch("/broker/connect", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (data.success) {
    setMsg("brokerMsg", "✅ " + data.message, "ok");
    checkBrokerStatus();
  } else {
    setMsg("brokerMsg", "❌ " + data.error, "err");
  }
}

async function disconnectBroker() {
  if (!confirm("Disconnect broker session?")) return;
  const resp = await fetch("/broker/disconnect", { method: "POST" });
  const data = await resp.json();
  setMsg("brokerMsg", data.message, "");
  checkBrokerStatus();
}

// ═══ UTILS ═══════════════════════════════════════════════════════════════════
function fmtN(v) { return v !== undefined && v !== null ? parseFloat(v).toFixed(2) : "0.00"; }
function emptyRow(cols, msg) { return `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`; }
function errRow(cols, msg)   { return `<tr><td colspan="${cols}" class="empty chg-dn">${msg}</td></tr>`; }
function setMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `msg-box ${type ? "msg-"+type : ""}`;
}
