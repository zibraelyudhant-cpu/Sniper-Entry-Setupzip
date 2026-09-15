"""
Riset: breakout M15 (3 threshold volume) -> berapa sering harga RETRACE
balik ke level sebelum lanjut trend.

Jalanin di Replit (yang punya akses Binance):
  python3 research_breakout_retrace.py

Output: statistik per simbol per threshold volume (1.5x/2x/2.5x MA20).
"""
import urllib.request
import json
import time
from datetime import datetime, timezone, timedelta

SYMBOLS = ["BTCUSDT", "DOGEUSDT"]
INTERVAL = "15m"
MONTHS_BACK = 12
VOLUME_MULTIPLIERS = [1.5, 2.0, 2.5]
ADX_MIN = 25
LOOKAHEAD_CANDLES = 40      # ~10 jam, window buat cek "apa retrace kejadian"
SWING_LOOKBACK = 30         # window nyari swing high/low fresh
SWING_FRACTAL = 2           # syarat fractal (2 kiri, 2 kanan)
RETEST_TOLERANCE_PCT = 0.15 # toleransi "nyentuh lagi" ke level (dlm %)

BASE_URL = "https://fapi.binance.com/fapi/v1/klines"


def fetch_klines(symbol, interval, start_ms, end_ms):
    """Fetch semua candle antara start_ms-end_ms, paginated (limit 1500/req)."""
    all_klines = []
    cur_start = start_ms
    while cur_start < end_ms:
        url = f"{BASE_URL}?symbol={symbol}&interval={interval}&startTime={cur_start}&endTime={end_ms}&limit=1500"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = json.loads(resp.read())
                break
            except Exception as e:
                print(f"  retry ({attempt+1}/3) {symbol}: {e}")
                time.sleep(2)
        else:
            raise RuntimeError(f"Gagal fetch {symbol} setelah 3x retry")
        if not data:
            break
        all_klines.extend(data)
        cur_start = data[-1][0] + 1
        print(f"  {symbol}: {len(all_klines)} candle terkumpul...")
        time.sleep(0.3)  # sopan ke rate limit
    return all_klines


def calc_sma(values, period, idx):
    if idx < period - 1:
        return None
    window = values[idx - period + 1: idx + 1]
    return sum(window) / period


def calc_adx(highs, lows, closes, period, idx):
    """ADX(14) Wilder sederhana, dihitung sampai index idx."""
    if idx < period * 2:
        return None
    trs, plus_dms, minus_dms = [], [], []
    for i in range(1, idx + 1):
        high, low, prev_close = highs[i], lows[i], closes[i - 1]
        prev_high, prev_low = highs[i - 1], lows[i - 1]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        up_move = high - prev_high
        down_move = prev_low - low
        plus_dm = up_move if (up_move > down_move and up_move > 0) else 0
        minus_dm = down_move if (down_move > up_move and down_move > 0) else 0
        trs.append(tr)
        plus_dms.append(plus_dm)
        minus_dms.append(minus_dm)

    def wilder_smooth(vals, period):
        smoothed = [sum(vals[:period])]
        for v in vals[period:]:
            smoothed.append(smoothed[-1] - (smoothed[-1] / period) + v)
        return smoothed

    if len(trs) < period * 2:
        return None
    atr_s = wilder_smooth(trs, period)
    plus_s = wilder_smooth(plus_dms, period)
    minus_s = wilder_smooth(minus_dms, period)
    dxs = []
    for a, p, m in zip(atr_s, plus_s, minus_s):
        if a == 0:
            continue
        plus_di = 100 * p / a
        minus_di = 100 * m / a
        denom = plus_di + minus_di
        dx = 100 * abs(plus_di - minus_di) / denom if denom != 0 else 0
        dxs.append(dx)
    if len(dxs) < period:
        return None
    return sum(dxs[-period:]) / period


def find_fresh_swing(highs, lows, idx, lookback, fractal):
    """Cari swing high & swing low FRESH (fractal) dalam window sebelum idx."""
    start = max(fractal, idx - lookback)
    swing_high = None
    swing_low = None
    for i in range(idx - fractal, start - 1, -1):
        if i < fractal or i + fractal >= len(highs):
            continue
        is_high = all(highs[i] > highs[i - k] for k in range(1, fractal + 1)) and \
                  all(highs[i] > highs[i + k] for k in range(1, fractal + 1))
        is_low = all(lows[i] < lows[i - k] for k in range(1, fractal + 1)) and \
                 all(lows[i] < lows[i + k] for k in range(1, fractal + 1))
        if is_high and swing_high is None:
            swing_high = (i, highs[i])
        if is_low and swing_low is None:
            swing_low = (i, lows[i])
        if swing_high and swing_low:
            break
    return swing_high, swing_low


