import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stocksRouter from "./stocks";
import deepAnalysisRouter from "./deep-analysis";
import dailyAnalysisRouter from "./daily-analysis";
import marketReportRouter from "./market-report";
import watchlistRouter from "./watchlist";
import sectorsRouter from "./sectors";

const router: IRouter = Router();

router.use(healthRouter);
router.use(watchlistRouter);
router.use(sectorsRouter);
router.use(stocksRouter);
router.use(deepAnalysisRouter);
router.use(dailyAnalysisRouter);
router.use(marketReportRouter);

export default router;
