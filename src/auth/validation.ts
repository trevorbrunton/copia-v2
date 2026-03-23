import { z } from "zod";
import { ValidationError } from "./errors";

export { ValidationError };

/**
 * Email validation schema — trims whitespace and lowercases for consistency
 */
export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .transform((val) => val.trim().toLowerCase())
  .pipe(z.string().email("Invalid email address"));

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be less than 128 characters")
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[0-9]/, "Must contain a number");

export const verificationCodeSchema = z
  .string()
  .length(6, "Verification code must be 6 digits")
  .regex(/^\d+$/, "Verification code must contain only numbers");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
    name: z.string().min(1, "Name is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const verifySchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const profileUpdateSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100).optional(),
    avatarUrl: z.string().url("Invalid URL").max(500).optional().or(z.literal("")),
    timezone: z.string().max(50).optional(),
    locale: z.string().max(10).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "At least one field required");

export const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE", {
    error: 'Type "DELETE" to confirm',
  }),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// ── Generic validation helper ────────────────────────────────────────

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const firstError = result.error.issues[0];
  return {
    success: false,
    error: firstError?.message || "Validation failed",
  };
}

// ── Client-side rate limiting ────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  blockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

export const RATE_LIMIT_CONFIG = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockDurationMs: 30 * 60 * 1000,
  cleanupIntervalMs: 5 * 60 * 1000,
} as const;

function ensureCleanupInterval(): void {
  if (typeof window === "undefined" || cleanupIntervalId !== null) return;

  cleanupIntervalId = setInterval(() => {
    const now = Date.now();
    const maxAge = RATE_LIMIT_CONFIG.windowMs + RATE_LIMIT_CONFIG.blockDurationMs;

    for (const [key, entry] of rateLimitStore.entries()) {
      const isExpired = now - entry.firstAttempt > maxAge;
      const isUnblocked = !entry.blockedUntil || entry.blockedUntil < now;

      if (isExpired && isUnblocked) {
        rateLimitStore.delete(key);
      }
    }
  }, RATE_LIMIT_CONFIG.cleanupIntervalMs);
}

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  blockedUntil?: Date;
  retryAfterSeconds?: number;
}

/**
 * Check if an identifier is rate limited.
 * Client-side only — for UX, not security. Use server-side rate limiting for protection.
 */
export function checkRateLimit(identifier: string): RateLimitResult {
  ensureCleanupInterval();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (entry?.blockedUntil && entry.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((entry.blockedUntil - now) / 1000);
    return {
      allowed: false,
      remainingAttempts: 0,
      blockedUntil: new Date(entry.blockedUntil),
      retryAfterSeconds,
    };
  }

  if (entry && now - entry.firstAttempt > RATE_LIMIT_CONFIG.windowMs) {
    rateLimitStore.delete(identifier);
    return { allowed: true, remainingAttempts: RATE_LIMIT_CONFIG.maxAttempts };
  }

  const currentCount = entry?.count ?? 0;
  const remaining = RATE_LIMIT_CONFIG.maxAttempts - currentCount;

  return { allowed: remaining > 0, remainingAttempts: Math.max(0, remaining) };
}

export function recordFailedAttempt(identifier: string): void {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || now - entry.firstAttempt > RATE_LIMIT_CONFIG.windowMs) {
    rateLimitStore.set(identifier, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
    if (entry.count >= RATE_LIMIT_CONFIG.maxAttempts) {
      entry.blockedUntil = now + RATE_LIMIT_CONFIG.blockDurationMs;
    }
  }
}

export function clearRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}

// ── Type exports ─────────────────────────────────────────────────────

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type VerifyInput = z.infer<typeof verifySchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
