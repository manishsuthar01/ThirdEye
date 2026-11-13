/**
 * ThirdEye Worker — Entry Point
 */

import fs from "node:fs";
import path from "node:path";

// Automatically load root .env if present
const possiblePaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
];

for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(envPath);
    console.log(`[ThirdEye Worker] Loaded environment variables from: ${envPath}`);
    break;
  }
}

import { queueManager } from "./lib/queue";
import type { NormalizedWebhookEvent } from "./types/webHookEvent";
import processDeploymentEvent from "./processors/deployment.processor";


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
