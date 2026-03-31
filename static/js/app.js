// ====================================================
//  CryptoAnalyzer - Frontend App
// ====================================================

let allData = [];
let activeSymbol        = null;
let activeInterval      = '1h';
let activeLiqMapPeriod  = '24h';
let activeRankingPeriod = '24h';
let charts = {};

const TF_GROUPS = [
  { label: 'Min',  intervals: ['1m', '5m', '15m', '30m'] },
  { label: 'Hora', intervals: ['1h', '2h', '4h', '6h', '12h'] },
  { label: 'Dia',  intervals: ['1d'] },
];

const formatPrice = (v) => {
  if (v >= 1000) return '$' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(4);
  return '$' + v.toFixed(6);
};

const formatBig = (v) => {
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  return '$' + v.toFixed(0);
};

const formatVol = (v) => {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  return v.toFixed(0);
};

const destroyCharts = () => {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  charts = {};
};

// ====================================================
//  Fetch & Init
// ====================================================
async function loadMarket() {
  try {
    const res = await fetch('/api/market');
    allData = await res.json();
    if (!allData.length) return;

    renderTabs();
    loadDominance();

    if (activeSymbol) {
      const found = allData.find(d => d.symbol === activeSymbol);
      renderDashboard(found || allData[0]);
    } else {
      activeSymbol = allData[0].symbol;
      renderDashboard(allData[0]);
    }

    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('pt-BR');
  } catch (e) {
    console.error('Erro ao carregar mercado:', e);
  }
}

async function loadDominance() {
  try {
    const res = await fetch('/api/dominance');
    const d = await res.json();
    document.getElementById('btcDom').textContent = d.btc_dominance;
    document.getElementById('totalCap').textContent = formatBig(d.total_market_cap);
    const capEl = document.getElementById('capChange');
    const pct = d.market_cap_change_24h;
    const color = pct >= 0 ? 'var(--green)' : 'var(--red)';
    capEl.innerHTML = `
      <span class="stat-label">24h</span>
      <span class="stat-value" style="color:${color}">${pct >= 0 ? '+' : ''}${pct}%</span>
    `;
  } catch (e) {}
}

