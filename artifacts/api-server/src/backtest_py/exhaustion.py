"""
Filter indikator RSI+StochRSI+MACD+Volume — replikasi PERSIS
checkIndicatorExhaustion dari smc.ts.
"""


def check_indicator_exhaustion_at(series, idx, bias):
    """
    OPTIMASI (versi cepat): ambil dari precomputed series (index doang, O(1)),
    bukan hitung ulang RSI/StochRSI/MACD dari nol tiap panggilan. series
    didapat dari indicators.precompute_indicator_series(h4_df) — DIPANGGIL
    SEKALI di level engine, bukan per-titik.
    """
    rsi = series["rsi"][idx]
    stoch_rsi = series["stoch_rsi"][idx]
    macd_hist = series["macd"][idx, 2]  # kolom ke-2 = histogram

    volumes = series["volumes"]
    vol_ma20 = volumes[max(0, idx - 20):idx].mean() if idx >= 1 else 0.0
    last_vol = volumes[idx]
    vol_ratio = last_vol / vol_ma20 if vol_ma20 > 0 else 1.0

    exhaustion_count = 0
    if bias == "bullish":
        if rsi >= 70: exhaustion_count += 1
        if stoch_rsi >= 80: exhaustion_count += 1
        if macd_hist < 0: exhaustion_count += 1
        if vol_ratio < 0.8: exhaustion_count += 1
    else:
        if rsi <= 30: exhaustion_count += 1
        if stoch_rsi <= 20: exhaustion_count += 1
        if macd_hist > 0: exhaustion_count += 1
        if vol_ratio < 0.8: exhaustion_count += 1

    blocked = exhaustion_count >= 3
    return {
        "blocked": blocked, "rsi": rsi, "stoch_rsi": stoch_rsi,
        "macd_histogram": macd_hist, "vol_ratio": vol_ratio,
    }
