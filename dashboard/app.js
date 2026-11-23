// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable and sortable table, and a per-protocol detail view with
// the model's own factor breakdown and the protocol's farm plan. No network: every byte it shows
// is in data.js. The scoring arithmetic is window.RADAR_LOGIC (dashboard/logic.js), the same file
// main.ts imports, so the page's numbers and the board's numbers are one computation.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var LOGIC = window.RADAR_LOGIC;
  if (!DATA || !LOGIC) return;

  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, sort: 'implied', dir: -1, tab: 'pre-token', selected: null, shown: 50 };
  var PAGE = 50;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return '×' + n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  var asofEl = document.getElementById('asof');
  var countsEl = document.getElementById('counts');
  var methodEl = document.getElementById('method');
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var watchEl = document.getElementById('watchlist-only');
  var sortEl = document.getElementById('sort');
  var headRow = document.getElementById('headrow');
  var body = document.getElementById('body');
  var emptyEl = document.getElementById('empty');
  var moreBtn = document.getElementById('more');
  var detailEl = document.getElementById('detail');
  var sourceEl = document.getElementById('source-line');

  asofEl.textContent = DATA.as_of;
  countsEl.innerHTML = '<b>' + DATA.board_size + '</b> pre-token protocols ranked &middot; <b>' + DATA.watchlist_size + '</b> on the watchlist &middot; <b>' +
    DATA.early_size + '</b> early finds below the $50M floor &middot; <b>' + DATA.live_size + '</b> already trading, shown apart';
  sourceEl.textContent = 'Snapshot: ' + DATA.source + '. Model ' + DATA.model_version + ', computed from the snapshot alone.';
  methodEl.innerHTML = '<b>How the value is computed.</b> <code>implied = TVL × 0.22 × size damping × growth × age × reach × category</code>. ' +
    'Growth rewards a rising TVL and punishes a falling one harder; age saturates, so running longer with no token keeps adding value but each extra year adds less; ' +
    'reach grows with the log of the chain count, capped; receipt products (bridges, liquid staking) carry a 0.55× discount because a receipt token is not a launch. ' +
    'No name is special-cased. Click any row for its full breakdown and farm plan.';

  // Filter options from the data itself: every category and chain the snapshot carries.
  var cats = {};
  var chains = {};
  DATA.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    (r.chains || []).forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) { catEl.appendChild(el('option', { value: c, text: c })); });
  Object.keys(chains).sort().forEach(function (c) { chainEl.appendChild(el('option', { value: c, text: c })); });

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
  }

  function sortedRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d === null ? 0 : a.change_7d) - (b.change_7d === null ? 0 : b.change_7d);
      else if (key === 'age') d = (a.age_days === null ? -1 : a.age_days) - (b.age_days === null ? -1 : b.age_days);
      else if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      if (d === 0) d = a.rank - b.rank;
      return d * dir;
    });
  }

  var COLUMNS = [
    { key: 'rank', label: 'Rank', sort: 'implied' },
    { key: 'name', label: 'Protocol', sort: 'name' },
    { key: 'category', label: 'Category', sort: null },
    { key: 'chains', label: 'Chains', sort: null },
    { key: 'tvl', label: 'TVL', sort: 'tvl' },
    { key: 'change', label: '7d', sort: 'change' },
    { key: 'age', label: 'No token for', sort: 'age' },
    { key: 'implied', label: 'Implied value', sort: 'implied' },
  ];

  function renderHead() {
    headRow.textContent = '';
    if (state.tab === 'live') {
      ['Protocol', 'Category', 'Chains', 'TVL', 'Market cap', '7d'].forEach(function (label) {
        headRow.appendChild(el('th', { text: label }));
      });
      return;
    }
    COLUMNS.forEach(function (col) {
      var th = el('th', { text: col.label + (state.sort === col.sort && col.sort ? (state.dir < 0 ? ' ↓' : ' ↑') : '') });
      if (col.sort) th.addEventListener('click', function () {
        if (state.sort === col.sort) state.dir = -state.dir;
        else { state.sort = col.sort; state.dir = col.sort === 'name' ? 1 : -1; }
        sortEl.value = state.sort;
        render();
      });
      headRow.appendChild(th);
    });
  }

  function rowCells(r, top) {
    var changeCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
    var badges = '';
    if (r.watchlist) badges += '<span class="pill watch">Watchlist</span>';
    else if (r.tvl_usd < DATA.floor_usd) badges += '<span class="pill early">Early find</span>';
    var cells = [
      el('td', { class: 'rank' + (r.rank <= 3 ? ' top' + r.rank : ''), text: String(r.rank) }),
      el('td', { html: '<span class="name">' + esc(r.name) + '</span>' + badges + '<small>' + esc(r.slug) + ' · records no token</small>' }),
      el('td', { text: r.category || '—' }),
      el('td', { text: String((r.chains || []).length) + ' chain' + ((r.chains || []).length === 1 ? '' : 's') }),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + changeCls, text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', { class: 'num value-cell', html: fmtUsd(r.implied_value_usd) + '<div class="bar"><i style="width:' + Math.max(2, Math.round(100 * r.implied_value_usd / top)) + '%"></i></div>' }),
    ];
    return cells;
  }

  function renderBody() {
    body.textContent = '';
    if (state.tab === 'live') {
      DATA.live.forEach(function (p) {
        var tr = el('tr');
        tr.appendChild(el('td', { html: '<span class="name">' + esc(p.name) + '</span><small>' + esc(p.slug) + ' · token trades</small>' }));
        tr.appendChild(el('td', { text: p.category || '—' }));
        tr.appendChild(el('td', { text: String((p.chains || []).length) + ' chain' + ((p.chains || []).length === 1 ? '' : 's') }));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }));
        tr.appendChild(el('td', { class: 'num ' + (p.change_7d === null ? '' : (p.change_7d >= 0 ? 'up' : 'down')), text: fmtPct(p.change_7d) }));
        body.appendChild(tr);
      });
      emptyEl.hidden = DATA.live.length > 0;
      moreBtn.style.display = 'none';
      return;
    }
    var rows = sortedRows(filteredRows());
    var top = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var shown = rows.slice(0, state.shown);
    shown.forEach(function (r) {
      var tr = el('tr', { 'data-slug': r.slug });
      if (state.selected === r.slug) tr.className = 'selected';
      rowCells(r, top).forEach(function (c) { tr.appendChild(c); });
      tr.addEventListener('click', function () { select(r.slug); });
      body.appendChild(tr);
    });
    emptyEl.hidden = rows.length > 0;
    moreBtn.style.display = rows.length > state.shown ? '' : 'none';
    moreBtn.textContent = 'Show more (' + (rows.length - state.shown) + ' left)';
  }

  function select(slug) {
    state.selected = slug;
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { detailEl.hidden = true; renderBody(); return; }
    var v = LOGIC.impliedValue(r, DATA.as_of);
    var steps = LOGIC.farmSteps(r, r.age_days);
    detailEl.innerHTML = '';
    detailEl.hidden = false;
    detailEl.appendChild(el('h2', { text: '#' + r.rank + ' ' + r.name }));
    detailEl.appendChild(el('p', { class: 'sub', text: (r.category || 'No category') + ' · ' + (r.chains || []).join(', ') + ' · tracked since ' + (r.listed_at || 'unknown date') + ' · records no token' + (r.watchlist ? ' · on the watchlist' : ' · below the watchlist floor') }));
    detailEl.appendChild(el('h3', { text: 'Why this value' }));
    var table = el('table', { class: 'breakdown' });
    var facts = [
      ['Base: TVL ' + fmtUsd(r.tvl_usd) + ' × 0.22 × size damping ' + v.damping.toFixed(3), fmtUsd(v.base)],
      ['Growth: ' + fmtPct(r.change_7d) + ' over 7 days', fmtMult(v.growth_multiplier)],
      ['Time with no token: ' + fmtAge(r.age_days), fmtMult(v.maturity_multiplier)],
      ['Reach: ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's'), fmtMult(v.reach_multiplier)],
      ['Category: ' + (r.category || 'none') + ' (' + v.category_group + ')', fmtMult(v.category_multiplier)],
    ];
    facts.forEach(function (f) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: f[0] }));
      tr.appendChild(el('td', { text: f[1] }));
      table.appendChild(tr);
    });
    var total = el('tr', { class: 'total' });
    total.appendChild(el('td', { text: 'Implied value if it launched at this record' }));
    total.appendChild(el('td', { text: fmtUsd(r.implied_value_usd) }));
    table.appendChild(total);
    detailEl.appendChild(table);
    detailEl.appendChild(el('h3', { text: 'How to farm it' }));
    var ol = el('ol', { class: 'steps' });
    steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    detailEl.appendChild(ol);
    detailEl.appendChild(el('p', { class: 'risk', text: LOGIC.riskFor(r) }));
    detailEl.appendChild(el('div', { class: 'facts', html: '<span>TVL <b>' + fmtUsd(r.tvl_usd) + '</b></span><span>7-day change <b>' + fmtPct(r.change_7d) + '</b></span><span>Age <b>' + fmtAge(r.age_days) + '</b></span><span>Implied <b>' + fmtUsd(r.implied_value_usd) + '</b></span>' }));
    renderBody();
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function render() {
    renderHead();
    renderBody();
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      state.tab = tab.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      render();
    });
  });
  qEl.addEventListener('input', function () { state.q = qEl.value; state.shown = PAGE; renderBody(); });
  catEl.addEventListener('change', function () { state.category = catEl.value; state.shown = PAGE; renderBody(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; state.shown = PAGE; renderBody(); });
  watchEl.addEventListener('change', function () { state.watchlistOnly = watchEl.checked; state.shown = PAGE; renderBody(); });
  sortEl.addEventListener('change', function () {
    state.sort = sortEl.value;
    state.dir = state.sort === 'name' ? 1 : -1;
    render();
  });
  moreBtn.addEventListener('click', function () { state.shown += PAGE; renderBody(); });

  // Screenshot states: ?shot=detail opens the top row's detail view, ?shot=filtered shows one
  // category's board. A hash #p=<slug> opens that protocol.
  var params = new URLSearchParams(window.location.search || '');
  var shot = params.get('shot');
  if (shot === 'filtered') {
    var counts = {};
    DATA.rows.forEach(function (r) { if (r.category) counts[r.category] = (counts[r.category] || 0) + 1; });
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (c) { if (counts[c] > bestN) { bestN = counts[c]; best = c; } });
    if (best) { state.category = best; catEl.value = best; }
  }
  render();
  if (shot === 'detail' && DATA.rows.length) select(DATA.rows[0].slug);
  else {
    var hash = (window.location.hash || '').replace(/^#/, '');
    var hp = new URLSearchParams(hash);
    if (hp.get('p')) select(hp.get('p'));
  }
})();
