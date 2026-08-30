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

/**
 * Changing your own password. The current one is asked for because a live
 * session is not proof that the person at the keyboard knows it — an unlocked
 * laptop is not consent to take the account over.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .trim(),
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "The new password must be different",
    path: ["newPassword"],
  });

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

/**
 * A manager putting a colleague on the books. Same name/email/password rules as
 * self-registration — deliberately the same schema shape, so the two ways into
 * the system cannot drift to different password minimums.
 */
export const addUserSchema = registerSchema;

export type AddUserDto = z.infer<typeof addUserSchema>;
