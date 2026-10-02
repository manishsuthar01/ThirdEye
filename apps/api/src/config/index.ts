/**
 * API Configuration
 *
 * Environment variable parsing, validation,
 * and application configuration.
 */

export const config = {
  port: Number(process.env.API_PORT) || 4000,
  host: process.env.API_HOST || "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  github: {
    appId: process.env.GITHUB_APP_ID || "",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY || "",
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET || "",
    clientId: process.env.GITHUB_APP_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET || "",
  },
};
