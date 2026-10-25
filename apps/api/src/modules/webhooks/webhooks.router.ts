import { Router } from "express";
import { verifyGitHubWebHook } from "../../middleware/verify-github";
// import { verifyVercelWebHook } from "../../middleware/verify-vercel";
import { createWebhookHandler } from "./webhooks.controller";
import { githubAdapter } from "./adapters/github.adapter";
import { vercelAdapter } from "./adapters/vercel.adapter";

const webhookRouter: Router = Router();

webhookRouter.post(
    "/github",
    verifyGitHubWebHook,
    createWebhookHandler(githubAdapter)
);

// webhookRouter.post(
//     "/vercel",
//     verifyVercelWebHook,
//     createWebhookHandler(vercelAdapter)
// );

export default webhookRouter;
