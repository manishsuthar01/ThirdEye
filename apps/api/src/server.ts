const PORT = process.env.API_PORT || 4000;
const HOST = process.env.API_HOST || "0.0.0.0";

import express from "express";
import webhookRouter from "./modules/routes";
import { queueManager } from "./lib/queue";

const app = express();

app.use(express.json());

// Handle malformed JSON payloads gracefully without logging raw stack traces
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON payload in request body" });
  }
  next(err);
});

app.use("/api/", webhookRouter);


async function bootstrap() {
  await queueManager.start();

  app.listen(PORT, () => {
    console.log(`Webhook Server running on port ${PORT}`)
  });
}

bootstrap().catch((err) => {
  console.error("[ThirdEye API] Failed to start:", err);
  process.exit(1);
});
