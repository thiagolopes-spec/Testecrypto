from flask import Flask, jsonify, render_template
from flask_cors import CORS
import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
import math

app = Flask(__name__)
CORS(app)

BINANCE_BASE = "https://api.binance.com/api/v3"
BINANCE_FUTURES = "https://fapi.binance.com/fapi/v1"

SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]

# Demo seed prices
DEMO_PRICES = {
    "BTCUSDT": 83200.0,
    "ETHUSDT": 1835.0,
    "BNBUSDT": 598.0,
    "SOLUSDT": 124.5,
    "XRPUSDT": 2.14,
}

# ====================================================
#  Demo Data Generator
# ====================================================
def generate_demo_klines(symbol, interval="1h", limit=100):
    base = DEMO_PRICES[symbol]
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)

    # Different trend per symbol for variety
    trends = {
        "BTCUSDT": 0.0003,
        "ETHUSDT": -0.0002,
        "BNBUSDT": 0.0001,
        "SOLUSDT": 0.0004,
        "XRPUSDT": -0.0001,
    }
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
        low_p = min(open_p, close_p) - abs(rng.gauss(0, volatility * 0.3))
        vol = abs(rng.gauss(base * 200, base * 80))

        rows.append({
            "open_time": ts,
            "open": round(open_p, 4),
            "high": round(high_p, 4),
            "low": round(low_p, 4),
            "close": round(close_p, 4),
            "volume": round(vol, 2),
        })
        price = close_p

    return pd.DataFrame(rows)

def generate_demo_ticker(symbol):
    base = DEMO_PRICES[symbol]
    changes = {
        "BTCUSDT": 2.34,
        "ETHUSDT": -3.12,
        "BNBUSDT": 1.05,
        "SOLUSDT": 5.67,
        "XRPUSDT": -1.88,
    }
    chg = changes.get(symbol, 0)
    return {
        "price": base,
        "change_pct": chg,
        "volume": base * 18000,
        "high": base * 1.03,
        "low": base * 0.97,
    }

# ====================================================
#  Live Data Fetchers (with demo fallback)
# ====================================================
def fetch_klines(symbol, interval="1h", limit=100):
    try:
        url = f"{BINANCE_BASE}/klines"
        params = {"symbol": symbol, "interval": interval, "limit": limit}
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        data = r.json()
        df = pd.DataFrame(data, columns=[
            "open_time","open","high","low","close","volume",
            "close_time","quote_volume","trades","taker_buy_base",
            "taker_buy_quote","ignore"
        ])
        for col in ["open","high","low","close","volume"]:
            df[col] = df[col].astype(float)
        df["open_time"] = pd.to_datetime(df["open_time"], unit="ms")
        return df
    except Exception:
        return generate_demo_klines(symbol, interval, limit)

def fetch_ticker(symbol):
    try:
        r = requests.get(f"{BINANCE_BASE}/ticker/24hr", params={"symbol": symbol}, timeout=8)
        r.raise_for_status()
        d = r.json()
        return {
            "price": float(d["lastPrice"]),
            "change_pct": float(d["priceChangePercent"]),
            "volume": float(d["quoteVolume"]),
            "high": float(d["highPrice"]),
            "low": float(d["lowPrice"]),
        }
    except Exception:
        return generate_demo_ticker(symbol)

def fetch_open_interest(symbol):
    try:
        r = requests.get(f"{BINANCE_FUTURES}/openInterest", params={"symbol": symbol}, timeout=8)
        r.raise_for_status()
        d = r.json()
        return float(d.get("openInterest", 0))
    except Exception:
        # Demo open interest
        base_oi = {"BTCUSDT": 85000, "ETHUSDT": 1200000, "BNBUSDT": 450000, "SOLUSDT": 2800000, "XRPUSDT": 150000000}
        return base_oi.get(symbol, 100000)

# ====================================================
#  Technical Analysis
# ====================================================
def calc_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calc_macd(series, fast=12, slow=26, signal=9):
    ema_fast = series.ewm(span=fast).mean()
    ema_slow = series.ewm(span=slow).mean()
    macd = ema_fast - ema_slow
    signal_line = macd.ewm(span=signal).mean()
    histogram = macd - signal_line
    return macd, signal_line, histogram

