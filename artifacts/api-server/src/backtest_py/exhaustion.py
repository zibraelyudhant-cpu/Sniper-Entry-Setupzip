"""
Filter indikator RSI+StochRSI+MACD+Volume+CCI+MFI+ROC — replikasi PERSIS
checkIndicatorExhaustion dari smc.ts (versi 7 indikator, sinkron dengan fix
berdasarkan data live Journal 175 sinyal — CCI ekstrem, MFI tinggi/hollow
move, ROC lemah semuanya berkorelasi kuat sama LOSE).
"""


def check_indicator_exhaustion_at(series, idx, bias):
    """
    OPTIMASI (versi cepat): ambil dari precomputed series (index doang, O(1)),
    bukan hitung ulang RSI/StochRSI/MACD/CCI/MFI/ROC dari nol tiap panggilan.
    series didapat dari indicators.precompute_indicator_series(df) — DIPANGGIL
    SEKALI di level engine, bukan per-titik.
    """
    rsi = series["rsi"][idx]
    stoch_rsi = series["stoch_rsi"][idx]
    macd_hist = series["macd"][idx, 2]  # kolom ke-2 = histogram
    cci = series["cci"][idx]
    mfi = series["mfi"][idx]
    roc = series["roc"][idx]

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
        if cci >= 100: exhaustion_count += 1
        if mfi >= 60: exhaustion_count += 1
        if roc < 1.0: exhaustion_count += 1
    else:
        if rsi <= 30: exhaustion_count += 1
        if stoch_rsi <= 20: exhaustion_count += 1
        if macd_hist > 0: exhaustion_count += 1
        if vol_ratio < 0.8: exhaustion_count += 1
        if cci <= -100: exhaustion_count += 1
        if mfi <= 40: exhaustion_count += 1
        if roc > -1.0: exhaustion_count += 1

    # Threshold block 4/7 (mayoritas) — PERSIS smc.ts
    blocked = exhaustion_count >= 4
    return {
        "blocked": blocked, "rsi": rsi, "stoch_rsi": stoch_rsi,
        "macd_histogram": macd_hist, "vol_ratio": vol_ratio,
        "cci": cci, "mfi": mfi, "roc": roc,
    }
