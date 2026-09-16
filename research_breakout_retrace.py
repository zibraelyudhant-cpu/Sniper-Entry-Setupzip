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

SYMBOLS = ["BTCUSDT", "DOGEUSDT", "SUIUSDT"]
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
                    "failed_after_retrace": 0, "candles_to_retest": [], "precision_pct": [],
                    "tp_outcome": []} for m in VOLUME_MULTIPLIERS}

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

            # TAMBAHAN (request user): ukur SEPRESISI APA harga balik ke
            # level PAS SAAT PERTAMA KALI nyentuh -- 0 = pas persis di
            # level, POSITIF = berhenti SEBELUM nyampe level (retrace
            # dangkal, gak sampe level), NEGATIF = udah LEWAT/nembus level
            # (overshoot). Ini beda dari "depth" (kemarin) yang ngukur
            # titik TERDALAM keseluruhan -- ini ngukur PAS DI CANDLE
            # SENTUHAN PERTAMA doang, buat kalibrasi jarak entry limit.
            touch_high, touch_low = highs[retrace_touch_idx], lows[retrace_touch_idx]
            if direction == "bullish":
                precision_pct = (touch_low - broken_level) / broken_level * 100
            else:
                precision_pct = (broken_level - touch_high) / broken_level * 100
            results[mult]["precision_pct"].append(precision_pct)

            # TAMBAHAN (request user): simulasi TRADE FORWARD -- entry di
            # level (sama mekanisme Sniper Breakout skill 1: level +-0.05%
            # ke arah gampang ke-fill, SL 1.4x ATR) -- cari RR TERTINGGI yang
            # kena SEBELUM SL, minimal RR1:2 sampe RR1:4.
            dir_mult = 1 if direction == "bullish" else -1
            entry_price = broken_level + (broken_level * 0.0005 * dir_mult)
            sl_price = entry_price - atr_at_breakout * 1.4 * dir_mult
            risk = abs(entry_price - sl_price)
            rr2_price = entry_price + risk * 2 * dir_mult
            rr3_price = entry_price + risk * 3 * dir_mult
            rr4_price = entry_price + risk * 4 * dir_mult

            outcome = "below_rr2"  # default kalau sampe window abis blm nyampe RR1:2 & blm SL
            max_rr_reached = 0
            for k in range(retrace_touch_idx, min(retrace_touch_idx + 100, n)):
                if direction == "bullish":
                    sl_hit = lows[k] <= sl_price
                    rr4_hit = highs[k] >= rr4_price
                    rr3_hit = highs[k] >= rr3_price
                    rr2_hit = highs[k] >= rr2_price
                else:
                    sl_hit = highs[k] >= sl_price
                    rr4_hit = lows[k] <= rr4_price
                    rr3_hit = lows[k] <= rr3_price
                    rr2_hit = lows[k] <= rr2_price

                if rr4_hit:
                    max_rr_reached = 4
                elif rr3_hit:
                    max_rr_reached = max(max_rr_reached, 3)
                elif rr2_hit:
                    max_rr_reached = max(max_rr_reached, 2)

                # SL dicek DULUAN per candle (asumsi konservatif -- worst case)
                if sl_hit:
                    outcome = "sl" if max_rr_reached == 0 else f"rr{max_rr_reached}_then_sl"
                    break
                if max_rr_reached == 4:
                    outcome = "rr4"
                    break
            else:
                # window abis (100 candle) tanpa SL/RR4 -- laporin RR tertinggi
                # yang sempet kena, atau "below_rr2" kalau blm ada yang kena
                if max_rr_reached > 0:
                    outcome = f"rr{max_rr_reached}_nohit_rr4"
            results[mult]["tp_outcome"].append(outcome)

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

        print(f"\n  Presisi retest ke level PAS SAAT PERTAMA nyentuh (%) -- 0=pas persis,")
        print(f"  POSITIF=berhenti SEBELUM nyampe level, NEGATIF=overshoot lewat level:")
        print(f"  {'Threshold':<12}{'Med%':<8}{'P25%':<8}{'P75%':<8}{'Min%':<8}{'Max%':<8}")
        for mult in VOLUME_MULTIPLIERS:
            r = res[mult]
            prec = sorted(r["precision_pct"])
            if not prec:
                print(f"  {mult}x MA20{'':<4}(gak ada data)")
                continue
            n_p = len(prec)
            med_p = prec[n_p // 2]
            p25_p = prec[min(int(n_p * 0.25), n_p - 1)]
            p75_p = prec[min(int(n_p * 0.75), n_p - 1)]
            print(f"  {mult}x MA20{'':<4}{med_p:<8.4f}{p25_p:<8.4f}{p75_p:<8.4f}{prec[0]:<8.4f}{prec[-1]:<8.4f}")

        print(f"\n  Simulasi RR tertinggi kena SEBELUM SL (entry level+-0.05%, SL 1.4xATR):")
        for mult in VOLUME_MULTIPLIERS:
            r = res[mult]
            outcomes = r["tp_outcome"]
            if not outcomes:
                print(f"  {mult}x MA20{'':<4}(gak ada data)")
                continue
            n_o = len(outcomes)
            from collections import Counter
            counts = Counter(outcomes)
            print(f"  {mult}x MA20 (n={n_o}):")
            for k, v in sorted(counts.items(), key=lambda x: -x[1]):
                print(f"    {k:<20} {v} ({v/n_o*100:.1f}%)")

    with open("breakout_retrace_result.json", "w") as f:
        json.dump(all_results, f, indent=2)
    print("\nHasil lengkap juga disimpan ke breakout_retrace_result.json")


if __name__ == "__main__":
    main()