def calc_bollinger(series, period=20, std_dev=2):
    sma = series.rolling(period).mean()
    std = series.rolling(period).std()
    upper = sma + std_dev * std
    lower = sma - std_dev * std
    return upper, sma, lower

def calc_ema(series, period):
    return series.ewm(span=period).mean()

def generate_signal(df):
    close = df["close"]
    rsi = calc_rsi(close)
    macd, signal_line, histogram = calc_macd(close)
    bb_upper, bb_mid, bb_lower = calc_bollinger(close)
    ema9 = calc_ema(close, 9)
    ema21 = calc_ema(close, 21)
    ema50 = calc_ema(close, 50)

    latest = close.iloc[-1]
    rsi_val = rsi.iloc[-1]
    macd_val = macd.iloc[-1]
    signal_val = signal_line.iloc[-1]
    hist_val = histogram.iloc[-1]
    bb_up = bb_upper.iloc[-1]
    bb_lo = bb_lower.iloc[-1]
    e9 = ema9.iloc[-1]
    e21 = ema21.iloc[-1]
    e50 = ema50.iloc[-1]

    score = 0
    reasons = []

    # RSI
    if rsi_val < 30:
        score += 3
        reasons.append(f"RSI sobrevendido ({rsi_val:.1f}) — reversão provável")
    elif rsi_val < 45:
        score += 1
        reasons.append(f"RSI em zona de acumulação ({rsi_val:.1f})")
    elif rsi_val > 70:
        score -= 3
        reasons.append(f"RSI sobrecomprado ({rsi_val:.1f}) — correção provável")
    elif rsi_val > 55:
        score -= 1
        reasons.append(f"RSI em zona de distribuição ({rsi_val:.1f})")

    # MACD
    if macd_val > signal_val and hist_val > 0:
        score += 2
        reasons.append("MACD acima da linha de sinal — momentum positivo")
    elif macd_val < signal_val and hist_val < 0:
        score -= 2
        reasons.append("MACD abaixo da linha de sinal — momentum negativo")

    # Bollinger
    if latest <= bb_lo:
        score += 2
        reasons.append("Preço tocando banda inferior de Bollinger (suporte)")
    elif latest >= bb_up:
        score -= 2
        reasons.append("Preço tocando banda superior de Bollinger (resistência)")

    # EMA trend
    if e9 > e21 > e50:
        score += 2
        reasons.append("Tendência altista confirmada (EMA 9 > 21 > 50)")
    elif e9 < e21 < e50:
        score -= 2
        reasons.append("Tendência baixista confirmada (EMA 9 < 21 < 50)")
    elif e9 > e21:
        score += 1
        reasons.append("EMA de curto prazo acima da média — tendência positiva")

    if score >= 4:
        action = "COMPRA FORTE"
        color = "#00e676"
        confidence = min(95, 60 + score * 5)
    elif score >= 2:
        action = "COMPRA"
        color = "#69f0ae"
        confidence = min(80, 55 + score * 5)
    elif score <= -4:
        action = "VENDA FORTE"
        color = "#ff1744"
        confidence = min(95, 60 + abs(score) * 5)
    elif score <= -2:
        action = "VENDA"
        color = "#ff5252"
        confidence = min(80, 55 + abs(score) * 5)
    else:
        action = "NEUTRO"
        color = "#ffd740"
        confidence = 50

    return {
        "action": action,
        "color": color,
        "confidence": int(confidence),
        "score": score,
        "reasons": reasons,
        "indicators": {
            "rsi": round(rsi_val, 2),
            "macd": round(macd_val, 4),
            "macd_signal": round(signal_val, 4),
            "macd_hist": round(hist_val, 4),
            "bb_upper": round(bb_up, 2),
            "bb_lower": round(bb_lo, 2),
            "ema9": round(e9, 2),
            "ema21": round(e21, 2),
            "ema50": round(e50, 2),
        }
    }

