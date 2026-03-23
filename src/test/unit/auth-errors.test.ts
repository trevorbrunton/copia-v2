import { describe, it, expect } from "vitest";
import { getAuthErrorMessage, ValidationError } from "@/src/auth/errors";

describe("getAuthErrorMessage", () => {
  describe("exact match", () => {
    it("maps 'Invalid login credentials' to friendly message", () => {
      const err = new Error("Invalid login credentials");
      expect(getAuthErrorMessage(err)).toBe("Incorrect email or password.");
    });

    it("maps 'Email not confirmed' to friendly message", () => {
      const err = new Error("Email not confirmed");
      expect(getAuthErrorMessage(err)).toBe(
        "Your email has not been verified. Please check your inbox."
      );
    });

    it("maps 'User already registered' to friendly message", () => {
      const err = new Error("User already registered");
      expect(getAuthErrorMessage(err)).toBe(
        "An account with this email already exists."
      );
    });

    it("maps 'Otp has expired or is invalid' to friendly message", () => {
      const err = new Error("Otp has expired or is invalid");
      expect(getAuthErrorMessage(err)).toBe(
        "Invalid or expired verification code. Please try again."
      );
    });

    it("maps 'Auth session missing' to friendly message", () => {
      const err = new Error("Auth session missing");
      expect(getAuthErrorMessage(err)).toBe(
        "Your reset link has expired. Please request a new one."
      );
    });

    it("maps 'Failed to fetch' to network error message", () => {
      const err = new Error("Failed to fetch");
      expect(getAuthErrorMessage(err)).toBe(
        "Network error. Please check your connection and try again."
      );
    });
  });

  describe("partial match", () => {
    it("matches when Supabase error contains extra context", () => {
      const err = new Error(
        "For security purposes, you can only request this after 60 seconds"
      );
      expect(getAuthErrorMessage(err)).toBe(
        "Too many attempts. Please try again later."
      );
    });

    it("matches rate limit with prefix text", () => {
      const err = new Error("Email rate limit exceeded for this project");
      expect(getAuthErrorMessage(err)).toBe(
        "Too many emails sent. Please try again later."
      );
    });
  });

  describe("ValidationError", () => {
    it("returns the ValidationError message directly", () => {
      const err = new ValidationError("Name is required");
      expect(getAuthErrorMessage(err)).toBe("Name is required");
    });
  });

  describe("context-based defaults", () => {
    it("returns signIn default for unrecognised error", () => {
      const err = new Error("some unknown Supabase internal error");
      expect(getAuthErrorMessage(err, "signIn")).toBe(
        "Unable to sign in. Please check your credentials and try again."
      );
    });

    it("returns signUp default for unrecognised error", () => {
      const err = new Error("something unexpected");
      expect(getAuthErrorMessage(err, "signUp")).toBe(
        "Unable to create account. Please try again."
      );
    });

    it("returns verify default for unrecognised error", () => {
      const err = new Error("unknown");
      expect(getAuthErrorMessage(err, "verify")).toBe(
        "Verification failed. Please try again."
      );
    });

    it("returns forgotPassword default", () => {
      const err = new Error("unknown");
      expect(getAuthErrorMessage(err, "forgotPassword")).toBe(
        "Unable to send reset email. Please try again."
      );
    });

    it("returns resetPassword default", () => {
      const err = new Error("unknown");
      expect(getAuthErrorMessage(err, "resetPassword")).toBe(
        "Unable to reset password. Please try again."
      );
    });

    it("returns generic default when no context specified", () => {
      const err = new Error("something broke");
      expect(getAuthErrorMessage(err)).toBe(
        "Something went wrong. Please try again."
      );
    });
  });

  describe("non-Error values", () => {
    it("returns default for string error", () => {
      expect(getAuthErrorMessage("a string")).toBe(
        "Something went wrong. Please try again."
      );
    });

    it("returns default for null", () => {
      expect(getAuthErrorMessage(null)).toBe(
        "Something went wrong. Please try again."
      );
    });

    it("returns default for undefined", () => {
      expect(getAuthErrorMessage(undefined)).toBe(
        "Something went wrong. Please try again."
      );
    });

    it("returns context-specific default for non-Error", () => {
      expect(getAuthErrorMessage(42, "signIn")).toBe(
        "Unable to sign in. Please check your credentials and try again."
      );
    });
  });
});
