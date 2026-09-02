"""
Skill Structural (Menu Scalping) — replikasi PERSIS analyzeScalpingEntry di
smc.ts. M30 struktur+zona, M5 eksekusi, H4 filter indikator.

PENDEKATAN BACKTEST: fungsi try_entry_at_index dipanggil per-titik candle M30
(loop di backtest_engine.py) — TIDAK sepenuhnya vectorized (breakout+retest
butuh scan window mundur dari tiap titik, MSV2 butuh swing detection yang
gak straightforward di-vectorize), TAPI struktur data (numpy arrays, bukan
re-fetch/re-parse) dan precomputed indicators (RSI series, dst dihitung
SEKALI di awal, bukan re-hitung tiap titik candle) itu yang bikin JAUH lebih
cepat dari pendekatan TypeScript lama (yang re-fetch+re-generate objek tiap
titik simulasi).
"""
import numpy as np
from zones import detect_zones_for_extreme, filter_zones_numpuk_fib
from msv2 import analyze_market_structure_v2
from exhaustion import check_indicator_exhaustion_at
from indicators import precompute_indicator_series
import pandas as pd


def try_zone_breakout_retest(m30_df, m5_df, current_price, resistance_levels, support_levels,
                               zone_width, atr_htf, tf, m5_series=None, m5_idx=None):
    """PERSIS tryZoneBreakoutRetest TS. m30_df/m5_df numpy-backed DataFrame,
    SUDAH di-slice sampai titik simulasi (no look-ahead). m5_series (opsional,
    precomputed) dipake buat momentum align — kalau gak dikasih, fallback
    hitung dari m5_df langsung (lebih lambat, tapi tetap correct)."""
    closes = m30_df["close"].to_numpy()
    volumes = m30_df["volume"].to_numpy()
    highs = m30_df["high"].to_numpy()
    lows = m30_df["low"].to_numpy()
    opens = m30_df["open"].to_numpy()
    n = len(closes)

    def vol_ma20_at(idx):
        start = max(0, idx - 20)
        win = volumes[start:idx]
        return win.mean() if len(win) > 0 else 0.0

    retest_window_max = 24
    found = None
    for idx in range(max(1, n - retest_window_max), n):
        close_at = closes[idx]
        vol_at = volumes[idx]
        vol_ma = vol_ma20_at(idx)
        if vol_ma <= 0:
            continue
        for level in resistance_levels:
            edge_upper = level + zone_width / 2
            edge_lower = level - zone_width / 2
            if close_at > edge_upper and vol_at > 1.4 * vol_ma:
                found = {"direction": "bullish", "level": level, "edge_upper": edge_upper,
                         "edge_lower": edge_lower, "breakout_price": close_at, "breakout_idx": idx}
        for level in support_levels:
            edge_upper = level + zone_width / 2
            edge_lower = level - zone_width / 2
            if close_at < edge_lower and vol_at > 1.4 * vol_ma:
                found = {"direction": "bearish", "level": level, "edge_upper": edge_upper,
                         "edge_lower": edge_lower, "breakout_price": close_at, "breakout_idx": idx}

    if not found:
        return {"ok": False, "status": "waiting", "reason": "Belum ada breakout"}

    bias = found["direction"]
    structv2 = analyze_market_structure_v2(opens, highs, lows, closes, tf)
    v2_compatible = (bias == "bullish" and structv2["classification"] in ("bullish_strong", "bullish_weak")) or \
                    (bias == "bearish" and structv2["classification"] in ("bearish_strong", "bearish_weak"))
    if not v2_compatible:
        return {"ok": False, "status": "waiting", "reason": "MSV2 block", "market_structure_v2": structv2}

    candles_since_breakout = n - 1 - found["breakout_idx"]
    entry_buffer = atr_htf * 0.2
    sl_buffer = atr_htf * 1
    dir_mult = 1 if bias == "bullish" else -1
    entry_price = found["edge_upper"] - entry_buffer if bias == "bullish" else found["edge_lower"] + entry_buffer
    stop_loss = found["edge_lower"] - sl_buffer if bias == "bullish" else found["edge_upper"] + sl_buffer
    risk = abs(entry_price - stop_loss)
    take_profit1 = entry_price + risk * 2 * dir_mult

    in_zone = found["edge_lower"] <= current_price <= found["edge_upper"]

    if not in_zone:
        if candles_since_breakout > retest_window_max:
            return {"ok": False, "status": "expired", "reason": "Retest window lewat"}
        return {
            "ok": True, "status": "approaching", "bias": bias,
            "entry_price": entry_price, "stop_loss": stop_loss, "take_profit1": take_profit1,
            "candles_since_breakout": candles_since_breakout,
        }

    pullback_depth = abs(found["breakout_price"] - current_price)
    if pullback_depth > atr_htf * 1.5:
        return {"ok": False, "status": "expired", "reason": "Pullback kelewat dalam"}

    last_vol = volumes[-1]
    last_vol_ma = vol_ma20_at(n - 1)
    pullback_volume_ok = last_vol < last_vol_ma if last_vol_ma > 0 else False
    if not pullback_volume_ok:
        return {"ok": False, "status": "expired", "reason": "Pullback volume masih tinggi"}

    confirm_count = 0
    rejection_volume_ok = last_vol_ma > 0 and last_vol >= 1.2 * last_vol_ma
    if rejection_volume_ok:
        confirm_count += 1

    m5_closes = m5_df["close"].to_numpy()
    if m5_series is not None and m5_idx is not None:
        rsi_ltf = m5_series["rsi"][m5_idx]
        macd_ltf = m5_series["macd"][m5_idx, 2]
    else:
        from indicators import calc_rsi_wilder, calc_macd
        rsi_ltf = calc_rsi_wilder(pd.Series(m5_closes), 14).iloc[-1]
        macd_ltf = calc_macd(pd.Series(m5_closes))["histogram"].iloc[-1]
    momentum_align = (rsi_ltf > 50 and macd_ltf > 0) if bias == "bullish" else (rsi_ltf < 50 and macd_ltf < 0)
    if momentum_align:
        confirm_count += 1
    if confirm_count < 1:
        return {"ok": False, "status": "expired", "reason": "Belum ada konfirmasi tambahan"}

    return {
        "ok": True, "status": "in_zone", "bias": bias,
        "entry_price": entry_price, "stop_loss": stop_loss, "take_profit1": take_profit1,
        "candles_since_breakout": candles_since_breakout, "market_structure_v2": structv2,
    }


