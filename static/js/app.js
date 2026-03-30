// ====================================================
//  CryptoAnalyzer - Frontend App
// ====================================================

let allData = [];
let activeSymbol = null;
let charts = {};

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
    capEl.innerHTML = `24h: <strong style="color:${pct >= 0 ? 'var(--green)' : 'var(--red)'}">${pct >= 0 ? '+' : ''}${pct}%</strong>`;
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
    const sigColor = item.signal.color;
    tab.innerHTML = `
      <div>
        <div class="tab-symbol">${item.symbol.replace('USDT', '')}</div>
        <div class="tab-price">${formatPrice(item.ticker.price)}</div>
        <div class="tab-change ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%</div>
      </div>
      <div class="tab-signal-dot" style="background:${sigColor};box-shadow:0 0 6px ${sigColor}"></div>
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
        <div class="card-title"><span>📈</span> Gráfico de Preço (1H) — ${item.symbol}</div>
        <div class="chart-wrapper"><canvas id="candleChart"></canvas></div>
        <div class="rsi-wrapper"><canvas id="rsiChart"></canvas></div>
      </div>
    </div>
    <div class="bottom-row">
      <div class="card" id="liqCard">
        <div class="card-title"><span>💥</span> Mapa de Liquidações — ${item.symbol}</div>
        <div class="liq-chart-wrapper"><canvas id="liqChart"></canvas></div>
        <div class="liq-legend">
          <div class="liq-legend-item"><div class="liq-dot" style="background:#ff1744"></div> Liquidações Long (vendedores forçados abaixo)</div>
          <div class="liq-legend-item"><div class="liq-dot" style="background:#00e676"></div> Liquidações Short (compradores forçados acima)</div>
        </div>
      </div>
      <div class="card" id="volCard">
        <div class="card-title"><span>📊</span> Volume & MACD</div>
        <div class="vol-wrapper"><canvas id="volChart"></canvas></div>
      </div>
    </div>
    <div class="full-row">
      <div class="card" id="liqRankingCard">
        <div class="card-title"><span>🏆</span> Ranking de Liquidações — Top 10 Tokens (24h)</div>
        <div id="liqRankingContent"><div class="loading-overlay"><div class="spinner"></div></div></div>
      </div>
      <div class="card" id="newsCard">
        <div class="card-title"><span>📰</span> Notícias Crypto — Últimas Horas</div>
        <div id="newsContent"><div class="loading-overlay"><div class="spinner"></div></div></div>
      </div>
    </div>
  `;
  main.appendChild(dash);

  renderSignalCard(item);
  renderCandleChart(item);
  renderRsiChart(item);
  renderVolMacdChart(item);
  loadLiquidations(item.symbol);
  loadLiquidationRanking();
  loadNews();
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
    <div class="card-title"><span>🎯</span> Recomendação — ${item.symbol.replace('USDT','')}</div>
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
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Motivos da Análise</div>
      ${reasonsHtml || '<div class="reason-item"><span>Sem sinais claros no momento</span></div>'}
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
          borderColor: 'rgba(171,71,188,0.5)', borderWidth: 1,
          pointRadius: 0, fill: '+1', backgroundColor: 'rgba(171,71,188,0.04)',
          tension: 0.3, order: 4,
        },
        {
          type: 'line', label: 'BB Média',
          data: ts.map((t, i) => ({x: t, y: middle[i]})),
          borderColor: 'rgba(171,71,188,0.6)', borderWidth: 1,
          pointRadius: 0, borderDash: [4, 4],
          tension: 0.3, order: 3,
        },
        {
          type: 'line', label: 'BB Inferior',
          data: ts.map((t, i) => ({x: t, y: lower[i]})),
          borderColor: 'rgba(171,71,188,0.5)', borderWidth: 1,
          pointRadius: 0, fill: '-1', backgroundColor: 'rgba(171,71,188,0.04)',
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
          borderColor: '#00e5ff', borderWidth: 1.5,
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
          labels: { color: '#64748b', boxWidth: 16, font: { size: 11 } }
        },
        tooltip: {
          backgroundColor: '#111827',
          borderColor: '#1e3050',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', displayFormats: { hour: 'dd/MM HH:mm' } },
          grid: { color: 'rgba(30,48,80,0.5)' },
          ticks: { color: '#64748b', maxTicksLimit: 8 },
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
          borderColor: '#ab47bc',
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
          grid: { color: 'rgba(30,48,80,0.3)' },
          ticks: { color: '#64748b', maxTicksLimit: 6, font: { size: 10 } }
        },
        y: {
          position: 'right',
          min: 0, max: 100,
          grid: { color: 'rgba(30,48,80,0.3)' },
          ticks: { color: '#64748b', font: { size: 10 } }
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
          borderColor: '#00e5ff', borderWidth: 1.5,
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
        legend: { labels: { color: '#64748b', boxWidth: 12, font: { size: 11 } } },
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
          grid: { color: 'rgba(30,48,80,0.3)' },
          ticks: { color: '#64748b', callback: v => formatVol(v), font: { size: 10 } },
        },
        yMacd: {
          position: 'right',
          grid: { display: false },
          ticks: { color: '#64748b', font: { size: 10 } },
        }
      }
    }
  });
}

