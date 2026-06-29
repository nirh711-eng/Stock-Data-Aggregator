import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stocksRouter from "./stocks";
import deepAnalysisRouter from "./deep-analysis";
import dailyAnalysisRouter from "./daily-analysis";
import marketReportRouter from "./market-report";
import watchlistRouter from "./watchlist";
import sectorsRouter from "./sectors";
import bottlenecksRouter from "./bottlenecks";
import socialRouter from "./social";
import bondsRouter from "./bonds";

const router: IRouter = Router();

router.use(healthRouter);
router.use(watchlistRouter);
router.use(sectorsRouter);
router.use(bottlenecksRouter);
router.use(stocksRouter);
router.use(deepAnalysisRouter);
router.use(dailyAnalysisRouter);
router.use(marketReportRouter);
router.use(socialRouter);
router.use(bondsRouter);

export default router;
