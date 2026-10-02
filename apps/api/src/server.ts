/**
 * ThirdEye API — Entry Point
 *
 * This is the main entry point for the API service.
 * It handles GitHub App webhooks, REST endpoints, and job creation.
 */

const PORT = process.env.API_PORT || 4000;
const HOST = process.env.API_HOST || "0.0.0.0";

async function bootstrap() {
  // TODO: Initialize HTTP server (e.g., Fastify or Express)
  // TODO: Register middleware (auth, request logging)
  // TODO: Mount feature modules (github, repositories, webhooks, commits)
  // TODO: Start listening

  console.log(`[ThirdEye API] Server starting on ${HOST}:${PORT}`);
}

bootstrap().catch((err) => {
  console.error("[ThirdEye API] Failed to start:", err);
  process.exit(1);
});
