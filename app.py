from flask import Flask, jsonify, render_template
from flask_cors import CORS
import requests
import random
import math
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

BINANCE_BASE = "https://api.binance.com/api/v3"
BINANCE_FUTURES = "https://fapi.binance.com/fapi/v1"

SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
           "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT"]

DEMO_PRICES = {
    "BTCUSDT": 83200.0,
    "ETHUSDT": 1835.0,
    "BNBUSDT": 598.0,
    "SOLUSDT": 124.5,
    "XRPUSDT": 2.14,
    "ADAUSDT": 0.68,
    "DOGEUSDT": 0.165,
    "AVAXUSDT": 34.5,
    "DOTUSDT": 6.12,
    "LINKUSDT": 13.8,
}

# ====================================================
#  Demo Data Generator (pure Python)
# ====================================================
def generate_demo_klines(symbol, limit=100):
    base = DEMO_PRICES[symbol]
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    trends = {"BTCUSDT": 0.0003, "ETHUSDT": -0.0002, "BNBUSDT": 0.0001, "SOLUSDT": 0.0004, "XRPUSDT": -0.0001,
               "ADAUSDT": 0.0002, "DOGEUSDT": 0.0005, "AVAXUSDT": -0.0003, "DOTUSDT": 0.0001, "LINKUSDT": 0.0003}
    drift = trends.get(symbol, 0)
    volatility = base * 0.012
    rows = []
    price = base * (1 - drift * limit * 0.5)
    rng = random.Random(hash(symbol) % 99999)
    for i in range(limit):
        ts = now - timedelta(hours=(limit - i))
        change = rng.gauss(drift, 0.008) * price
        open_p = price
        close_p = price + change
        high_p = max(open_p, close_p) + abs(rng.gauss(0, volatility * 0.3))
        low_p  = min(open_p, close_p) - abs(rng.gauss(0, volatility * 0.3))
        vol    = abs(rng.gauss(base * 200, base * 80))
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
    changes = {"BTCUSDT": 2.34, "ETHUSDT": -3.12, "BNBUSDT": 1.05, "SOLUSDT": 5.67, "XRPUSDT": -1.88,
                "ADAUSDT": 3.21, "DOGEUSDT": 8.44, "AVAXUSDT": -2.15, "DOTUSDT": 1.77, "LINKUSDT": 4.02}
    chg = changes.get(symbol, 0)
    return {"price": base, "change_pct": chg, "volume": base * 18000, "high": base * 1.03, "low": base * 0.97}

# ====================================================
#  Live Fetchers with demo fallback
# ====================================================
def fetch_klines(symbol, limit=100):
    try:
        url = f"{BINANCE_BASE}/klines"
        params = {"symbol": symbol, "interval": "1h", "limit": limit}
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
        return generate_demo_klines(symbol, limit)