def is_fresh_untouched(highs, lows, swing_idx, swing_price, check_until_idx, tol_pct):
    tol = swing_price * tol_pct / 100
    for i in range(swing_idx + 1, check_until_idx):
        if abs(highs[i] - swing_price) <= tol or abs(lows[i] - swing_price) <= tol:
            return False
        if lows[i] <= swing_price <= highs[i]:
            return False
    return True


def calc_atr(highs, lows, closes, period, idx):
    if idx < period:
        return None
    trs = []
    for i in range(idx - period + 1, idx + 1):
        if i == 0:
            continue
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else None


def run_analysis(symbol, klines):
    opens = [float(k[1]) for k in klines]
    highs = [float(k[2]) for k in klines]
    lows = [float(k[3]) for k in klines]
    closes = [float(k[4]) for k in klines]
    volumes = [float(k[5]) for k in klines]
    n = len(closes)
    print(f"\n{symbol}: {n} candle M15 dianalisa ({n * 15 / 60 / 24:.0f} hari)")

    results = {m: {"total_breakout": 0, "retrace": 0, "no_retrace": 0,
                    "depths_pct": [], "depths_atr": [], "continued_after_retrace": 0,
                    "failed_after_retrace": 0, "candles_to_retest": []} for m in VOLUME_MULTIPLIERS}

    for i in range(SWING_LOOKBACK + SWING_FRACTAL, n - LOOKAHEAD_CANDLES):
        vol_ma20 = calc_sma(volumes, 20, i)
        if vol_ma20 is None or vol_ma20 == 0:
            continue

        swing_high, swing_low = find_fresh_swing(highs, lows, i, SWING_LOOKBACK, SWING_FRACTAL)

        bullish_breakout = swing_high is not None and closes[i] > swing_high[1] and \
            is_fresh_untouched(highs, lows, swing_high[0], swing_high[1], i, RETEST_TOLERANCE_PCT)
        bearish_breakout = swing_low is not None and closes[i] < swing_low[1] and \
            is_fresh_untouched(highs, lows, swing_low[0], swing_low[1], i, RETEST_TOLERANCE_PCT)

        if not bullish_breakout and not bearish_breakout:
            continue

        adx = calc_adx(highs, lows, closes, 14, i)
        if adx is None or adx <= ADX_MIN:
            continue

        atr_at_breakout = calc_atr(highs, lows, closes, 14, i)
        if atr_at_breakout is None or atr_at_breakout == 0:
            continue

        vol_ratio = volumes[i] / vol_ma20
        broken_level = swing_high[1] if bullish_breakout else swing_low[1]
        direction = "bullish" if bullish_breakout else "bearish"
        breakout_extreme = highs[i] if bullish_breakout else lows[i]  # titik ekstrem breakout candle

        for mult in VOLUME_MULTIPLIERS:
            if vol_ratio < mult:
                continue
            results[mult]["total_breakout"] += 1

            tol = broken_level * RETEST_TOLERANCE_PCT / 100
            retraced = False
            retrace_touch_idx = None
            for j in range(i + 1, min(i + 1 + LOOKAHEAD_CANDLES, n)):
                if abs(highs[j] - broken_level) <= tol or abs(lows[j] - broken_level) <= tol or \
                   (lows[j] <= broken_level <= highs[j]):
                    retraced = True
                    retrace_touch_idx = j
                    break

            if not retraced:
                results[mult]["no_retrace"] += 1
                continue

            results[mult]["retrace"] += 1

            # TAMBAHAN (request user): ukur BERAPA CANDLE dari breakout
            # sampai retest KEJADIAN -- buat kalibrasi scan-back window.
            candles_to_retest = retrace_touch_idx - i
            results[mult]["candles_to_retest"].append(candles_to_retest)

            # ═══ TAMBAHAN (request user): ukur SEBERAPA DALAM retrace-nya,
            # dan apa abis itu genuinely lanjut trend atau malah gagal (harga
            # nembus JAUH lewatin level, bukan cuma nyentuh/mantul) ═════════
            # FIX BUG (ketemu user, "angka kedalaman kelewat gede"): dulu
            # ngukur titik terdalam di SELURUH window 40 candle -- ikut
            # kehitung pullback LANJUTAN yang gak ada hubungannya sama retest
            # awal. Sekarang cuma sampai retrace_touch_idx (titik sentuhan
            # retest PERTAMA), biar genuinely ngukur kedalaman retest itu doang.
            full_window_end = min(i + 1 + LOOKAHEAD_CANDLES, n)  # buat continuation check
            depth_window_end = retrace_touch_idx + 1              # buat depth measurement
            if direction == "bullish":
                deepest = min(lows[i+1:depth_window_end])
                depth_abs = broken_level - deepest  # positif = nembus ke bawah level
            else:
                deepest = max(highs[i+1:depth_window_end])
                depth_abs = deepest - broken_level

            depth_pct = (depth_abs / broken_level) * 100
            depth_atr = depth_abs / atr_at_breakout
            results[mult]["depths_pct"].append(depth_pct)
            results[mult]["depths_atr"].append(depth_atr)

            # Cek lanjut trend: SETELAH titik retrace, apa harga bikin extreme
            # BARU yang ngelewatin breakout_extreme (konfirmasi genuinely
            # lanjut), dalam SISA window penuh (bukan window depth)?
            if retrace_touch_idx + 1 < full_window_end:
                rest = (highs[retrace_touch_idx+1:full_window_end] if direction == "bullish"
                        else lows[retrace_touch_idx+1:full_window_end])
                if direction == "bullish" and rest and max(rest) > breakout_extreme:
                    results[mult]["continued_after_retrace"] += 1
                elif direction == "bearish" and rest and min(rest) < breakout_extreme:
                    results[mult]["continued_after_retrace"] += 1
                else:
                    results[mult]["failed_after_retrace"] += 1
            else:
                results[mult]["failed_after_retrace"] += 1

    return results


