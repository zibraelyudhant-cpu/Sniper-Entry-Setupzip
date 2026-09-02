"""
Market Structure V2 — replikasi PERSIS analyzeMarketStructureV2 di smc.ts.
BEDA dari indicators.py: MSV2 gak sepenuhnya bisa di-vectorize (fractal swing
detection butuh window kiri-kanan, break quality butuh scan ke depan dari tiap
swing) — jadi fungsi intinya tetep dipanggil PER-TITIK (evaluate_msv2_at),
tapi tetep JAUH lebih cepat dari versi TS lama karena:
1. Data candle di-slice pakai numpy array (bukan re-fetch/re-generate)
2. Dipanggil dalam loop backtest yang udah di-precompute indikator lain
   secara vectorized duluan (RSI series, SMA series, dst)
"""
import numpy as np

MSV2_BASE_CANDLE_COUNT = {"M1": 150, "M5": 120, "M15": 100, "M30": 96, "H1": 96, "H2": 84, "H4": 72, "D1": 60}
MSV2_FRACTAL_STRENGTH = {
    "M1": (2, 2), "M5": (2, 2), "M15": (2, 2), "M30": (2, 2),
    "H1": (2, 2), "H2": (2, 2), "H4": (3, 3), "D1": (3, 3),
}
MSV2_SWING_MIN_DIST_ATR = {"M1": 0.2, "M5": 0.25, "M15": 0.3, "M30": 0.35, "H1": 0.35, "H2": 0.55, "H4": 0.4, "D1": 0.45}
MSV2_BREAK_FOLLOWTHROUGH_ATR = {"M1": 0.4, "M5": 0.4, "M15": 0.4, "M30": 0.55, "H1": 0.55, "H2": 0.55, "H4": 0.6, "D1": 0.6}


def _atr_simple_seed(highs, lows, closes, period=14):
    """ATR Wilder versi numpy cepat, dipake INTERNAL msv2 (butuh 1 angka doang,
    dari slice candle yang udah dipotong pas manggil)."""
    n = len(closes)
    if n < 2:
        return 0.0
    tr = np.empty(n - 1)
    for i in range(1, n):
        tr[i - 1] = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
    if len(tr) == 0:
        return 0.0
    if len(tr) < period:
        return tr.mean()
    rma = tr[:period].mean()
    for i in range(period, len(tr)):
        rma = (rma * (period - 1) + tr[i]) / period
    return rma


def _find_swing_points(values, is_high, left, right, atr, min_dist_atr):
    raw = []
    n = len(values)
    for i in range(left, n - right):
        is_swing = True
        for j in range(1, left + 1):
            if (is_high and values[i] <= values[i - j]) or (not is_high and values[i] >= values[i - j]):
                is_swing = False
                break
        if is_swing:
            for j in range(1, right + 1):
                if (is_high and values[i] <= values[i + j]) or (not is_high and values[i] >= values[i + j]):
                    is_swing = False
                    break
        if is_swing:
            raw.append((values[i], i))

    min_dist = atr * min_dist_atr
    filtered = []
    for price, idx in raw:
        if not filtered:
            filtered.append((price, idx))
        else:
            last_price, last_idx = filtered[-1]
            if abs(price - last_price) >= min_dist:
                filtered.append((price, idx))
            elif (is_high and price > last_price) or (not is_high and price < last_price):
                filtered[-1] = (price, idx)
    return filtered  # list of (price, index)


def _score_structure_direction(swing_highs, swing_lows):
    if len(swing_highs) < 3 or len(swing_lows) < 3:
        return 0, 0
    h = swing_highs[-3:]
    l = swing_lows[-3:]
    h_prev2, h_prev, h_last = h[0][0], h[1][0], h[2][0]
    l_prev2, l_prev, l_last = l[0][0], l[1][0], l[2][0]
    bull, bear = 0, 0
    if h_last > h_prev: bull += 2
    if l_last > l_prev: bull += 2
    if h_prev > h_prev2: bull += 1
    if l_prev > l_prev2: bull += 1
    if h_last < h_prev: bear += 2
    if l_last < l_prev: bear += 2
    if h_prev < h_prev2: bear += 1
    if l_prev < l_prev2: bear += 1
    return bull, bear


def _find_recent_breaks(closes, swing_highs, swing_lows, max_breaks):
    all_swings = [(idx, price, "high") for price, idx in swing_highs] + \
                 [(idx, price, "low") for price, idx in swing_lows]
    all_swings.sort(key=lambda x: x[0])
    breaks = []
    n = len(closes)
    for idx, price, typ in all_swings:
        for i in range(idx + 1, n):
            if typ == "high" and closes[i] > price:
                breaks.append({"index": i, "direction": "up", "level": price})
                break
            if typ == "low" and closes[i] < price:
                breaks.append({"index": i, "direction": "down", "level": price})
                break
    breaks.sort(key=lambda b: b["index"])
    return breaks[-max_breaks:]


