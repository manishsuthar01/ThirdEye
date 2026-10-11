const PORT = process.env.API_PORT || 4000;
const HOST = process.env.API_HOST || "0.0.0.0";

import express from "express";

const app = express();

app.use(express.json());

app.post("/api/webhooks/github", (req, res) => {
  const event = req.headers['x-github-event'] as string;
  const signature = req.headers['x-hub-signature-256'] as string;
  const payload = req.body;

  if (!signature) {
    return res.status(401).json({ message: "Missing signature" })
  }


  if (event === "push") {
    console.log("Repository:", payload.repository.full_name);
    console.log("Branch:", payload.ref);

    for (const commit of payload.commits ?? []) {
      console.log("Commit:", commit.id);
      console.log("Message:", commit.message);
    }
  }
  res.status(202).json({ received: true });

});



app.listen(PORT, (err: any) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log(`Webhook Server running on port ${PORT}`)
});



async function bootstrap() {

  console.log(`[ThirdEye API] Server starting on ${HOST}:${PORT}`);
}

bootstrap().catch((err) => {
  console.error("[ThirdEye API] Failed to start:", err);
  process.exit(1);
});
