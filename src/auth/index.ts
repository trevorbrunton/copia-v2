// Auth module public API
export { AuthProvider } from "./provider";
export { useAuth } from "./context";
export type { AuthContextValue } from "./context";
export { getAuthErrorMessage, ValidationError } from "./errors";
export type { AuthUser, AuthState } from "./types";
export {
  signInSchema,
  signUpSchema,
  verifySchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  profileUpdateSchema,
  deleteAccountSchema,
  changePasswordSchema,
  validate,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  RATE_LIMIT_CONFIG,
} from "./validation";
export type {
  SignInInput,
  SignUpInput,
  VerifyInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ProfileUpdateInput,
  DeleteAccountInput,
  ChangePasswordInput,
  ValidationResult,
  RateLimitResult,
} from "./validation";
