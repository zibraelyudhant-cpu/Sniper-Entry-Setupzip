import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenerRouter from "./screener";
import smcAnalysisRouter from "./smc-analysis";
import breakoutRouter from "./breakout";
import breakoutEntryRouter from "./breakout-entry";
import patternsRouter from "./patterns";
import backtestRouter from "./backtest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(screenerRouter);
router.use(smcAnalysisRouter);
router.use(breakoutRouter);
router.use(breakoutEntryRouter);
router.use(patternsRouter);
router.use(backtestRouter);

export default router;