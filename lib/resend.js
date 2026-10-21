/**
 * lib/resend.js -- Resend client wrapper.
 *
 * One place to read RESEND_API_KEY and define the From / Reply-To
 * addresses used across the app. Fails fast at module load if the
 * key is missing -- that's easier to spot in dev than a silent send
 * failure later.
 */

import { Resend } from 'resend';
import { paced } from './email/resendPace.js';

if (!process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY not set in environment');
}

export const resend = new Resend(process.env.RESEND_API_KEY);

// tue-4: EVERY send through this client is paced to <= 8 a second and retried on
// a 429 (lib/email/resendPace.js). One wrapper here, so no caller can forget it.
const rawSend = resend.emails.send.bind(resend.emails);
resend.emails.send = paced(rawSend);

export const EMAIL_FROM = 'Sportsvyn <hello@sportsvyn.com>';
// wed-2: the product's own domain, and the default for every mail we send
// (welcome, broadcast, alerts, reminders). Was derik@safetymanagers.com.
export const EMAIL_REPLY_TO = 'derik@sportsvyn.com';
