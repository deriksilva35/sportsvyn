/**
 * lib/emails/magicLink.js
 *
 * Builds the subject / HTML / plaintext for the Auth.js v5 magic-link
 * sign-in email. Mirrors lib/emails/confirmation.js so the two emails
 * read as siblings (ink #0A0A0A bg, volt #D4FF00 CTA, paper-warm
 * #F5F5F2 headline, muted #888888 secondary, table-based with inline
 * styles only, 560px max-width inner table, wordmark PNG derived from
 * the URL's origin).
 *
 * The {url} from Auth.js's sendVerificationRequest already carries the
 * signed verification token — it is rendered VERBATIM into the href
 * (no encoding, no wrapping, no mutation). A mangled link breaks the
 * adapter's useVerificationToken handshake.
 *
 * Voice: same register as confirmation.js. No marketing copy — the
 * user already knows what Sportsvyn is; this is a sign-in link, not a
 * pitch. No hardcoded expiry duration (the verification_token row's
 * actual TTL is Auth.js's choice; "shortly" is honest).
 *
 * The CTA span-inside-anchor trick (redundant color on nested <span>)
 * locks the text color against Outlook's tendency to override inline
 * anchor color with default link blue — would be unreadable on volt.
 */

export function buildMagicLinkEmail({ url, identifier, code }) {
  const baseUrl = new URL(url).origin;
  const wordmarkUrl = `${baseUrl}/wordmark-email.png`;

  const subject = 'Your Sportsvyn sign-in link';

  const text =
    `Click to sign in.\n\n` +
    `Sign in to Sportsvyn ->\n${url}\n\n` +
    (code ? `Or enter this code in the app: ${code}\n\n` : '') +
    `Someone (we hope you) requested a sign-in link for ${identifier}. ` +
    `Click the link above${code ? ', or enter the code,' : ''} to sign in.\n\n` +
    `If you didn't request this, ignore this email. This link` +
    `${code ? ' and code' : ''} expire in 10 minutes.\n\n` +
    `— Sportsvyn`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#0A0A0A;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your Sportsvyn sign-in link — click to sign in.</div>
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
          <td style="padding-bottom:28px;color:#F5F5F2;font-size:22px;line-height:1.3;font-weight:600;">
            Click to sign in.
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:36px;">
            <a href="${url}" style="display:inline-block;background:#D4FF00;color:#0A0A0A;text-decoration:none;padding:14px 28px;font-weight:600;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;">
              <span style="color:#0A0A0A;">Sign in to Sportsvyn →</span>
            </a>
          </td>
        </tr>
        ${code ? `<tr>
          <td style="padding-bottom:8px;color:#888888;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">
            Or enter this code in the app
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:36px;">
            <span style="display:inline-block;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;letter-spacing:0.28em;color:#F5F5F2;font-weight:700;">${code}</span>
          </td>
        </tr>` : ''}
        <tr>
          <td style="padding-bottom:20px;color:#F5F5F2;font-size:15px;line-height:1.65;">
            Someone (we hope you) requested a sign-in link for ${identifier}. Click the button above${code ? ', or enter the code,' : ''} to sign in.
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:36px;color:#888888;font-size:14px;line-height:1.65;">
            If you didn't request this, ignore this email. This link${code ? ' and code' : ''} expire in 10 minutes.
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