// ====================================================
//  Tabs
// ====================================================
function renderTabs() {
  const container = document.getElementById('symbolTabs');
  container.innerHTML = '';
  allData.forEach(item => {
    const tab = document.createElement('div');
    tab.className = 'symbol-tab' + (item.symbol === activeSymbol ? ' active' : '');
    const chg = item.ticker.change_pct;
    const sig = item.signal;
    const badgeBg = sig.color + '22';
    tab.innerHTML = `
      <div class="tab-info">
        <div class="tab-symbol">${item.symbol.replace('USDT', '')}</div>
        <div class="tab-price">${formatPrice(item.ticker.price)}</div>
        <div class="tab-change ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%</div>
      </div>
      <div class="tab-signal-badge" style="color:${sig.color};background:${badgeBg};border:1px solid ${sig.color}44">
        ${sig.action.split(' ')[0]}
      </div>
    `;
    tab.addEventListener('click', () => {
      activeSymbol = item.symbol;
      document.querySelectorAll('.symbol-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      destroyCharts();
      renderDashboard(item);
    });
    container.appendChild(tab);
  });
}

// ====================================================
//  Dashboard
// ====================================================
function renderDashboard(item) {
  const main = document.getElementById('mainContent');
  const overlay = document.getElementById('loadingOverlay');

  main.innerHTML = '';
  main.appendChild(overlay);

  const dash = document.createElement('div');
  dash.className = 'dashboard';
  dash.innerHTML = `
    <div class="top-row">
      <div class="card signal-card" id="signalCard"></div>
      <div class="card" id="candleCard">
        <div class="card-title">
          <div class="card-title-icon">📈</div>
          Gráfico de Preço — <span style="color:var(--vivo-bright);margin-left:4px">${item.symbol.replace('USDT','/USDT')}</span>
          <span id="tfActiveLabel" style="margin-left:auto;font-size:9px;color:var(--text-dim)">${activeInterval.toUpperCase()} · últimas 100 velas</span>
        </div>
        <div class="tf-bar" id="tfBar">${buildTfBar()}</div>
        <div class="chart-wrapper"><canvas id="candleChart"></canvas></div>
        <div class="rsi-wrapper"><canvas id="rsiChart"></canvas></div>
      </div>
    </div>
    <div class="bottom-row">
      <div class="card" id="liqCard">
        <div class="card-title">
          <div class="card-title-icon">💥</div>
          Mapa de Liquidações — <span style="color:var(--vivo-bright);margin-left:4px">${item.symbol.replace('USDT','/USDT')}</span>
        </div>
        <div class="liq-period-bar" id="liqMapPeriodBar">${buildPeriodBar(['4h','8h','12h','24h','3d','7d'], activeLiqMapPeriod)}</div>
        <div id="liqChart"><div style="display:flex;align-items:center;justify-content:center;height:80px"><div class="loading-bar-wrap" style="width:120px"><div class="loading-bar"></div></div></div></div>
      </div>
      <div class="card" id="volCard">
        <div class="card-title">
          <div class="card-title-icon">📊</div>
          Volume & MACD
          <span style="margin-left:auto;font-size:9px;color:var(--text-dim)">1H</span>
        </div>
        <div class="vol-wrapper"><canvas id="volChart"></canvas></div>
      </div>
    </div>
    <div class="fg-row">
      <div class="card" id="fearGreedCard">
        <div class="card-title">
          <div class="card-title-icon">🌡️</div>
          Termômetro Medo &amp; Ganância
          <span style="margin-left:auto;font-size:9px;color:var(--text-dim)">alternative.me</span>
        </div>
        <div id="fearGreedGaugeContent">
          <div style="display:flex;align-items:center;justify-content:center;height:80px">
            <div class="loading-bar-wrap" style="width:120px"><div class="loading-bar"></div></div>
          </div>
        </div>
      </div>
      <div class="card" id="fearContextCard">
        <div class="card-title">
          <div class="card-title-icon">📖</div>
          Como Interpretar o Índice
        </div>
        <div class="fg-context-list">
          <div class="fg-context-item">
            <div class="fg-context-dot" style="background:#ff1744"></div>
            <span class="fg-context-range">0 – 20</span>
            <span class="fg-context-label">Medo Extremo</span>
            <span class="fg-context-desc">Investidores em pânico — historicamente um sinal de compra</span>
          </div>
          <div class="fg-context-item">
            <div class="fg-context-dot" style="background:#ff9100"></div>
            <span class="fg-context-range">21 – 40</span>
            <span class="fg-context-label">Medo</span>
            <span class="fg-context-desc">Sentimento negativo predomina, cautela no mercado</span>
          </div>
          <div class="fg-context-item">
            <div class="fg-context-dot" style="background:#ffd740"></div>
            <span class="fg-context-range">41 – 60</span>
            <span class="fg-context-label">Neutro</span>
            <span class="fg-context-desc">Mercado equilibrado, sem tendência emocional clara</span>
          </div>
          <div class="fg-context-item">
            <div class="fg-context-dot" style="background:#69f0ae"></div>
            <span class="fg-context-range">61 – 80</span>
            <span class="fg-context-label">Ganância</span>
            <span class="fg-context-desc">Otimismo elevado — possível sobrevalorização</span>
          </div>
          <div class="fg-context-item">
            <div class="fg-context-dot" style="background:#00e676"></div>
            <span class="fg-context-range">81 – 100</span>
            <span class="fg-context-label">Ganância Extrema</span>
            <span class="fg-context-desc">Euforia — historicamente precede correções</span>
          </div>
        </div>
      </div>
    </div>
    <div class="full-row">
      <div class="card" id="liqRankingCard">
        <div class="card-title">
          <div class="card-title-icon">🏆</div>
          Ranking de Liquidações — Top 20 Mercado Futuros
          <span id="rankingPeriodLabel" style="margin-left:6px;font-size:10px;font-weight:700;color:var(--vivo-bright)">(${activeRankingPeriod})</span>
        </div>
        <div class="liq-period-bar" id="rankingPeriodBar">${buildPeriodBar(['4h','8h','12h','24h'], activeRankingPeriod)}</div>
        <div id="liqRankingContent">
          <div style="display:flex;align-items:center;justify-content:center;height:80px;color:var(--text-muted)">
            <div class="loading-bar-wrap" style="width:120px"><div class="loading-bar"></div></div>
          </div>
        </div>
      </div>
      <div class="card" id="newsCard">
        <div class="card-title">
          <div class="card-title-icon">📰</div>
          Notícias Crypto
          <span style="margin-left:auto;font-size:9px;color:var(--text-dim)">últimas horas</span>
        </div>
        <div id="newsContent">
          <div style="display:flex;align-items:center;justify-content:center;height:80px;color:var(--text-muted)">
            <div class="loading-bar-wrap" style="width:120px"><div class="loading-bar"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;
  main.appendChild(dash);

  renderSignalCard(item);
  attachTfListeners(item.symbol);
  renderCandleChart(item);
  renderRsiChart(item);
  renderVolMacdChart(item);
  attachLiqMapPeriodListeners(item.symbol);
  attachRankingPeriodListeners();
  loadLiquidations(item.symbol);
  loadLiquidationRanking();
  loadNews();
  loadFearGreed();
}

// ====================================================
//  Signal Card
// ====================================================
function renderSignalCard(item) {
  const { signal, ticker } = item;
  const card = document.getElementById('signalCard');

  const reasonIcons = {
    'RSI': '📊',
    'MACD': '📉',
    'Preço': '📌',
    'Tendência': '📈',
  };

  const getIcon = (r) => {
    for (const [k, v] of Object.entries(reasonIcons)) {
      if (r.includes(k)) return v;
    }
    return '•';
  };

  const reasonsHtml = signal.reasons.map(r => `
    <div class="reason-item">
      <span class="reason-icon">${getIcon(r)}</span>
      <span>${r}</span>
    </div>
  `).join('');

  const ind = signal.indicators;
  const macdBull = ind.macd_hist > 0;
  const rsiBull = ind.rsi < 50;
  const trendBull = ind.ema9 > ind.ema21;

  card.innerHTML = `
    <div class="card-title">
      <div class="card-title-icon">🎯</div>
      Recomendação — <span style="color:var(--vivo-bright);margin-left:4px">${item.symbol.replace('USDT','')}</span>
    </div>
    <div class="signal-main" style="border-color:${signal.color};background:${signal.color}18">
      <div class="signal-action" style="color:${signal.color}">${signal.action}</div>
      <div class="signal-confidence">Confiança: ${signal.confidence}%</div>
      <div class="confidence-bar">
        <div class="confidence-fill" style="width:${signal.confidence}%;background:${signal.color}"></div>
      </div>
    </div>

    <div class="signal-price-row">
      <div class="price-stat">
        <div class="price-stat-label">Preço Atual</div>
        <div class="price-stat-value">${formatPrice(ticker.price)}</div>
      </div>
      <div class="price-stat">
        <div class="price-stat-label">Variação 24h</div>
        <div class="price-stat-value ${ticker.change_pct >= 0 ? 'up' : 'down'}">${ticker.change_pct >= 0 ? '+' : ''}${ticker.change_pct.toFixed(2)}%</div>
      </div>
      <div class="price-stat">
        <div class="price-stat-label">Máxima 24h</div>
        <div class="price-stat-value up">${formatPrice(ticker.high)}</div>
      </div>
      <div class="price-stat">
        <div class="price-stat-label">Mínima 24h</div>
        <div class="price-stat-value down">${formatPrice(ticker.low)}</div>
      </div>
    </div>

    <div class="indicators-grid">
      <div class="indicator-box">
        <div class="ind-label">RSI (14)</div>
        <div class="ind-value ${ind.rsi < 30 ? 'bullish' : ind.rsi > 70 ? 'bearish' : 'neutral'}">${ind.rsi}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">MACD</div>
        <div class="ind-value ${macdBull ? 'bullish' : 'bearish'}">${ind.macd.toFixed(2)}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">Histograma</div>
        <div class="ind-value ${ind.macd_hist > 0 ? 'bullish' : 'bearish'}">${ind.macd_hist.toFixed(2)}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">EMA 9</div>
        <div class="ind-value ${trendBull ? 'bullish' : 'bearish'}">${formatPrice(ind.ema9)}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">EMA 21</div>
        <div class="ind-value neutral">${formatPrice(ind.ema21)}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">EMA 50</div>
        <div class="ind-value neutral">${formatPrice(ind.ema50)}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">BB Superior</div>
        <div class="ind-value bearish">${formatPrice(ind.bb_upper)}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">BB Inferior</div>
        <div class="ind-value bullish">${formatPrice(ind.bb_lower)}</div>
      </div>
      <div class="indicator-box">
        <div class="ind-label">Volume 24h</div>
        <div class="ind-value neutral">${formatVol(ticker.volume)}</div>
      </div>
    </div>

    <div class="signal-reasons">
      <div class="reasons-label">Motivos da Análise</div>
      ${reasonsHtml || '<div class="reason-item"><span class="reason-icon">•</span><span>Sem sinais claros no momento</span></div>'}
    </div>
  `;
}

// ====================================================
//  Candle Chart
// ====================================================
function renderCandleChart(item) {
  const candles = item.candles;
  const labels = candles.map(c => new Date(c.open_time));

  const ohlcData = candles.map(c => ({
    x: new Date(c.open_time).getTime(),
    o: c.open, h: c.high, l: c.low, c: c.close
  }));

  const ema9Data = calcEMA(candles.map(c => c.close), 9);
  const ema21Data = calcEMA(candles.map(c => c.close), 21);
  const ema50Data = calcEMA(candles.map(c => c.close), 50);
  const { upper, middle, lower } = calcBollinger(candles.map(c => c.close), 20);

  const ts = candles.map(c => new Date(c.open_time).getTime());

  const ctx = document.getElementById('candleChart').getContext('2d');
  charts.candle = new Chart(ctx, {
    type: 'candlestick',
    data: {
      datasets: [
        {
          label: item.symbol,
          data: ohlcData,
          color: {
            up: '#00e676',
            down: '#ff1744',
            unchanged: '#ffd740',
          },
          borderColor: {
            up: '#00e676',
            down: '#ff1744',
            unchanged: '#ffd740',
          },
          order: 5,
        },
        {
          type: 'line', label: 'BB Superior',
          data: ts.map((t, i) => ({x: t, y: upper[i]})),
          borderColor: 'rgba(196,77,255,0.5)', borderWidth: 1,
          pointRadius: 0, fill: '+1', backgroundColor: 'rgba(196,77,255,0.05)',
          tension: 0.3, order: 4,
        },
        {
          type: 'line', label: 'BB Média',
          data: ts.map((t, i) => ({x: t, y: middle[i]})),
          borderColor: 'rgba(196,77,255,0.65)', borderWidth: 1,
          pointRadius: 0, borderDash: [4, 4],
          tension: 0.3, order: 3,
        },
        {
          type: 'line', label: 'BB Inferior',
          data: ts.map((t, i) => ({x: t, y: lower[i]})),
          borderColor: 'rgba(196,77,255,0.5)', borderWidth: 1,
          pointRadius: 0, fill: '-1', backgroundColor: 'rgba(196,77,255,0.05)',
          tension: 0.3, order: 4,
        },
        {
          type: 'line', label: 'EMA 9',
          data: ts.map((t, i) => ({x: t, y: ema9Data[i]})),
          borderColor: '#ffd740', borderWidth: 1.5,
          pointRadius: 0, tension: 0.3, order: 2,
        },
        {
          type: 'line', label: 'EMA 21',
          data: ts.map((t, i) => ({x: t, y: ema21Data[i]})),
          borderColor: '#e040fb', borderWidth: 1.5,
          pointRadius: 0, tension: 0.3, order: 2,
        },
        {
          type: 'line', label: 'EMA 50',
          data: ts.map((t, i) => ({x: t, y: ema50Data[i]})),
          borderColor: '#ff9100', borderWidth: 1.5,
          pointRadius: 0, tension: 0.3, order: 2,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#8a6fb0', boxWidth: 16, font: { size: 11 } }
        },
        tooltip: {
          backgroundColor: '#160d21',
          borderColor: '#3d1f6e',
          borderWidth: 1,
          titleColor: '#f0e8ff',
          bodyColor: '#8a6fb0',
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', displayFormats: { hour: 'dd/MM HH:mm' } },
          grid: { color: 'rgba(61,31,110,0.5)' },
          ticks: { color: '#8a6fb0', maxTicksLimit: 8 },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(30,48,80,0.5)' },
          ticks: {
            color: '#64748b',
            callback: v => formatPrice(v),
          }
        }
      }
    }
  });
}

// ====================================================
//  RSI Chart
// ====================================================
function renderRsiChart(item) {
  const closes = item.candles.map(c => c.close);
  const rsiValues = calcRSI(closes, 14);
  const ts = item.candles.map(c => new Date(c.open_time).getTime());

  const ctx = document.getElementById('rsiChart').getContext('2d');
  charts.rsi = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'RSI (14)',
          data: ts.map((t, i) => ({ x: t, y: rsiValues[i] })),
          borderColor: '#c44dff',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'Sobrecomprado (70)',
          data: ts.map(t => ({ x: t, y: 70 })),
          borderColor: 'rgba(255,82,82,0.4)',
          borderWidth: 1, borderDash: [4, 4],
          pointRadius: 0,
        },
        {
          label: 'Sobrevendido (30)',
          data: ts.map(t => ({ x: t, y: 30 })),
          borderColor: 'rgba(0,230,118,0.4)',
          borderWidth: 1, borderDash: [4, 4],
          pointRadius: 0,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#64748b', boxWidth: 12, font: { size: 10 } } },
        tooltip: {
          backgroundColor: '#111827', borderColor: '#1e3050', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#94a3b8',
          callbacks: { label: ctx => `RSI: ${ctx.parsed.y?.toFixed(2) ?? '--'}` }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } },
          grid: { color: 'rgba(61,31,110,0.3)' },
          ticks: { color: '#8a6fb0', maxTicksLimit: 6, font: { size: 10 } }
        },
        y: {
          position: 'right',
          min: 0, max: 100,
          grid: { color: 'rgba(61,31,110,0.3)' },
          ticks: { color: '#8a6fb0', font: { size: 10 } }
        }
      }
    }
  });
}

// ====================================================
//  Volume + MACD Chart
// ====================================================
function renderVolMacdChart(item) {
  const closes = item.candles.map(c => c.close);
  const volumes = item.candles.map(c => c.volume);
  const { macd, signal, hist } = calcMACD(closes);
  const ts = item.candles.map(c => new Date(c.open_time).getTime());
  const change = item.candles.map(c => c.close >= c.open);

  const ctx = document.getElementById('volChart').getContext('2d');
  charts.vol = new Chart(ctx, {
    type: 'bar',
    data: {
      datasets: [
        {
          type: 'bar', label: 'Volume',
          data: ts.map((t, i) => ({ x: t, y: volumes[i] })),
          backgroundColor: ts.map((_, i) => change[i] ? 'rgba(0,230,118,0.4)' : 'rgba(255,23,68,0.4)'),
          borderColor: ts.map((_, i) => change[i] ? '#00e676' : '#ff1744'),
          borderWidth: 1,
          yAxisID: 'yVol',
          order: 3,
        },
        {
          type: 'line', label: 'MACD',
          data: ts.map((t, i) => ({ x: t, y: macd[i] })),
          borderColor: '#c44dff', borderWidth: 1.5,
          pointRadius: 0, tension: 0.3,
          yAxisID: 'yMacd', order: 1,
        },
        {
          type: 'line', label: 'Sinal',
          data: ts.map((t, i) => ({ x: t, y: signal[i] })),
          borderColor: '#ff9100', borderWidth: 1.5,
          pointRadius: 0, tension: 0.3,
          yAxisID: 'yMacd', order: 1,
        },
        {
          type: 'bar', label: 'Histograma',
          data: ts.map((t, i) => ({ x: t, y: hist[i] })),
          backgroundColor: ts.map((_, i) => hist[i] >= 0 ? 'rgba(0,230,118,0.5)' : 'rgba(255,23,68,0.5)'),
          yAxisID: 'yMacd', order: 2,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8a6fb0', boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#111827', borderColor: '#1e3050', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#94a3b8',
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', displayFormats: { hour: 'dd/MM HH:mm' } },
          grid: { color: 'rgba(30,48,80,0.5)' },
          ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } },
        },
        yVol: {
          position: 'left',
          grid: { color: 'rgba(61,31,110,0.3)' },
          ticks: { color: '#8a6fb0', callback: v => formatVol(v), font: { size: 10 } },
        },
        yMacd: {
          position: 'right',
          grid: { display: false },
          ticks: { color: '#8a6fb0', font: { size: 10 } },
        }
      }
    }
  });
}

// ====================================================
//  Liquidation Map
// ====================================================
async function loadLiquidations(symbol, period) {
  const p = period || activeLiqMapPeriod;
  try {
    const res  = await fetch(`/api/liquidations/${symbol}?period=${p}`);
    const data = await res.json();
    renderLiquidationChart(data);
  } catch (e) {
    console.error('Erro liquidações:', e);
  }
}

function renderLiquidationChart(data) {
  const prices  = data.prices;
  const longs   = data.long_liquidations;
  const shorts  = data.short_liquidations;
  const current = data.current_price;
  const n       = prices.length;

  // Find index closest to current price
  let closestIdx = 0, minDist = Infinity;
  prices.forEach((p, i) => {
    const d = Math.abs(p - current);
    if (d < minDist) { minDist = d; closestIdx = i; }
  });

  // Replace canvas wrapper with heatmap
  const oldCanvas = document.getElementById('liqChart');
  if (!oldCanvas) return;
  const container = oldCanvas.parentElement;

  const maxLong  = Math.max(...longs,  0.1);
  const maxShort = Math.max(...shorts, 0.1);

  // Sample 22 rows, always include current price
  const step = Math.max(1, Math.floor(n / 22));
  const idxSet = new Set();
  for (let i = 0; i < n; i += step) idxSet.add(i);
  idxSet.add(closestIdx);
  const indices = [...idxSet].sort((a, b) => b - a); // high → low

  let rows = '';
  indices.forEach(i => {
    const price     = prices[i];
    const longVal   = longs[i];
    const shortVal  = shorts[i];
    const isCurrent = i === closestIdx;
    const longPct   = (longVal  / maxLong)  * 100;
    const shortPct  = (shortVal / maxShort) * 100;
    const longAlpha  = 0.12 + (longVal  / maxLong)  * 0.78;
    const shortAlpha = 0.12 + (shortVal / maxShort) * 0.78;

    rows += `
      <div class="liq-row${isCurrent ? ' liq-row-current' : ''}">
        <div class="liq-col-short">
          <span class="liq-val">${shortVal > 8 ? shortVal.toFixed(0) + '%' : ''}</span>
          <div class="liq-bar-wrap">
            <div class="liq-bar-fill" style="width:${shortPct}%;background:rgba(0,230,118,${shortAlpha});margin-left:auto"></div>
          </div>
        </div>
        <div class="liq-price-label${isCurrent ? ' current' : price > current ? ' above' : ' below'}">
          ${isCurrent ? `<span class="price-arrow">▶</span>` : ''}
          <span>${formatPrice(price)}</span>
          ${isCurrent ? `<span class="liq-now-badge">AGORA</span>` : ''}
        </div>
        <div class="liq-col-long">
          <div class="liq-bar-wrap">
            <div class="liq-bar-fill" style="width:${longPct}%;background:rgba(255,23,68,${longAlpha})"></div>
          </div>
          <span class="liq-val">${longVal > 8 ? longVal.toFixed(0) + '%' : ''}</span>
        </div>
      </div>`;
  });

  container.innerHTML = `
    <div class="liq-heatmap-wrap">
      <div class="liq-heatmap-header">
        <div class="liq-hdr short"><span class="liq-hdr-dot" style="background:var(--green)"></span>Shorts Liquidados <span class="liq-hdr-hint">preço sobe ↑</span></div>
        <div class="liq-hdr center">Nível de Preço</div>
        <div class="liq-hdr long">Longs Liquidados <span class="liq-hdr-hint">preço cai ↓</span><span class="liq-hdr-dot" style="background:var(--red)"></span></div>
      </div>
      <div class="liq-heatmap">${rows}</div>
      <div class="liq-heatmap-footer">
        Preço atual: <strong style="color:var(--vivo-bright)">${formatPrice(current)}</strong>
        &nbsp;·&nbsp; Intensidade da barra = concentração de liquidações naquele nível
      </div>
    </div>
  `;
}

// ====================================================
//  Technical Indicator Helpers
// ====================================================
function calcEMA(data, period) {
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  let ema = data[0];
  result[0] = ema;
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = i >= period - 1 ? ema : null;
  }
  return result;
}

function calcRSI(data, period = 14) {
  const result = new Array(data.length).fill(null);
  if (data.length < period + 1) return result;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcMACD(data, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);
  const macd = data.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );
  const validMacd = macd.map(v => v ?? 0);
  const sig = calcEMA(validMacd, signal);
  const hist = macd.map((v, i) => v !== null && sig[i] !== null ? v - sig[i] : null);
  return { macd, signal: sig, hist };
}

function calcBollinger(data, period = 20, stdDev = 2) {
  const upper = [], middle = [], lower = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(null); middle.push(null); lower.push(null);
      continue;
    }
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push(avg + stdDev * sd);
    middle.push(avg);
    lower.push(avg - stdDev * sd);
  }
  return { upper, middle, lower };
}

// ====================================================
//  Liquidation Ranking
// ====================================================
async function loadLiquidationRanking(period) {
  const p   = period || activeRankingPeriod;
  const container = document.getElementById('liqRankingContent');
  if (!container) return;
  try {
    const res  = await fetch(`/api/liquidations_ranking?period=${p}`);
    const json = await res.json();
    renderLiquidationRanking(json.data || json, container, json.period || p);
  } catch (e) {
    container.innerHTML = '<p style="color:var(--text-muted)">Erro ao carregar ranking</p>';
  }
}

function renderLiquidationRanking(data, container, period) {
  if (!data || !data.length) { container.innerHTML = '<p>Sem dados</p>'; return; }
  const p = period || activeRankingPeriod;

  const totalLong  = data.reduce((a, d) => a + d.liq_24h_long, 0);
  const totalShort = data.reduce((a, d) => a + d.liq_24h_short, 0);
  const totalAll   = totalLong + totalShort;
  const maxLiq     = Math.max(...data.map(d => d.liq_24h_total));

  let html = `
    <div class="liq-summary-row">
      <div class="liq-summary-box">
        <div class="liq-summary-label">Total Liquidado (${p})</div>
        <div class="liq-summary-value" style="color:var(--vivo-bright)">${formatBig(totalAll)}</div>
      </div>
      <div class="liq-summary-box">
        <div class="liq-summary-label">Longs Liquidados (${p})</div>
        <div class="liq-summary-value" style="color:var(--red)">${formatBig(totalLong)}</div>
      </div>
      <div class="liq-summary-box">
        <div class="liq-summary-label">Shorts Liquidados (${p})</div>
        <div class="liq-summary-value" style="color:var(--green)">${formatBig(totalShort)}</div>
      </div>
      <div class="liq-summary-box">
        <div class="liq-summary-label">Ratio Long/Short</div>
        <div class="liq-summary-value" style="color:${totalLong > totalShort ? 'var(--red)' : 'var(--green)'}">
          ${(totalLong / Math.max(totalShort, 1)).toFixed(2)}
        </div>
      </div>
    </div>
    <div class="liq-table-wrap">
    <table class="liq-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Token</th>
          <th>Preço</th>
          <th>24h</th>
          <th>Liq. Long (${p})</th>
          <th>Liq. Short (${p})</th>
          <th>Total (${p})</th>
          <th>Barra</th>
          <th>Open Interest</th>
          <th>Volatilidade</th>
          <th>Suporte</th>
          <th>Resistência</th>
        </tr>
      </thead>
      <tbody>`;

  data.forEach((d, i) => {
    const chgClass = d.change_pct >= 0 ? 'up' : 'down';
    const longPct  = maxLiq > 0 ? (d.liq_24h_long / maxLiq * 100) : 0;
    const shortPct = maxLiq > 0 ? (d.liq_24h_short / maxLiq * 100) : 0;

    html += `
      <tr>
        <td class="liq-rank ${i < 3 ? 'top3' : ''}">${i + 1}</td>
        <td>
          <div class="liq-symbol-cell">
            <div>
              <div class="liq-symbol-name">${d.symbol.replace('USDT','')}</div>
              <div class="liq-symbol-price">${formatPrice(d.price)}</div>
            </div>
          </div>
        </td>
        <td>${formatPrice(d.price)}</td>
        <td style="color:var(--${chgClass === 'up' ? 'green' : 'red'});font-weight:600">${d.change_pct >= 0 ? '+' : ''}${d.change_pct.toFixed(2)}%</td>
        <td style="color:var(--red);font-weight:600">${formatBig(d.liq_24h_long)}</td>
        <td style="color:var(--green);font-weight:600">${formatBig(d.liq_24h_short)}</td>
        <td class="liq-total-value">${formatBig(d.liq_24h_total)}</td>
        <td style="min-width:120px">
          <div class="liq-bar-cell">
            <div class="liq-bar long" style="width:${longPct}%"></div>
            <div class="liq-bar short" style="width:${shortPct}%"></div>
          </div>
        </td>
        <td>${formatBig(d.oi_value_usd)}</td>
        <td style="color:${d.volatility_24h > 3 ? 'var(--orange)' : 'var(--text-muted)'};font-weight:600">${d.volatility_24h.toFixed(2)}%</td>
        <td style="color:var(--green)">${formatPrice(d.support)}</td>
        <td style="color:var(--red)">${formatPrice(d.resistance)}</td>
      </tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ====================================================
//  News
// ====================================================
async function loadNews() {
  const container = document.getElementById('newsContent');
  if (!container) return;
  try {
    const res = await fetch('/api/news');
    const data = await res.json();
    renderNews(data.news, container);
  } catch (e) {
    container.innerHTML = '<p style="color:var(--text-muted)">Erro ao carregar notícias</p>';
  }
}

function renderNews(news, container) {
  if (!news || !news.length) { container.innerHTML = '<p>Sem notícias</p>'; return; }

  const timeAgo = (dateStr) => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return `${Math.floor(diff/60)}min`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h`;
    return `${Math.floor(diff/86400)}d`;
  };

  let html = '<div class="news-list">';
  news.forEach(n => {
    const sentClass = n.sentiment > 0 ? 'positive' : n.sentiment < 0 ? 'negative' : 'neutral_';
    const badgeClass = n.sentiment > 0 ? 'pos' : n.sentiment < 0 ? 'neg' : 'neu';
    const sentIcon = n.sentiment > 0 ? '▲ Positivo' : n.sentiment < 0 ? '▼ Negativo' : '● Neutro';
    const tagsHtml = n.currencies.map(c => `<span class="news-tag">${c}</span>`).join('');
    const hasUrl = n.url && n.url !== '#';

    html += `
      <div class="news-item ${hasUrl ? 'clickable' : ''}" ${hasUrl ? `onclick="window.open('${n.url}', '_blank', 'noopener')"` : ''}>
        <div class="news-sentiment ${sentClass}"></div>
        <div class="news-body">
          <div class="news-title">${n.title}</div>
          <div class="news-meta">
            <span class="news-source">${n.source}</span>
            <span>${timeAgo(n.published_at)}</span>
            <div class="news-tags">${tagsHtml}</div>
            <span class="news-sentiment-badge ${badgeClass}">${sentIcon}</span>
            ${hasUrl ? '<span class="news-open-icon">↗</span>' : ''}
          </div>
        </div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ====================================================
//  Period Selectors (Liquidation Map + Ranking)
// ====================================================
function buildPeriodBar(options, activePeriod) {
  return options.map(p => `
    <button class="liq-period-btn${p === activePeriod ? ' active' : ''}" data-period="${p}">${p}</button>
  `).join('');
}

function attachLiqMapPeriodListeners(symbol) {
  const bar = document.getElementById('liqMapPeriodBar');
  if (!bar) return;
  bar.querySelectorAll('.liq-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      if (period === activeLiqMapPeriod) return;
      activeLiqMapPeriod = period;
      bar.querySelectorAll('.liq-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show loading state
      const liqEl = document.getElementById('liqChart');
      if (liqEl) liqEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px"><div class="loading-bar-wrap" style="width:120px"><div class="loading-bar"></div></div></div>';
      loadLiquidations(symbol, period);
    });
  });
}

function attachRankingPeriodListeners() {
  const bar = document.getElementById('rankingPeriodBar');
  if (!bar) return;
  bar.querySelectorAll('.liq-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      if (period === activeRankingPeriod) return;
      activeRankingPeriod = period;
      bar.querySelectorAll('.liq-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update label in card title
      const lbl = document.getElementById('rankingPeriodLabel');
      if (lbl) lbl.textContent = `(${period})`;
      // Show loading state
      const content = document.getElementById('liqRankingContent');
      if (content) content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px"><div class="loading-bar-wrap" style="width:120px"><div class="loading-bar"></div></div></div>';
      loadLiquidationRanking(period);
    });
  });
}

