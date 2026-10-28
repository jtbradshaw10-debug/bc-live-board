/*
 * The Birdie Collective — live league leaderboard for the lounge TV.
 *
 * Runs ON simulatorgolftour.com (injected by Fully Kiosk, or pasted into a logged-in browser),
 * so it can read SGT's own leaderboard with the TV's SGT login. It hides SGT's page, draws the
 * Birdie board, re-checks SGT every 60 s, and alternates between this week (live) and the season.
 *
 * Only activates when the address ends in #bclive. Optional extras after it, e.g.
 *   #bclive&event=78792   force a specific SGT event
 *   #bclive&view=week     stay on one view (week | season)
 * Data (teams, colors, SGT usernames): league.json next to this file.
 */
(function () {
  'use strict';
  if (window.__bcLive) return;
  if (!/bclive/i.test(location.hash)) return;
  window.__bcLive = true;

  var SELF = document.currentScript && document.currentScript.src;
  var BASE = SELF ? SELF.replace(/[^/]*(\?.*)?$/, '') : 'https://jtbradshaw10-debug.github.io/bc-live-board/';
  var OPTS = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) OPTS[p[0].toLowerCase()] = decodeURIComponent(p[1] || ''); });

  var W = 1920, H = 1080;
  var LEAGUE = null, WHO = {};
  var state = { event: null, week: null, season: null, error: null, updated: null, view: 'week', seenFinished: {}, fresh: {} };

  // ---------- helpers ----------
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var key = function (s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); };
  var fmt = function (v) { return v === 0 ? 'E' : v > 0 ? '+' + v : String(v); };
  var dot = function () { return [].slice.call(arguments).filter(Boolean).join(' · '); };
  var parse = function (html) { return new DOMParser().parseFromString(html, 'text/html'); };
  var now = function () { return Date.now(); };

  function sgt(path) {
    var url = path + (path.indexOf('?') >= 0 ? '&' : '?') + '_=' + now();
    return fetch(url, { credentials: 'include', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { if (!r.ok) throw new Error('SGT ' + r.status); return r.text(); })
      .then(function (t) { if (/<title>[^<]*\|\s*OB\s*<\/title>/i.test(t)) { var e = new Error('signedout'); e.signedOut = true; throw e; } return t; });
  }

  function teamFor(users) {
    var set = {};
    users.forEach(function (u) { var n = WHO[key(u)]; if (n) set[n] = 1; });
    var ns = Object.keys(set);
    return ns.length === 1 ? LEAGUE.byN[ns[0]] : null;
  }

  function rankBy(rows, val, better) {
    // rows already sorted best-first; adds .pos ("1", "T4", ...)
    rows.forEach(function (r, i) {
      var v = val(r);
      var first = rows.findIndex(function (x) { return val(x) === v; });
      var count = rows.filter(function (x) { return val(x) === v; }).length;
      r.rank = first + 1;
      r.pos = (count > 1 ? 'T' : '') + (first + 1);
    });
    return rows;
  }

  // ---------- data ----------
  function loadEvents() {
    return sgt('/sgt-api/tour/' + LEAGUE.tourId + '/events').then(function (html) {
      var d = parse(html), section = 'active', list = [];
      [].forEach.call(d.querySelectorAll('h2, .event-card'), function (el) {
        if (el.tagName === 'H2') { section = /past/i.test(el.textContent) ? 'past' : 'active'; return; }
        var a = el.querySelector('a[href*="/tournament/"]'); if (!a) return;
        var id = (a.getAttribute('href').match(/tournament\/(\d+)/) || [])[1];
        var title = ((el.querySelector('.text-sgt-white.text-uppercase') || {}).textContent || '').trim();
        var dateTxt = ((el.querySelector('.text-nowrap') || {}).textContent || '').trim();
        var date = new Date(dateTxt + ' 23:59:59');
        var wk = Number((title.match(/week\s*(\d+)/i) || [])[1]) || null;
        var course = title.replace(/^.*?week\s*\d+\s*[-–—:]\s*/i, '').replace(/,\s*[A-Z]{2}$/, '').trim();
        list.push({ id: id, title: title, week: wk, course: course, date: date, past: section === 'past' });
      });
      if (!list.length) throw new Error('No events found on SGT');
      var pick = null;
      if (OPTS.event) pick = list.find(function (e) { return e.id === OPTS.event; });
      if (!pick) {
        var t = new Date(); t.setHours(0, 0, 0, 0);
        var open = list.filter(function (e) { return !e.past && e.date >= t; }).sort(function (a, b) { return a.date - b.date; });
        pick = open[0] || list.filter(function (e) { return e.past || e.date < t; }).sort(function (a, b) { return b.date - a.date; })[0] || list[0];
      }
      pick.final = pick.past || pick.date < new Date();
      state.event = pick;
      return pick;
    });
  }

  function loadWeek(ev) {
    return sgt('/sgt-api/leaderboard/' + ev.id + '/net').then(function (html) {
      var d = parse(html), byTeam = {}, extra = [];
      [].forEach.call(d.querySelectorAll('table.leaderboard-table tbody tr'), function (tr) {
        var users = [].map.call(tr.querySelectorAll('td.player a[href*="/profile/"]'), function (a) { return a.textContent.trim(); }).filter(Boolean);
        if (!users.length) return;
        var toPar = null, thru = null;
        [].forEach.call(tr.cells, function (c) {
          var m = c.textContent.replace(/\s+/g, ' ').trim().match(/^([+-]?\d+|E)\s+\*?(F|\d{1,2})\*?$/i);
          if (m) { toPar = m[1].toUpperCase() === 'E' ? 0 : Number(m[1]); thru = m[2].toUpperCase(); }
        });
        if (toPar === null) {
          var tot = tr.cells[tr.cells.length - 1].textContent.trim().toUpperCase();
          if (/^([+-]?\d+|E)$/.test(tot)) toPar = tot === 'E' ? 0 : Number(tot);
        }
        var playing = /playing/i.test(tr.className) || (thru !== null && thru !== 'F');
        if (toPar === null && !playing) return;
        var row = { users: users, toPar: toPar, thru: thru || (playing ? '' : 'F'), playing: playing };
        var team = teamFor(users);
        if (team) { if (!byTeam[team.n] || (row.toPar !== null && (byTeam[team.n].toPar === null || row.toPar < byTeam[team.n].toPar))) { row.team = team; byTeam[team.n] = row; } }
        else extra.push(row);
      });
      var played = Object.keys(byTeam).map(function (n) { return byTeam[n]; }).concat(extra)
        .filter(function (r) { return r.toPar !== null; })
        .sort(function (a, b) { return a.toPar - b.toPar || (a.playing - b.playing); });
      rankBy(played, function (r) { return r.toPar; });
      var onCourseNoScore = Object.keys(byTeam).map(function (n) { return byTeam[n]; }).concat(extra).filter(function (r) { return r.toPar === null; });
      onCourseNoScore.forEach(function (r) { r.pos = '—'; });
      var waiting = LEAGUE.teams.filter(function (t) { return !byTeam[t.n]; }).map(function (t) { return { team: t, toPar: null, thru: '', pos: '—', waiting: true }; });
      // mark teams that just posted a finished round
      played.forEach(function (r) {
        var k = r.team ? 't' + r.team.n : 'u' + r.users.join('/');
        if (r.thru === 'F' && !r.playing) {
          if (state.seenFinished[ev.id] && !state.seenFinished[ev.id][k]) state.fresh[k] = now();
        }
        r.k = k;
      });
      var fin = {}; played.forEach(function (r) { if (r.thru === 'F' && !r.playing) fin[r.k] = 1; });
      state.seenFinished[ev.id] = fin;
      state.week = { rows: played.concat(onCourseNoScore, waiting), onCourse: played.concat(onCourseNoScore).filter(function (r) { return r.playing; }).length, posted: played.length };
    });
  }

  function loadSeason() {
    return sgt('/sgt-api/tour/' + LEAGUE.tourId + '/standings/net').then(function (txt) {
      var j = JSON.parse(txt), seen = {}, rows = [];
      var through = (j.events || []).reduce(function (m, e) { var w = Number((String(e[1]).match(/week\s*(\d+)/i) || [])[1]) || 0; return Math.max(m, w); }, 0) || (j.events || []).length;
      (j.rows || []).forEach(function (r) {
        var users = r[1] || [], team = teamFor(users);
        if (team && seen[team.n]) return;
        if (team) seen[team.n] = 1;
        rows.push({ team: team, users: users, pts: Number(r[5]) || 0, events: r[6], wins: Number(r[7]) || 0, prev: Number(r[10]) || 0 });
      });
      rows.sort(function (a, b) { return b.pts - a.pts; });
      rankBy(rows, function (r) { return r.pts; });
      rows.forEach(function (r) { r.move = r.prev ? r.prev - r.rank : 0; });
      LEAGUE.teams.forEach(function (t) { if (!seen[t.n]) rows.push({ team: t, pts: null, wins: null, pos: '—', move: 0 }); });
      state.season = { rows: rows, through: through };
    });
  }

  function refresh() {
    return loadEvents()
      .then(function (ev) { return Promise.all([loadWeek(ev), loadSeason()]); })
      .then(function () { state.error = null; state.updated = new Date(); })
      .catch(function (e) { state.error = e && e.signedOut ? 'signedout' : (e && e.message) || 'error'; console.warn('[bclive]', e); })
      .then(render);
  }

  // ---------- view ----------
  var CSS = [
    ':root{--bg:#0E100D;--panel:#141712;--alt:#11140F;--line:#23271F;--bone:#F0F1EC;--brass:#D7BD8B;--muted:#8C9287;--green:#4F584C;--red:#D0695E}',
    'html,body{background:#0E100D!important;margin:0!important;overflow:hidden!important;cursor:none}',
    'body>*:not(#bclive){display:none!important}',
    '#bclive{position:fixed;inset:0;z-index:2147483647;background:var(--bg);overflow:hidden;font-family:"Barlow Condensed",sans-serif;color:var(--bone);-webkit-font-smoothing:antialiased}',
    '#bclive *{box-sizing:border-box;margin:0;padding:0}',
    '#bclive .stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center}',
    '#bclive .lab{font-family:"Zilla Slab",serif;font-style:italic;font-weight:600;text-transform:uppercase;letter-spacing:.24em}',
    '#bclive .title{font-weight:800;text-transform:uppercase;line-height:.86;letter-spacing:.005em;white-space:nowrap}',
    '#bclive .title em{font-style:normal;color:var(--brass)}',
    '#bclive .view{position:absolute;inset:0;padding:40px 64px 30px;display:flex;flex-direction:column;transition:opacity .7s ease}',
    '#bclive .view.off{opacity:0}',
    '#bclive header{display:flex;align-items:center;height:128px;gap:38px}',
    '#bclive header .bc{height:122px}',
    '#bclive header .vr{width:1px;height:100px;background:#2E332B}',
    '#bclive header .t{flex:1;min-width:0}',
    '#bclive header .t .lab{font-size:20px;color:var(--brass);margin-bottom:12px}',
    '#bclive header .title{font-size:96px}',
    '#bclive .wk{display:flex;flex-direction:column;align-items:flex-end;gap:10px}',
    '#bclive .wk .lab{font-size:18px;color:var(--muted);display:flex;align-items:center;gap:12px}',
    '#bclive .wk .num{display:flex;align-items:baseline;gap:10px;line-height:.8}',
    '#bclive .wk .num .w{font-weight:600;font-size:34px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}',
    '#bclive .wk .num b{font-weight:800;font-size:92px}',
    '#bclive .wk .num .of{font-weight:600;font-size:34px;color:var(--muted)}',
    '#bclive .seg{display:flex;gap:6px}#bclive .seg i{display:block;width:30px;height:8px;background:#2A2F27}#bclive .seg i.on{background:var(--brass)}',
    '#bclive .live{display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--red);animation:bcpulse 2s ease-in-out infinite}',
    '#bclive .live.ok{background:var(--brass)}',
    '@keyframes bcpulse{0%,100%{opacity:1}50%{opacity:.25}}',
    '#bclive .rule{height:1px;background:#2E332B;margin:24px 0 10px;position:relative}',
    '#bclive .rule::before{content:"";position:absolute;left:0;top:-1px;width:140px;height:3px;background:var(--brass)}',
    '#bclive main{display:grid;grid-template-columns:1fr 1fr;gap:44px;flex:1;min-height:0}',
    '#bclive .colhead,#bclive .row{display:grid;align-items:center}',
    '#bclive .colhead{height:36px;font-size:16px;color:var(--muted)}',
    '#bclive .colhead .c{text-align:center}#bclive .colhead .r{text-align:right;padding-right:16px}',
    '#bclive .row{height:var(--rh,56px);border-top:1px solid var(--line);position:relative}',
    '#bclive .row:nth-child(even){background:var(--alt)}',
    '#bclive .row .pos{font-weight:700;font-size:32px;text-align:center}',
    '#bclive .row.lead .pos{color:var(--brass)}',
    '#bclive .row .team{display:flex;align-items:center;height:100%;min-width:0;padding-left:4px;gap:20px}',
    '#bclive .row .sw{display:block;flex:none;width:6px;height:34px;border-radius:1px}',
    '#bclive .row .team img{display:block;max-height:calc(36px * var(--k,1));max-width:600px;min-width:0;object-fit:contain;object-position:left center}',
    '#bclive .row .team .nm{font-weight:700;font-size:30px;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#bclive .row .sc{font-weight:700;font-size:40px;text-align:right;padding-right:16px;font-variant-numeric:tabular-nums}',
    '#bclive .row .sc.under{color:var(--brass)}#bclive .row .sc.none{color:#4A5046}',
    '#bclive .row .sc.sm{font-size:30px;font-weight:600;color:var(--muted)}',
    '#bclive .row .thru{font-weight:600;font-size:26px;text-align:center;color:var(--muted);display:flex;align-items:center;justify-content:center;gap:8px;font-variant-numeric:tabular-nums}',
    '#bclive .row .thru.on{color:var(--bone)}',
    '#bclive .row .thru .live{width:9px;height:9px}',
    '#bclive .row.wait .team{opacity:.38}',
    '#bclive .row .mv{font-weight:700;font-size:19px;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '#bclive .row .mv.up{color:var(--brass)}#bclive .row .mv.dn{color:var(--red)}',
    '#bclive .row.fresh::after{content:"";position:absolute;inset:0;border-left:4px solid var(--brass);background:linear-gradient(90deg,rgba(215,189,139,.16),rgba(215,189,139,0) 70%);animation:bcfade 12s ease-out forwards;pointer-events:none}',
    '@keyframes bcfade{0%,60%{opacity:1}100%{opacity:0}}',
    '#bclive .row .new{flex:none;font-family:"Zilla Slab",serif;font-style:italic;font-weight:600;font-size:14px;letter-spacing:.18em;color:var(--bg);background:var(--brass);padding:3px 8px 2px;border-radius:2px}',
    '#bclive .foot{height:34px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;font-size:15px;color:var(--muted)}',
    '#bclive .foot .l,#bclive .foot .r{display:flex;align-items:center;gap:14px}',
    '#bclive .foot img{height:24px}',
    '#bclive .pager{display:flex;gap:8px}#bclive .pager i{display:block;width:44px;height:4px;background:#2A2F27;overflow:hidden}',
    '#bclive .pager i b{display:block;height:100%;width:0;background:var(--brass)}',
    '#bclive .pager i.on b{animation:bcfill var(--dur,30s) linear forwards}',
    '@keyframes bcfill{to{width:100%}}',
    '#bclive .warn{color:var(--red)}',
    '#bclive .msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center}',
    '#bclive .msg img{height:150px}#bclive .msg .title{font-size:84px}#bclive .msg .lab{font-size:22px;color:var(--muted);letter-spacing:.16em;line-height:1.6}'
  ].join('\n');

  var root, stage, views = {};

  function mount() {
    var head = document.head || document.documentElement;
    var pc = document.createElement('link'); pc.rel = 'preconnect'; pc.href = 'https://fonts.gstatic.com'; pc.crossOrigin = ''; head.appendChild(pc);
    var f = document.createElement('link'); f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Zilla+Slab:ital,wght@1,600&display=block';
    head.appendChild(f);
    var st = document.createElement('style'); st.id = 'bclive-css'; st.textContent = CSS; head.appendChild(st);
    root = document.createElement('div'); root.id = 'bclive';
    root.innerHTML = '<div class="stage"><div class="view" data-v="week"></div><div class="view off" data-v="season"></div><div class="msg" style="display:none"></div></div>';
    document.body.appendChild(root);
    stage = root.querySelector('.stage');
    views.week = root.querySelector('[data-v="week"]');
    views.season = root.querySelector('[data-v="season"]');
    views.msg = root.querySelector('.msg');
    fit(); window.addEventListener('resize', fit);
  }

  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  function segs(w) { var h = ''; for (var i = 1; i <= LEAGUE.weeks; i++) h += '<i class="' + (i <= w ? 'on' : '') + '"></i>'; return h; }

  function teamCell(r) {
    var t = r.team;
    var fresh = r.k && state.fresh[r.k] && now() - state.fresh[r.k] < 15 * 60 * 1000;
    if (!t) return '<div class="team"><i class="sw" style="background:#4A5046"></i><span class="nm">' + esc(r.users.join(' / ')) + '</span>' + (fresh ? '<span class="new">New</span>' : '') + '</div>';
    return '<div class="team"><i class="sw" style="background:' + t.color + '"></i><img src="' + BASE + t.logo + '" alt="' + esc(t.name) + '" style="--k:' + (t.rowH || 1) + '">' + (fresh ? '<span class="new">New</span>' : '') + '</div>';
  }

  function header(kicker, title, label, liveDot, week) {
    return '<header><img class="bc" src="' + BASE + 'brand/bc-logo.png" alt="The Birdie Collective"><div class="vr"></div>' +
      '<div class="t"><div class="lab">' + esc(kicker) + '</div><div class="title">' + title + '</div></div>' +
      '<div class="wk"><div class="lab">' + (liveDot ? '<span class="live' + (state.error ? '' : ' ok') + '"></span>' : '') + esc(label) + '</div>' +
      '<div class="num"><span class="w">Week</span><b>' + (week || '–') + '</b><span class="of">/ ' + LEAGUE.weeks + '</span></div><div class="seg">' + segs(week || 0) + '</div></div></header><div class="rule"></div>';
  }

  function split(rows, cols, headHTML, rowFn) {
    var per = Math.ceil(rows.length / 2);
    var rh = Math.max(36, Math.min(56, Math.floor(760 / Math.max(per, 1))));
    var col = function (rs) { return '<section style="--rh:' + rh + 'px"><div class="colhead lab" style="grid-template-columns:' + cols + '">' + headHTML + '</div>' + rs.map(function (r) { return rowFn(r, cols); }).join('') + '</section>'; };
    return '<main>' + col(rows.slice(0, per)) + col(rows.slice(per)) + '</main>';
  }

  function footer(view) {
    var u = state.updated ? state.updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    var status;
    if (state.error === 'signedout') status = '<span class="warn">SGT signed out on this screen</span>';
    else if (state.error) status = '<span class="warn">Reconnecting to SGT…</span>' + (u ? ' · Last update ' + u : '');
    else {
      var oc = state.week && state.week.onCourse;
      status = (view === 'week' && state.event && state.event.final ? 'Final' : 'Live') + (u ? ' · Updated ' + u : '') +
        (view === 'week' && oc ? ' · ' + oc + (oc === 1 ? ' team' : ' teams') + ' on course' : '');
    }
    var pager = OPTS.view ? '' : '<div class="pager"><i class="' + (view === 'week' ? 'on' : '') + '" style="--dur:' + LEAGUE.rotate.weekSeconds + 's"><b></b></i><i class="' + (view === 'season' ? 'on' : '') + '" style="--dur:' + LEAGUE.rotate.seasonSeconds + 's"><b></b></i></div>';
    return '<div class="foot lab"><div class="l"><img src="' + BASE + 'brand/bc-mark.png" alt="">The Birdie Collective</div>' + pager + '<div class="r">' + status + '</div></div>';
  }

  function renderWeek() {
    var ev = state.event, wk = state.week;
    var cols = '66px 1fr 92px 120px';
    var rows = wk ? wk.rows : [];
    var lead = rows.length && rows[0].rank === 1 ? 1 : 0;
    var body = split(rows, cols, '<span class="c">Pos</span><span>Team</span><span class="c">Thru</span><span class="r">Net</span>', function (r) {
      var thru = r.waiting ? '<div class="thru"></div>' : r.playing ? '<div class="thru on"><span class="live ok"></span>' + (r.thru || '') + '</div>' : '<div class="thru">F</div>';
      var sc = r.toPar === null ? '<div class="sc none">—</div>' : '<div class="sc' + (r.toPar < 0 ? ' under' : '') + '">' + fmt(r.toPar) + '</div>';
      var cls = 'row' + (r.rank === 1 && lead ? ' lead' : '') + (r.waiting ? ' wait' : '') + (r.k && state.fresh[r.k] && now() - state.fresh[r.k] < 20000 ? ' fresh' : '');
      return '<div class="' + cls + '" style="grid-template-columns:' + cols + '"><div class="pos">' + r.pos + '</div>' + teamCell(r) + thru + sc + '</div>';
    });
    views.week.innerHTML = header(dot(LEAGUE.season, ev && ev.course), 'Fall Scramble <em>League</em>', ev && ev.final ? 'Final Leaderboard' : 'Live Leaderboard', !(ev && ev.final), ev && ev.week) + body + footer('week');
  }

  function renderSeason() {
    var s = state.season, ev = state.event;
    var cols = '66px 50px 1fr 92px 112px';
    var rows = s ? s.rows : [];
    var body = split(rows, cols, '<span class="c">Pos</span><span></span><span>Team</span><span class="r">Wins</span><span class="r">Pts</span>', function (r) {
      var mv = r.move > 0 ? '<div class="mv up">▲' + r.move + '</div>' : r.move < 0 ? '<div class="mv dn">▼' + (-r.move) + '</div>' : '<div class="mv"></div>';
      var num = function (v, cls) { return '<div class="sc ' + (cls || '') + (v === null ? ' none' : '') + '">' + (v === null ? '—' : v) + '</div>'; };
      return '<div class="row' + (r.rank === 1 ? ' lead' : '') + (r.pts === null ? ' wait' : '') + '" style="grid-template-columns:' + cols + '"><div class="pos">' + r.pos + '</div>' + mv + teamCell(r) + num(r.wins, 'sm') + num(r.pts) + '</div>';
    });
    views.season.innerHTML = header(dot(LEAGUE.season, s && s.through ? 'Through Week ' + s.through : ''), 'Season <em>Standings</em>', 'Net Points', false, ev && ev.week) + body + footer('season');
  }

  function renderMessage(title, lines) {
    views.msg.style.display = 'flex';
    views.week.style.display = views.season.style.display = 'none';
    views.msg.innerHTML = '<img src="' + BASE + 'brand/bc-logo.png" alt=""><div class="title">' + title + '</div><div class="lab">' + lines.map(esc).join('<br>') + '</div>';
  }

  function render() {
    if (!state.week && !state.season) {
      if (state.error === 'signedout') return renderMessage('Sign in to <em>SGT</em>', ['This screen is signed out of Simulator Golf Tour.', 'Sign in at simulatorgolftour.com/login, then reopen the board.']);
      if (state.error) return renderMessage('Leaderboard <em>Loading</em>', ['Can’t reach SGT right now — retrying every minute.']);
      return renderMessage('Leaderboard <em>Loading</em>', ['Pulling the latest scores from SGT…']);
    }
    views.msg.style.display = 'none';
    views.week.style.display = views.season.style.display = '';
    renderWeek(); renderSeason();
    show(state.view, true);
  }

  var rotTimer = null;
  function show(v, keep) {
    state.view = v;
    views.week.classList.toggle('off', v !== 'week');
    views.season.classList.toggle('off', v !== 'season');
    if (keep) return;
    // restart the pager bar animation on the visible view
    var bar = views[v].querySelector('.pager i.on b');
    if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
  }
  function rotate() {
    clearTimeout(rotTimer);
    if (OPTS.view === 'week' || OPTS.view === 'season') { show(OPTS.view); return; }
    var next = state.view === 'week' ? 'season' : 'week';
    if (!state.season || !state.season.rows.length) next = 'week';
    renderWeek(); renderSeason();
    show(next);
    rotTimer = setTimeout(rotate, 1000 * (next === 'week' ? LEAGUE.rotate.weekSeconds : LEAGUE.rotate.seasonSeconds));
  }

  // ---------- boot ----------
  function boot() {
    mount();
    renderMessage('Leaderboard <em>Loading</em>', ['Pulling the latest scores from SGT…']);
    fetch(BASE + 'league.json?_=' + now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (L) {
        LEAGUE = L; LEAGUE.byN = {};
        L.teams.forEach(function (t) { LEAGUE.byN[t.n] = t; (t.sgt || []).forEach(function (u) { WHO[key(u)] = t.n; }); });
        if (OPTS.view === 'week' || OPTS.view === 'season') state.view = OPTS.view;
        return refresh();
      })
      .then(function () {
        setInterval(refresh, 1000 * (LEAGUE.pollSeconds || 60));
        rotTimer = setTimeout(rotate, 1000 * LEAGUE.rotate.weekSeconds);
        // reload every 6 hours to pick up board updates and keep the TV browser fresh
        setTimeout(function () { location.reload(); }, 6 * 3600 * 1000);
      })
      .catch(function (e) {
        console.warn('[bclive]', e);
        renderMessage('Leaderboard <em>Offline</em>', ['Couldn’t load the board files. Retrying in 2 minutes.']);
        setTimeout(function () { location.reload(); }, 120000);
      });
  }

  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
