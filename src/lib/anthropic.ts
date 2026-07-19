import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-sonnet-5";

export function createAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

/** Turns common Anthropic API errors into messages a non-engineer can act on. */
export function friendlyAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.APIError && err.status === 401) {
    return new Error("The Anthropic API key is invalid or expired. Please check ANTHROPIC_API_KEY and try again.");
  }
  if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(err.message)) {
    return new Error("The Anthropic account has run out of credit. Please add credits and try again.");
  }
  return err instanceof Error ? err : new Error(String(err));
}