def _score_break_quality(breaks, highs, lows, closes, atr, follow_through_atr):
    if not breaks:
        return 0, 0, 0, "data kurang"
    valid = 0
    n = len(closes)
    for b in breaks:
        max_follow = 0.0
        end_idx = min(b["index"] + 5, n)
        for i in range(b["index"], end_idx):
            dist = (highs[i] - b["level"]) if b["direction"] == "up" else (b["level"] - lows[i])
            if dist > max_follow:
                max_follow = dist
        follow_ok = max_follow >= atr * follow_through_atr
        back_in_range = False
        for i in range(b["index"] + 1, min(b["index"] + 3, n - 1) + 1):
            if b["direction"] == "up" and closes[i] < b["level"]:
                back_in_range = True
                break
            if b["direction"] == "down" and closes[i] > b["level"]:
                back_in_range = True
                break
        if follow_ok and not back_in_range:
            valid += 1
    points = 2 if valid >= 4 else 1 if valid >= 2 else 0
    label = "kuat" if valid >= 4 else "sedang" if valid >= 2 else "lemah"
    return valid, len(breaks), points, label


def _score_sideways(highs, lows, closes, opens, minor_breaks):
    n = len(closes)
    failed_count = 0
    for b in minor_breaks:
        back_in_range = False
        for i in range(b["index"] + 1, min(b["index"] + 3, n - 1) + 1):
            if b["direction"] == "up" and closes[i] < b["level"]:
                back_in_range = True
                break
            if b["direction"] == "down" and closes[i] > b["level"]:
                back_in_range = True
                break
        if back_in_range:
            failed_count += 1
    failure_rate = failed_count / len(minor_breaks) if minor_breaks else 0
    failure_score = 3 if failure_rate > 0.6 else 2 if failure_rate > 0.4 else 1 if failure_rate > 0.25 else 0

    window = min(20, n - 1)
    overlap_count = 0
    for i in range(max(1, n - window), n):
        overlap = min(highs[i], highs[i - 1]) - max(lows[i], lows[i - 1])
        if overlap > 0:
            overlap_count += 1
    overlap_rate = overlap_count / window if window > 0 else 0
    overlap_score = 2 if overlap_rate > 0.6 else 1 if overlap_rate > 0.45 else 0

    window_slice = max(1, n - window)
    range_high = max(highs[window_slice:])
    range_low = min(lows[window_slice:])
    rng = range_high - range_low
    mid_count = 0
    for i in range(window_slice, n):
        if rng == 0:
            continue
        pos = (closes[i] - range_low) / rng
        if 0.4 <= pos <= 0.6:
            mid_count += 1
    mid_rate = mid_count / window if window > 0 else 0
    midrange_score = 2 if mid_rate > 0.5 else 1 if mid_rate > 0.35 else 0

    wick_dom_count = 0
    for i in range(window_slice, n):
        body = abs(closes[i] - opens[i])
        total_range = highs[i] - lows[i]
        wick = total_range - body
        if total_range > 0 and wick / total_range > 0.5:
            wick_dom_count += 1
    wick_rate = wick_dom_count / window if window > 0 else 0
    wick_score = 2 if wick_rate > 0.45 else 1 if wick_rate > 0.3 else 0

    total = failure_score + overlap_score + midrange_score + wick_score
    return failure_score, overlap_score, midrange_score, wick_score, total


def _score_impulse_retrace(swing_highs, swing_lows, current_price, bias):
    if not swing_highs or not swing_lows:
        return 0
    if bias == "bullish":
        last_low_price, last_low_idx = swing_lows[-1]
        last_high_price, last_high_idx = swing_highs[-1]
        if last_high_idx <= last_low_idx:
            return 0
        impulse = last_high_price - last_low_price
        if impulse <= 0:
            return 0
        retrace = (last_high_price - current_price) / impulse
        if retrace < 0.35: return 2
        if retrace <= 0.50: return 1
        if retrace <= 0.65: return 0
        return -1
    else:
        last_high_price, last_high_idx = swing_highs[-1]
        last_low_price, last_low_idx = swing_lows[-1]
        if last_low_idx <= last_high_idx:
            return 0
        impulse = last_high_price - last_low_price
        if impulse <= 0:
            return 0
        rebound = (current_price - last_low_price) / impulse
        if rebound < 0.35: return 2
        if rebound <= 0.50: return 1
        if rebound <= 0.65: return 0
        return -1


def _score_position(highs, lows, closes, window):
    n = len(highs)
    sl = max(0, n - window)
    h = max(highs[sl:])
    l = min(lows[sl:])
    c = closes[-1]
    range_position = (c - l) / (h - l) if h > l else 0.5
    return (1 if range_position > 0.65 else 0), (1 if range_position < 0.35 else 0), range_position


