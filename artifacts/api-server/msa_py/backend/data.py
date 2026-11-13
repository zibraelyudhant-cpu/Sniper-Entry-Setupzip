"""Data layer: baca file {SIMBOL}_{tf}.npz (key t,o,h,l,c,v; t = open time ms UTC)."""
import glob
import os
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np

TF_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000,
}

FILE_RE = re.compile(r"^(?P<sym>.+)_(?P<tf>\d+[mhd])\.npz$", re.IGNORECASE)


@dataclass
class Bars:
    t: np.ndarray
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    v: np.ndarray

    def __len__(self):
        return len(self.t)

    def slice(self, a, b, copy=False):
        f = (lambda x: x[a:b].copy()) if copy else (lambda x: x[a:b])
        return Bars(f(self.t), f(self.o), f(self.h), f(self.l), f(self.c), f(self.v))

    def to_list(self):
        return [
            {"time": int(t) // 1000, "open": float(o), "high": float(h),
             "low": float(l), "close": float(c), "volume": float(v)}
            for t, o, h, l, c, v in zip(self.t, self.o, self.h, self.l, self.c, self.v)
        ]


def load_npz(path):
    with np.load(path, allow_pickle=False) as z:
        t = np.asarray(z["t"], dtype=np.int64)
        cols = [np.asarray(z[k], dtype=np.float64) for k in ("o", "h", "l", "c", "v")]
    if len(t) and t[0] < 100_000_000_000:  # detik -> ms
        t = t * 1000
    ok = ~(np.isnan(cols[0]) | np.isnan(cols[1]) | np.isnan(cols[2]) | np.isnan(cols[3]))
    t, cols = t[ok], [x[ok] for x in cols]
    if len(t) > 1 and not np.all(np.diff(t) > 0):  # urutkan + buang duplikat
        t, idx = np.unique(t, return_index=True)
        cols = [x[idx] for x in cols]
    return Bars(t, *cols)


def aggregate(b, ms):
    """Rakit candle TF besar dari candle kecil (open pertama, high max, low min, close terakhir, volume total)."""
    if not len(b):
        return b
    g = b.t // ms * ms
    keys, idx = np.unique(g, return_index=True)
    end = np.r_[idx[1:], len(b)] - 1
    return Bars(keys.astype(np.int64), b.o[idx], np.maximum.reduceat(b.h, idx), np.minimum.reduceat(b.l, idx),
                b.c[end], np.add.reduceat(b.v, idx))


class DataStore:
    def __init__(self, data_dir, cache_size=32):
        self.data_dir = data_dir
        self.cache_size = cache_size
        self._cache = OrderedDict()
        self._lock = threading.Lock()
        self.catalog = {}
        for path in glob.glob(os.path.join(data_dir, "*.npz")):
            m = FILE_RE.match(os.path.basename(path))
            if m and m["tf"].lower() in TF_MS:
                self.catalog.setdefault(m["sym"].upper(), {})[m["tf"].lower()] = path

    def symbols(self):
        return sorted(self.catalog)

    def file_timeframes(self, symbol):
        return sorted(self.catalog[symbol], key=TF_MS.get)

    def base_tf(self, symbol):
        return self.file_timeframes(symbol)[0]

    def timeframes(self, symbol):
        """Semua TF yang bisa dipakai: yang ada filenya + yang bisa dirakit dari base TF (sampai 1d)."""
        b = TF_MS[self.base_tf(symbol)]
        return [tf for tf, ms in sorted(TF_MS.items(), key=lambda x: x[1])
                if tf in self.catalog[symbol] or (b <= ms <= TF_MS["1d"] and ms % b == 0)]

    def get(self, symbol, tf):
        key = (symbol, tf)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        if tf in self.catalog[symbol]:
            bars = load_npz(self.catalog[symbol][tf])
        elif tf in self.timeframes(symbol):   # TF tanpa file (mis. 30m, 2h, 12h): dirakit dari base TF
            bars = aggregate(self.get(symbol, self.base_tf(symbol)), TF_MS[tf])
        else:
            raise ValueError(f"TF {tf} tidak tersedia untuk {symbol}")
        with self._lock:
            self._cache[key] = bars
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return bars

    def info(self, symbol):
        b = self.get(symbol, self.base_tf(symbol))
        return {"symbol": symbol, "timeframes": self.timeframes(symbol), "files": self.file_timeframes(symbol),
                "base_tf": self.base_tf(symbol),
                "start": int(b.t[0]) if len(b) else None,
                "end": int(b.t[-1]) if len(b) else None}


class DataView:
    """Satu-satunya pintu akses data selama replay/backtest. Hanya mengembalikan
    bar yang sudah close per waktu `now()`, plus candle forming yang dirakit dari base TF."""

    def __init__(self, store, symbol, now_fn):
        self.store, self.symbol, self._now = store, symbol, now_fn
        self.base_tf = store.base_tf(symbol)

    def _n_closed(self, tf):
        a = self.store.get(self.symbol, tf)
        return a, int(np.searchsorted(a.t, self._now() - TF_MS[tf], side="right"))  # t + durasi <= now

    def closed(self, tf, n=500):
        a, k = self._n_closed(tf)
        s = 0 if n is None else max(0, k - n)
        return a.slice(s, k, copy=True)

    def closed_before(self, tf, before_ms, n=1500):
        """Bar closed dengan open time < before_ms (untuk memuat histori lama)."""
        a, k = self._n_closed(tf)
        k = min(k, int(np.searchsorted(a.t, before_ms)))
        return a.slice(max(0, k - n), k, copy=True)

    def closed_after(self, tf, after_ms, limit=5000):
        """Bar closed dengan open time > after_ms (untuk update chart incremental)."""
        a, k = self._n_closed(tf)
        s = int(np.searchsorted(a.t, after_ms, side="right")) if after_ms is not None else 0
        s = max(s, k - limit)
        return a.slice(s, k, copy=True)

    def forming(self, tf):
        now, dur = self._now(), TF_MS[tf]
        cur_open = (now // dur) * dur  # TF Binance align ke epoch UTC (D1 = 00:00 UTC)
        if cur_open == now:
            return None
        b = self.store.get(self.symbol, self.base_tf)
        i0 = int(np.searchsorted(b.t, cur_open))
        i1 = int(np.searchsorted(b.t, now))  # base bar dengan open < now = sudah close
        if i0 >= i1:
            return None
        return {"time": cur_open // 1000, "open": float(b.o[i0]),
                "high": float(b.h[i0:i1].max()), "low": float(b.l[i0:i1].min()),
                "close": float(b.c[i1 - 1]), "volume": float(b.v[i0:i1].sum())}
