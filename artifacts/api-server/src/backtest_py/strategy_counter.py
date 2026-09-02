"""
Counter Scalping (Multi-Factor Score) — replikasi PERSIS analyzeCounterStructural
di smc.ts. H1 doang, SuperTrend+RSI+MACD+Bollinger, threshold 0.15, entry di
fresh breakout level (belum retest).
"""
import numpy as np
import pandas as pd
from indicators import calc_rsi_wilder, calc_macd, calc_atr_wilder
from zones import detect_zones_for_extreme
from msv2 import analyze_market_structure_v2


def _average_true_range_simple(highs, lows, closes, window=10):
    n = len(closes)
    tr = np.zeros(n)
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
    atr = np.zeros(n)
    if n > window:
        cumsum = np.cumsum(tr)
        for i in range(window, n):
            atr[i] = (cumsum[i] - cumsum[i - window]) / window
    return atr


def _supertrend_direction_series(highs, lows, closes, atr_window=10, multiplier=3.0):
    n = len(closes)
    hl2 = (highs + lows) / 2
    atr = _average_true_range_simple(highs, lows, closes, atr_window)
    upper = hl2 + multiplier * atr
    lower = hl2 - multiplier * atr
    final_upper = upper.copy()
    final_lower = lower.copy()
    trend = np.ones(n)
    for i in range(1, n):
        if closes[i-1] <= final_upper[i-1]:
            final_upper[i] = min(upper[i], final_upper[i-1])
        if closes[i-1] >= final_lower[i-1]:
            final_lower[i] = max(lower[i], final_lower[i-1])
        if closes[i] > final_upper[i-1]:
            trend[i] = 1
        elif closes[i] < final_lower[i-1]:
            trend[i] = -1
        else:
            trend[i] = trend[i-1]
    return trend


def _bollinger_at(closes, idx, window=20, std_mult=2.0):
    if idx < window - 1:
        return None
    win = closes[idx - window + 1:idx + 1]
    mean = win.mean()
    std = win.std()
    return {"lower": mean - std_mult * std, "middle": mean, "upper": mean + std_mult * std}


def precompute_counter_series(h1_df):
    """
    OPTIMASI KRUSIAL: hitung SuperTrend/RSI/MACD/ATR SEKALI buat SELURUH
    dataset (bukan re-hitung dari nol tiap kali try_entry dipanggil, yang
    tadinya bikin O(n²) — 2070 candle butuh 60+ detik). Return dict berisi
    numpy array PENUH, tinggal di-index[idx] pas dipanggil per titik.
    """
    highs = h1_df["high"].to_numpy()
    lows = h1_df["low"].to_numpy()
    closes = h1_df["close"].to_numpy()
    closes_s = pd.Series(closes)

    supertrend = _supertrend_direction_series(highs, lows, closes)
    rsi = calc_rsi_wilder(closes_s, 14).to_numpy()
    macd_df = calc_macd(closes_s)
    macd_line = macd_df["macd"].to_numpy()
    signal_line = macd_df["signal"].to_numpy()
    histogram = macd_df["histogram"].to_numpy()
    atr_wilder = calc_atr_wilder(h1_df, 14).to_numpy()

    # Bollinger — rolling mean/std vectorized penuh (bukan per-titik)
    window, std_mult = 20, 2.0
    roll = closes_s.rolling(window=window, min_periods=window)
    bb_mean = roll.mean().to_numpy()
    bb_std = roll.std(ddof=0).to_numpy()
    bb_lower = bb_mean - std_mult * bb_std
    bb_upper = bb_mean + std_mult * bb_std

    return {
        "supertrend": supertrend, "rsi": rsi, "macd": macd_line, "signal": signal_line,
        "histogram": histogram, "atr_wilder": atr_wilder,
        "bb_lower": bb_lower, "bb_middle": bb_mean, "bb_upper": bb_upper,
    }


def compute_multifactor_score_at(series, closes, idx, st_w=0.30, rsi_w=0.20, macd_w=0.30, bb_w=0.20):
    """Versi CEPAT compute_multifactor_score — AMBIL dari precomputed series
    (index doang, O(1)), bukan hitung ulang. Hasilnya PERSIS sama given basis
    perhitungannya identik (cuma beda cara ambil: precompute-sekali vs
    hitung-ulang-tiap-panggil)."""
    supertrend_score = series["supertrend"][idx]
    rsi_value = series["rsi"][idx]
    rsi_score = 1 if rsi_value < 35 else -1 if rsi_value > 65 else 0
    macd_val, signal_val, hist_val = series["macd"][idx], series["signal"][idx], series["histogram"][idx]
    macd_score = 1 if (macd_val > signal_val and hist_val > 0) else -1 if (macd_val < signal_val and hist_val < 0) else 0
    bollinger_score = 0
    if not np.isnan(series["bb_lower"][idx]):
        price = closes[idx]
        lo, mid, hi = series["bb_lower"][idx], series["bb_middle"][idx], series["bb_upper"][idx]
        if price < lo: bollinger_score = 1
        elif price > hi: bollinger_score = -1
        elif price >= mid: bollinger_score = 0.25
        else: bollinger_score = -0.25
    total_w = st_w + rsi_w + macd_w + bb_w
    composite = (supertrend_score * st_w + rsi_score * rsi_w + macd_score * macd_w + bollinger_score * bb_w) / total_w
    return max(-1.0, min(1.0, composite)), rsi_value


