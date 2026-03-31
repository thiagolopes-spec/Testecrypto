from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
import requests
import random
import math
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

BINANCE_BASE = "https://api.binance.com/api/v3"
BINANCE_FUTURES = "https://fapi.binance.com/fapi/v1"

VALID_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']
INTERVAL_MINUTES = {
    '1m': 1, '5m': 5, '15m': 15, '30m': 30,
    '1h': 60, '2h': 120, '4h': 240, '6h': 360, '12h': 720, '1d': 1440,
}

# Liquidation period → (candle_interval, limit)
LIQ_PERIOD_PARAMS = {
    '4h':  ('1h',  4),
    '8h':  ('1h',  8),
    '12h': ('1h', 12),
    '24h': ('1h', 24),
    '3d':  ('4h', 18),
    '7d':  ('1d',  7),
}
RANKING_PERIOD_PARAMS = {
    '4h':  ('1h',  4),
    '8h':  ('1h',  8),
    '12h': ('1h', 12),
    '24h': ('1h', 24),
}

SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
    "LTCUSDT", "ATOMUSDT", "NEARUSDT", "INJUSDT", "APTUSDT",
    "ARBUSDT", "OPUSDT", "MATICUSDT", "UNIUSDT", "AAVEUSDT",
]

DEMO_PRICES = {
    "BTCUSDT":   62400.0,
    "ETHUSDT":   3120.0,
    "BNBUSDT":   420.0,
    "SOLUSDT":   142.0,
    "XRPUSDT":   0.52,
    "ADAUSDT":   0.44,
    "DOGEUSDT":  0.12,
    "AVAXUSDT":  36.5,
    "DOTUSDT":   7.20,
    "LINKUSDT":  14.8,
    "LTCUSDT":   82.0,
    "ATOMUSDT":  8.90,
    "NEARUSDT":  5.40,
    "INJUSDT":   24.5,
    "APTUSDT":   8.10,
    "ARBUSDT":   1.08,
    "OPUSDT":    2.15,
    "MATICUSDT": 0.88,
    "UNIUSDT":   9.40,
    "AAVEUSDT":  215.0,
}

