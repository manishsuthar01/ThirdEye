const PORT = process.env.API_PORT || 4000;
const HOST = process.env.API_HOST || "0.0.0.0";

import express from "express";
import webhookRouter from "./modules/routes";
import { queueManager } from "./lib/queue";

const app = express();

// Parse both raw application/json and GitHub's application/x-www-form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// If GitHub sends urlencoded format, the JSON payload is wrapped inside req.body.payload
app.use((req, _res, next) => {
  if (req.body && typeof req.body.payload === "string") {
    try {
      req.body = JSON.parse(req.body.payload);
    } catch (e) {
      console.warn("[API] Failed to parse URL-encoded body.payload as JSON");
    }
  }
  next();
});

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
