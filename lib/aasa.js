/**
 * lib/aasa.js — Apple App Site Association (Universal Links) content.
 *
 * Served as application/json (no file extension) at
 * /.well-known/apple-app-site-association by
 * app/.well-known/apple-app-site-association/route.js.
 *
 * INERT until a native build with the associated-domains entitlement for this
 * appID claims the domain. Serving this file has zero effect on current web
 * users or the build in review — nothing intercepts these paths until an
 * installed app declares `applinks:sportsvyn.com` and matches this appID.
 *
 * appID = <TeamID>.<BundleID> = 87BX25MUHY.com.sportsvyn.draftvyn
 * paths: the auth callback (so a signed installed app can catch the OAuth return)
 * and the whole sim surface.
 */

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: '87BX25MUHY.com.sportsvyn.draftvyn',
        paths: ['/api/auth/callback/*', '/sim*'],
      },
    ],
  },
};
