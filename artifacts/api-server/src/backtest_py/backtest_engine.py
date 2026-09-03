"""
Engine backtest utama — loop simulasi candle-per-candle, evaluasi SL/TP,
kumpulin hasil. Dipanggil sebagai subprocess dari Node (backtest.ts), terima
input JSON via stdin, kirim hasil JSON via stdout.

INPUT (stdin JSON):
{
  "menu": "structural" | "scalping15m" | "counter_scalping" | "both",
  "candles": {
    "m30": [[timestamp, open, high, low, close, volume], ...],  // buat structural
    "m5": [...],
    "m15": [...],  // buat scalping15m
    "h4": [...],   // filter indikator kedua skill Scalping
    "h1": [...],   // buat counter_scalping
    "btc_h1": [...] // opsional, buat BTC correlation
  }
}

OUTPUT (stdout JSON):
{
  "structuralResult": {...} | null,
  "scalping15mResult": {...} | null,
  "counterScalpingResult": {...} | null,
}
"""
import sys
import json
import time
import pandas as pd
import numpy as np

from strategy_structural import try_entry_structural
from strategy_15m import try_entry_15m
from strategy_counter import try_entry_counter_scalping, precompute_counter_series
from msv2 import analyze_market_structure_v2
from indicators import precompute_indicator_series


def klines_to_df(klines):
    """Binance kline array -> DataFrame kolom timestamp/open/high/low/close/volume."""
    df = pd.DataFrame(klines, columns=["timestamp", "open", "high", "low", "close", "volume"] + [f"extra{i}" for i in range(max(0, len(klines[0]) - 6) if klines else 0)])
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)
    df["timestamp"] = df["timestamp"].astype(np.int64)
    return df[["timestamp", "open", "high", "low", "close", "volume"]].reset_index(drop=True)


def get_btc_bias_at(btc_h1_df, timestamp, tf="H1"):
    """Cek bias BTC di titik waktu tertentu — proxy checkBtcAlignment TS."""
    if btc_h1_df is None:
        return None
    slice_df = btc_h1_df[btc_h1_df["timestamp"] <= timestamp].tail(100)
    if len(slice_df) < 30:
        return None
    result = analyze_market_structure_v2(
        slice_df["open"].to_numpy(), slice_df["high"].to_numpy(),
        slice_df["low"].to_numpy(), slice_df["close"].to_numpy(), tf
    )
    cls = result["classification"]
    if cls in ("bullish_strong", "bullish_weak"):
        return "bullish"
    if cls in ("bearish_strong", "bearish_weak"):
        return "bearish"
    return "ranging"


def wait_for_limit_fill(df, signal_idx, entry_price, bias, max_wait=40):
    """
    FIX BUG KRUSIAL: sinyal Structural/Skill15M/Counter Scalping itu LIMIT
    ORDER (entry_price bukan harga candle sekarang, tapi level breakout/zona)
    — posisi CUMA kebuka begitu harga GENUINELY balik nyentuh level itu.
    Backtest awal saya SALAH nganggep posisi langsung kebuka di signal_idx,
    yang bikin WR keliatan gak masuk akal tinggi (90%+, entry keburu di
    harga yang udah searah duluan, bukan nunggu retest genuine).

    Cari candle PERTAMA setelah signal_idx dimana high/low candle nyentuh
    entry_price. Return index candle itu, atau None kalau gak pernah
    kesentuh dalam max_wait candle.
    """
    n = len(df)
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    for j in range(signal_idx, min(signal_idx + max_wait, n)):
        if lows[j] <= entry_price <= highs[j]:
            return j
    return None


def simulate_trade(df, entry_idx, bias, entry_price, stop_loss, take_profit1, max_lookahead=80):
    """Evaluasi WIN/LOSE dari titik entry — cek candle SETELAH entry_idx,
    mana yang kena duluan SL atau TP."""
    n = len(df)
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    for j in range(entry_idx + 1, min(entry_idx + max_lookahead, n)):
        h, l = highs[j], lows[j]
        if bias == "bullish":
            hit_sl = l <= stop_loss
            hit_tp = h >= take_profit1
        else:
            hit_sl = h >= stop_loss
            hit_tp = l <= take_profit1
        if hit_sl and hit_tp:
            return "LOSE", j  # asumsi konservatif: SL duluan kalau dua-duanya kena di candle sama
        elif hit_sl:
            return "LOSE", j
        elif hit_tp:
            return "WIN", j
    return None, None  # belum resolve dalam window


def run_backtest_structural(m30_df, m5_df, h4_df, btc_h1_df, start_idx=150, step=1):
    trades = []
    # OPTIMASI KRUSIAL: precompute SEKALI doang buat SELURUH dataset, bukan
    # re-hitung dari nol tiap kali try_entry_structural dipanggil (yang
    # tadinya bikin O(n²), backtest lambat parah).
    m30_series = precompute_indicator_series(m30_df)
    m5_series = precompute_indicator_series(m5_df)
    h4_series = precompute_indicator_series(h4_df)
    i = start_idx
    n = len(m30_df)
    while i < n - 5:
        m30_ts = m30_df["timestamp"].iloc[i]
        btc_bias = get_btc_bias_at(btc_h1_df, m30_ts, "M30") if btc_h1_df is not None else None
        entry = try_entry_structural(m30_df, m5_df, h4_df, i, m30_series, h4_df, h4_series, m5_series, btc_bias)
        if entry:
            # FIX: sinyal itu LIMIT ORDER, tunggu harga GENUINELY nyentuh
            # entry_price dulu sebelum posisi dianggap kebuka.
            fill_idx = wait_for_limit_fill(m30_df, entry["entry_idx"], entry["entry_price"], entry["bias"])
            if fill_idx is not None:
                result, exit_idx = simulate_trade(m30_df, fill_idx, entry["bias"],
                                                    entry["entry_price"], entry["stop_loss"], entry["take_profit1"])
                if result is not None:
                    trades.append({
                        "symbol": None, "bias": entry["bias"], "result": result,
                        "entry_price": entry["entry_price"], "stop_loss": entry["stop_loss"],
                        "take_profit1": entry["take_profit1"],
                        "entry_time": int(m30_df["timestamp"].iloc[fill_idx]), "exit_time": int(m30_df["timestamp"].iloc[exit_idx]),
                    })
                    i = exit_idx + 1
                    continue
        i += step
    return trades


