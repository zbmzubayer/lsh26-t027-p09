import { z } from "zod";

const envSchema = z.object({});

export type EnvPublic = z.infer<typeof envSchema>;

export const ENV_PUBLIC = envSchema.parse({});
