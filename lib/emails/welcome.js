/**
 * lib/emails/welcome.js
 *
 * The one email a new Draftvyn account gets. Subject / HTML / plaintext,
 * built the same way as confirmation.js and magicLink.js: table layout,
 * inline styles only, no <style> block and no external CSS, because mail
 * clients still strip or ignore all three.
 *
 * REGISTER. Four beats and nothing else: what this is, one thing to do,
 * one thing to know about draft night, and a way out. It does not sell,
 * does not congratulate, and does not explain features nobody asked
 * about yet. The reader just signed up - they have already decided.
 *
 * HYPHENS ONLY. No em or en dashes anywhere in the copy.
 *
 * The unsubscribe line is plain text with a real link, not a dark-pattern
 * grey mouse-print. This send is arguably transactional, so the link is
 * insurance rather than obligation - which is exactly why it should look
 * like something a reader can actually find.
 */

export function buildWelcomeEmail({ baseUrl, unsubscribeUrl }) {
  const draftUrl = `${baseUrl}/sim`;
  const wordmarkUrl = `${baseUrl}/wordmark-email.png`;

  const subject = 'Your first mock draft is waiting';

  const text =
    `Draftvyn drafts against the market - real ADP, rooms that reach and slide like real ones. The read is yours.\n\n` +
    `Start your first mock draft ->\n${draftUrl}\n\n` +
    `On draft night, the Tracker logs your real draft live at the table, pick by pick.\n\n` +
    `---\n` +
    `You are receiving this because you created a Draftvyn account.\n` +
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
              <img src="${wordmarkUrl}" width="200" height="40" alt="Sportsvyn"
                   style="display:block;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <tr>
            <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                       font-size:17px;line-height:1.55;color:#F5F5F2;padding-bottom:26px;">
              Draftvyn drafts against the market - real ADP, rooms that reach and slide like real ones.
              The read is yours.
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#D4FF00" style="border-radius:2px;">
                    <a href="${draftUrl}"
                       style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                              font-size:14px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                              color:#0A0A0A;text-decoration:none;">
                      <!-- redundant nested span: Outlook drops inline color on
                           anchors and falls back to link blue, unreadable on volt -->
                      <span style="color:#0A0A0A;">Start your first mock draft</span>
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                       font-size:15px;line-height:1.55;color:#C5C5C2;padding-bottom:30px;">
              On draft night, the Tracker logs your real draft live at the table, pick by pick.
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #2E2E2E;padding-top:18px;
                       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                       font-size:12px;line-height:1.6;color:#888888;">
              You are receiving this because you created a Draftvyn account.<br />
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
