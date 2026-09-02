"""
Indikator dasar, vectorized pakai Pandas — replikasi PERSIS logic TypeScript
di smc.ts (calcATR, calcRSI, calcMACD, calcSMA, calcStochRSI, calcFibonacci).
Semua fungsi di sini return pd.Series (bukan angka tunggal), beda dari versi
TS yang biasanya cuma return nilai TERAKHIR — biar backtest bisa evaluasi
SEMUA titik candle sekaligus (vectorized), bukan loop manual re-hitung ulang
tiap titik (yang lambat, itu kelemahan pendekatan lama).
"""
import numpy as np
import pandas as pd


def calc_atr_wilder(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """ATR Wilder/RMA — PERSIS calcATR di smc.ts (seed SMA(period), lalu RMA)."""
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    tr = tr.iloc[1:]  # TS: trs mulai dari i=1 (skip candle pertama)

    atr = pd.Series(index=df.index, dtype=float)
    if len(tr) == 0:
        return atr.fillna(0.0)
    if len(tr) < period:
        # fallback data kurang: rata-rata SEMUA tr yang ada, sama utk semua titik
        val = tr.mean()
        atr.iloc[1:] = val
        atr.iloc[0] = 0.0
        return atr

    # RMA manual (bukan pandas .ewm, biar match PERSIS seeding SMA(period) punya TS)
    tr_vals = tr.to_numpy()
    atr_vals = np.full(len(tr_vals), np.nan)
    seed = tr_vals[:period].mean()
    atr_vals[period - 1] = seed
    rma = seed
    for i in range(period, len(tr_vals)):
        rma = (rma * (period - 1) + tr_vals[i]) / period
        atr_vals[i] = rma
    # tr index mulai dari df.index[1], isi balik ke df.index penuh
    result = pd.Series(index=df.index, dtype=float)
    result.iloc[0] = np.nan
    result.iloc[1:] = atr_vals
    return result.ffill().fillna(0.0)


def calc_rsi_wilder(closes: pd.Series, period: int = 14) -> pd.Series:
    """RSI Wilder — PERSIS calcRSI di smc.ts. Return series RSI penuh (default 50
    di titik yang datanya belum cukup, sama kayak fallback TS)."""
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)

    n = len(closes)
    rsi = np.full(n, 50.0)
    if n < period + 1:
        return pd.Series(rsi, index=closes.index)

    gain_vals = gain.to_numpy()
    loss_vals = loss.to_numpy()
    avg_gain = np.nanmean(gain_vals[1:period + 1])
    avg_loss = np.nanmean(loss_vals[1:period + 1])
    if avg_loss == 0:
        rsi[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi[period] = 100 - 100 / (1 + rs)

    for i in range(period + 1, n):
        g = gain_vals[i] if not np.isnan(gain_vals[i]) else 0.0
        l = loss_vals[i] if not np.isnan(loss_vals[i]) else 0.0
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        if avg_loss == 0:
            rsi[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[i] = 100 - 100 / (1 + rs)
    # titik SEBELUM index [period] tetep default 50 (belum cukup data), sesuai fallback TS
    return pd.Series(rsi, index=closes.index)


def calc_ema_series(values: pd.Series, span: int) -> pd.Series:
    """EMA — PERSIS calcEMASeries TS (seed = nilai pertama, bukan SMA)."""
    k = 2 / (span + 1)
    vals = values.to_numpy()
    ema = np.empty(len(vals))
    ema[0] = vals[0]
    for i in range(1, len(vals)):
        ema[i] = vals[i] * k + ema[i - 1] * (1 - k)
    return pd.Series(ema, index=values.index)


def calc_macd(closes: pd.Series) -> pd.DataFrame:
    """MACD — PERSIS calcMACD TS. Return df dengan kolom macd/signal/histogram."""
    if len(closes) < 35:
        return pd.DataFrame({
            "macd": 0.0, "signal": 0.0, "histogram": 0.0,
        }, index=closes.index)
    ema12 = calc_ema_series(closes, 12)
    ema26 = calc_ema_series(closes, 26)
    macd_line = ema12 - ema26
    signal_line = calc_ema_series(macd_line, 9)
    histogram = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "histogram": histogram})


