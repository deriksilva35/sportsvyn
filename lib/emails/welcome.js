/**
 * lib/emails/welcome.js
 *
 * The one email a new Sportsvyn account gets. Subject / HTML / plaintext,
 * built the same way as confirmation.js and magicLink.js: table layout,
 * inline styles only, no <style> block and no external CSS, because mail
 * clients still strip or ignore all three.
 *
 * REWRITTEN FOR SPORTSVYN (mon-16, Derik). It was the old draft-app welcome - a
 * mock-draft pitch from before the games were the product. Now: the lockup,
 * one line on what this is, the Daily as the one primary action, the
 * scoreboard as the second, and a way out. It does not sell and does not
 * explain features nobody asked about yet - the reader just signed up.
 *
 * HYPHENS ONLY. No em or en dashes anywhere in the copy.
 *
 * The unsubscribe line is plain text with a real link (the signed
 * /api/email/unsubscribe URL lib/auth/welcomeEmail.js builds with
 * unsubscribeUrlFor), not a dark-pattern grey mouse-print.
 */

import { emailLockupHtml } from '../brand/tagline.js';

export const WELCOME_LINE = 'Free sports games, live scores and leagues - the arcade of sports.';
export const WELCOME_CTA = 'Play today\'s Daily';
export const WELCOME_CTA_2 = 'Open the scoreboard';
export const WELCOME_FOOTER = 'You\'re receiving this because you created a Sportsvyn account.';

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function buildWelcomeEmail({ baseUrl, unsubscribeUrl }) {
  const dailyUrl = `${baseUrl}/daily`;
  const scoresUrl = `${baseUrl}/scores`;
  const wordmarkUrl = `${baseUrl}/wordmark-email.png`;

  const subject = 'Welcome to Sportsvyn';

  const text =
    `${WELCOME_LINE}\n\n` +
    `${WELCOME_CTA} ->\n${dailyUrl}\n\n` +
    `${WELCOME_CTA_2} ->\n${scoresUrl}\n\n` +
    `---\n` +
    `${WELCOME_FOOTER}\n` +
    `Unsubscribe: ${unsubscribeUrl}\n`;

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#0A0A0A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0A0A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td style="padding-bottom:26px;">
              ${emailLockupHtml({ wordmarkUrl })}
            </td>
          </tr>
          <tr>
            <td style="font-family:${FONT};font-size:17px;line-height:1.55;color:#F5F5F2;padding-bottom:26px;">
              ${WELCOME_LINE}
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:14px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#D4FF00" style="border-radius:2px;">
                    <a href="${dailyUrl}"
                       style="display:inline-block;padding:14px 28px;font-family:${FONT};
                              font-size:14px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                              color:#0A0A0A;text-decoration:none;">
                      <!-- redundant nested span: Outlook drops inline color on
                           anchors and falls back to link blue, unreadable on volt -->
                      <span style="color:#0A0A0A;">${WELCOME_CTA}</span>
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border:1px solid #2E2E2E;border-radius:2px;">
                    <a href="${scoresUrl}"
                       style="display:inline-block;padding:12px 24px;font-family:${FONT};
                              font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                              text-decoration:none;">
                      <span style="color:#C5C5C2;">${WELCOME_CTA_2}</span>
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-top:18px;font-family:${FONT};font-size:12px;line-height:1.6;color:#888888;">
              ${WELCOME_FOOTER}<br />
              <a href="${unsubscribeUrl}" style="color:#888888;text-decoration:underline;">Unsubscribe</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