def try_entry_structural(m30_df, m5_df, h4_df, idx_m30, m30_series, h4_df_indexed, h4_series, m5_series, btc_h1_bias=None):
    """
    Coba cari entry Structural DI TITIK idx_m30 (real-time simulation — data
    yang dipakai CUMA sampai idx_m30, gak boleh liat masa depan).
    m30_series/h4_series/m5_series: precompute_indicator_series(df) masing2 —
    SEMUA dipanggil SEKALI di level engine, bukan per-titik simulasi.
    h4_df_indexed: h4_df yang timestamp-nya kolom biasa (buat lookup index).
    Return None kalau gak ada sinyal 'in_zone', atau dict entry kalau ada.
    """
    m30_slice = m30_df.iloc[:idx_m30 + 1]
    if len(m30_slice) < 100:
        return None
    current_price = m30_slice["close"].iloc[-1]

    highs = m30_slice["high"].to_numpy()
    lows = m30_slice["low"].to_numpy()
    closes = m30_slice["close"].to_numpy()

    atr_m30 = m30_series["atr_wilder"][idx_m30]
    atr_pct = (atr_m30 / current_price) * 100
    if atr_pct < 0.5:
        return None

    res_raw, sup_raw, zone_width = detect_zones_for_extreme(highs, lows, atr_m30)
    resistance_levels = filter_zones_numpuk_fib(res_raw, m30_slice, len(m30_slice) - 1)
    support_levels = filter_zones_numpuk_fib(sup_raw, m30_slice, len(m30_slice) - 1)
    if not resistance_levels and not support_levels:
        return None

    # cari m5 candle yang sejalur waktu (timestamp-based lookup)
    m30_time = m30_slice["timestamp"].iloc[-1]
    m5_idx_arr = m5_df.index[m5_df["timestamp"] <= m30_time]
    if len(m5_idx_arr) < 10:
        return None
    m5_idx = m5_idx_arr[-1]
    m5_slice = m5_df.iloc[max(0, m5_idx - 119):m5_idx + 1]

    picked = try_zone_breakout_retest(m30_slice, m5_slice, current_price, resistance_levels,
                                        support_levels, zone_width, atr_m30, "M30",
                                        m5_series=m5_series, m5_idx=m5_idx)
    if not picked["ok"] or picked["status"] != "in_zone":
        return None

    h4_idx_arr = h4_df_indexed.index[h4_df_indexed["timestamp"] <= m30_time]
    if len(h4_idx_arr) < 30:
        return None
    h4_idx = h4_idx_arr[-1]
    exhaustion = check_indicator_exhaustion_at(h4_series, h4_idx, picked["bias"])
    if exhaustion["blocked"]:
        return None

    if btc_h1_bias is not None and btc_h1_bias != "ranging" and btc_h1_bias != picked["bias"]:
        return None

    return {
        "bias": picked["bias"], "entry_price": picked["entry_price"],
        "stop_loss": picked["stop_loss"], "take_profit1": picked["take_profit1"],
        "entry_idx": idx_m30,
    }