// ====================================================
//  Timeframe Selector
// ====================================================
function buildTfBar() {
  return TF_GROUPS.map(g => `
    <div class="tf-group">
      <span class="tf-group-label">${g.label}</span>
      ${g.intervals.map(iv => `
        <button class="tf-btn${iv === activeInterval ? ' active' : ''}" data-interval="${iv}">${iv}</button>
      `).join('')}
    </div>
  `).join('');
}

function attachTfListeners(symbol) {
  const bar = document.getElementById('tfBar');
  if (!bar) return;
  bar.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const iv = btn.dataset.interval;
      if (iv === activeInterval) return;
      activeInterval = iv;

      // Update active state visually
      bar.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const label = document.getElementById('tfActiveLabel');
      if (label) label.textContent = `${iv.toUpperCase()} · últimas 100 velas`;

      loadCandlesForInterval(symbol, iv);
    });
  });
}

async function loadCandlesForInterval(symbol, interval) {
  // Show loading state on charts
  const chartWrap = document.querySelector('#candleCard .chart-wrapper');
  const rsiWrap   = document.querySelector('#candleCard .rsi-wrapper');
  if (chartWrap) chartWrap.style.opacity = '0.4';
  if (rsiWrap)   rsiWrap.style.opacity   = '0.4';

  try {
    const res     = await fetch(`/api/candles/${symbol}/${interval}`);
    const candles = await res.json();
    if (!Array.isArray(candles) || candles.length < 10) return;

    if (charts.candle) { charts.candle.destroy(); delete charts.candle; }
    if (charts.rsi)    { charts.rsi.destroy();    delete charts.rsi;    }

    const fakeItem = { candles, symbol };
    renderCandleChart(fakeItem);
    renderRsiChart(fakeItem);
  } catch (e) {
    console.error('Erro ao carregar candles:', e);
  } finally {
    if (chartWrap) chartWrap.style.opacity = '1';
    if (rsiWrap)   rsiWrap.style.opacity   = '1';
  }
}

