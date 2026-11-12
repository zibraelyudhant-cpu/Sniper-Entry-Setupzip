import { Router, type IRouter } from "express";
import healthRouter from "./health";
import breakoutRouter from "./breakout";
import breakoutEntryRouter from "./breakout-entry";
import patternsRouter from "./patterns";
import technicalAnalysisProRouter from "./technical-analysis-pro";
import journalFollowupRouter from "./journal-followup";
import moneyMagnetScalpingRouter from "./money-magnet-scalping";
import setupFinderRouter from "./setup-finder";
import tp3Router from "./tp3";
import journalSyncRouter from "./journal-sync";
import debugRouter from "./debug";

const router: IRouter = Router();

router.use(healthRouter);
router.use(breakoutRouter);
router.use(breakoutEntryRouter);
router.use(patternsRouter);
router.use(technicalAnalysisProRouter);
router.use(journalFollowupRouter);
router.use(moneyMagnetScalpingRouter);
router.use(setupFinderRouter);
router.use(tp3Router);
router.use(journalSyncRouter);
router.use(debugRouter);

export default router;