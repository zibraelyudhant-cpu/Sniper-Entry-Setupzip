import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenerRouter from "./screener";
import breakoutRouter from "./breakout";
import breakoutEntryRouter from "./breakout-entry";
import patternsRouter from "./patterns";
import backtestRouter from "./backtest";
import economicCalendarRouter from "./economic-calendar";
import multiTfScanRouter from "./multi-tf-scan";
import allMenusAnalysisRouter from "./all-menus-analysis";
import journalFollowupRouter from "./journal-followup";

const router: IRouter = Router();

router.use(healthRouter);
router.use(screenerRouter);
router.use(breakoutRouter);
router.use(breakoutEntryRouter);
router.use(patternsRouter);
router.use(backtestRouter);
router.use(economicCalendarRouter);
router.use(multiTfScanRouter);
router.use(allMenusAnalysisRouter);
router.use(journalFollowupRouter);

export default router;