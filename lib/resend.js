/**
 * lib/resend.js -- Resend client wrapper.
 *
 * One place to read RESEND_API_KEY and define the From / Reply-To
 * addresses used across the app. Fails fast at module load if the
 * key is missing -- that's easier to spot in dev than a silent send
 * failure later.
 */

import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY not set in environment');
}

export const resend = new Resend(process.env.RESEND_API_KEY);

export const EMAIL_FROM = 'Sportsvyn <hello@sportsvyn.com>';
export const EMAIL_REPLY_TO = 'derik@safetymanagers.com';
