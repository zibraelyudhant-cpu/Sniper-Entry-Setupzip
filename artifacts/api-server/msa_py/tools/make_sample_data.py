"""Bikin data sintetis (format sama dengan data asli) untuk uji coba tanpa data Binance."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.data import TF_MS  # noqa: E402


def make(out_dir, symbol="SAMPLEUSDT", days=120, start_ms=1_735_689_600_000, seed=0):
    rng = np.random.default_rng(seed)
    n = days * 288
    t = start_ms + np.arange(n, dtype=np.int64) * TF_MS["5m"]
    ret = rng.normal(0, 0.002, n) + 0.0002 * np.sin(np.arange(n) / 1500)
    close = 100 * np.exp(np.cumsum(ret))
    open_ = np.r_[100.0, close[:-1]]
    wick = np.abs(rng.normal(0, 0.0015, (2, n))) * close
    high = np.maximum(open_, close) + wick[0]
    low = np.minimum(open_, close) - wick[1]
    vol = rng.uniform(1e3, 1e4, n)
    os.makedirs(out_dir, exist_ok=True)
    for tf in ("5m", "15m", "1h", "4h", "1d"):
        k = TF_MS[tf] // TF_MS["5m"]
        m = n // k * k
        g = lambda x: x[:m].reshape(-1, k)  # noqa: E731
        np.savez(os.path.join(out_dir, f"{symbol}_{tf}.npz"), t=t[:m:k], o=g(open_)[:, 0],
                 h=g(high).max(1), l=g(low).min(1), c=g(close)[:, -1], v=g(vol).sum(1))
    print("data sampel ditulis ke", out_dir)


if __name__ == "__main__":
    make(sys.argv[1] if len(sys.argv) > 1 else "sample_data")
