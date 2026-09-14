import Router from "@koa/router";
import { getHealth } from "../controllers/health.controller";

const router = new Router();

router.get("/health", getHealth);

export default router;
