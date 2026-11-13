"""Penghubung (TAMBAHAN, bukan kode referensi) untuk menjalankan menu 📐 Market Structure apa adanya.

Program asli memakai FastAPI. File referensi `backend/app_endpoints_market_structure.py` dan
`backend/app_pendukung.py` adalah POTONGAN app.py (pakai @app.post / @app.get, HTTPException, JSONResponse,
store, whales.c). Supaya potongan itu jalan TANPA DIUBAH, file ini:
  - menyediakan objek `app` kecil dengan dekorator .get / .post (pengganti FastAPI, tanpa paket tambahan),
  - menyediakan HTTPException & JSONResponse dengan perilaku yang sama (galat -> {"detail": ...} + kode status),
  - membuat `store = DataStore(DATA_DIR)` (data.py asli) dan `whales.c = Client()` (binance_client.py asli),
  - menjalankan kedua potongan itu (exec) di namespace yang sama dengan app.py asli,
  - melayani HTTP di 127.0.0.1:MSA_PORT (dipanggil api-server Node lewat proxy).
Tambahan di luar referensi: GET /health dan POST /reload (memuat ulang katalog file .npz setelah gudang candle
diperbarui). Tidak ada logika analisa di file ini.
"""
import json
import math
import os
import re
import sys
import threading
import time
import types
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from backend.binance_client import BinanceError, Client  # noqa: E402
from backend.data import TF_MS, DataStore  # noqa: E402

DATA_DIR = os.environ.get("MSA_DATA_DIR") or os.path.join(HERE, "..", "msa_data")
PORT = int(os.environ.get("MSA_PORT", "8791"))
os.makedirs(DATA_DIR, exist_ok=True)


class HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class JSONResponse:
    def __init__(self, content, status_code=200):
        self.content = content
        self.status_code = status_code


class _App:
    def __init__(self):
        self.routes = []   # (method, regex, fn)

    def _add(self, method, path):
        names = re.findall(r"{(\w+)}", path)
        rx = re.compile("^" + re.sub(r"{\w+}", r"([^/]+)", path) + "$")

        def deco(fn):
            self.routes.append((method, rx, names, fn))
            return fn
        return deco

    def get(self, path):
        return self._add("GET", path)

    def post(self, path):
        return self._add("POST", path)


app = _App()
whales = types.SimpleNamespace(c=Client())

NS = {
    "__name__": "backend.app", "__package__": "backend", "__builtins__": __builtins__,
    "app": app, "HTTPException": HTTPException, "JSONResponse": JSONResponse,
    "BinanceError": BinanceError, "whales": whales, "store": DataStore(DATA_DIR), "TF_MS": TF_MS,
    "time": time, "uuid": uuid, "math": math, "np": np,
}
for fname in ("app_pendukung.py", "app_endpoints_market_structure.py"):
    path = os.path.join(HERE, "backend", fname)
    with open(path, encoding="utf-8") as f:
        exec(compile(f.read(), path, "exec"), NS)   # potongan app.py asli, tanpa perubahan

_reload_lock = threading.Lock()


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


class Handler(BaseHTTPRequestHandler):
    server_version = "msa/1"

    def log_message(self, fmt, *args):   # senyap (api-server Node yang mencatat)
        pass

    def _send(self, status, obj):
        body = json.dumps(obj, default=_json_default).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _dispatch(self, method):
        path = self.path.split("?", 1)[0]
        if method == "GET" and path == "/health":
            st = NS["store"]
            return self._send(200, {"ok": True, "symbols": len(st.symbols()), "data_dir": os.path.abspath(DATA_DIR)})
        if method == "POST" and path == "/reload":
            with _reload_lock:
                NS["store"] = DataStore(DATA_DIR)
            return self._send(200, {"ok": True, "symbols": len(NS["store"].symbols())})
        for m, rx, names, fn in app.routes:
            if m != method:
                continue
            mt = rx.match(path)
            if not mt:
                continue
            kwargs = dict(zip(names, mt.groups()))
            try:
                if method == "POST":
                    n = int(self.headers.get("Content-Length") or 0)
                    raw = self.rfile.read(n) if n else b"{}"
                    try:
                        req = json.loads(raw or b"{}")
                    except ValueError:
                        return self._send(422, {"detail": "body bukan JSON yang valid"})
                    if not isinstance(req, dict):
                        return self._send(422, {"detail": "body harus objek JSON"})
                    out = fn(req, **kwargs)
                else:
                    out = fn(**kwargs)
            except HTTPException as ex:
                return self._send(ex.status_code, {"detail": ex.detail})
            except Exception as ex:   # noqa: BLE001
                return self._send(500, {"detail": f"{type(ex).__name__}: {ex}"})
            if isinstance(out, JSONResponse):
                return self._send(out.status_code, out.content)
            return self._send(200, out)
        return self._send(404, {"detail": "Not Found"})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"msa python siap di 127.0.0.1:{PORT}, data {os.path.abspath(DATA_DIR)}", flush=True)
    srv.serve_forever()
