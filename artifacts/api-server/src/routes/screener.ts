const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

// ─── Symbol cache ─────────────────────────────────────────────────────────────

let cryptoSymbolCache: Set<string> | null = null;
let cryptoSymbolCacheAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function getCryptoPerpetualSymbols(): Promise<Set<string>> {
  const now = Date.now();
  if (cryptoSymbolCache && now - cryptoSymbolCacheAt < CACHE_TTL_MS) {
    return cryptoSymbolCache;
  }
  const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/exchangeInfo`);
  if (!res.ok) throw new Error("Failed to fetch exchangeInfo");
  const data: {
    symbols: Array<{
      symbol: string;
      contractType: string;
      status: string;
      quoteAsset: string;
      underlyingType: string;
    }>;
  } = await res.json();
  const symbols = new Set(
    data.symbols
      .filter(
        (s) =>
          s.contractType === "PERPETUAL" &&
          s.quoteAsset === "USDT" &&
          s.status === "TRADING" &&
          s.underlyingType === "COIN"
      )
      .map((s) => s.symbol)
  );
  cryptoSymbolCache = symbols;
  cryptoSymbolCacheAt = now;
  return symbols;
}

// Cache universe 10 menit supaya tidak spam Binance
let universeCache: { symbols: string[]; ts: number } | null = null;
const UNIVERSE_CACHE_MS = 10 * 60 * 1000;

// FIX (request user, tombol sortir "Volume/Perubahan Harga/Funding Rate" di
// semua menu scan — samain persis kolom yang ada di Binance Futures market
// list): simpan metadata priceChangePercent+quoteVolume DARI DATA YANG UDAH
// DI-FETCH getUniverse() sendiri (ticker/24hr), TANPA nambah API call baru
// sama sekali buat 2 dari 3 kriteria sortir.
export interface MarketMetadataEntry {
  priceChangePercent: number; // dari ticker/24hr, field "priceChangePercent"
  quoteVolume: number; // dari ticker/24hr, field "quoteVolume" (USDT)
  fundingRate: number | null; // dari premiumIndex, field "lastFundingRate" — null kalau gagal fetch/gak ketemu
}

// FIX BUG KRUSIAL (ketemu user, "sortir gak ngaruh, urutan tetep sama"):
// versi SEBELUMNYA getMarketMetadata() BERGANTUNG ke side-effect getUniverse()
// buat ngisi tickerMetadataCache — TAPI getUniverse() punya jalur "return cepat"
// (baris if universeCache masih valid) yang TIDAK PERNAH nyentuh blok yang
// nge-set tickerMetadataCache. Kalau ada RACE/timing dimana tickerMetadataCache
// null/stale TAPI universeCache masih valid, metadata GAK PERNAH KE-ISI —
// semua koin dapet fallback 0/null, jadi SORT-nya SECARA VISUAL "gak ngaruh"
// (angka yang dibandingin sama semua). FIX: getMarketMetadata() PUNYA CACHE
// SENDIRI, FETCH SENDIRI kalau perlu — TIDAK bergantung state global punya
// fungsi lain sama sekali.
let marketMetadataCache: { data: Map<string, { priceChangePercent: number; quoteVolume: number }>; ts: number } | null = null;
const MARKET_METADATA_CACHE_MS = 3 * 60 * 1000; // lebih pendek dari universe cache — data harga/volume lebih cepat berubah

let fundingRateCache: { data: Map<string, number>; ts: number } | null = null;
const FUNDING_RATE_CACHE_MS = 5 * 60 * 1000; // funding rate update tiap 8 jam di Binance, 5 menit cache cukup aman

export async function getUniverse(limit = 150): Promise<string[]> {
  if (universeCache && Date.now() - universeCache.ts < UNIVERSE_CACHE_MS) {
    return universeCache.symbols.slice(0, limit);
  }

  // Retry max 2x dengan timeout 8 detik
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const [cryptoSymbols, tickersRes] = await Promise.all([
        getCryptoPerpetualSymbols(),
        fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`, { signal: controller.signal }),
      ]);
      clearTimeout(timeout);
      if (!tickersRes.ok) {
        if (attempt < 1) { await new Promise(r => setTimeout(r, 1000)); continue; }
        throw new Error(`Failed to fetch tickers (${tickersRes.status})`);
      }
      const allTickers: Array<{ symbol: string; quoteVolume: string; priceChangePercent: string }> = await tickersRes.json();
      const filtered = allTickers.filter(t => cryptoSymbols.has(t.symbol));
      // REVISI (request user, Sniper Breakout & Scalping & Money Magnet
      // Scalping naik ke 500 koin): cache internal dinaikkan ke 550
      // (headroom di atas limit terbesar yang dipake caller manapun),
      // biar getUniverse(limit) tinggal SLICE dari cache yang sama --
      // gak perlu fetch/cache terpisah per limit.
      const symbols = filtered
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 550)
        .map(t => t.symbol);
      universeCache = { symbols, ts: Date.now() };

      // Simpan metadata SEKALIAN — data yang sama, gak fetch ulang. TETEP
      // di-set di sini buat kasus normal (efisien, gak nambah API call),
      // TAPI getMarketMetadata() DIBAWAH GAK BERGANTUNG SEMATA-MATA ke ini.
      const metaMap = new Map<string, { priceChangePercent: number; quoteVolume: number }>();
      for (const t of filtered) {
        metaMap.set(t.symbol, { priceChangePercent: parseFloat(t.priceChangePercent), quoteVolume: parseFloat(t.quoteVolume) });
      }
      marketMetadataCache = { data: metaMap, ts: Date.now() };

      return symbols.slice(0, limit);
    } catch (err) {
      if (attempt < 1) { await new Promise(r => setTimeout(r, 1000)); continue; }
      // Kalau cache lama masih ada, pakai itu daripada throw
      if (universeCache) return universeCache.symbols.slice(0, limit);
      throw err;
    }
  }
  throw new Error('Failed to fetch universe after retries');
}

