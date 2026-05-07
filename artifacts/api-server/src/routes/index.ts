import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stocksRouter from "./stocks";
import deepAnalysisRouter from "./deep-analysis";
import watchlistRouter from "./watchlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(watchlistRouter);
router.use(stocksRouter);
router.use(deepAnalysisRouter);

export default router;
