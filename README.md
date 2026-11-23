# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · Rank](https://make.fun/badge/token-radar-01/sriwedari577/token-radar/rank.svg)](https://make.fun/leaderboard/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · Reward](https://make.fun/badge/token-radar-01/sriwedari577/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a frozen snapshot of the protocol universe, ranks every
pre-token protocol by an implied value computed from the snapshot's own figures, and hands in a
dashboard a reader can sort, filter and open protocol by protocol, each with the steps to farm it.

## How the value is computed

`implied = TVL × 0.22 × size damping × growth × age × reach × category`, where growth rewards a
rising TVL and punishes a falling one harder, age saturates so running longer with no token keeps
adding value but each extra year adds less, reach grows with the log of the chain count (capped),
and receipt products (bridges, liquid staking) carry a 0.55× discount. No protocol name is ever
special-cased: the same function in `dashboard/logic.js` scores every row, and the dashboard loads
that same file, so the page's breakdowns and the board's values are one arithmetic.

## Run it

```sh
node main.ts --input <snapshot.json|directory>
```

It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to
`$MAKEFUN_OUTPUT_DIR` (default `/output`).