// ====================================================
//  Fear & Greed
// ====================================================
async function loadFearGreed() {
  try {
    const res = await fetch('/api/fear_greed');
    const data = await res.json();
    const val = parseInt(data.value, 10);
    const cls = data.classification;

    // Update header pill
    const fgVal = document.getElementById('fgValue');
    const fgCls = document.getElementById('fgClass');
    if (fgVal) {
      fgVal.textContent = val;
      fgVal.style.color = fgColor(val);
    }
    if (fgCls) {
      fgCls.textContent = fgTranslate(cls);
      fgCls.style.color = fgColor(val);
    }
    const pill = document.getElementById('fearGreedPill');
    if (pill) {
      pill.style.borderColor = fgColor(val) + '55';
    }

    // Update dashboard gauge
    const gaugeContainer = document.getElementById('fearGreedGaugeContent');
    if (gaugeContainer) renderFearGreedGauge(gaugeContainer, val, cls, data.demo);
  } catch (e) {
    console.error('Erro fear & greed:', e);
  }
}

function fgColor(v) {
  if (v <= 20) return '#ff1744';
  if (v <= 40) return '#ff9100';
  if (v <= 60) return '#ffd740';
  if (v <= 80) return '#69f0ae';
  return '#00e676';
}

function fgTranslate(cls) {
  const map = {
    'Extreme Fear': 'Medo Extremo',
    'Fear': 'Medo',
    'Neutral': 'Neutro',
    'Greed': 'Ganância',
    'Extreme Greed': 'Ganância Extrema',
  };
  return map[cls] || cls;
}

