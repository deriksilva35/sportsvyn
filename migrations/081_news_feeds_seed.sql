-- Seed the 32 NFL club feeds. Run after 081_news_items.sql.
--
-- ONE URL PATTERN, VERIFIED ON FOUR CLUBS BEFORE IT WAS TRUSTED:
--   packers.com/rss/news        200, 100 items
--   philadelphiaeagles.com      200, 100 items
--   dallascowboys.com           200, 100 items
--   chiefs.com                  200,  20 items
--   49ers.com                   200,  20 items
-- and it does NOT hold outside the NFL: ramblinwreck.com/rss/news is a 404.
--
-- WSH, NOT WAS. The first apply seeded 31 of 32: this table stores the
-- Commanders as WSH and the seed said WAS, so the join found nothing and the
-- row was silently absent rather than wrong. Caught by counting the result
-- against 32 instead of trusting the INSERT.
--
-- A club whose feed later stops answering is left in the table with an error
-- stamped on it rather than deleted - a feed that disappeared is a fact worth
-- keeping, and the cron alerts on it.
INSERT INTO news_feeds (league_id, team_id, name, url)
SELECT l.id, t.id, t.name, 'https://www.' || d.domain || '.com/rss/news'
  FROM (VALUES
    ('ARI','azcardinals'), ('ATL','atlantafalcons'), ('BAL','baltimoreravens'),
    ('BUF','buffalobills'), ('CAR','panthers'), ('CHI','chicagobears'),
    ('CIN','bengals'), ('CLE','clevelandbrowns'), ('DAL','dallascowboys'),
    ('DEN','denverbroncos'), ('DET','detroitlions'), ('GB','packers'),
    ('HOU','houstontexans'), ('IND','colts'), ('JAX','jaguars'),
    ('KC','chiefs'), ('LV','raiders'), ('LAC','chargers'),
    ('LAR','therams'), ('MIA','miamidolphins'), ('MIN','vikings'),
    ('NE','patriots'), ('NO','neworleanssaints'), ('NYG','giants'),
    ('NYJ','newyorkjets'), ('PHI','philadelphiaeagles'), ('PIT','steelers'),
    ('SF','49ers'), ('SEA','seahawks'), ('TB','buccaneers'),
    ('TEN','tennesseetitans'), ('WSH','commanders')
  ) AS d(abbr, domain)
  JOIN leagues l ON l.slug = 'nfl'
  JOIN teams t ON t.league_id = l.id AND t.abbreviation = d.abbr
ON CONFLICT (url) DO NOTHING;