# ====================================================
#  Demo Data Generator (pure Python)
# ====================================================
def generate_demo_klines(symbol, limit=100, interval='1h'):
    base = DEMO_PRICES[symbol]
    interval_min = INTERVAL_MINUTES.get(interval, 60)
    scale = math.sqrt(interval_min / 60.0)   # volatility scales with sqrt(time)

    now = datetime.utcnow().replace(second=0, microsecond=0)
    if interval_min >= 1440:
        now = now.replace(hour=0, minute=0)
    elif interval_min >= 60:
        now = now.replace(minute=0)
    else:
        aligned = (now.minute // interval_min) * interval_min
        now = now.replace(minute=aligned)

    trends = {
        "BTCUSDT": 0.0003, "ETHUSDT": -0.0002, "BNBUSDT": 0.0001, "SOLUSDT": 0.0004, "XRPUSDT": -0.0001,
        "ADAUSDT": 0.0002, "DOGEUSDT": 0.0005, "AVAXUSDT": -0.0003, "DOTUSDT": 0.0001, "LINKUSDT": 0.0003,
        "LTCUSDT": -0.0001, "ATOMUSDT": 0.0002, "NEARUSDT": 0.0004, "INJUSDT": 0.0003, "APTUSDT": -0.0002,
        "ARBUSDT": 0.0001, "OPUSDT": -0.0002, "MATICUSDT": 0.0001, "UNIUSDT": 0.0002, "AAVEUSDT": 0.0003,
    }
    base_drift = trends.get(symbol, 0)
    drift      = base_drift * scale
    volatility = base * 0.012 * scale

    rows = []
    price = base * (1 - base_drift * limit * 0.5)
    rng = random.Random((hash(symbol) + hash(interval)) % 99999)
    for i in range(limit):
        ts = now - timedelta(minutes=interval_min * (limit - i))
        change = rng.gauss(drift, 0.008 * scale) * price
        open_p  = price
        close_p = price + change
        high_p  = max(open_p, close_p) + abs(rng.gauss(0, volatility * 0.3))
        low_p   = min(open_p, close_p) - abs(rng.gauss(0, volatility * 0.3))
        vol     = abs(rng.gauss(base * 200, base * 80))
        rows.append({
            "open_time": ts.strftime("%Y-%m-%dT%H:%M:%S"),
            "open":  round(open_p, 4),
            "high":  round(high_p, 4),
            "low":   round(low_p, 4),
            "close": round(close_p, 4),
            "volume": round(vol, 2),
        })
        price = close_p
    return rows

def generate_demo_ticker(symbol):
    base = DEMO_PRICES[symbol]
    changes = {
        "BTCUSDT": 2.34, "ETHUSDT": -3.12, "BNBUSDT": 1.05, "SOLUSDT": 5.67, "XRPUSDT": -1.88,
        "ADAUSDT": 3.21, "DOGEUSDT": 8.44, "AVAXUSDT": -2.15, "DOTUSDT": 1.77, "LINKUSDT": 4.02,
        "LTCUSDT": -1.23, "ATOMUSDT": 2.88, "NEARUSDT": 6.41, "INJUSDT": 3.55, "APTUSDT": -4.10,
        "ARBUSDT": 1.90, "OPUSDT": -2.77, "MATICUSDT": 0.95, "UNIUSDT": 2.44, "AAVEUSDT": 3.18,
    }
    chg = changes.get(symbol, 0)
    return {"price": base, "change_pct": chg, "volume": base * 18000, "high": base * 1.03, "low": base * 0.97}

# ====================================================
#  Live Fetchers with demo fallback
# ====================================================
def fetch_klines(symbol, limit=100, interval='1h'):
    try:
        url = f"{BINANCE_BASE}/klines"
        params = {"symbol": symbol, "interval": interval, "limit": limit}
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        data = r.json()
        rows = []
        for d in data:
            rows.append({
                "open_time": datetime.utcfromtimestamp(d[0]/1000).strftime("%Y-%m-%dT%H:%M:%S"),
                "open":   float(d[1]),
                "high":   float(d[2]),
                "low":    float(d[3]),
                "close":  float(d[4]),
                "volume": float(d[5]),
            })
        return rows
    except Exception:
        return generate_demo_klines(symbol, limit, interval)

def fetch_klines_4h(symbol, limit=100):
    return fetch_klines(symbol, limit, '4h')

def fetch_ticker(symbol):
    try:
        r = requests.get(f"{BINANCE_BASE}/ticker/24hr", params={"symbol": symbol}, timeout=8)
        r.raise_for_status()
        d = r.json()
        return {"price": float(d["lastPrice"]), "change_pct": float(d["priceChangePercent"]),
                "volume": float(d["quoteVolume"]), "high": float(d["highPrice"]), "low": float(d["lowPrice"])}
    except Exception:
        return generate_demo_ticker(symbol)

def fetch_open_interest(symbol):
    try:
        r = requests.get(f"{BINANCE_FUTURES}/openInterest", params={"symbol": symbol}, timeout=8)
        r.raise_for_status()
        return float(r.json().get("openInterest", 0))
    except Exception:
        base_oi = {
            "BTCUSDT": 85000, "ETHUSDT": 1200000, "BNBUSDT": 450000, "SOLUSDT": 2800000, "XRPUSDT": 150000000,
            "ADAUSDT": 52000000, "DOGEUSDT": 85000000, "AVAXUSDT": 3200000, "DOTUSDT": 12000000, "LINKUSDT": 8500000,
            "LTCUSDT": 550000, "ATOMUSDT": 4200000, "NEARUSDT": 18000000, "INJUSDT": 2100000, "APTUSDT": 9800000,
            "ARBUSDT": 45000000, "OPUSDT": 22000000, "MATICUSDT": 95000000, "UNIUSDT": 3800000, "AAVEUSDT": 280000,
        }
        return base_oi.get(symbol, 100000)

# ====================================================
#  Technical Indicators (pure Python)
# ====================================================
def calc_ema(data, period):
    k = 2.0 / (period + 1)
    result = [None] * len(data)
    ema = data[0]
    result[0] = ema
    for i in range(1, len(data)):
        ema = data[i] * k + ema * (1 - k)
        result[i] = ema if i >= period - 1 else None
    return result

def calc_rsi(data, period=14):
    result = [None] * len(data)
    if len(data) < period + 1:
        return result
    gains, losses = 0.0, 0.0
    for i in range(1, period + 1):
        d = data[i] - data[i-1]
        if d >= 0: gains += d
        else: losses -= d
    avg_gain = gains / period
    avg_loss = losses / period
    result[period] = 100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, len(data)):
        d = data[i] - data[i-1]
        avg_gain = (avg_gain * (period - 1) + max(d, 0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0)) / period
        result[i] = 100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return result

