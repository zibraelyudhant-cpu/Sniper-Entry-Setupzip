"""
Deteksi zona S&R — replikasi PERSIS detectZonesForExtreme, findSwingHighs/Lows,
filterZonesNumpukFib dari smc.ts.
"""
import numpy as np
from indicators import calc_fibonacci_at


def find_swing_highs(highs, lookback):
    """PERSIS findSwingHighs TS — fractal 2-kiri-2-kanan, ambil N terakhir."""
    swings = []
    n = len(highs)
    for i in range(2, n - 2):
        if highs[i] > highs[i-1] and highs[i] > highs[i-2] and highs[i] > highs[i+1] and highs[i] > highs[i+2]:
            swings.append(highs[i])
    return swings[-lookback:] if lookback else swings


def find_swing_lows(lows, lookback):
    swings = []
    n = len(lows)
    for i in range(2, n - 2):
        if lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
            swings.append(lows[i])
    return swings[-lookback:] if lookback else swings


def detect_zones_for_extreme(highs, lows, atr_htf, min_touches=2):
    """PERSIS detectZonesForExtreme TS — swing+merge WAJIB minimal N touches."""
    zone_width = atr_htf * 0.35
    merge_distance = atr_htf * 0.5
    lookback_slice = 120
    h = highs[-lookback_slice:]
    l = lows[-lookback_slice:]
    swing_h = find_swing_highs(h, 30)
    swing_l = find_swing_lows(l, 30)

    def merge_with_touches(levels):
        if not levels:
            return []
        sorted_levels = sorted(levels)
        groups = [[sorted_levels[0]]]
        for x in sorted_levels[1:]:
            if x - groups[-1][-1] <= merge_distance:
                groups[-1].append(x)
            else:
                groups.append([x])
        return [sum(g) / len(g) for g in groups if len(g) >= min_touches]

    return merge_with_touches(swing_h), merge_with_touches(swing_l), zone_width


def filter_zones_numpuk_fib(levels, df, idx):
    """PERSIS filterZonesNumpukFib TS — zona WAJIB numpuk Fibonacci (toleransi 0.5%)."""
    fib = calc_fibonacci_at(df, idx)
    if not fib:
        return []
    fib_values = list(fib["levels"].values())
    return [lvl for lvl in levels if any(abs(lvl - fv) / lvl * 100 < 0.5 for fv in fib_values)]