// ====================================================
//  Liquidation Map
// ====================================================
async function loadLiquidations(symbol) {
  try {
    const res = await fetch(`/api/liquidations/${symbol}`);
    const data = await res.json();
    renderLiquidationChart(data);
  } catch (e) {
    console.error('Erro liquidações:', e);
  }
}

function renderLiquidationChart(data) {
  const ctx = document.getElementById('liqChart');
  if (!ctx) return;

  const prices = data.prices;
  const longs = data.long_liquidations;
  const shorts = data.short_liquidations;
  const current = data.current_price;

  // Find current price index for annotation
  let closestIdx = 0;
  let minDist = Infinity;
  prices.forEach((p, i) => {
    const d = Math.abs(p - current);
    if (d < minDist) { minDist = d; closestIdx = i; }
  });

  charts.liq = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: prices.map(p => formatPrice(p)),
      datasets: [
        {
          label: 'Liquidações Long',
          data: longs,
          backgroundColor: prices.map((p, i) => {
            const intensity = longs[i] / 100;
            return `rgba(255,23,68,${0.2 + intensity * 0.7})`;
          }),
          borderColor: 'rgba(255,23,68,0.8)',
          borderWidth: prices.map((_, i) => i === closestIdx ? 2 : 0),
          borderSkipped: false,
        },
        {
          label: 'Liquidações Short',
          data: shorts,
          backgroundColor: prices.map((p, i) => {
            const intensity = shorts[i] / 100;
            return `rgba(0,230,118,${0.2 + intensity * 0.7})`;
          }),
          borderColor: 'rgba(0,230,118,0.8)',
          borderWidth: 0,
          borderSkipped: false,
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#111827', borderColor: '#1e3050', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#94a3b8',
          callbacks: {
            title: (items) => `Preço: ${items[0].label}`,
            label: (item) => `${item.dataset.label}: ${item.raw.toFixed(1)}%`,
          }
        },
        annotation: {
          annotations: {
            currentPrice: {
              type: 'line',
              yMin: closestIdx,
              yMax: closestIdx,
              borderColor: '#ffd740',
              borderWidth: 2,
              borderDash: [6, 3],
              label: {
                display: true,
                content: `Preço Atual: ${formatPrice(current)}`,
                backgroundColor: '#ffd740',
                color: '#0a0e1a',
                font: { weight: 'bold', size: 11 },
                position: 'end',
              }
            }
          }
        }
      },
      scales: {
        x: {
          stacked: false,
          grid: { color: 'rgba(30,48,80,0.4)' },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            callback: v => v + '%'
          }
        },
        y: {
          stacked: false,
          grid: { color: 'rgba(30,48,80,0.2)' },
          ticks: {
            color: (ctx) => {
              if (ctx.index === closestIdx) return '#ffd740';
              return '#475569';
            },
            font: (ctx) => ({
              size: ctx.index === closestIdx ? 12 : 10,
              weight: ctx.index === closestIdx ? 'bold' : 'normal',
            }),
            maxTicksLimit: 20,
          }
        }
      }
    }
  });
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
async function loadLiquidationRanking() {
  const container = document.getElementById('liqRankingContent');
  if (!container) return;
  try {
    const res = await fetch('/api/liquidations_ranking');
    const data = await res.json();
    renderLiquidationRanking(data, container);
  } catch (e) {
    container.innerHTML = '<p style="color:var(--text-muted)">Erro ao carregar ranking</p>';
  }
}

function renderLiquidationRanking(data, container) {
  if (!data.length) { container.innerHTML = '<p>Sem dados</p>'; return; }

  const totalLong  = data.reduce((a, d) => a + d.liq_24h_long, 0);
  const totalShort = data.reduce((a, d) => a + d.liq_24h_short, 0);
  const totalAll   = totalLong + totalShort;
  const maxLiq     = Math.max(...data.map(d => d.liq_24h_total));

  let html = `
    <div class="liq-summary-row">
      <div class="liq-summary-box">
        <div class="liq-summary-label">Total Liquidado (24h)</div>
        <div class="liq-summary-value" style="color:var(--accent)">${formatBig(totalAll)}</div>
      </div>
      <div class="liq-summary-box">
        <div class="liq-summary-label">Longs Liquidados</div>
        <div class="liq-summary-value" style="color:var(--red)">${formatBig(totalLong)}</div>
      </div>
      <div class="liq-summary-box">
        <div class="liq-summary-label">Shorts Liquidados</div>
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
          <th>Liq. Long</th>
          <th>Liq. Short</th>
          <th>Total Liq.</th>
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

    html += `
      <div class="news-item">
        <div class="news-sentiment ${sentClass}"></div>
        <div class="news-body">
          <div class="news-title">${n.url !== '#' ? `<a href="${n.url}" target="_blank" rel="noopener">${n.title}</a>` : n.title}</div>
          <div class="news-meta">
            <span class="news-source">${n.source}</span>
            <span>${timeAgo(n.published_at)}</span>
            <div class="news-tags">${tagsHtml}</div>
            <span class="news-sentiment-badge ${badgeClass}">${sentIcon}</span>
          </div>
        </div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ====================================================
//  Auto-refresh
// ====================================================
loadMarket();
setInterval(loadMarket, 60000); // refresh every 60s
