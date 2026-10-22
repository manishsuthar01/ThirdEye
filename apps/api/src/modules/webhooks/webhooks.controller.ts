import { Request, Response } from "express";
import { WebhookAdapter } from "./adapters/adapater.interface";
import { queueManager } from "../../lib/queue";

export const createWebhookHandler = (adapter: WebhookAdapter) => {
    return async (req: Request, res: Response) => {
        try {
            const normalized = adapter.normalize(req);
            if (!normalized) {
                return res.status(200).json({ received: true, ignored: true });
            }
            const routingKey = adapter.getRoutingKey(req);

            // publish the RabbitMQ using the routing key
            const published = await queueManager.publishEvent(routingKey, normalized);

            if (!published) {
                return res.status(500).json({ error: "Failed to enqueue webhook event" });

            }
            return res.status(202).json({
                received: true,
                status: "queued",
                eventId: normalized.triggerId
            });
        }
        catch (error) {
            console.error("Webhook Error:", error);
            return res.status(500).json({ error: "Internal Server Error" })
        }
    }
}
