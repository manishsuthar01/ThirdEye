import { Router } from "express";
import { verifyGitHubWebHook } from "../middleware/verify-github"
import webhooksRouter from "./webhooks/webhooks.router";

const router: Router = Router();

router
    .get("/", (req, res) => {
        res.send("Hello World!");
    })
    .use("/webhooks", webhooksRouter)
    .use((req, res) => {
        console.log(req.method, req.url, req.body);
        res.status(404).json({ error: "Not Found" });
    });

export default router
