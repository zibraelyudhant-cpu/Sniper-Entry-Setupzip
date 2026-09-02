"""
Skill 15M (Menu Scalping) — replikasi PERSIS analyzeScalping15M di smc.ts.
M15 struktur+zona+eksekusi (1 TF doang), H4 filter indikator.
"""
import numpy as np
from zones import find_swing_highs, find_swing_lows, filter_zones_numpuk_fib
from msv2 import analyze_market_structure_v2
from exhaustion import check_indicator_exhaustion_at


def try_entry_15m(m15_df, h4_df_indexed, idx_m15, m15_series, h4_series, btc_h1_bias=None):
    """
    m15_series/h4_series: precompute_indicator_series(df) masing2 — SEKALI di
    level engine, bukan per-titik simulasi (OPTIMASI KRUSIAL, sebelumnya
    calc_rsi_wilder/calc_atr_wilder dipanggil ULANG dari NOL 7000+ kali,
    bikin backtest 33 detik buat 720 candle H1 doang).
    """
    m15_slice = m15_df.iloc[:idx_m15 + 1]
    if len(m15_slice) < 100:
        return None
    current_price = m15_slice["close"].iloc[-1]

    highs = m15_slice["high"].to_numpy()
    lows = m15_slice["low"].to_numpy()
    closes = m15_slice["close"].to_numpy()
    volumes = m15_slice["volume"].to_numpy()
    opens = m15_slice["open"].to_numpy()

    atr15 = m15_series["atr_wilder"][idx_m15]
    zone_width = atr15 * 0.35
    merge_distance = atr15 * 0.5

    lookback_slice = 100
    h = highs[-lookback_slice:]
    l = lows[-lookback_slice:]
    swing_h = find_swing_highs(h, 30)
    swing_l = find_swing_lows(l, 30)

    def merge_levels(levels):
        if not levels:
            return []
        sorted_levels = sorted(levels)
        merged = [sorted_levels[0]]
        for x in sorted_levels[1:]:
            if x - merged[-1] > merge_distance:
                merged.append(x)
        return merged

    merged_resistance = merge_levels(swing_h)
    merged_support = merge_levels(swing_l)

    resistance_levels = filter_zones_numpuk_fib(merged_resistance, m15_slice, len(m15_slice) - 1)
    support_levels = filter_zones_numpuk_fib(merged_support, m15_slice, len(m15_slice) - 1)
    if not resistance_levels and not support_levels:
        return None

    def vol_ma20_at(idx):
        start = max(0, idx - 20)
        win = volumes[start:idx]
        return win.mean() if len(win) > 0 else 0.0

    n15 = len(closes)
    retest_window_max = 24
    found_breakout = None
    for idx in range(max(1, n15 - retest_window_max), n15):
        close_at = closes[idx]
        vol_at = volumes[idx]
        vol_ma = vol_ma20_at(idx)
        if vol_ma <= 0:
            continue
        for level in resistance_levels:
            edge_upper = level + zone_width / 2
            edge_lower = level - zone_width / 2
            if close_at > edge_upper and vol_at > 1.4 * vol_ma:
                found_breakout = {"direction": "bullish", "zone_level": level, "edge_upper": edge_upper,
                                   "edge_lower": edge_lower, "breakout_price": close_at, "breakout_idx": idx}
        for level in support_levels:
            edge_upper = level + zone_width / 2
            edge_lower = level - zone_width / 2
            if close_at < edge_lower and vol_at > 1.4 * vol_ma:
                found_breakout = {"direction": "bearish", "zone_level": level, "edge_upper": edge_upper,
                                   "edge_lower": edge_lower, "breakout_price": close_at, "breakout_idx": idx}

    if not found_breakout:
        return None

    bias = found_breakout["direction"]

    m15_time = m15_slice["timestamp"].iloc[-1]
    h4_idx_arr = h4_df_indexed.index[h4_df_indexed["timestamp"] <= m15_time]
    if len(h4_idx_arr) < 30:
        return None
    h4_idx = h4_idx_arr[-1]
    exhaustion = check_indicator_exhaustion_at(h4_series, h4_idx, bias)
    if exhaustion["blocked"]:
        return None

    structv2 = analyze_market_structure_v2(opens, highs, lows, closes, "M15")
    v2_compatible = (bias == "bullish" and structv2["classification"] in ("bullish_strong", "bullish_weak")) or \
                    (bias == "bearish" and structv2["classification"] in ("bearish_strong", "bearish_weak"))
    if not v2_compatible:
        return None

    entry_buffer = atr15 * 0.20
    sl_buffer = atr15 * 1
    if bias == "bullish":
        entry_price = found_breakout["edge_upper"] - entry_buffer
        stop_loss = found_breakout["edge_lower"] - sl_buffer
    else:
        entry_price = found_breakout["edge_lower"] + entry_buffer
        stop_loss = found_breakout["edge_upper"] + sl_buffer
    risk = abs(entry_price - stop_loss)
    dir_mult = 1 if bias == "bullish" else -1
    if risk <= 0:
        return None
    take_profit1 = entry_price + risk * 2 * dir_mult

    in_zone = found_breakout["edge_lower"] <= current_price <= found_breakout["edge_upper"]
    if not in_zone:
        return None  # backtest cuma ambil sinyal FINAL (in_zone), approaching di-skip

    pullback_depth = abs(found_breakout["breakout_price"] - current_price)
    max_pullback = atr15 * 1.5
    if pullback_depth > max_pullback:
        return None

    last_vol = volumes[-1]
    last_vol_ma = vol_ma20_at(n15 - 1)
    pullback_volume_ok = last_vol < last_vol_ma if last_vol_ma > 0 else False
    if not pullback_volume_ok:
        return None

    confirm_count = 0
    rejection_volume_ok = last_vol_ma > 0 and last_vol >= 1.2 * last_vol_ma
    if rejection_volume_ok:
        confirm_count += 1
    rsi15 = m15_series["rsi"][idx_m15]
    macd15 = m15_series["macd"][idx_m15, 2]
    momentum_align = (rsi15 > 50 and macd15 > 0) if bias == "bullish" else (rsi15 < 50 and macd15 < 0)
    if momentum_align:
        confirm_count += 1
    if confirm_count < 1:
        return None

    if btc_h1_bias is not None and btc_h1_bias != "ranging" and btc_h1_bias != bias:
        return None

    return {
        "bias": bias, "entry_price": entry_price, "stop_loss": stop_loss,
        "take_profit1": take_profit1, "entry_idx": idx_m15,
    }