def calc_macd_py(data, fast=12, slow=26, signal=9):
    ema_fast = calc_ema(data, fast)
    ema_slow = calc_ema(data, slow)
    macd = [
        (ema_fast[i] - ema_slow[i]) if (ema_fast[i] is not None and ema_slow[i] is not None) else None
        for i in range(len(data))
    ]
    macd_vals = [v if v is not None else 0 for v in macd]
    sig = calc_ema(macd_vals, signal)
    hist = [
        (macd[i] - sig[i]) if (macd[i] is not None and sig[i] is not None) else None
        for i in range(len(data))
    ]
    return macd, sig, hist

def calc_bollinger_py(data, period=20):
    upper, middle, lower = [], [], []
    for i in range(len(data)):
        if i < period - 1:
            upper.append(None); middle.append(None); lower.append(None)
            continue
        sl = data[i-period+1:i+1]
        avg = sum(sl) / period
        std = math.sqrt(sum((x - avg)**2 for x in sl) / period)
        upper.append(avg + 2*std)
        middle.append(avg)
        lower.append(avg - 2*std)
    return upper, middle, lower

def generate_signal(candles):
    closes = [c["close"] for c in candles]
    rsi_vals = calc_rsi(closes)
    macd_vals, sig_vals, hist_vals = calc_macd_py(closes)
    bb_upper, bb_mid, bb_lower = calc_bollinger_py(closes)
    ema9  = calc_ema(closes, 9)
    ema21 = calc_ema(closes, 21)
    ema50 = calc_ema(closes, 50)

    latest  = closes[-1]
    rsi_val  = next((v for v in reversed(rsi_vals) if v is not None), 50)
    macd_val = next((v for v in reversed(macd_vals) if v is not None), 0)
    sig_val  = next((v for v in reversed(sig_vals) if v is not None), 0)
    hist_val = next((v for v in reversed(hist_vals) if v is not None), 0)
    bb_up    = next((v for v in reversed(bb_upper) if v is not None), latest * 1.02)
    bb_lo    = next((v for v in reversed(bb_lower) if v is not None), latest * 0.98)
    e9  = next((v for v in reversed(ema9) if v is not None), latest)
    e21 = next((v for v in reversed(ema21) if v is not None), latest)
    e50 = next((v for v in reversed(ema50) if v is not None), latest)

    score = 0
    reasons = []

    if rsi_val < 30:
        score += 3; reasons.append(f"RSI sobrevendido ({rsi_val:.1f}) — reversão provável")
    elif rsi_val < 45:
        score += 1; reasons.append(f"RSI em zona de acumulação ({rsi_val:.1f})")
    elif rsi_val > 70:
        score -= 3; reasons.append(f"RSI sobrecomprado ({rsi_val:.1f}) — correção provável")
    elif rsi_val > 55:
        score -= 1; reasons.append(f"RSI em zona de distribuição ({rsi_val:.1f})")

    if macd_val > sig_val and hist_val > 0:
        score += 2; reasons.append("MACD acima da linha de sinal — momentum positivo")
    elif macd_val < sig_val and hist_val < 0:
        score -= 2; reasons.append("MACD abaixo da linha de sinal — momentum negativo")

    if latest <= bb_lo:
        score += 2; reasons.append("Preço tocando banda inferior de Bollinger (suporte)")
    elif latest >= bb_up:
        score -= 2; reasons.append("Preço tocando banda superior de Bollinger (resistência)")

    if e9 > e21 > e50:
        score += 2; reasons.append("Tendência altista confirmada (EMA 9 > 21 > 50)")
    elif e9 < e21 < e50:
        score -= 2; reasons.append("Tendência baixista confirmada (EMA 9 < 21 < 50)")
    elif e9 > e21:
        score += 1; reasons.append("EMA de curto prazo acima da média — tendência positiva")

    if score >= 4:   action, color, conf = "COMPRA FORTE", "#00e676", min(95, 60 + score * 5)
    elif score >= 2: action, color, conf = "COMPRA",       "#69f0ae", min(80, 55 + score * 5)
    elif score <= -4: action, color, conf = "VENDA FORTE", "#ff1744", min(95, 60 + abs(score) * 5)
    elif score <= -2: action, color, conf = "VENDA",       "#ff5252", min(80, 55 + abs(score) * 5)
    else:             action, color, conf = "NEUTRO",      "#ffd740", 50

    return {
        "action": action, "color": color, "confidence": int(conf), "score": score, "reasons": reasons,
        "indicators": {
            "rsi": round(rsi_val, 2), "macd": round(macd_val, 4),
            "macd_signal": round(sig_val, 4), "macd_hist": round(hist_val, 4),
            "bb_upper": round(bb_up, 2), "bb_lower": round(bb_lo, 2),
            "ema9": round(e9, 2), "ema21": round(e21, 2), "ema50": round(e50, 2),
        }
    }

