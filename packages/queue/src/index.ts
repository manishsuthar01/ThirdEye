/**
 * @thirdeye/queue
 *
 * RabbitMQ (AMQP 0-9-1) connection management via amqplib,
 * topic exchange topology, queue bindings, and typed publisher/subscriber helpers.
 *
 * Shared between the API (producer) and worker (consumer).
 */
import amqp, { ChannelModel, Channel, ConsumeMessage } from "amqplib";

export class QueueManager {
    private connection!: ChannelModel;
    private channel!: Channel;
    constructor(
        private url: string = process.env.RABBITMQ_URL || "amqp://thirdeye:thirdeye@localhost:5672",
        private exchange: string = "thirdeye.events",
        private dlxExchange: string = "thirdeye.dlx"
    ) { }

    private readonly SYSTEM_QUEUES = [
        { name: "deployments_queue", routingKey: "deployment.#" },
        { name: "errors_queue", routingKey: "error.#" },
        { name: "incidents_queue", routingKey: "incident.#" },
    ];

    async start(): Promise<void> {
        this.connection = await amqp.connect(this.url);
        this.channel = await this.connection.createChannel();

        this.channel.on("return", (msg) => {
            console.error("⚠️ [QueueManager] Message was unroutable and returned to publisher:", {
                exchange: msg.fields.exchange,
                routingKey: msg.fields.routingKey,
                content: msg.content.toString(),
            });
        });

        await this.channel.assertExchange(this.exchange, "topic", { durable: true });
        await this.channel.assertExchange(this.dlxExchange, "direct", { durable: true });

        const { queue: dlq } = await this.channel.assertQueue("thirdeye.failed_events_dlq", { durable: true })
        await this.channel.bindQueue(dlq, this.dlxExchange, "failed");


        // create system queues
        for (const queue of this.SYSTEM_QUEUES) {
            const { queue: q } = await this.channel.assertQueue(queue.name, {
                durable: true,
                arguments: {
                    "x-dead-letter-exchange": "thirdeye.dlx",
                    "x-dead-letter-routing-key": "failed",
                }
            });
            await this.channel.bindQueue(q, this.exchange, queue.routingKey);
        }

        console.log("✅ [QueueManager] Connected to RabbitMQ and initialized exchanges.");
    }

    async publishEvent<T>(routingKey: string, payload: T): Promise<boolean> {
        if (!this.channel) {
            throw new Error("[QueueManager] Cannot publish: Call start() first.");
        }

        try {
            const buffer = Buffer.from(JSON.stringify(payload));
            const returnedMsg = this.channel.publish(this.exchange, routingKey, buffer, {
                persistent: true,
                contentType: "application/json",
                timestamp: Date.now(),
                mandatory: true
            })


            return returnedMsg;
        } catch (error) {
            console.error("[QueueManager]: Failed to publish event to exchange.", {
                error,
                routingKey,
                payload
            })
            return false
        }
    }

    // an consumer with dead letter routing
    async createConsumer<T>(queueName: string, routingKey: string, consumerHandler: (data: T, rawMsg: ConsumeMessage) => Promise<void>, prefetchCount: number = 10): Promise<void> {
        if (!this.channel) {
            throw new Error("[QueueManager] Cannot consume: Call start() first.");
        }
        await this.channel.prefetch(prefetchCount);

        const { queue: q } = await this.channel.assertQueue(queueName, {
            durable: true,
            arguments: {
                "x-dead-letter-exchange": "thirdeye.dlx",
                "x-dead-letter-routing-key": "failed",
            }
        })
        await this.channel.bindQueue(q, this.exchange, routingKey);
        console.log("✅ [QueueManager] Created consumer for queue '%s' with routing key '%s'", queueName, routingKey);

        // setup the consumer
        this.channel.consume(q, async (msg) => {
            if (!msg) return

            try {

                const parseData = JSON.parse(msg.content.toString()) as T;

                // run the worker business logic now
                await consumerHandler(parseData, msg);

                // if consumer hander return wihtout error or exception then ack
                this.channel.ack(msg)
            } catch (error) {

                // if consumer fails
                // requeue for retry (only if retry is allowed)
                this.channel.reject(msg, false)

                console.error("[QueueManager] Failed to process message, routing to DLQ:", error);
            }

        })
        console.log(`📡 [QueueManager] Consumer listening on queue "${queueName}" for "${routingKey}"`);

    }

    async close(): Promise<void> {
        if (!this.channel && !this.connection) return;

        await this.channel?.close();
        await this.connection?.close();
        console.log("✅ [QueueManager] Closed RabbitMQ connection.");
    }
}

export const createQueueManager = () => {
    return new QueueManager()
}





// // 1. Define the TypeScript type for our dummy deployment event
// interface DeploymentEvent {
//     deploymentId: string;
//     project: string;
//     environment: "production" | "preview";
//     commitSha: string;
//     author: string;
//     status: "BUILDING" | "READY" | "ERROR";
//     timestamp: string;
// }

// async function main() {
//     const queueManager = createQueueManager();
//     // initialize all the required exchanges and queues
//     await queueManager.start();

//     // 2. Register the consumer on "deployments_queue"
//     await queueManager.createConsumer<DeploymentEvent>(
//         "deployments_queue",
//         "deployment.#",
//         async (data) => {
//             console.log("\n🎉 [Worker Received Deployment Event]:", {
//                 id: data.deploymentId,
//                 project: data.project,
//                 env: data.environment,
//                 commit: data.commitSha,
//                 status: data.status,
//             });
//         }
//     );

//     // 3. Create a realistic dummy deployment payload
//     const dummyDeployment: DeploymentEvent = {
//         deploymentId: "dep_live_98765",
//         project: "thirdeye-web",
//         environment: "production",
//         commitSha: "a1b2c3d4",
//         author: "manish",
//         status: "READY",
//         timestamp: new Date().toISOString(),
//     };

//     // 4. Publish the event with routing key "deployment.vercel.succeeded"
//     console.log("🚀 [API Publishing Deployment Event] ->", dummyDeployment.deploymentId);
//     for (let i = 0; i < 500; i++) {
//         await queueManager.publishEvent("deployment.vercel.succeeded", dummyDeployment);
//     }
// }

// main().catch(console.error);

