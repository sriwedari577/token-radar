// The token radar's shared logic: one file, plain JavaScript, no DOM and no network.
//
// main.ts imports it to score the board it writes to board.json, and the dashboard loads it as a
// classic script so the page recomputes every row from the same snapshot figures. The two can never
// drift: the board's implied values and the page's breakdowns are one arithmetic.
//
// The model scores only what the snapshot carries: TVL, seven-day growth, how long the protocol has
// run with no token recorded, how many chains it runs on, and its category. No protocol name is ever
// special-cased: the same function scores every row. A protocol "records no token" when DefiLlama's
// record carries no market cap, no CoinGecko id and no symbol; that is a fact about the record, never
// a claim that the protocol has no token.

'use strict';

/** The model's constants, as the dashboard states them. */
var MODEL = {
  base_multiple: 0.22,
  growth_weight_up: 0.6,
  growth_weight_down: 0.9,
  growth_floor: -80,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_scale_days: 400,
  unknown_age_days: 365,
  tvl_reference: 100000000,
  tvl_damping: 0.05,
  damping_floor: 0.7,
  damping_cap: 1.3,
  reach_step: 0.05,
  reach_cap: 1.15,
  receipt_discount: 0.55,
};

var MODEL_VERSION = 'radar-2';

/** A finite number, else `fallback`. */
function finite(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

var DAY_MS = 86400000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
function ageDays(asOf, listedAt) {
  if (listedAt === null || listedAt === undefined) return null;
  var a = Date.parse(asOf + 'T00:00:00Z');
  var b = Date.parse(listedAt + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
function isRankable(p) {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The category's multiple: fee-monetising businesses carry a higher one, receipt products a lower one. */
function categoryMultiple(p) {
  var c = (p.category || '').toLowerCase();
  if (c.indexOf('bridge') >= 0) return MODEL.receipt_discount;
  if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restaked') >= 0 || c.indexOf('staking pool') >= 0 || c === 'restaking') return MODEL.receipt_discount;
  if (c.indexOf('index') >= 0) return 0.9;
  if (c.indexOf('dex') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('collateral') >= 0) return 1.15;
  if (c.indexOf('rwa') >= 0 || c.indexOf('payment') >= 0 || c.indexOf('insurance') >= 0 || c.indexOf('prediction') >= 0 || c.indexOf('index') >= 0) return 0.9;
  if (c === 'chain') return 0.8;
  return 1.0;
}

/** The category group's plain name, for the breakdown and the farm plan. */
function categoryGroup(p) {
  var c = (p.category || '').toLowerCase();
  if (c.indexOf('bridge') >= 0) return 'bridge';
  if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restaked') >= 0 || c.indexOf('staking pool') >= 0 || c === 'restaking') return 'receipt';
  if (c.indexOf('index') >= 0) return 'general';
  if (c.indexOf('dex') >= 0) return 'dex';
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
  if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('option') >= 0) return 'derivatives';
  if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'yield';
  if (c.indexOf('rwa') >= 0) return 'rwa';
  if (c.indexOf('prediction') >= 0) return 'prediction';
  if (c.indexOf('insurance') >= 0) return 'insurance';
  if (c.indexOf('stable') >= 0) return 'stable';
  if (c === 'chain') return 'chain';
  return 'general';
}

/**
 * One protocol's implied value and every factor behind it. Growth is asymmetric: a falling TVL
 * costs more than a rising one gains, because users leaving is a stronger signal than users
 * arriving on a small base. Age saturates: running longer with no token keeps adding value, but
 * each extra year adds less. Reach grows with the log of the chain count, capped.
 */
function impliedValue(p, asOf) {
  var age = ageDays(asOf, p.listed_at);
  var ageForModel = age === null ? MODEL.unknown_age_days : age;
  var rawGrowth = finite(p.change_7d, 0);
  var growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, rawGrowth));
  var growthMult = growthPct >= 0
    ? 1 + (growthPct / 100) * MODEL.growth_weight_up
    : Math.max(0.28, 1 + (growthPct / 100) * MODEL.growth_weight_down);
  var maturityMult = MODEL.maturity_floor + MODEL.maturity_range * (1 - Math.exp(-ageForModel / MODEL.maturity_scale_days));
  var damping = Math.pow(Math.max(p.tvl_usd, 1) / MODEL.tvl_reference, -MODEL.tvl_damping);
  damping = Math.min(MODEL.damping_cap, Math.max(MODEL.damping_floor, damping));
  var base = p.tvl_usd * MODEL.base_multiple * damping;
  var chains = Array.isArray(p.chains) ? p.chains.length : 0;
  var reachMult = Math.min(MODEL.reach_cap, 1 + MODEL.reach_step * Math.log(Math.max(chains, 1)));
  var catMult = categoryMultiple(p);
  var implied = Math.max(1, Math.round(base * growthMult * maturityMult * reachMult * catMult));
  return {
    implied: implied,
    base: Math.round(base),
    growth_pct: growthPct,
    growth_multiplier: Math.round(growthMult * 1e4) / 1e4,
    maturity_multiplier: Math.round(maturityMult * 1e4) / 1e4,
    reach_multiplier: Math.round(reachMult * 1e4) / 1e4,
    category_multiplier: catMult,
    category_group: categoryGroup(p),
    damping: Math.round(damping * 1e4) / 1e4,
    age_days: age,
  };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p) {
  return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p) {
  if (p.tvl_usd >= 5000000000) return 250;
  if (p.tvl_usd >= 1000000000) return 150;
  if (p.tvl_usd >= 100000000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The main farming action, by the category group the snapshot's own category field gives. */
function actionFor(p, capital, chain) {
  var name = p.name;
  switch (categoryGroup(p)) {
    case 'dex':
      return 'Add $' + capital + ' of liquidity to ' + name + '\u2019s highest-volume pair on ' + chain + ', in a narrow range you can manage, and keep the position open.';
    case 'lending':
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow 30% of it against the supply, and repay the borrow before you withdraw.';
    case 'derivatives':
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position, long on one venue and short on another, so the trade itself is the qualifying action.';
    case 'yield':
      return 'Deposit $' + capital + ' into ' + name + '\u2019s highest-yield vault on ' + chain + ' and keep the vault shares for the whole hold period.';
    case 'bridge':
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' in two tranches a week apart, and use the bridged funds inside the destination app each time.';
    case 'receipt':
      return 'Stake $' + capital + ' of the chain\u2019s staking asset through ' + name + ', delegate the receipt to two different operators, and keep the receipt for the whole hold period.';
    case 'rwa':
      return 'Mint $' + capital + ' of ' + name + '\u2019s yield-bearing asset on ' + chain + ' and hold it in the same wallet for the whole hold period.';
    case 'prediction':
      return 'Fund $' + capital + ' on ' + name + ' and take one position in a market that resolves after your hold period ends.';
    case 'insurance':
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a protocol you already use, and keep the policy active.';
    case 'stable':
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and keep it supplied, not idle in the wallet.';
    case 'chain':
      return 'Bridge $' + capital + ' of USDC to ' + name + '\u2019s chain, use its native decentralised exchange for one swap, and keep a small balance staked with a validator.';
    default:
      return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open for the whole hold period.';
  }
}

/** The weekly qualifying action, by the category group the snapshot's own category field gives. */
function weeklyActionFor(p) {
  var name = p.name;
  switch (categoryGroup(p)) {
    case 'dex':
      return 'Rebalance the liquidity position once a week and collect the fees it earned, so every week shows a fresh qualifying action.';
    case 'lending':
      return 'Check the borrow health once a week, top up the supply when the health factor slips, and repay a little of the borrow.';
    case 'derivatives':
      return 'Roll the hedged position once a week, closing the old leg and opening a fresh one, so the position never goes stale.';
    case 'yield':
      return 'Claim the vault rewards once a week and compound them back into the vault, so each week adds a new on-chain action.';
    case 'bridge':
      return 'Bridge one small tranche through ' + name + ' once a week and use the bridged funds inside the destination app each time.';
    case 'receipt':
      return 'Check the receipt balance once a week and delegate the receipt to a second operator when the first one underperforms.';
    case 'rwa':
      return 'Check ' + name + '\u2019s backing report once a week and confirm the yield-bearing asset still matches the assets backing it.';
    case 'prediction':
      return 'Take one small position each week in a market that resolves after the hold period ends, and never chase a losing market.';
    case 'insurance':
      return 'Check the policy stays active once a week and renew the cover before it lapses, so the wallet never shows a gap.';
    case 'stable':
      return 'Add one small deposit to the stable position each week and keep it supplied, not idle in the wallet.';
    case 'chain':
      return 'Make one swap on the chain\u2019s native decentralised exchange each week and top up the validator stake with a small amount.';
    default:
      return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let a week pass with no activity.';
  }
}

/** The second qualifying action: a second chain when the protocol runs on more than one. */
function secondActionFor(p, capital, chain) {
  var name = p.name;
  if (p.chains && p.chains.length > 1) {
    return 'Repeat the same deposit on a second chain ' + name + ' runs on, ' + p.chains[1] + ', with half the capital, so the activity is counted on two chains.';
  }
  return 'Make a second, different qualifying action the same week, such as a swap, a vote or a deposit into a second pool, so the wallet shows more than one kind of activity.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
function farmSteps(p, age) {
  var chain = chainOf(p);
  var capital = capitalFor(p);
  var hold = holdDaysFor(age);
  var name = p.name;
  return [
    { text: 'Open a fresh wallet on ' + chain + ' that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
    { text: secondActionFor(p, capital, chain), cost: 'about $' + (capital >= 150 ? 6 : 3) + ' of gas', time: '15 minutes' },
    { text: weeklyActionFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
    { text: 'Before you withdraw, open ' + name + '\u2019s own points or rewards page and claim only from the link it publishes; then write the wallet, the dates and every transaction in a farm log.', cost: 'no fee to check, and never pay to claim', time: '15 minutes' },
  ].map(stepText);
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\u2019s own page.';
  return s;
}

/** The risk line for a category group, shown beside the farm plan in the detail view. */
function riskFor(p) {
  switch (categoryGroup(p)) {
    case 'dex': return 'Risk: impermanent loss if the pair\u2019s prices move apart while you provide liquidity.';
    case 'lending': return 'Risk: liquidation if the borrowed asset rises against your supply; keep the borrow small.';
    case 'derivatives': return 'Risk: funding and liquidation on leveraged positions; keep the position small and hedged.';
    case 'bridge': return 'Risk: the bridge contract itself; bridge in tranches and never more than you can afford to wait for.';
    case 'receipt': return 'Risk: the receipt token can trade below the staked asset, and unstaking can take days.';
    case 'rwa': return 'Risk: the backing assets are off-chain; the token\u2019s value depends on the issuer, not only the code.';
    default: return 'Risk: smart-contract risk on every position; farm only with funds you can afford to lose.';
  }
}

// Shared with main.ts (Node) and the dashboard (browser): one object, no module system needed.
var RADAR_LOGIC = {
  MODEL: MODEL,
  MODEL_VERSION: MODEL_VERSION,
  finite: finite,
  ageDays: ageDays,
  isPreToken: isPreToken,
  isRankable: isRankable,
  categoryMultiple: categoryMultiple,
  categoryGroup: categoryGroup,
  impliedValue: impliedValue,
  chainOf: chainOf,
  capitalFor: capitalFor,
  holdDaysFor: holdDaysFor,
  farmSteps: farmSteps,
  stepText: stepText,
  riskFor: riskFor,
};
if (typeof module !== 'undefined' && module.exports) module.exports = RADAR_LOGIC;
if (typeof window !== 'undefined') window.RADAR_LOGIC = RADAR_LOGIC;
