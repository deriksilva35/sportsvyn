// Hardcoded placeholder data for the /app deck. Self-contained — no
// imports from lib/, no DB. Step 2B will replace this with real data.

export const NEXT_UP = {
  home: { name: 'Mexico',       emoji: '🇲🇽', code: 'MEX', followed: true },
  away: { name: 'South Africa', emoji: '🇿🇦', code: 'RSA' },
  meta: 'Thu Jun 11 · 8:00 PM ET · Estadio Azteca',
  lede: 'A reopened Azteca, a home crowd at full voice, a Bafana side that arrived more dangerous than the seeding implied.',
  body: 'Mexico starts the tournament as host with everything to gain and nothing yet to prove. South Africa is the kind of team that punishes a slow first half — quick on the break, organised in midfield, willing to sit and counter. The script writes itself only if Mexico lets it.',
  winProb: { home: 61, draw: 23, away: 16 },
  watch: [
    'Edson Álvarez vs Teboho Mokoena in midfield — first 20 minutes set the tempo.',
    'Set pieces: South Africa is taller on average and will hunt the second ball.',
  ],
};

export const POWER_RANKINGS_TOP5 = [
  { rank: 1, name: 'Spain',     emoji: '🇪🇸', score: 9.2 },
  { rank: 2, name: 'Argentina', emoji: '🇦🇷', score: 9.1, followed: true },
  { rank: 3, name: 'France',    emoji: '🇫🇷', score: 8.6 },
  { rank: 4, name: 'Portugal',  emoji: '🇵🇹', score: 8.2 },
  { rank: 5, name: 'Germany',   emoji: '🇩🇪', score: 8.0 },
];

export const PLAYER_TOP5 = [
  { rank: 1, name: 'Mbappé',       country: 'France',    pos: 'FWD', score: 9.3 },
  { rank: 2, name: 'Bellingham',   country: 'England',   pos: 'MID', score: 9.0 },
  { rank: 3, name: 'Vinícius Jr',  country: 'Brazil',    pos: 'FWD', score: 8.9 },
  { rank: 4, name: 'Messi',        country: 'Argentina', pos: 'FWD', score: 8.7, followed: true },
  { rank: 5, name: 'Pedri',        country: 'Spain',     pos: 'MID', score: 8.5 },
];

export const WATCH_TODAY = [
  { home: 'Saudi Arabia', away: 'Senegal',      score: 7.5 },
  { home: 'Argentina',    away: 'Iceland',      score: 7.0, followed: true },
  { home: 'Kyrgyzstan',   away: 'Palestine',    score: 6.4 },
  { home: 'Liberia',      away: 'Sierra Leone', score: 5.9 },
  { home: 'Iraq',         away: 'Venezuela',    score: 5.1 },
];

export const READ = {
  title: 'The Azteca Was Never Just a Stadium',
  lede: 'For Mexico, the opener is a homecoming and a reckoning at the same address.',
  body: 'It has hosted two World Cup finals, a coronation, a famous Hand. Now it is a renovated bowl with new sightlines, a new pitch, and the same noise. The story of the next month begins under its lights — and the rest of CONCACAF will spend Thursday wondering how to follow the example.',
  footer: 'Sportsvyn · 2,400 words · 9 min',
};

export const MARKET = {
  kicker: 'Market Explainer',
  title: 'Reading the Market in Plain English',
  lede: 'What the numbers say without the jargon, the chest-thumping, or the picks.',
  body: 'We translate live odds into language: who the market actually fears, who it does not yet believe, and where opinion is shifting between kickoff and kickoff. We explain — we do not pick. The market is a sentiment thermometer, not a forecast. Read it for what it is.',
  footer: "Coming this week · explain · don't pick",
};
