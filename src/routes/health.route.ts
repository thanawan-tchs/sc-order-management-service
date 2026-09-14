import Router from "@koa/router";
import { getHealth, getMetrics, getReadiness } from "../controllers/health.controller";

const router = new Router();

router.get("/health", getHealth);
router.get("/ready", getReadiness);
router.get("/metrics", getMetrics);

export default router;