# ====================================================
#  Liquidation Zone Builder (pure Python)
# ====================================================
def build_liquidation_zones(candles, current_price):
    lows   = [c["low"]    for c in candles]
    highs  = [c["high"]   for c in candles]
    closes = [c["close"]  for c in candles]
    vols   = [c["volume"] for c in candles]

    price_min = min(lows)   * 0.97
    price_max = max(highs)  * 1.03
    n_levels  = 40
    step = (price_max - price_min) / (n_levels - 1)
    levels = [price_min + i * step for i in range(n_levels)]

    intensity = [0.0] * n_levels
    for i in range(len(closes)):
        candle_range = highs[i] - lows[i]
        if candle_range == 0:
            continue
        for j, price in enumerate(levels):
            if lows[i] <= price <= highs[i]:
                prox = 1 - abs(price - closes[i]) / candle_range
                intensity[j] += vols[i] * (0.3 + 0.7 * prox)

    for j, price in enumerate(levels):
        zeros = len(f"{price:.0f}") - len(f"{price:.0f}".rstrip('0'))
        intensity[j] *= (1 + zeros * 0.3)

    long_liq  = intensity[:]
    short_liq = intensity[:]
    for j, price in enumerate(levels):
        dist = (price - current_price) / current_price
        if price < current_price:
            long_liq[j]  *= max(0, 1 + dist * 6)
            short_liq[j] *= 0.15
        else:
            short_liq[j] *= max(0, 1 - dist * 6)
            long_liq[j]  *= 0.15

    max_val = max(max(long_liq), max(short_liq), 1)
    return {
        "prices":             [round(p, 2) for p in levels],
        "long_liquidations":  [round(v / max_val * 100, 1) for v in long_liq],
        "short_liquidations": [round(v / max_val * 100, 1) for v in short_liq],
        "current_price":      current_price,
    }

# ====================================================
#  Routes
# ====================================================
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/market")
def market_data():
    result = []
    for sym in SYMBOLS:
        ticker  = fetch_ticker(sym)
        candles = fetch_klines(sym, 100)
        if not ticker or not candles or len(candles) < 30:
            continue
        signal = generate_signal(candles)
        result.append({
            "symbol":  sym,
            "ticker":  ticker,
            "signal":  signal,
            "candles": candles[-60:],
        })
    return jsonify(result)

@app.route("/api/liquidations/<symbol>")
def liquidation_map(symbol):
    symbol = symbol.upper()
    if symbol not in SYMBOLS:
        return jsonify({"error": "Symbol not supported"}), 400
    period = request.args.get('period', '24h')
    if period not in LIQ_PERIOD_PARAMS:
        period = '24h'
    liq_interval, liq_limit = LIQ_PERIOD_PARAMS[period]
    ticker  = fetch_ticker(symbol)
    candles = fetch_klines(symbol, limit=liq_limit, interval=liq_interval)
    if not ticker or not candles:
        return jsonify({"error": "Failed to fetch data"}), 500
    liq = build_liquidation_zones(candles, ticker["price"])
    liq["open_interest"] = fetch_open_interest(symbol)
    liq["symbol"] = symbol
    liq["period"] = period
    return jsonify(liq)

@app.route("/api/candles/<symbol>/<interval>")
def candles_by_interval(symbol, interval):
    symbol   = symbol.upper()
    interval = interval.lower()
    if symbol not in SYMBOLS:
        return jsonify({"error": "Symbol not supported"}), 400
    if interval not in VALID_INTERVALS:
        return jsonify({"error": f"Invalid interval. Use one of: {', '.join(VALID_INTERVALS)}"}), 400
    rows = fetch_klines(symbol, limit=100, interval=interval)
    return jsonify(rows)

