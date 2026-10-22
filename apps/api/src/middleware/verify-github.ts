/**
 * API Middleware
 *
 * Authentication, request validation, error handling,
 * and logging middleware.
 */

import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { config } from "../config";

export function verifyGitHubWebHook(req: Request, res: Response, next: NextFunction) {

    if (!config.github.webhookSecret) {
        return next();
    }

    const signature = req.headers["x-hub-signature-256"] as string
    const rawBody = JSON.stringify(req.body);
    const header = req.headers["x-github-event"] as string;

    if (!signature) {
        return res.status(401).json({ error: "Missing webhook signature" });
    }

    const hmac = crypto.createHmac("sha256", config.github.webhookSecret);

    const calculatedSignature = `sha256=${hmac.update(rawBody).digest("hex")}`;

    const sigBuf = Buffer.from(signature);
    const calcBuf = Buffer.from(calculatedSignature);
    if (sigBuf.length !== calcBuf.length) {
        return res.status(401).json({ error: "Invalid GitHub webhook signature" });
    }
    const isVerified = crypto.timingSafeEqual(sigBuf, calcBuf);
    if (!isVerified) {
        return res.status(401).json({ error: "Invalid GitHub webhook signature" });
    }

    next()

}