def fetch_klines_4h(symbol, limit=100):
    try:
        url = f"{BINANCE_BASE}/klines"
        params = {"symbol": symbol, "interval": "4h", "limit": limit}
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
        return generate_demo_klines(symbol, limit)

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
        base_oi = {"BTCUSDT": 85000, "ETHUSDT": 1200000, "BNBUSDT": 450000, "SOLUSDT": 2800000, "XRPUSDT": 150000000,
                    "ADAUSDT": 52000000, "DOGEUSDT": 85000000, "AVAXUSDT": 3200000, "DOTUSDT": 12000000, "LINKUSDT": 8500000}
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
    ticker  = fetch_ticker(symbol)
    candles = fetch_klines_4h(symbol, 100)
    if not ticker or not candles:
        return jsonify({"error": "Failed to fetch data"}), 500
    liq = build_liquidation_zones(candles, ticker["price"])
    liq["open_interest"] = fetch_open_interest(symbol)
    liq["symbol"] = symbol
    return jsonify(liq)

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
    """Top 10 tokens with liquidation estimates based on volume, OI and volatility."""
    ranking = []
    for sym in SYMBOLS:
        ticker = fetch_ticker(sym)
        if not ticker:
            continue
        candles = fetch_klines(sym, 50)
        if not candles or len(candles) < 10:
            continue
        oi = fetch_open_interest(sym)
        price = ticker["price"]

        # Estimate liquidation values from volume and volatility
        highs = [c["high"] for c in candles[-24:]]
        lows  = [c["low"]  for c in candles[-24:]]
        vols  = [c["volume"] for c in candles[-24:]]
        avg_vol = sum(vols) / len(vols) if vols else 0
        avg_range = sum(h - l for h, l in zip(highs, lows)) / len(highs) if highs else 0
        volatility_pct = (avg_range / price * 100) if price > 0 else 0

        # Simulated liq value based on OI * price * volatility factor
        liq_24h_long  = round(oi * price * volatility_pct * 0.0008, 2)
        liq_24h_short = round(oi * price * volatility_pct * 0.0006, 2)
        liq_24h_total = round(liq_24h_long + liq_24h_short, 2)

        # Key price levels
        recent_low  = min(lows) if lows else price * 0.97
        recent_high = max(highs) if highs else price * 1.03

        ranking.append({
            "symbol": sym,
            "price": price,
            "change_pct": ticker["change_pct"],
            "open_interest": oi,
            "oi_value_usd": round(oi * price, 2),
            "liq_24h_long": liq_24h_long,
            "liq_24h_short": liq_24h_short,
            "liq_24h_total": liq_24h_total,
            "volatility_24h": round(volatility_pct, 2),
            "volume_24h": ticker["volume"],
            "support": round(recent_low, 4),
            "resistance": round(recent_high, 4),
        })

    ranking.sort(key=lambda x: x["liq_24h_total"], reverse=True)
    return jsonify(ranking)

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
        {
            "title": "Bitcoin ultrapassa US$ 83.000 com entrada recorde em ETFs spot",
            "url": "#",
            "source": "CoinDesk",
            "published_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["BTC"],
            "kind": "news",
            "sentiment": 3,
        },
        {
            "title": "Ethereum se prepara para atualização Pectra: o que esperar",
            "url": "#",
            "source": "The Block",
            "published_at": (datetime.utcnow() - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["ETH"],
            "kind": "news",
            "sentiment": 2,
        },
        {
            "title": "SEC adia decisão sobre ETF de Solana para segundo semestre",
            "url": "#",
            "source": "Bloomberg",
            "published_at": (datetime.utcnow() - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["SOL"],
            "kind": "news",
            "sentiment": -1,
        },
        {
            "title": "Binance anuncia programa de queima de BNB acelerado",
            "url": "#",
            "source": "CoinTelegraph",
            "published_at": (datetime.utcnow() - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["BNB"],
            "kind": "news",
            "sentiment": 2,
        },
        {
            "title": "Whale alerta: transferência de 12.000 BTC para exchange detectada",
            "url": "#",
            "source": "Whale Alert",
            "published_at": (datetime.utcnow() - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["BTC"],
            "kind": "news",
            "sentiment": -2,
        },
        {
            "title": "XRP Ledger recebe atualização para suportar smart contracts nativos",
            "url": "#",
            "source": "Decrypt",
            "published_at": (datetime.utcnow() - timedelta(hours=7)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["XRP"],
            "kind": "news",
            "sentiment": 3,
        },
        {
            "title": "Liquidações no mercado de futuros somam US$ 320M nas últimas 24h",
            "url": "#",
            "source": "Coinglass",
            "published_at": (datetime.utcnow() - timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["BTC", "ETH"],
            "kind": "news",
            "sentiment": -1,
        },
        {
            "title": "Dogecoin sobe 8% após Elon Musk postar meme sobre DOGE",
            "url": "#",
            "source": "CoinDesk",
            "published_at": (datetime.utcnow() - timedelta(hours=9)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["DOGE"],
            "kind": "news",
            "sentiment": 2,
        },
        {
            "title": "Avalanche fecha parceria com grande banco europeu para tokenização",
            "url": "#",
            "source": "The Block",
            "published_at": (datetime.utcnow() - timedelta(hours=10)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["AVAX"],
            "kind": "news",
            "sentiment": 3,
        },
        {
            "title": "Chainlink integra oracle em mais 5 redes Layer 2",
            "url": "#",
            "source": "CryptoSlate",
            "published_at": (datetime.utcnow() - timedelta(hours=11)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["LINK"],
            "kind": "news",
            "sentiment": 2,
        },
        {
            "title": "Federal Reserve sinaliza manutenção das taxas: mercado crypto reage",
            "url": "#",
            "source": "Reuters",
            "published_at": (datetime.utcnow() - timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": [],
            "kind": "news",
            "sentiment": 0,
        },
        {
            "title": "Cardano lança Hydra V2 com melhorias de escalabilidade",
            "url": "#",
            "source": "CoinTelegraph",
            "published_at": (datetime.utcnow() - timedelta(hours=14)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "currencies": ["ADA"],
            "kind": "news",
            "sentiment": 2,
        },
    ]
    return jsonify({"news": demo_news, "demo": True})

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
