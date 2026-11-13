# Potongan backend/screener.py: klien Binance Futures (dipakai sebagai whales.c / screener.c).
import json
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from . import indicators as ind

BASE_URL = os.environ.get("BINANCE_FAPI_URL", "https://fapi.binance.com")
INTERVAL_MS = {"1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000,
               "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000,
               "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000}
BARS = 499          # candle per koin untuk scan pertama (cukup untuk EMA 200). <500 = weight 2 di Binance
WORKERS = 8


class BinanceError(RuntimeError):
    pass


class Client:
    def __init__(self, base=BASE_URL):
        self.base = base.rstrip("/")
        self.weight = 0
        self.lock = threading.Lock()

    def get(self, path, **params):
        url = f"{self.base}{path}" + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "futures-replay-screener"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    w = r.headers.get("X-MBX-USED-WEIGHT-1M")
                    if w and w.isdigit():
                        with self.lock:
                            self.weight = int(w)
                        if int(w) > 2000:            # batas Binance 2400/menit: tunggu menit berikutnya
                            time.sleep(61 - time.gmtime().tm_sec)
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                if e.code in (418, 429):              # rate limit: tunggu sesuai Retry-After
                    time.sleep(int(e.headers.get("Retry-After", "10")))
                    continue
                if e.code in (451, 403):
                    raise BinanceError(f"Binance menolak akses dari jaringan ini (HTTP {e.code}).") from e
                raise BinanceError(f"HTTP {e.code} dari Binance untuk {path}") from e
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == 3:
                    raise BinanceError(f"Tidak bisa terhubung ke {self.base} ({getattr(e, 'reason', e)}).") from e
                time.sleep(1 + attempt)
        raise BinanceError(f"Gagal mengambil {path}")


