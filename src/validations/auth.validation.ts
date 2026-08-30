import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .email({
      error: (issues) =>
        issues.input ? "Invalid email address" : "Email is required",
    })
    .trim(),
  password: z.string().min(1, "Password is required").trim(),
});

export type LoginDto = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").trim(),
  email: z
    .email({
      error: (issues) =>
        issues.input ? "Invalid email address" : "Email is required",
    })
    .trim(),
  password: z.string().min(8, "Password must be at least 8 characters").trim(),
});

export type RegisterDto = z.infer<typeof registerSchema>;
