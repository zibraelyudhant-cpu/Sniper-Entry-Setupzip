// Harga kecil (< 0,01) ditampilkan dengan 4 angka signifikan, mis. 0.00003051 (sebelumnya dipotong 6 desimal -> 0.000031).
// Harga >= 0,01 tidak berubah dari format lama (6 desimal untuk menu yang memakai toFixed(6)).
export function smallPriceDecimals(v: number, normal = 6): number {
  if (!(v > 0) || v >= 0.01) return normal;
  return Math.min(12, Math.ceil(-Math.log10(v)) + 3);
}
export function fixedPrice(v: number | undefined | null, normal = 6): string | undefined {
  if (v === undefined || v === null || !isFinite(v)) return undefined;
  return v.toFixed(smallPriceDecimals(v, normal));
}
