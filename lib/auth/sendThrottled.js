/**
 * lib/auth/sendThrottled.js - the error a capped sign-in send throws.
 *
 * Auth.js forwards only a short list of error TYPES to the client; anything
 * else becomes "Configuration" (and reads as a broken site). Typed as
 * AccessDenied so the client gets error=AccessDenied and SignInForm can show its
 * one generic "can't send another code right now" line. It is the same line for
 * every address, so it cannot tell anyone whether an account exists.
 */
// Imported from @auth/core directly (next-auth re-exports this same class) so
// the module also loads under plain node for its test.
import { AuthError } from '@auth/core/errors';

export class SendThrottled extends AuthError {
  static type = 'AccessDenied';
}
