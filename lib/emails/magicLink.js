/**
 * lib/emails/magicLink.js
 *
 * Builds the subject / HTML / plaintext for the Sportsvyn sign-in email.
 *
 * CODE-ONLY: there is NO sign-in link. The 6-digit code (lib/auth/emailOtp.js) is
 * the sole redemption path — the emailed verification token cannot be redeemed via
 * URL (auth.js disables useVerificationToken). So this email renders the code as
 * the hero and never emits a callback URL. `url` is still received (for the
 * wordmark image origin only) but is never rendered as a link.
 *
 * House styling mirrors lib/emails/confirmation.js: ink #0A0A0A bg, volt #D4FF00
 * accent, paper-warm #F5F5F2 headline, muted #888888 secondary, table-based with
 * inline styles only, 560px inner table, wordmark PNG from the URL's origin.
 *
 * Voice: measured, present-tense. Hyphens only.
 */

export function buildMagicLinkEmail({ url, identifier, code }) {
  const baseUrl = new URL(url).origin;
  const wordmarkUrl = `${baseUrl}/wordmark-email.png`;

  const subject = 'Your Sportsvyn sign-in code';

  const text =
    `Your sign-in code\n\n` +
    `${code}\n\n` +
    `Enter it where you requested sign-in. Expires in 10 minutes.\n\n` +
    `Someone (we hope you) requested sign-in for ${identifier}.\n\n` +
    `If you didn't request this, ignore this email.\n\n` +
    `— Sportsvyn`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#0A0A0A;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your Sportsvyn sign-in code - enter it to sign in.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0A0A;">
  <tr>
    <td align="center" style="padding:48px 24px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
        <tr>
          <td style="padding-bottom:40px;">
            <img src="${wordmarkUrl}" alt="Sportsvyn" width="200" height="40" style="display:block;border:0;outline:none;text-decoration:none;height:40px;width:200px;">
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:12px;color:#F5F5F2;font-size:22px;line-height:1.3;font-weight:600;">
            Your sign-in code
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:18px;">
            <span style="display:inline-block;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:44px;letter-spacing:0.30em;color:#D4FF00;font-weight:700;">${code}</span>
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:36px;color:#888888;font-size:14px;line-height:1.65;">
            Enter it where you requested sign-in. Expires in 10 minutes.
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:20px;color:#F5F5F2;font-size:15px;line-height:1.65;">
            Someone (we hope you) requested sign-in for ${identifier}.
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:36px;color:#888888;font-size:14px;line-height:1.65;">
            If you didn't request this, ignore this email.
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #2A2A2A;padding-top:24px;color:#888888;font-size:14px;line-height:1.65;">
            — Sportsvyn
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