/**
 * FIX: independen — cek cache SENDIRI, kalau stale/kosong FETCH SENDIRI
 * (ticker/24hr, TANPA filter cryptoSymbols — kita cuma butuh price/volume,
 * gak perlu filter kategori). TIDAK bergantung sama sekali ke getUniverse()
 * pernah dipanggil atau enggak sebelumnya.
 */
async function ensureMarketMetadataFresh(): Promise<void> {
  if (marketMetadataCache && Date.now() - marketMetadataCache.ts < MARKET_METADATA_CACHE_MS) return;
  try {
    const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`);
    if (!res.ok) return; // fail-safe — biarin cache lama (kalau ada) atau tetep kosong, JANGAN throw
    const allTickers: Array<{ symbol: string; quoteVolume: string; priceChangePercent: string }> = await res.json();
    const metaMap = new Map<string, { priceChangePercent: number; quoteVolume: number }>();
    for (const t of allTickers) {
      metaMap.set(t.symbol, { priceChangePercent: parseFloat(t.priceChangePercent), quoteVolume: parseFloat(t.quoteVolume) });
    }
    marketMetadataCache = { data: metaMap, ts: Date.now() };
  } catch {
    // fail-safe — sortir cuma gak akurat, gak boleh gagalin scan
  }
}

async function getFundingRateMap(): Promise<Map<string, number>> {
  if (fundingRateCache && Date.now() - fundingRateCache.ts < FUNDING_RATE_CACHE_MS) {
    return fundingRateCache.data;
  }
  try {
    const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/premiumIndex`); // TANPA symbol = semua koin sekaligus, 1x call doang
    if (!res.ok) return fundingRateCache?.data ?? new Map();
    const data: Array<{ symbol: string; lastFundingRate: string }> = await res.json();
    const map = new Map<string, number>();
    for (const d of data) map.set(d.symbol, parseFloat(d.lastFundingRate));
    fundingRateCache = { data: map, ts: Date.now() };
    return map;
  } catch {
    return fundingRateCache?.data ?? new Map(); // fail-safe — sortir funding rate cuma gak akurat, gak boleh gagalin scan
  }
}

/**
 * Ambil metadata (perubahan harga, volume, funding rate) buat SEKUMPULAN
 * simbol sekaligus — dipanggil abis hasil scan siap, di tiap route scan.
 */
export async function getMarketMetadata(symbols: string[]): Promise<Map<string, MarketMetadataEntry>> {
  await ensureMarketMetadataFresh();
  const fundingMap = await getFundingRateMap();
  const result = new Map<string, MarketMetadataEntry>();
  for (const symbol of symbols) {
    const ticker = marketMetadataCache?.data.get(symbol);
    result.set(symbol, {
      priceChangePercent: ticker?.priceChangePercent ?? 0,
      quoteVolume: ticker?.quoteVolume ?? 0,
      fundingRate: fundingMap.get(symbol) ?? null,
    });
  }
  return result;
}