function renderFearGreedGauge(container, value, classification, isDemo) {
  const cx = 110, cy = 100, r = 80, rn = 68;

  // Point on the top semicircle arc at value v (0=left, 100=right)
  const arcPt = (v) => {
    const theta = Math.PI * (1 - v / 100);
    return [cx + r * Math.cos(theta), cy - r * Math.sin(theta)];
  };

  // Needle endpoint
  const theta = Math.PI * (1 - value / 100);
  const nx = cx + rn * Math.cos(theta);
  const ny = cy - rn * Math.sin(theta);

  const zones = [
    { from: 0,  to: 20,  color: '#ff1744' },
    { from: 20, to: 40,  color: '#ff9100' },
    { from: 40, to: 60,  color: '#ffd740' },
    { from: 60, to: 80,  color: '#69f0ae' },
    { from: 80, to: 100, color: '#00e676' },
  ];

  let zonePaths = '';
  zones.forEach(z => {
    const [x1, y1] = arcPt(z.from);
    const [x2, y2] = arcPt(z.to);
    zonePaths += `<path d="M ${x1.toFixed(1)},${y1.toFixed(1)} A ${r} ${r} 0 0 0 ${x2.toFixed(1)},${y2.toFixed(1)}" stroke="${z.color}" stroke-width="13" fill="none" stroke-linecap="butt" opacity="0.75"/>`;
  });

  const color = fgColor(value);
  const clsPt = fgTranslate(classification);

  container.innerHTML = `
    <div class="fg-gauge-wrap">
      <svg viewBox="0 0 220 112" class="fg-gauge-svg">
        ${zonePaths}
        <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="8" fill="${color}" opacity="0.85"/>
        <circle cx="${cx}" cy="${cy}" r="4" fill="#08050f"/>
        <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="20" font-weight="800" fill="${color}">${value}</text>
        <text x="${cx}" y="${cy + 32}" text-anchor="middle" font-family="Inter, sans-serif" font-size="8.5" fill="#7a5fa8" letter-spacing="0.8">${clsPt.toUpperCase()}</text>
        <text x="22" y="108" font-family="Inter, sans-serif" font-size="8" fill="#4a3570">MEDO</text>
        <text x="${cx}" y="108" text-anchor="middle" font-family="Inter, sans-serif" font-size="8" fill="#4a3570">NEUTRO</text>
        <text x="198" y="108" text-anchor="end" font-family="Inter, sans-serif" font-size="8" fill="#4a3570">GANÂNCIA</text>
      </svg>
      ${isDemo ? '<div class="fg-demo-badge">DADOS DEMO</div>' : ''}
    </div>
  `;
}

// ====================================================
//  Auto-refresh
// ====================================================
loadMarket();
setInterval(loadMarket, 60000); // refresh every 60s