def calc_sma(closes: pd.Series, period: int) -> pd.Series:
    return closes.rolling(window=period, min_periods=1).mean()


def calc_stoch_rsi(closes: pd.Series, rsi_period: int = 14, stoch_period: int = 14) -> pd.Series:
    """Stochastic RSI — PERSIS calcStochRSI TS (stochastic DARI series RSI)."""
    rsi_series = calc_rsi_wilder(closes, rsi_period)
    n = len(rsi_series)
    out = np.full(n, 50.0)
    rsi_vals = rsi_series.to_numpy()
    for i in range(stoch_period - 1, n):
        window = rsi_vals[i - stoch_period + 1:i + 1]
        lo, hi = window.min(), window.max()
        if hi == lo:
            out[i] = 50.0
        else:
            out[i] = (rsi_vals[i] - lo) / (hi - lo) * 100
    return pd.Series(out, index=closes.index)


def calc_fibonacci_at(df: pd.DataFrame, idx: int, lookback: int = 30) -> dict | None:
    """Fibonacci retracement — PERSIS calcFibonacci TS, dihitung di 1 titik (idx)
    dari 30 candle SEBELUM DAN TERMASUK idx (real-time simulation, no look-ahead)."""
    start = max(0, idx - lookback + 1)
    window = df.iloc[start:idx + 1]
    if len(window) == 0:
        return None
    swing_high = window["high"].max()
    swing_low = window["low"].min()
    rng = swing_high - swing_low
    if rng == 0:
        return None
    return {
        "swing_high": swing_high, "swing_low": swing_low,
        "levels": {
            "0.0": swing_low,
            "0.236": swing_low + rng * 0.236,
            "0.382": swing_low + rng * 0.382,
            "0.5": swing_low + rng * 0.5,
            "0.618": swing_low + rng * 0.618,
            "0.705": swing_low + rng * 0.705,
            "0.786": swing_low + rng * 0.786,
            "1.0": swing_high,
        },
    }


def calc_volume_ma(volumes: pd.Series, period: int = 20) -> pd.Series:
    """Volume MA20 versi TS: rata-rata window SEBELUM index saat ini (exclusive),
    bukan termasuk candle sekarang — PERSIS volMA20At di tryZoneBreakoutRetest."""
    return volumes.shift(1).rolling(window=period, min_periods=1).mean()


def precompute_indicator_series(df: pd.DataFrame) -> dict:
    """
    OPTIMASI KRUSIAL (ketemu user, backtest lambat — Skill 15M 33 detik buat
    720 candle H1, gara-gara calc_rsi_wilder/calc_atr_wilder DIPANGGIL ULANG
    RATUSAN-RIBUAN KALI, tiap kali re-hitung dari AWAL data). Hitung SEKALI
    doang buat SELURUH dataset, return dict numpy array — tinggal index[idx]
    pas dipanggil per titik simulasi (O(1) per akses, bukan O(n) re-hitung).
    Semua indikator ini CAUSAL (gak butuh data masa depan), jadi precompute
    dari FULL dataset hasilnya IDENTIK sama hitung ulang dari slice — cuma
    beda cara ambil, BUKAN beda logic/angka.
    """
    closes_s = df["close"]
    return {
        "rsi": calc_rsi_wilder(closes_s, 14).to_numpy(),
        "stoch_rsi": calc_stoch_rsi(closes_s).to_numpy(),
        "atr_wilder": calc_atr_wilder(df, 14).to_numpy(),
        "macd": calc_macd(closes_s).to_numpy(),  # DataFrame -> numpy 2D (macd, signal, histogram)
        "volumes": df["volume"].to_numpy(),
    }

