# The launch email

## launch-email-sep8.html

The **send build** of the Sportsvyn launch email, 8 September 2026. This is
the file that goes into Resend.

**Subject line:** `You came for the mock draft. Now it counts.`

It is also the `<title>`, and the preheader — the hidden line mail clients
show next to the subject — is the first `<div>` in the body:

> Four ranked games, all free. The Weekly locks at first kickoff Wednesday
> night.

### This is the URL build, not the preview

Two builds of this email exist and only one belongs in a repo.

| | size | images |
|---|---|---|
| **send build** (this file) | 42 KB | eight `https://sportsvyn.com/email/sep8/*.jpg` references |
| preview build | 1.2 MB | the same eight, inlined as base64 data URIs |

The preview exists so the email can be read before the assets are live. It
must never be the file that is sent: Gmail clips a message over ~102 KB, so
a 1.2 MB body is truncated mid-email, and several clients refuse to render
base64 images at all. The send build is 42 KB and stays well under the clip
threshold.

### The eight assets

They live in this repo at `public/email/sep8/` and are served from
`https://sportsvyn.com/email/sep8/`:

    hero-ball.jpg      1200x600    117 KB   hero background
    stadium.jpg        1200x520     95 KB   full-bleed section break
    lobby.jpg          1080x1278    99 KB   the games lobby
    draft-room.jpg     1080x1090   104 KB   The Draft
    weekly-grade.jpg   1080x997     85 KB   The Weekly grade card
    pickem-board.jpg   1080x997     60 KB   a Pick'em board
    scores.jpg          900x928      47 KB  scores, two-up
    league.jpg          900x986      48 KB  a match page, two-up

All eight are under 200 KB. They are referenced by absolute URL, so they
must be deployed to production BEFORE the email is sent — a mail client
fetches them at open time and there is no second chance once the send has
gone out.

The wordmark is not in that directory. It comes from
`public/brand/sportsvynwordmarkwhite3000x600truealpha.png`.

### `{{unsubscribe_url}}`

A **Resend merge tag**, not a placeholder to fill in by hand. Resend
substitutes each recipient's own unsubscribe link at send time. Leave it
exactly as written, braces included. If it is replaced with a literal URL
the email loses its per-recipient unsubscribe and should not be sent.

### Editing

Edit this file, not a copy. The images are absolute URLs, so it renders
correctly opened straight from disk in a browser once the assets are live —
which is the fastest way to check a change without a test send.
