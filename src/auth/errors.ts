/**
 * Maps Supabase Auth error messages to user-friendly messages.
 */

const SUPABASE_ERROR_MAP: Record<string, string> = {
  // Sign-in errors
  "Invalid login credentials": "Incorrect email or password.",
  "Email not confirmed": "Your email has not been verified. Please check your inbox.",
  "Invalid Refresh Token": "Session expired. Please sign in again.",

  // Sign-up errors
  "User already registered": "An account with this email already exists.",
  "Password should be at least 6 characters":
    "Password does not meet requirements. Use at least 8 characters.",
  "Signup requires a valid password": "Please enter a valid password.",

  // Verification errors
  "Token has expired or is invalid": "Verification code has expired. Please request a new one.",
  "Otp has expired or is invalid": "Invalid or expired verification code. Please try again.",

  // Rate limiting
  "For security purposes, you can only request this after": "Too many attempts. Please try again later.",
  "Email rate limit exceeded": "Too many emails sent. Please try again later.",

  // Password reset
  "New password should be different from the old password.":
    "New password must be different from your current password.",
  "Auth session missing": "Your reset link has expired. Please request a new one.",

  // Network / generic
  "Failed to fetch": "Network error. Please check your connection and try again.",
};

const DEFAULT_MESSAGES: Record<string, string> = {
  signIn: "Unable to sign in. Please check your credentials and try again.",
  signUp: "Unable to create account. Please try again.",
  verify: "Verification failed. Please try again.",
  forgotPassword: "Unable to send reset email. Please try again.",
  resetPassword: "Unable to reset password. Please try again.",
  resendCode: "Unable to resend code. Please try again.",
  default: "Something went wrong. Please try again.",
};

export function getAuthErrorMessage(
  error: unknown,
  context: keyof typeof DEFAULT_MESSAGES = "default"
): string {
  if (error instanceof ValidationError) {
    return error.message;
  }

  if (error instanceof Error) {
    // Check for exact match first
    const exact = SUPABASE_ERROR_MAP[error.message];
    if (exact) return exact;

    // Check for partial match (Supabase sometimes includes extra context)
    for (const [pattern, friendlyMessage] of Object.entries(SUPABASE_ERROR_MAP)) {
      if (error.message.includes(pattern)) {
        return friendlyMessage;
      }
    }
  }

  return DEFAULT_MESSAGES[context] || DEFAULT_MESSAGES.default;
}

/**
 * Custom error class for validation failures
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