def main():
    end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = int((datetime.now(timezone.utc) - timedelta(days=MONTHS_BACK * 30)).timestamp() * 1000)

    print(f"Rentang: {datetime.fromtimestamp(start_ms/1000, tz=timezone.utc).date()} "
          f"s/d {datetime.fromtimestamp(end_ms/1000, tz=timezone.utc).date()}")

    all_results = {}
    for symbol in SYMBOLS:
        print(f"\nFetching {symbol}...")
        klines = fetch_klines(symbol, INTERVAL, start_ms, end_ms)
        all_results[symbol] = run_analysis(symbol, klines)

    print("\n" + "=" * 70)
    print("HASIL RINGKASAN")
    print("=" * 70)
    for symbol, res in all_results.items():
        print(f"\n{symbol}:")
        print(f"{'Threshold':<12}{'Total':<8}{'Retrace':<10}{'No-Retr':<10}{'%Retrace':<10}")
        for mult in VOLUME_MULTIPLIERS:
            r = res[mult]
            total = r["total_breakout"]
            pct = (r["retrace"] / total * 100) if total > 0 else 0
            print(f"{mult}x MA20{'':<4}{total:<8}{r['retrace']:<10}{r['no_retrace']:<10}{pct:.1f}%")

        print(f"\n  Kedalaman retest (cuma sampai titik sentuhan pertama) & lanjut trend:")
        print(f"  {'Threshold':<12}{'Med ATR':<10}{'P75 ATR':<10}{'P90 ATR':<10}{'Lanjut trend':<14}")
        for mult in VOLUME_MULTIPLIERS:
            r = res[mult]
            depths_atr = sorted(r["depths_atr"])
            if not depths_atr:
                print(f"  {mult}x MA20{'':<4}(gak ada data retrace)")
                continue
            n_d = len(depths_atr)
            med = depths_atr[n_d // 2]
            p75 = depths_atr[min(int(n_d * 0.75), n_d - 1)]
            p90 = depths_atr[min(int(n_d * 0.90), n_d - 1)]
            cont = r["continued_after_retrace"]
            fail = r["failed_after_retrace"]
            cont_pct = cont / (cont+fail) * 100 if (cont+fail) > 0 else 0
            print(f"  {mult}x MA20{'':<4}{med:<10.2f}{p75:<10.2f}{p90:<10.2f}{cont_pct:<13.1f}%")

        print(f"\n  Berapa CANDLE M15 dari breakout sampai retest kejadian (buat kalibrasi scan-back):")
        print(f"  {'Threshold':<12}{'Med':<8}{'P75':<8}{'P90':<8}{'P95':<8}{'Max':<8}")
        for mult in VOLUME_MULTIPLIERS:
            r = res[mult]
            ctr = sorted(r["candles_to_retest"])
            if not ctr:
                print(f"  {mult}x MA20{'':<4}(gak ada data)")
                continue
            n_c = len(ctr)
            med_c = ctr[n_c // 2]
            p75_c = ctr[min(int(n_c * 0.75), n_c - 1)]
            p90_c = ctr[min(int(n_c * 0.90), n_c - 1)]
            p95_c = ctr[min(int(n_c * 0.95), n_c - 1)]
            print(f"  {mult}x MA20{'':<4}{med_c:<8}{p75_c:<8}{p90_c:<8}{p95_c:<8}{ctr[-1]:<8}")

    with open("breakout_retrace_result.json", "w") as f:
        json.dump(all_results, f, indent=2)
    print("\nHasil lengkap juga disimpan ke breakout_retrace_result.json")


if __name__ == "__main__":
    main()
