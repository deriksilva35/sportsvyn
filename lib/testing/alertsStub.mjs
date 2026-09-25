// lib/testing/alertsStub.mjs - a stand-in for lib/pollers/alerts.js that a
// test routes '@/lib/pollers/alerts' to, so a route handler run under test can
// never reach the mailer. It records what it was handed and sends nothing.
//
// A MODULE, NOT A STRING A TEST WRITES OUT. lib/gridiron/kickoffGuard.test.mjs
// forbids any test file from invoking the real alert sender; this file is the
// sanctioned replacement, and a test that uses it names it in its hook.
export const sent = [];
export async function maybeAlert(sql, alert) {
  sent.push(alert);
  return { sent: false, stub: true };
}
