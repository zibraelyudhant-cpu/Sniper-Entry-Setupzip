import { Router } from "express";
import { analyzeSniperEntry } from "../lib/smc";

const router = Router();

// GET /api/smc-analysis?symbol=BTCUSDT
router.get("/smc-analysis", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  if (!symbol) {
    res.status(400).json({ error: "symbol required" });
    return;
  }

  // Ensure USDT suffix
  const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  const result = await analyzeSniperEntry(normalizedSymbol);
  res.json(result);
});

export default router;
