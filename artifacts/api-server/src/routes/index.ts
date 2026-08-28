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
import economicCalendarRouter from "./economic-calendar";
import alertsRouter from "./alerts";
import preferencesRouter from "./preferences";
import accessRouter, { requireApprovedAccess } from "./access";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);
router.use(requireApprovedAccess);
router.use(watchlistRouter);
router.use(sectorsRouter);
router.use(bottlenecksRouter);
router.use(stocksRouter);
router.use(deepAnalysisRouter);
router.use(dailyAnalysisRouter);
router.use(marketReportRouter);
router.use(socialRouter);
router.use(bondsRouter);
router.use(economicCalendarRouter);
router.use(alertsRouter);
router.use(preferencesRouter);

export default router;
