# v1.2 client half - push wiring in the Xcode project

The server half is live in this repo (lib/push/, /api/push/register,
/api/push/unregister, hooks in daily-close). Everything below happens in
**~/sportsvyn-mock-app on the Mac** - the droplet's ios/ is the abandoned
copy and must not be touched.

## What the web code already does (nothing to add in the binary for these)

The pre-warm surfaces are all server-delivered and feature-detect
`window.Capacitor.Plugins.PushNotifications`:

- onboarding sheet grows a step 4 (notifications pre-warm, toggle
  pre-checked, ENABLE -> OS prompt, NOT NOW -> never blocks)
- one-time post-entry nudge on the Daily receipt
- Notifications row on /sim/account
- silent re-register on launch when permission is already granted
  (components/push/PushReRegister, mounted globally)

In the v1.1 binary and on the web the plugin is absent, so none of it
renders. Installing the plugin in v1.2 is what switches it all on.

## Mac steps, in order

1. **Plugin** (Cap 7 pinned - do not take a v8):
   ```
   npm install @capacitor/push-notifications@^7
   npx cap sync ios
   ```

2. **Capability**: Xcode -> target -> Signing & Capabilities ->
   + Capability -> Push Notifications. This writes the `aps-environment`
   entitlement (Xcode manages the value: `development` for debug builds,
   `production` for App Store/TestFlight archives).

3. **AppDelegate** - Capacitor 7 needs the two APNs callbacks forwarded:
   ```swift
   func application(_ application: UIApplication,
       didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
     NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications,
                                     object: deviceToken)
   }
   func application(_ application: UIApplication,
       didFailToRegisterForRemoteNotificationsWithError error: Error) {
     NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications,
                                     object: error)
   }
   ```

4. **Tap routing**: on `pushNotificationActionPerformed`, navigate the
   webview to the payload's `url` (every payload carries an in-app path
   like `/daily`). If the shell has no notification listener yet, the
   minimum viable version is a `window.location.assign(url)` from a
   `PushNotifications.addListener('pushNotificationActionPerformed', ...)`
   in the web layer - which we can add repo-side once the plugin exists;
   nothing blocks v1.2 on it because a tap with no handler still opens
   the app.

5. **Portal, one-time** (item 0 of the block): Keys -> + -> APNs ->
   download the .p8 immediately, note the Key ID. Then in Vercel env:
   `APNS_KEY` (paste the .p8 contents; \n-escaped is fine),
   `APNS_KEY_ID`, `APNS_TEAM_ID=87BX25MUHY`, `APNS_ENV=production`
   (sandbox is the default when unset), `PUSH_ENABLED=1` to arm.
   Same five in the droplet's .env.local for the sandbox smoke test.

6. **Build against PROD**: the shell's server.url already points at
   https://sportsvyn.com - no change. Archive, upload via App Store
   Connect, submit as v1.2 by Thu Aug 20.

## Sandbox smoke test (droplet-side, once the .p8 lands)

A debug build on a real device registers a SANDBOX token (aps-environment
= development). With `APNS_ENV` unset the sender already points at
api.sandbox.push.apple.com, so: register from the device, then fire
`notifyEvent` once by hand and watch the lock screen. The send-once
ledger row lands in sync_runs source='push'.

## The topic

`apns-topic` is hardcoded to `com.sportsvyn.draftvyn` (lib/push/apns.js).
That must equal the BINARY's bundle id. The droplet's stale
capacitor.config.ts says com.sportsvyn.app - if the real project's bundle
id differs from com.sportsvyn.draftvyn, the topic constant is the one
line to fix, and pushes 400 with BadTopic until it is.

## Queued beside push registration: Universal Links for /join/{code}

A league invite link (`https://sportsvyn.com/join/{code}`) tapped from a group chat opens in Safari, not the app, BY DESIGN until Universal Links ship with the next Draftvyn binary: an AASA file served at `/.well-known/apple-app-site-association` (paths `/join/*`) plus the Associated Domains entitlement (`applinks:sportsvyn.com`). No web change now; the join page already works signed-out in Safari and carries the code through sign-in (2 Sep).
