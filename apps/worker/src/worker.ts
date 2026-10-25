/**
 * ThirdEye Worker — Entry Point
 */

import { queueManager } from "./lib/queue"
import type { NormalizedWebhookEvent } from "./types/webHookEvent"
import processDeploymentEvent from "./processors/deployment.processor"


const CONCURRENCY: number = Number(process.env.WORKER_CONCURRENCY) || 5;



async function bootstrap() {
  await queueManager.start();

  await queueManager.createConsumer<NormalizedWebhookEvent>(
    "deployments_queue",
    "deployment.#",
    processDeploymentEvent,
    CONCURRENCY
  )


  console.log(
    `[ThirdEye Worker] Starting with concurrency: ${CONCURRENCY}`
  );
}

bootstrap().catch((err) => {
  console.error("[ThirdEye Worker] Failed to start:", err);
  process.exit(1);
});