# ====================================================
#  Liquidation Zone Builder
# ====================================================
def build_liquidation_zones(df, ticker):
    """
    Models liquidation zones from volume profile + leverage distribution.
    High volume at price levels = high potential liquidation clusters.
    Long liq zones = below current price (longs get liquidated on drops).
    Short liq zones = above current price (shorts get liquidated on rises).
    """
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values
    volume = df["volume"].values
    current = ticker["price"]

    price_min = min(low) * 0.97
    price_max = max(high) * 1.03
    levels = np.linspace(price_min, price_max, 40)

    liq_intensity = np.zeros(40)
    for i in range(len(close)):
        candle_range = high[i] - low[i]
        if candle_range == 0:
            continue
        for j, price in enumerate(levels):
            if low[i] <= price <= high[i]:
                proximity = 1 - abs(price - close[i]) / candle_range
                liq_intensity[j] += volume[i] * (0.3 + 0.7 * proximity)

    # Boost round number zones
    for j, price in enumerate(levels):
        str_p = f"{price:.0f}"
        zeros = len(str_p) - len(str_p.rstrip('0'))
        liq_intensity[j] *= (1 + zeros * 0.3)

    long_liq = liq_intensity.copy()
    short_liq = liq_intensity.copy()

    for j, price in enumerate(levels):
        dist = (price - current) / current
        if price < current:
            long_liq[j] *= max(0, 1 + dist * 6)
            short_liq[j] *= 0.15
        else:
            short_liq[j] *= max(0, 1 - dist * 6)
            long_liq[j] *= 0.15

    max_val = max(max(long_liq), max(short_liq), 1)
    long_liq = [round(v / max_val * 100, 1) for v in long_liq]
    short_liq = [round(v / max_val * 100, 1) for v in short_liq]

    return {
        "prices": [round(p, 2) for p in levels],
        "long_liquidations": long_liq,
        "short_liquidations": short_liq,
        "current_price": current,
    }

# ====================================================
#  API Routes
# ====================================================
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/market")
def market_data():
    result = []
    for sym in SYMBOLS:
        ticker = fetch_ticker(sym)
        if not ticker:
            continue
        df = fetch_klines(sym, "1h", 100)
        if df is None or len(df) < 30:
            continue
        signal = generate_signal(df)
        candles = df.tail(60)[["open_time","open","high","low","close","volume"]].copy()
        candles["open_time"] = candles["open_time"].dt.strftime("%Y-%m-%dT%H:%M:%S")

        result.append({
            "symbol": sym,
            "ticker": ticker,
            "signal": signal,
            "candles": candles.to_dict("records"),
        })
    return jsonify(result)

@app.route("/api/liquidations/<symbol>")
def liquidation_map(symbol):
    symbol = symbol.upper()
    if symbol not in SYMBOLS:
        return jsonify({"error": "Symbol not supported"}), 400
    ticker = fetch_ticker(symbol)
    if not ticker:
        return jsonify({"error": "Failed to fetch ticker"}), 500
    df = fetch_klines(symbol, "4h", 100)
    if df is None:
        return jsonify({"error": "Failed to fetch klines"}), 500
    liq = build_liquidation_zones(df, ticker)
    oi = fetch_open_interest(symbol)
    liq["open_interest"] = oi
    liq["symbol"] = symbol
    return jsonify(liq)

@app.route("/api/dominance")
def market_dominance():
    try:
        r = requests.get("https://api.coingecko.com/api/v3/global", timeout=8)
        r.raise_for_status()
        data = r.json()["data"]
        dom = data.get("market_cap_percentage", {})
        return jsonify({
            "btc_dominance": round(dom.get("btc", 0), 2),
            "eth_dominance": round(dom.get("eth", 0), 2),
            "total_market_cap": data.get("total_market_cap", {}).get("usd", 0),
            "total_volume": data.get("total_volume", {}).get("usd", 0),
            "market_cap_change_24h": round(data.get("market_cap_change_percentage_24h_usd", 0), 2),
            "demo": False,
        })
    except Exception:
        # Demo global stats
        return jsonify({
            "btc_dominance": 54.8,
            "eth_dominance": 8.9,
            "total_market_cap": 2_740_000_000_000,
            "total_volume": 98_400_000_000,
            "market_cap_change_24h": 1.24,
            "demo": True,
        })

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
