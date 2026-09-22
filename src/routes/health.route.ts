import Router from "@koa/router";
import { getHealth, getReadiness } from "@controllers/health.controller";

const router = new Router();

router.get("/health", getHealth);
router.get("/ready", getReadiness);

export default router;