@app.route("/api/dominance")
def market_dominance():
    try:
        r = requests.get("https://api.coingecko.com/api/v3/global", timeout=8)
        r.raise_for_status()
        data = r.json()["data"]
        dom  = data.get("market_cap_percentage", {})
        return jsonify({
            "btc_dominance":      round(dom.get("btc", 0), 2),
            "eth_dominance":      round(dom.get("eth", 0), 2),
            "total_market_cap":   data.get("total_market_cap", {}).get("usd", 0),
            "total_volume":       data.get("total_volume", {}).get("usd", 0),
            "market_cap_change_24h": round(data.get("market_cap_change_percentage_24h_usd", 0), 2),
            "demo": False,
        })
    except Exception:
        return jsonify({
            "btc_dominance": 54.8, "eth_dominance": 8.9,
            "total_market_cap": 2_740_000_000_000,
            "total_volume":       98_400_000_000,
            "market_cap_change_24h": 1.24,
            "demo": True,
        })

@app.route("/api/liquidations_ranking")
def liquidation_ranking():
    """Top 20 tokens with liquidation estimates based on volume, OI and volatility."""
    period = request.args.get('period', '24h')
    if period not in RANKING_PERIOD_PARAMS:
        period = '24h'
    rank_interval, rank_limit = RANKING_PERIOD_PARAMS[period]

    ranking = []
    for sym in SYMBOLS:
        ticker = fetch_ticker(sym)
        if not ticker:
            continue
        candles = fetch_klines(sym, rank_limit, rank_interval)
        if not candles or len(candles) < 2:
            continue
        oi = fetch_open_interest(sym)
        price = ticker["price"]

        highs = [c["high"]   for c in candles]
        lows  = [c["low"]    for c in candles]
        vols  = [c["volume"] for c in candles]
        avg_range      = sum(h - l for h, l in zip(highs, lows)) / len(highs)
        volatility_pct = (avg_range / price * 100) if price > 0 else 0

        liq_long  = round(oi * price * volatility_pct * 0.0008, 2)
        liq_short = round(oi * price * volatility_pct * 0.0006, 2)
        liq_total = round(liq_long + liq_short, 2)

        recent_low  = min(lows)  if lows  else price * 0.97
        recent_high = max(highs) if highs else price * 1.03

        ranking.append({
            "symbol": sym,
            "price": price,
            "change_pct": ticker["change_pct"],
            "open_interest": oi,
            "oi_value_usd": round(oi * price, 2),
            "liq_24h_long":  liq_long,
            "liq_24h_short": liq_short,
            "liq_24h_total": liq_total,
            "volatility_24h": round(volatility_pct, 2),
            "volume_24h": ticker["volume"],
            "support": round(recent_low, 4),
            "resistance": round(recent_high, 4),
        })

    ranking.sort(key=lambda x: x["liq_24h_total"], reverse=True)
    return jsonify({"data": ranking, "period": period})

