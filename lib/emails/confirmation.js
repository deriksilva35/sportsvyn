/**
 * lib/emails/confirmation.js
 *
 * Builds the subject / HTML / plaintext for the confirmation email.
 *
 * HTML uses a table-based layout with inline styles only -- email
 * clients still don't trust flexbox/grid, and most strip <style>
 * blocks or external CSS. Outer table fills the viewport with ink
 * bg; inner table is capped at 560px max-width.
 *
 * The CTA's visible text is wrapped in a redundant nested <span>
 * with its own inline color: Outlook sometimes ignores inline color
 * on anchor tags and falls back to default link blue, which on the
 * volt background is unreadable. The nested span locks the text
 * color regardless.
 *
 * The wordmark <img> points at /wordmark-email.png (white-on-
 * transparent, 1600x320 native, displayed at 200x40 -- 8x density
 * for retina). We derive the asset's absolute URL from confirmUrl's
 * origin so callers pass exactly one URL.
 */

export function buildConfirmationEmail({ confirmUrl }) {
  const baseUrl = new URL(confirmUrl).origin;
  const wordmarkUrl = `${baseUrl}/wordmark-email.png`;

  const subject = 'Confirm your Sportsvyn signup';

  const text =
    `One click and you're in.\n\n` +
    `Confirm your email ->\n${confirmUrl}\n\n` +
    `Sportsvyn is a new editorial sports publication launching with ` +
    `the 2026 World Cup. You signed up at sportsvyn.com — confirm ` +
    `your email so we can send you what we publish.\n\n` +
    `If you didn't sign up, ignore this email. The link expires in ` +
    `seven days.\n\n` +
    `— Sportsvyn`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#0A0A0A;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Confirm your Sportsvyn signup — one click and you're in.</div>
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
            One click and you're in.
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:36px;">
            <a href="${confirmUrl}" style="display:inline-block;background:#D4FF00;color:#0A0A0A;text-decoration:none;padding:14px 28px;font-weight:600;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;">
              <span style="color:#0A0A0A;">Confirm your email →</span>
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:20px;color:#F5F5F2;font-size:15px;line-height:1.65;">
            Sportsvyn is a new editorial sports publication launching with the 2026 World Cup. You signed up at sportsvyn.com — confirm your email so we can send you what we publish.
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:36px;color:#888888;font-size:14px;line-height:1.65;">
            If you didn't sign up, ignore this email. The link expires in seven days.
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