def _score_ma_confluence(closes):
    if len(closes) < 20:
        return 0, 0
    sma5 = closes[-5:].mean()
    sma10 = closes[-10:].mean()
    sma20 = closes[-20:].mean()
    price = closes[-1]
    bull, bear = 0, 0
    if price > sma5: bull += 1
    else: bear += 1
    if sma5 > sma10: bull += 1
    else: bear += 1
    if sma10 > sma20: bull += 1
    else: bear += 1
    # RSI(14) sederhana dari closes yang sama (dipanggil sekali doang di sini,
    # cukup akurat given cuma butuh 1 angka -- bukan seri penuh)
    from indicators import calc_rsi_wilder
    import pandas as pd
    rsi_val = calc_rsi_wilder(pd.Series(closes), 14).iloc[-1]
    if rsi_val > 50: bull += 1
    else: bear += 1
    return bull, bear


def _run_pass(opens, highs, lows, closes, tf, candle_count):
    cc = min(candle_count, len(closes))
    o, h, l, c = opens[-cc:], highs[-cc:], lows[-cc:], closes[-cc:]
    atr = _atr_simple_seed(h, l, c)
    fractal_l, fractal_r = MSV2_FRACTAL_STRENGTH[tf]
    min_dist_atr = MSV2_SWING_MIN_DIST_ATR[tf]

    swing_highs = _find_swing_points(h, True, fractal_l, fractal_r, atr, min_dist_atr)
    swing_lows = _find_swing_points(l, False, fractal_l, fractal_r, atr, min_dist_atr)

    if len(swing_highs) < 3 or len(swing_lows) < 3:
        return {
            "classification": "transition", "bias": "sideways",
            "bullish_total": 0, "bearish_total": 0, "sideways_total": 0,
            "candle_count_used": cc,
        }

    struct_bull, struct_bear = _score_structure_direction(swing_highs, swing_lows)
    follow_atr = MSV2_BREAK_FOLLOWTHROUGH_ATR[tf]
    recent_breaks = _find_recent_breaks(c, swing_highs, swing_lows, 5)
    _, _, bq_points, _ = _score_break_quality(recent_breaks, h, l, c, atr, follow_atr)

    minor_breaks = _find_recent_breaks(c, swing_highs, swing_lows, 10)
    _, _, _, _, sideways_total = _score_sideways(h, l, c, o, minor_breaks)

    current_price = c[-1]
    bull_retrace = _score_impulse_retrace(swing_highs, swing_lows, current_price, "bullish")
    bear_rebound = _score_impulse_retrace(swing_highs, swing_lows, current_price, "bearish")

    bull_bonus, bear_bonus, _ = _score_position(h, l, c, min(cc, 50))
    ma_bull, ma_bear = _score_ma_confluence(c)

    bullish_total = struct_bull + bq_points + bull_retrace + bull_bonus
    bearish_total = struct_bear + bq_points + bear_rebound + bear_bonus
    diff = bullish_total - bearish_total

    if bullish_total >= 8 and diff >= 3 and sideways_total <= 5 and ma_bull >= 2:
        classification, bias = "bullish_strong", "bullish"
    elif bearish_total >= 8 and -diff >= 3 and sideways_total <= 5 and ma_bear >= 2:
        classification, bias = "bearish_strong", "bearish"
    elif (bullish_total >= 6 and sideways_total > 5) or (bearish_total >= 6 and sideways_total > 5):
        classification, bias = "transition", "sideways"
    elif sideways_total >= 6 or abs(diff) <= 2 or (bullish_total < 6 and bearish_total < 6):
        classification, bias = "sideways", "sideways"
    elif bullish_total >= 6 and diff > 0 and sideways_total <= 5:
        classification, bias = "bullish_weak", "bullish"
    elif bearish_total >= 6 and diff < 0 and sideways_total <= 5:
        classification, bias = "bearish_weak", "bearish"
    else:
        classification, bias = "transition", "sideways"

    return {
        "classification": classification, "bias": bias,
        "bullish_total": bullish_total, "bearish_total": bearish_total, "sideways_total": sideways_total,
        "candle_count_used": cc,
    }


def analyze_market_structure_v2(opens, highs, lows, closes, tf):
    """
    Entry point — PERSIS analyzeMarketStructureV2 TS, termasuk two-pass
    adaptive candle count. opens/highs/lows/closes itu numpy array PENUH
    (SAMPAI titik simulasi saat ini doang, caller yang tanggung jawab slice
    "no look-ahead" sebelum manggil fungsi ini).
    """
    base_count = MSV2_BASE_CANDLE_COUNT[tf]
    pass1 = _run_pass(opens, highs, lows, closes, tf, base_count)

    adjusted_count = None
    if pass1["sideways_total"] >= 8:
        adjusted_count = round(base_count * 1.30)
    elif (pass1["classification"] == "bullish_strong" and pass1["bullish_total"] - pass1["bearish_total"] >= 5) or \
         (pass1["classification"] == "bearish_strong" and pass1["bearish_total"] - pass1["bullish_total"] >= 5):
        adjusted_count = round(base_count * 0.75)

    if adjusted_count is not None and adjusted_count != base_count and len(closes) >= min(adjusted_count, len(closes)):
        pass2 = _run_pass(opens, highs, lows, closes, tf, adjusted_count)
        return pass2

    return pass1
