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
 *
 * /games* (thu-21): the app's home is Games, so a shared games link opens the
 * app there. /sim* stays for older links.
 *
 * /j/* IS THE LEAGUE INVITE LINK (thu-19, Leagues V1 P1): a /j/<code> shared in
 * Messages opens the app straight onto the join. It ships WITH the /j/ route -
 * claiming a path the site does not serve would open the app on a 404. The
 * bundle id stays draftvyn after the rename, so the appID does not change.
 *
 * /daily* IS THE DAILY'S SHARE LINK (relay mon-12): the share card's text
 * carries sportsvyn.com/daily, so a friend with the app installed opens it
 * there, and without it lands on the web board (app/daily/page.js 308s to
 * /daily/board). One claim covers the short link, today's board and a
 * result's /daily/board/<date>.
 */

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: '87BX25MUHY.com.sportsvyn.draftvyn',
        paths: ['/api/auth/callback/*', '/sim*', '/nfl/game/*', '/cfb/game/*', '/j/*', '/games*', '/daily*'],
      },
    ],
  },
};