def run_backtest_15m(m15_df, h4_df, btc_h1_df, start_idx=150, step=1):
    trades = []
    m15_series = precompute_indicator_series(m15_df)
    h4_series = precompute_indicator_series(h4_df)
    i = start_idx
    n = len(m15_df)
    while i < n - 5:
        m15_ts = m15_df["timestamp"].iloc[i]
        btc_bias = get_btc_bias_at(btc_h1_df, m15_ts, "M15") if btc_h1_df is not None else None
        entry = try_entry_15m(m15_df, h4_df, i, m15_series, h4_series, btc_bias)
        if entry:
            fill_idx = wait_for_limit_fill(m15_df, entry["entry_idx"], entry["entry_price"], entry["bias"])
            if fill_idx is not None:
                result, exit_idx = simulate_trade(m15_df, fill_idx, entry["bias"],
                                                    entry["entry_price"], entry["stop_loss"], entry["take_profit1"])
                if result is not None:
                    trades.append({
                        "symbol": None, "bias": entry["bias"], "result": result,
                        "entry_price": entry["entry_price"], "stop_loss": entry["stop_loss"],
                        "take_profit1": entry["take_profit1"],
                        "entry_time": int(m15_df["timestamp"].iloc[fill_idx]), "exit_time": int(m15_df["timestamp"].iloc[exit_idx]),
                    })
                    i = exit_idx + 1
                    continue
        i += step
    return trades


def run_backtest_counter(h1_df, btc_h1_df, start_idx=150, step=1):
    trades = []
    series = precompute_counter_series(h1_df)  # SuperTrend/RSI/MACD/Bollinger — SEKALI doang
    exhaustion_series = precompute_indicator_series(h1_df)  # RSI/StochRSI/MACD/CCI/MFI/ROC/Vol — buat filter exhaustion (sinkron smc.ts)
    i = start_idx
    n = len(h1_df)
    while i < n - 5:
        h1_ts = h1_df["timestamp"].iloc[i]
        btc_bias = get_btc_bias_at(btc_h1_df, h1_ts, "H1") if btc_h1_df is not None else None
        entry = try_entry_counter_scalping(h1_df, i, series, exhaustion_series, btc_h1_bias=btc_bias)
        if entry:
            fill_idx = wait_for_limit_fill(h1_df, entry["entry_idx"], entry["entry_price"], entry["bias"])
            if fill_idx is not None:
                result, exit_idx = simulate_trade(h1_df, fill_idx, entry["bias"],
                                                    entry["entry_price"], entry["stop_loss"], entry["take_profit1"])
                if result is not None:
                    trades.append({
                        "symbol": None, "bias": entry["bias"], "result": result,
                        "entry_price": entry["entry_price"], "stop_loss": entry["stop_loss"],
                        "take_profit1": entry["take_profit1"],
                        "entry_time": int(h1_df["timestamp"].iloc[fill_idx]), "exit_time": int(h1_df["timestamp"].iloc[exit_idx]),
                    })
                    i = exit_idx + 1
                    continue
        i += step
    return trades


def build_summary(trades):
    n = len(trades)
    if n == 0:
        return {"totalTrades": 0, "wins": 0, "losses": 0, "winRate": 0.0, "trades": []}
    wins = len([t for t in trades if t["result"] == "WIN"])
    return {
        "totalTrades": n, "wins": wins, "losses": n - wins,
        "winRate": round(wins / n * 100, 2),
        "trades": trades,
    }


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)
    menu = payload.get("menu", "both")
    candles = payload["candles"]

    m30_df = klines_to_df(candles["m30"]) if "m30" in candles else None
    m5_df = klines_to_df(candles["m5"]) if "m5" in candles else None
    m15_df = klines_to_df(candles["m15"]) if "m15" in candles else None
    h4_df = klines_to_df(candles["h4"]) if "h4" in candles else None
    h1_df = klines_to_df(candles["h1"]) if "h1" in candles else None
    btc_h1_df = klines_to_df(candles["btc_h1"]) if "btc_h1" in candles else None

    result = {}
    t0 = time.time()

    if menu in ("structural", "both") and m30_df is not None and m5_df is not None and h4_df is not None:
        trades = run_backtest_structural(m30_df, m5_df, h4_df, btc_h1_df)
        result["structuralResult"] = build_summary(trades)
    else:
        result["structuralResult"] = None

    if menu in ("scalping15m", "both") and m15_df is not None and h4_df is not None:
        trades = run_backtest_15m(m15_df, h4_df, btc_h1_df)
        result["scalping15mResult"] = build_summary(trades)
    else:
        result["scalping15mResult"] = None

    if menu in ("counter_scalping", "both") and h1_df is not None:
        trades = run_backtest_counter(h1_df, btc_h1_df)
        result["counterScalpingResult"] = build_summary(trades)
    else:
        result["counterScalpingResult"] = None

    result["elapsedSeconds"] = round(time.time() - t0, 2)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