def compute_multifactor_score(highs, lows, closes, st_w=0.30, rsi_w=0.20, macd_w=0.30, bb_w=0.20):
    idx = len(closes) - 1
    supertrend_score = _supertrend_direction_series(highs, lows, closes)[idx]
    rsi_value = calc_rsi_wilder(pd.Series(closes), 14).iloc[-1]
    rsi_score = 1 if rsi_value < 35 else -1 if rsi_value > 65 else 0
    macd_df = calc_macd(pd.Series(closes))
    macd_val, signal_val, hist_val = macd_df["macd"].iloc[-1], macd_df["signal"].iloc[-1], macd_df["histogram"].iloc[-1]
    macd_score = 1 if (macd_val > signal_val and hist_val > 0) else -1 if (macd_val < signal_val and hist_val < 0) else 0
    bb = _bollinger_at(closes, idx)
    bollinger_score = 0
    if bb:
        price = closes[idx]
        if price < bb["lower"]: bollinger_score = 1
        elif price > bb["upper"]: bollinger_score = -1
        elif price >= bb["middle"]: bollinger_score = 0.25
        else: bollinger_score = -0.25
    total_w = st_w + rsi_w + macd_w + bb_w
    composite = (supertrend_score * st_w + rsi_score * rsi_w + macd_score * macd_w + bollinger_score * bb_w) / total_w
    return max(-1.0, min(1.0, composite))


def find_fresh_breakout_level(h1_slice, bias, lookback=24):
    highs = h1_slice["high"].to_numpy()
    lows = h1_slice["low"].to_numpy()
    closes = h1_slice["close"].to_numpy()
    opens = h1_slice["open"].to_numpy()
    volumes = h1_slice["volume"].to_numpy()

    atr = calc_atr_wilder(h1_slice, 14).iloc[-1]
    if atr <= 0:
        return None
    resistance_levels, support_levels, zone_width = detect_zones_for_extreme(highs, lows, atr)
    n = len(closes)
    found = None

    def vol_ma20_at(idx):
        start = max(0, idx - 20)
        win = volumes[start:idx]
        return win.mean() if len(win) > 0 else 0.0

    for idx in range(max(1, n - lookback), n):
        close_at = closes[idx]
        vol_at = volumes[idx]
        vol_ma = vol_ma20_at(idx)
        if vol_ma <= 0:
            continue
        if bias == "bullish":
            for level in resistance_levels:
                edge_upper = level + zone_width / 2
                if close_at > edge_upper and vol_at > 1.4 * vol_ma:
                    found = {"level": level, "breakout_idx": idx}
        else:
            for level in support_levels:
                edge_lower = level - zone_width / 2
                if close_at < edge_lower and vol_at > 1.4 * vol_ma:
                    found = {"level": level, "breakout_idx": idx}
    if not found:
        return None

    structv2 = analyze_market_structure_v2(opens, highs, lows, closes, "H1")
    v2_compatible = (bias == "bullish" and structv2["classification"] in ("bullish_strong", "bullish_weak")) or \
                    (bias == "bearish" and structv2["classification"] in ("bearish_strong", "bearish_weak"))
    if not v2_compatible:
        return None

    for j in range(found["breakout_idx"] + 1, n):
        if bias == "bullish" and lows[j] <= found["level"]:
            return None
        if bias == "bearish" and highs[j] >= found["level"]:
            return None
    return found["level"]


def try_entry_counter_scalping(h1_df, idx_h1, series, threshold=0.15, btc_h1_bias=None):
    h1_slice = h1_df.iloc[:idx_h1 + 1]
    if len(h1_slice) < 100:
        return None

    closes = h1_df["close"].to_numpy()  # FULL array, precomputed series indexnya nyambung ke ini
    current_price = closes[idx_h1]

    composite, _ = compute_multifactor_score_at(series, closes, idx_h1)
    bias = "bullish" if composite >= threshold else "bearish" if composite <= -threshold else None
    if bias is None:
        return None

    fresh_level = find_fresh_breakout_level(h1_slice, bias)
    if fresh_level is None:
        return None
    pullback_valid = fresh_level < current_price if bias == "bullish" else fresh_level > current_price
    if not pullback_valid:
        return None

    atr_h1 = series["atr_wilder"][idx_h1]
    if atr_h1 <= 0:
        return None
    dir_mult = 1 if bias == "bullish" else -1
    entry_price = fresh_level
    stop_loss = entry_price - atr_h1 * dir_mult
    take_profit1 = entry_price + atr_h1 * 2 * dir_mult

    if btc_h1_bias is not None and btc_h1_bias != "ranging" and btc_h1_bias != bias:
        return None

    return {
        "bias": bias, "entry_price": entry_price, "stop_loss": stop_loss,
        "take_profit1": take_profit1, "entry_idx": idx_h1,
    }
