import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenerRouter from "./screener";
import smcAnalysisRouter from "./smc-analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(screenerRouter);
router.use(smcAnalysisRouter);

export default router;
