import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  // Optional: the ngrok https URL of ml/serve.py. Unset (or unreachable) and
  // /api/visit silently falls back to the model bundled in src/data.
  ML_URL: z.url().optional(),
});

export type EnvPrivate = z.infer<typeof envSchema>;

export const ENV_PRIVATE = envSchema.parse(process.env);
