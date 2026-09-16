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
 * paths: the auth callback (so a signed installed app can catch the OAuth return),
 * the whole sim surface, and the two GAME PAGE routes.
 *
 * THE GAME PAGES ARE HERE BECAUSE OF THE LIVE ACTIVITY (relay 3B item 5). The
 * Activity carries https://sportsvyn.com/<league>/game/<slug> in its static
 * attributes, and tapping the card or the island opens that URL - which lands
 * in Safari, not the app, unless the domain association claims the path. The
 * same claim is what makes a game link shared in Messages open the app.
 *
 * BOTH LEAGUES, not just NFL: app/cfb/game/[slug] is a real route and a CFB
 * link is exactly as shareable as an NFL one.
 */

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: '87BX25MUHY.com.sportsvyn.draftvyn',
        paths: ['/api/auth/callback/*', '/sim*', '/nfl/game/*', '/cfb/game/*'],
      },
    ],
  },
};