@app.route("/api/news")
def crypto_news():
    """Fetch crypto news from CryptoPanic or fallback to demo."""
    # Try CryptoPanic public API (no auth required for public posts)
    try:
        r = requests.get("https://cryptopanic.com/api/free/v1/posts/?auth_token=public&public=true&kind=news", timeout=8)
        r.raise_for_status()
        data = r.json()
        news = []
        for item in data.get("results", [])[:15]:
            news.append({
                "title": item.get("title", ""),
                "url": item.get("url", "#"),
                "source": item.get("source", {}).get("title", "Desconhecido"),
                "published_at": item.get("published_at", ""),
                "currencies": [c.get("code", "") for c in item.get("currencies", [])],
                "kind": item.get("kind", "news"),
                "sentiment": item.get("votes", {}).get("positive", 0) - item.get("votes", {}).get("negative", 0),
            })
        return jsonify({"news": news, "demo": False})
    except Exception:
        pass

    # Demo news
    demo_news = [
        {"title": "Bitcoin registra entrada recorde em ETFs spot pela terceira semana consecutiva", "url": "https://www.coindesk.com", "source": "CoinDesk", "published_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["BTC"], "kind": "news", "sentiment": 3},
        {"title": "Ethereum se prepara para atualização Pectra: o que esperar nos próximos meses", "url": "https://www.theblock.co", "source": "The Block", "published_at": (datetime.utcnow() - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["ETH"], "kind": "news", "sentiment": 2},
        {"title": "SEC adia decisão sobre ETF de Solana para o segundo semestre do ano", "url": "https://www.bloomberg.com/crypto", "source": "Bloomberg", "published_at": (datetime.utcnow() - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["SOL"], "kind": "news", "sentiment": -1},
        {"title": "Bitcoin testa resistência histórica: analistas divergem sobre próximo movimento", "url": "https://cointelegraph.com", "source": "CoinTelegraph", "published_at": (datetime.utcnow() - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["BTC"], "kind": "news", "sentiment": 0},
        {"title": "Binance anuncia programa de queima de BNB com ritmo acelerado", "url": "https://cointelegraph.com", "source": "CoinTelegraph", "published_at": (datetime.utcnow() - timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["BNB"], "kind": "news", "sentiment": 2},
        {"title": "Whale alert: grande transferência de BTC detectada entre carteiras frias", "url": "https://whale-alert.io", "source": "Whale Alert", "published_at": (datetime.utcnow() - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["BTC"], "kind": "news", "sentiment": -2},
        {"title": "XRP Ledger recebe atualização para suportar smart contracts nativos", "url": "https://decrypt.co", "source": "Decrypt", "published_at": (datetime.utcnow() - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["XRP"], "kind": "news", "sentiment": 3},
        {"title": "Mercado de futuros crypto registra volume elevado de liquidações nas últimas 24h", "url": "https://www.coinglass.com", "source": "Coinglass", "published_at": (datetime.utcnow() - timedelta(hours=7)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["BTC", "ETH"], "kind": "news", "sentiment": -1},
        {"title": "Solana supera Ethereum em número de transações diárias pelo quinto dia seguido", "url": "https://decrypt.co", "source": "Decrypt", "published_at": (datetime.utcnow() - timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["SOL", "ETH"], "kind": "news", "sentiment": 2},
        {"title": "Dogecoin apresenta forte volatilidade após menção em rede social", "url": "https://www.coindesk.com", "source": "CoinDesk", "published_at": (datetime.utcnow() - timedelta(hours=9)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["DOGE"], "kind": "news", "sentiment": 1},
        {"title": "Avalanche fecha parceria com grande instituição europeia para tokenização de ativos", "url": "https://www.theblock.co", "source": "The Block", "published_at": (datetime.utcnow() - timedelta(hours=10)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["AVAX"], "kind": "news", "sentiment": 3},
        {"title": "Chainlink integra serviço de oracle em mais 5 redes Layer 2", "url": "https://cryptoslate.com", "source": "CryptoSlate", "published_at": (datetime.utcnow() - timedelta(hours=11)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["LINK"], "kind": "news", "sentiment": 2},
        {"title": "Federal Reserve mantém postura cautelosa sobre taxas — crypto monitora reação dos mercados", "url": "https://www.reuters.com/markets/currencies", "source": "Reuters", "published_at": (datetime.utcnow() - timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": [], "kind": "news", "sentiment": 0},
        {"title": "Cardano lança Hydra V2 com melhorias significativas de escalabilidade", "url": "https://cointelegraph.com", "source": "CoinTelegraph", "published_at": (datetime.utcnow() - timedelta(hours=13)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["ADA"], "kind": "news", "sentiment": 2},
        {"title": "NEAR Protocol anuncia integração com inteligência artificial para smart contracts", "url": "https://cryptoslate.com", "source": "CryptoSlate", "published_at": (datetime.utcnow() - timedelta(hours=14)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["NEAR"], "kind": "news", "sentiment": 3},
        {"title": "Uniswap V4 entra em fase de testes públicos com nova estrutura de taxas", "url": "https://decrypt.co", "source": "Decrypt", "published_at": (datetime.utcnow() - timedelta(hours=16)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["UNI"], "kind": "news", "sentiment": 2},
        {"title": "Polygon (MATIC) confirma migração completa para POL concluída com sucesso", "url": "https://www.theblock.co", "source": "The Block", "published_at": (datetime.utcnow() - timedelta(hours=18)).strftime("%Y-%m-%dT%H:%M:%SZ"), "currencies": ["MATIC"], "kind": "news", "sentiment": 2},
    ]
    return jsonify({"news": demo_news, "demo": True})

@app.route("/api/fear_greed")
def fear_greed():
    """Fetch Fear & Greed index from alternative.me or return demo."""
    try:
        r = requests.get("https://api.alternative.me/fng/?limit=1", timeout=8)
        r.raise_for_status()
        d = r.json()["data"][0]
        return jsonify({
            "value":              int(d["value"]),
            "classification":     d["value_classification"],
            "timestamp":          d["timestamp"],
            "demo":               False,
        })
    except Exception:
        return jsonify({
            "value":          42,
            "classification": "Fear",
            "timestamp":      str(int(datetime.utcnow().timestamp())),
            "demo":           True,
        })

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
