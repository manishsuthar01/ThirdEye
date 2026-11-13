import { Request, Response } from "express";
import { WebhookAdapter } from "./adapters/adapater.interface";
import { queueManager } from "../../lib/queue";

export const createWebhookHandler = (adapter: WebhookAdapter) => {
    return async (req: Request, res: Response) => {
        try {
            console.log(`\n---------------- [INCOMING WEBHOOK] ----------------`);
            console.log(`Method:       ${req.method}`);
            console.log(`Content-Type: ${req.headers["content-type"]}`);
            console.log(`Event Header: ${req.headers["x-github-event"] || "None"}`);
            console.log(`Delivery ID:  ${req.headers["x-github-delivery"] || "None"}`);

            const normalized = adapter.normalize(req);
            if (!normalized) {
                console.log(`Status:       IGNORED (returned 200 OK)`);
                console.log(`----------------------------------------------------\n`);
                return res.status(200).json({ received: true, ignored: true });
            }

            const routingKey = adapter.getRoutingKey(req);
            console.log(`Publishing to RabbitMQ: routingKey="${routingKey}"`);

            // publish the RabbitMQ using the routing key
            const published = await queueManager.publishEvent(routingKey, normalized);

            if (!published) {
                console.error(`[WebhookController] Failed to enqueue event to RabbitMQ`);
                return res.status(500).json({ error: "Failed to enqueue webhook event" });
            }

            console.log(`Status:       QUEUED (eventId: ${normalized.triggerId})`);
            console.log(`----------------------------------------------------\n`);

            return res.status(202).json({
                received: true,
                status: "queued",
                eventId: normalized.triggerId,
            });
        } catch (error) {
            console.error("[WebhookController] Webhook Error:", error);
            return res.status(500).json({ error: "Internal Server Error" });
        }
    };
};
