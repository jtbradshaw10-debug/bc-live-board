/*
 * The Birdie Collective — live league leaderboard for the lounge TV.
 *
 * Runs ON simulatorgolftour.com (injected by Fully Kiosk, or a bookmark in a logged-in browser),
 * so it can read SGT's own leaderboard with that screen's SGT login. It hides SGT's page, draws the
 * Birdie board, re-checks SGT every 60 s, and alternates between this week (live) and the season.
 *
 * Broadcast touches: rows glide to their new spots, changed scores tick to the new number,
 * a "Just posted" banner runs when a team finishes, and reloads paint instantly from a cache.
 *
 * Only activates when the address has #bclive. Optional extras after it, e.g.
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
  var FIXED = OPTS.view === 'week' || OPTS.view === 'season' ? OPTS.view : null;

  var W = 1920, H = 1080, GAP = 44;
  var CACHE_KEY = 'bclive-cache-v2';
  var LEAGUE = null, LEAGUE_TXT = '', WHO = {};
  var state = { event: null, week: null, season: null, error: null, updated: null, view: FIXED || 'week', finished: null, fresh: {} };

  // ---------- helpers ----------
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var key = function (s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); };
  var fmt = function (v) { return v === 0 ? 'E' : v > 0 ? '+' + v : String(v); };
  var dot = function () { return [].slice.call(arguments).filter(Boolean).join(' · '); };
  var parse = function (html) { return new DOMParser().parseFromString(html, 'text/html'); };
  var now = function () { return Date.now(); };
  var hash = function (s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h + ':' + s.length; };
  var setText = function (el, t) { t = String(t); if (el._t !== t) { el._t = t; el.textContent = t; } };
  var setHTML = function (el, h) { if (el._h !== h) { el._h = h; el.innerHTML = h; } };

  function sgt(path) {
    var url = path + (path.indexOf('?') >= 0 ? '&' : '?') + '_=' + now();
    return fetch(url, { credentials: 'include', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { if (!r.ok) throw new Error('SGT ' + r.status); return r.text(); })
      .then(function (t) { if (/<title>[^<]*\|\s*OB\s*<\/title>/i.test(t)) { var e = new Error('signedout'); e.signedOut = true; throw e; } return t; });
  }

  function setLeague(L, txt) {
    LEAGUE = L; LEAGUE_TXT = txt || JSON.stringify(L); LEAGUE.byN = {}; WHO = {};
    L.teams.forEach(function (t) { LEAGUE.byN[t.n] = t; (t.sgt || []).forEach(function (u) { WHO[key(u)] = t.n; }); });
  }

  function teamFor(users) {
    var set = {};
    users.forEach(function (u) { var n = WHO[key(u)]; if (n) set[n] = 1; });
    var ns = Object.keys(set);
    return ns.length === 1 ? LEAGUE.byN[ns[0]] : null;
  }

  function rankBy(rows, val) {
    rows.forEach(function (r) {
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
          var m = c.textContent.replace(/\s+/g, ' ').trim().match(/^([+-]?\d+|E)(?:\s+(?:THRU\s*)?\*?(F|\d{1,2})\*?|\s*\(\s*(F|\d{1,2})\s*\))$/i);
          if (m) { toPar = m[1].toUpperCase() === 'E' ? 0 : Number(m[1]); thru = (m[2] || m[3]).toUpperCase(); }
        });
        if (toPar === null) {
          var tot = tr.cells[tr.cells.length - 1].textContent.trim().toUpperCase();
          if (/^([+-]?\d+|E)$/.test(tot)) toPar = tot === 'E' ? 0 : Number(tot);
        }
        var playing = /playing|in-progress/i.test(tr.className) || (thru !== null && thru !== 'F');
        if (toPar === null && !playing) return;
        var team = teamFor(users);
        var row = { users: users, toPar: toPar, thru: thru || (playing ? '' : 'F'), playing: playing, team: team || null, k: team ? 't' + team.n : 'u' + key(users.join('/')) };
        if (team) { if (!byTeam[team.n] || (row.toPar !== null && (byTeam[team.n].toPar === null || row.toPar < byTeam[team.n].toPar))) byTeam[team.n] = row; }
        else extra.push(row);
      });
      var all = Object.keys(byTeam).map(function (n) { return byTeam[n]; }).concat(extra);
      var played = all.filter(function (r) { return r.toPar !== null; })
        .sort(function (a, b) { return a.toPar - b.toPar || (a.playing - b.playing) || (a.k < b.k ? -1 : 1); });
      rankBy(played, function (r) { return r.toPar; });
      var noScore = all.filter(function (r) { return r.toPar === null; });
      noScore.forEach(function (r) { r.pos = '—'; r.rank = 0; });
      var waiting = LEAGUE.teams.filter(function (t) { return !byTeam[t.n]; })
        .map(function (t) { return { team: t, k: 't' + t.n, toPar: null, thru: '', pos: '—', rank: 0, waiting: true }; });
      return { eventId: ev.id, rows: played.concat(noScore, waiting), onCourse: all.filter(function (r) { return r.playing; }).length, posted: played.length };
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
        rows.push({ team: team, users: users, k: team ? 't' + team.n : 'u' + key(users.join('/')), pts: Number(r[5]) || 0, wins: Number(r[7]) || 0, prev: Number(r[10]) || 0 });
      });
      rows.sort(function (a, b) { return b.pts - a.pts || (a.k < b.k ? -1 : 1); });
      rankBy(rows, function (r) { return r.pts; });
      rows.forEach(function (r) { r.move = r.prev ? r.prev - r.rank : 0; });
      LEAGUE.teams.forEach(function (t) { if (!seen[t.n]) rows.push({ team: t, k: 't' + t.n, pts: null, wins: null, pos: '—', rank: 0, move: 0, waiting: true }); });
      return { rows: rows, through: through };
    });
  }

  function refresh() {
    return loadEvents()
      .then(function (ev) {
        return Promise.all([loadWeek(ev), loadSeason()]).then(function (res) {
          var wk = res[0], fin = {};
          wk.rows.forEach(function (r) { if (!r.waiting && !r.playing && r.toPar !== null && r.thru === 'F') fin[r.k] = 1; });
          var prev = state.finished && state.finished.eventId === ev.id ? state.finished.keys : null;
          var fresh = [];
          if (prev) wk.rows.forEach(function (r) { if (fin[r.k] && !prev[r.k]) { state.fresh[r.k] = now(); fresh.push(r); } });
          state.finished = { eventId: ev.id, keys: fin };
          state.event = ev; state.week = wk; state.season = res[1];
          state.error = null; state.updated = new Date();
          saveCache();
          return fresh;
        });
      })
      .catch(function (e) { state.error = e && e.signedOut ? 'signedout' : (e && e.message) || 'error'; console.warn('[bclive]', e); return []; })
      .then(function (fresh) { paint(); fresh.slice(0, 4).forEach(announce); });
  }

  // ---------- cache (instant repaint after a reload) ----------
  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: now(), league: LEAGUE_TXT, event: state.event, week: state.week, season: state.season, finished: state.finished, updated: state.updated }));
    } catch (e) { /* storage unavailable: board still works, just repaints from scratch */ }
  }
  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return c && now() - c.t < 24 * 3600 * 1000 ? c : null; } catch (e) { return null; }
  }

  // ---------- view ----------
  var CSS = [
    ':root{--bg:#0E100D;--panel:#141712;--alt:#11140F;--line:#23271F;--bone:#F0F1EC;--brass:#D7BD8B;--muted:#8C9287;--green:#4F584C;--red:#D0695E}',
    'html,body{background:#0E100D!important;margin:0!important;overflow:hidden!important;cursor:none}',
    'body>*:not(#bclive){display:none!important}',
    '#bclive{position:fixed;inset:0;z-index:2147483647;background:var(--bg);overflow:hidden;font-family:"Barlow Condensed",sans-serif;color:var(--bone);-webkit-font-smoothing:antialiased}',
    '#bclive *{box-sizing:border-box;margin:0;padding:0}',
    '#bclive .stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;overflow:hidden}',
    '#bclive .lab{font-family:"Zilla Slab",serif;font-style:italic;font-weight:600;text-transform:uppercase;letter-spacing:.24em}',
    '#bclive .title{font-weight:800;text-transform:uppercase;line-height:.86;letter-spacing:.005em;white-space:nowrap}',
    '#bclive .title em{font-style:normal;color:var(--brass)}',
    '#bclive .view{position:absolute;inset:0;padding:40px 64px 30px;display:flex;flex-direction:column;transition:opacity .8s ease}',
    '#bclive .view.off{opacity:0;pointer-events:none}',
    '#bclive header{display:flex;align-items:center;height:128px;gap:38px;flex:none}',
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
    '#bclive .seg{display:flex;gap:6px}#bclive .seg i{display:block;width:30px;height:8px;background:#2A2F27;transition:background .6s}#bclive .seg i.on{background:var(--brass)}',
    '#bclive .live{display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--red);animation:bcpulse 2s ease-in-out infinite}',
    '#bclive .live.ok{background:var(--brass)}#bclive .live.hide{display:none}',
    '@keyframes bcpulse{0%,100%{opacity:1}50%{opacity:.25}}',
    '#bclive .rule{height:1px;background:#2E332B;margin:24px 0 10px;position:relative;flex:none}',
    '#bclive .rule::before{content:"";position:absolute;left:0;top:-1px;width:140px;height:3px;background:var(--brass)}',
    '#bclive main{flex:1;min-height:0;display:flex;flex-direction:column}',
    '#bclive .heads{display:grid;grid-template-columns:1fr 1fr;gap:' + GAP + 'px;flex:none}',
    '#bclive .colhead,#bclive .row{display:grid;align-items:center}',
    '#bclive .colhead{height:36px;font-size:16px;color:var(--muted)}',
    '#bclive .colhead .c{text-align:center}#bclive .colhead .r{text-align:right;padding-right:16px}',
    '#bclive .rows{position:relative;flex:1;min-height:0}',
    '#bclive .row{position:absolute;left:0;top:0;border-top:1px solid var(--line);will-change:transform;transition:transform 1.1s cubic-bezier(.22,.9,.24,1),opacity .6s ease,background-color .6s ease}',
    '#bclive .row.alt{background:var(--alt)}',
    '#bclive .row.moving{z-index:2;background:#181C16}',
    '#bclive .row .pos{font-weight:700;font-size:32px;text-align:center;transition:color .6s}',
    '#bclive .row.lead .pos{color:var(--brass)}',
    '#bclive .row .team{display:flex;align-items:center;height:100%;min-width:0;padding-left:4px;gap:20px}',
    '#bclive .row .sw{display:block;flex:none;width:6px;height:34px;border-radius:1px}',
    '#bclive .row .team img{display:block;max-height:calc(36px * var(--k,1));max-width:600px;min-width:0;object-fit:contain;object-position:left center}',
    '#bclive .row .team .nm{font-weight:700;font-size:30px;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#bclive .row .sc{font-weight:700;font-size:40px;text-align:right;padding-right:16px;font-variant-numeric:tabular-nums;transition:color .6s}',
    '#bclive .row .sc span{display:inline-block;transform-origin:right center}',
    '#bclive .row .sc.under{color:var(--brass)}#bclive .row .sc.none{color:#4A5046}',
    '#bclive .row .sc.sm{font-size:30px;font-weight:600;color:var(--muted)}',
    '#bclive .row .sc.bump span{animation:bcbump 1.8s ease-out}',
    '@keyframes bcbump{0%{transform:scale(1.22);color:var(--brass)}35%{transform:scale(1.22);color:var(--brass)}100%{transform:scale(1)}}',
    '#bclive .row .thru{font-weight:600;font-size:26px;text-align:center;color:var(--muted);display:flex;align-items:center;justify-content:center;gap:8px;font-variant-numeric:tabular-nums}',
    '#bclive .row.playing .thru{color:var(--bone)}',
    '#bclive .row .thru .live{width:9px;height:9px}',
    '#bclive .row.wait .team,#bclive .row.wait .pos{opacity:.38;transition:opacity .8s}',
    '#bclive .row .mv{font-weight:700;font-size:19px;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '#bclive .row .mv.up{color:var(--brass)}#bclive .row .mv.dn{color:var(--red)}',
    '#bclive .row.flash::after{content:"";position:absolute;inset:0;border-left:4px solid var(--brass);background:linear-gradient(90deg,rgba(215,189,139,.18),rgba(215,189,139,0) 70%);animation:bcfade 12s ease-out forwards;pointer-events:none}',
    '@keyframes bcfade{0%,55%{opacity:1}100%{opacity:0}}',
    '#bclive .row .new{display:none;flex:none;font-family:"Zilla Slab",serif;font-style:italic;font-weight:600;font-size:14px;letter-spacing:.18em;color:var(--bg);background:var(--brass);padding:3px 8px 2px;border-radius:2px}',
    '#bclive .row.isnew .new{display:inline-block}',
    '#bclive .foot{height:34px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;font-size:15px;color:var(--muted);flex:none}',
    '#bclive .foot .l,#bclive .foot .r{display:flex;align-items:center;gap:14px;flex:1}',
    '#bclive .foot .r{justify-content:flex-end}',
    '#bclive .foot img{height:24px}',
    '#bclive .pager{display:flex;gap:8px}#bclive .pager i{display:block;width:44px;height:4px;background:#2A2F27;overflow:hidden}',
    '#bclive .pager i b{display:block;height:100%;width:0;background:var(--brass)}',
    '#bclive .pager i.done b{width:100%}',
    '#bclive .pager i.on b{animation:bcfill var(--dur,30s) linear forwards}',
    '@keyframes bcfill{from{width:0}to{width:100%}}',
    '#bclive .warn{color:var(--red)}',
    '#bclive .banner{position:absolute;left:50%;bottom:96px;z-index:4;min-width:880px;max-width:1500px;transform:translate(-50%,160%);opacity:0;transition:transform .9s cubic-bezier(.22,.9,.24,1),opacity .6s ease;background:#151913;border-top:3px solid var(--brass);box-shadow:0 24px 60px rgba(0,0,0,.55);padding:20px 40px 22px;display:flex;align-items:center;gap:34px}',
    '#bclive .banner.show{transform:translate(-50%,0);opacity:1}',
    '#bclive .banner .bl{font-size:18px;color:var(--brass);white-space:nowrap;line-height:1.25}',
    '#bclive .banner .bl small{display:block;font-size:14px;color:var(--muted);letter-spacing:.2em}',
    '#bclive .banner .bt{display:flex;align-items:center;gap:20px;flex:1;min-width:0}',
    '#bclive .banner .bt img{max-height:calc(48px * var(--k,1));max-width:720px}',
    '#bclive .banner .bt .nm{font-weight:700;font-size:40px;text-transform:uppercase}',
    '#bclive .banner .sw{display:block;flex:none;width:7px;height:46px;border-radius:1px}',
    '#bclive .banner .bs{font-weight:800;font-size:76px;line-height:.9;font-variant-numeric:tabular-nums}',
    '#bclive .banner .bs.under{color:var(--brass)}',
    '#bclive .banner .bp{font-size:18px;color:var(--muted);text-align:right;line-height:1.3}',
    '#bclive .banner .bp b{display:block;font-family:"Barlow Condensed",sans-serif;font-style:normal;font-weight:800;font-size:44px;letter-spacing:.02em;color:var(--bone)}',
    '#bclive .msg{position:absolute;inset:0;z-index:5;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;transition:opacity .7s ease}',
    '#bclive .msg.off{opacity:0;pointer-events:none}',
    '#bclive .msg img{height:150px}#bclive .msg .title{font-size:84px}#bclive .msg .lab{font-size:22px;color:var(--muted);letter-spacing:.16em;line-height:1.6}'
  ].join('\n');

  var root, stage, views = {}, banner;

  function viewHTML(v) {
    return '<header><img class="bc" src="' + BASE + 'brand/bc-logo.png" alt="The Birdie Collective"><div class="vr"></div>' +
      '<div class="t"><div class="lab kick"></div><div class="title ttl"></div></div>' +
      '<div class="wk"><div class="lab"><span class="live hide"></span><span class="lbl"></span></div>' +
      '<div class="num"><span class="w">Week</span><b class="wn">–</b><span class="of"></span></div><div class="seg"></div></div></header>' +
      '<div class="rule"></div><main><div class="heads"><div class="colhead lab"></div><div class="colhead lab"></div></div><div class="rows"></div></main>' +
      '<div class="foot lab"><div class="l"><img src="' + BASE + 'brand/bc-mark.png" alt="">The Birdie Collective</div>' +
      (FIXED ? '' : '<div class="pager"><i data-p="week" style="--dur:30s"><b></b></i><i data-p="season" style="--dur:15s"><b></b></i></div>') +
      '<div class="r st"></div></div>';
  }

  function mount() {
    var head = document.head || document.documentElement;
    var pc = document.createElement('link'); pc.rel = 'preconnect'; pc.href = 'https://fonts.gstatic.com'; pc.crossOrigin = ''; head.appendChild(pc);
    var f = document.createElement('link'); f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Zilla+Slab:ital,wght@1,600&display=block';
    head.appendChild(f);
    var st = document.createElement('style'); st.id = 'bclive-css'; st.textContent = CSS; head.appendChild(st);
    root = document.createElement('div'); root.id = 'bclive';
    root.innerHTML = '<div class="stage"><div class="view" data-v="week">' + viewHTML('week') + '</div><div class="view off" data-v="season">' + viewHTML('season') + '</div>' +
      '<div class="banner"></div><div class="msg"></div></div>';
    document.body.appendChild(root);
    stage = root.querySelector('.stage');
    ['week', 'season'].forEach(function (v) {
      var el = root.querySelector('[data-v="' + v + '"]');
      views[v] = { el: el, q: function (s) { return el.querySelector(s); }, rows: el.querySelector('.rows'), els: {} };
    });
    views.msg = root.querySelector('.msg');
    banner = root.querySelector('.banner');
    fit(); window.addEventListener('resize', fit);
  }

  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  function message(title, lines) {
    views.msg.classList.remove('off');
    setHTML(views.msg, '<img src="' + BASE + 'brand/bc-logo.png" alt=""><div class="title">' + title + '</div><div class="lab">' + lines.map(esc).join('<br>') + '</div>');
  }

  function segs(w) { var h = ''; for (var i = 1; i <= LEAGUE.weeks; i++) h += '<i class="' + (i <= w ? 'on' : '') + '"></i>'; return h; }

  function teamHTML(r, bannerSize) {
    var t = r.team;
    if (!t) return '<i class="sw" style="background:#4A5046"></i><span class="nm">' + esc(r.users.join(' / ')) + '</span>';
    return '<i class="sw" style="background:' + t.color + '"></i><img src="' + BASE + t.logo + '" alt="' + esc(t.name) + '" style="--k:' + (t.rowH || 1) + '">';
  }

  // number tween: ticks from the old value to the new one
  function tween(el, span, v, show) {
    var old = el._v; el._v = v;
    if (v === null) { clearInterval(el._ti); span.textContent = '—'; return; }
    if (old === undefined || old === null || old === v || !el._live) { span.textContent = show(v); return; }
    clearInterval(el._ti);
    var steps = Math.min(Math.abs(v - old), 12), i = 0, from = old;
    var sc = span.parentNode; sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
    el._ti = setInterval(function () {
      i++; var cur = i >= steps ? v : Math.round(from + (v - from) * i / steps);
      span.textContent = show(cur);
      if (i >= steps) clearInterval(el._ti);
    }, 120);
  }

  function buildRow(mode, r) {
    var el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = mode === 'week'
      ? '<div class="pos"></div><div class="team">' + teamHTML(r) + '<span class="new">New</span></div><div class="thru"></div><div class="sc"><span></span></div>'
      : '<div class="pos"></div><div class="mv"></div><div class="team">' + teamHTML(r) + '</div><div class="sc sm"><span></span></div><div class="sc pts"><span></span></div>';
    el.q = { pos: el.querySelector('.pos'), thru: el.querySelector('.thru'), mv: el.querySelector('.mv'), sc: el.querySelectorAll('.sc span') };
    return el;
  }

  function updateRow(mode, el, r) {
    setText(el.q.pos, r.pos);
    el.classList.toggle('lead', r.rank === 1);
    el.classList.toggle('wait', !!r.waiting);
    if (mode === 'week') {
      el.classList.toggle('playing', !!r.playing);
      el.classList.toggle('isnew', !!(state.fresh[r.k] && now() - state.fresh[r.k] < 15 * 60 * 1000));
      setHTML(el.q.thru, r.waiting ? '' : r.playing ? '<span class="live ok"></span>' + esc(r.thru || '') : 'F');
      var sc = el.q.sc[0];
      sc.parentNode.classList.toggle('none', r.toPar === null);
      sc.parentNode.classList.toggle('under', r.toPar !== null && r.toPar < 0);
      tween(el, sc, r.toPar, fmt);
    } else {
      setHTML(el.q.mv, r.move > 0 ? '▲' + r.move : r.move < 0 ? '▼' + (-r.move) : '');
      el.q.mv.className = 'mv' + (r.move > 0 ? ' up' : r.move < 0 ? ' dn' : '');
      el.q.sc[0].textContent = r.wins === null || r.wins === undefined ? '—' : r.wins;
      el.q.sc[1].parentNode.classList.toggle('none', r.pts === null);
      tween(el, el.q.sc[1], r.pts, String);
    }
  }

  // places each row by position; rows that change spots glide there
  function layout(view, mode, rows, cols) {
    var box = view.rows, els = view.els, keep = {};
    var per = Math.max(1, Math.ceil(rows.length / 2));
    var rh = Math.max(36, Math.min(56, Math.floor((box.clientHeight || 769) / per)));
    var colW = Math.floor(((box.clientWidth || 1792) - GAP) / 2);
    rows.forEach(function (r, i) {
      var col = i < per ? 0 : 1, idx = col ? i - per : i;
      var t = 'translate(' + (col * (colW + GAP)) + 'px,' + (idx * rh) + 'px)';
      var el = els[r.k], isNew = !el;
      if (isNew) {
        el = els[r.k] = buildRow(mode, r);
        el.style.transition = 'none'; el.style.opacity = '0';
        box.appendChild(el);
      } else if (el._tf !== t) {
        el.classList.add('moving');
        clearTimeout(el._mt); el._mt = setTimeout(function () { el.classList.remove('moving'); }, 1150);
      }
      el.style.width = colW + 'px'; el.style.height = rh + 'px'; el.style.gridTemplateColumns = cols;
      if (el._tf !== t) { el._tf = t; el.style.transform = t; }
      el.classList.toggle('alt', idx % 2 === 1);
      updateRow(mode, el, r);
      if (isNew) { void el.offsetWidth; el.style.transition = ''; el.style.opacity = '1'; }
      el._live = true;
      keep[r.k] = 1;
    });
    Object.keys(els).forEach(function (k) {
      if (keep[k]) return;
      var e = els[k]; delete els[k];
      e.style.opacity = '0'; setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 700);
    });
  }

  function paintHeader(v, kicker, title, label, liveDot, week) {
    var q = views[v].q;
    setText(q('.kick'), kicker);
    setHTML(q('.ttl'), title);
    setText(q('.lbl'), label);
    q('.live').className = 'live' + (liveDot ? (state.error ? '' : ' ok') : ' hide');
    setText(q('.wn'), week || '–');
    setText(q('.of'), '/ ' + LEAGUE.weeks);
    setHTML(q('.seg'), segs(week || 0));
  }

  function footerStatus(v) {
    var u = state.updated ? new Date(state.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    if (state.error === 'signedout') return '<span class="warn">SGT signed out on this screen</span>';
    if (state.error) return '<span class="warn">Reconnecting to SGT…</span>' + (u ? ' · Last update ' + esc(u) : '');
    var oc = state.week && state.week.onCourse;
    return (v === 'week' && state.event && state.event.final ? 'Final' : 'Live') + (u ? ' · Updated ' + esc(u) : '') +
      (v === 'week' && oc ? ' · ' + oc + (oc === 1 ? ' team' : ' teams') + ' on course' : '');
  }

  function paint() {
    if (!state.week && !state.season) {
      if (state.error === 'signedout') return message('Sign in to <em>SGT</em>', ['This screen is signed out of Simulator Golf Tour.', 'Sign in at simulatorgolftour.com/login, then reopen the board.']);
      if (state.error) return message('Leaderboard <em>Loading</em>', ['Can’t reach SGT right now — retrying every minute.', '(' + state.error + ')']);
      return message('Leaderboard <em>Loading</em>', ['Pulling the latest scores from SGT…']);
    }
    var ev = state.event || {}, wk = state.week, se = state.season;
    var final = !!ev.final;
    paintHeader('week', dot(LEAGUE.season, ev.course), 'Fall Scramble <em>League</em>', final ? 'Final Leaderboard' : 'Live Leaderboard', !final, ev.week);
    var wc = '66px 1fr 92px 120px', wh = '<span class="c">Pos</span><span>Team</span><span class="c">Thru</span><span class="r">Net</span>';
    [].forEach.call(views.week.el.querySelectorAll('.colhead'), function (h) { h.style.gridTemplateColumns = wc; setHTML(h, wh); });
    if (wk) layout(views.week, 'week', wk.rows, wc);
    setHTML(views.week.q('.st'), footerStatus('week'));

    paintHeader('season', dot(LEAGUE.season, se && se.through ? 'Through Week ' + se.through : ''), 'Season <em>Standings</em>', 'Net Points', false, ev.week);
    var sc = '66px 50px 1fr 92px 112px', sh = '<span class="c">Pos</span><span></span><span>Team</span><span class="r">Wins</span><span class="r">Pts</span>';
    [].forEach.call(views.season.el.querySelectorAll('.colhead'), function (h) { h.style.gridTemplateColumns = sc; setHTML(h, sh); });
    if (se) layout(views.season, 'season', se.rows, sc);
    setHTML(views.season.q('.st'), footerStatus('season'));

    views.msg.classList.add('off');
  }

  // ---------- rotation + banner ----------
  var rotTimer = null, showing = false, queue = [];

  function show(v) {
    state.view = v;
    views.week.el.classList.toggle('off', v !== 'week');
    views.season.el.classList.toggle('off', v !== 'season');
    if (FIXED) return;
    var dur = { week: LEAGUE.rotate.weekSeconds, season: LEAGUE.rotate.seasonSeconds };
    [views.week, views.season].forEach(function (vw) {
      [].forEach.call(vw.el.querySelectorAll('.pager i'), function (i) {
        var p = i.getAttribute('data-p');
        i.style.setProperty('--dur', dur[p] + 's');
        i.classList.toggle('done', v === 'season' && p === 'week');
        var b = i.firstChild; i.classList.remove('on'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
        if (p === v) i.classList.add('on');
      });
    });
  }
  function schedule(sec) { clearTimeout(rotTimer); rotTimer = setTimeout(rotate, sec * 1000); }
  function rotate() {
    if (showing || FIXED) return;
    var next = state.view === 'week' && state.season && state.season.rows.length ? 'season' : 'week';
    show(next);
    schedule(next === 'week' ? LEAGUE.rotate.weekSeconds : LEAGUE.rotate.seasonSeconds);
  }

  function announce(r) { queue.push(r); if (!showing) nextBanner(); }
  function nextBanner() {
    var r = queue.shift();
    if (!r) { showing = false; if (!FIXED) { show('week'); schedule(LEAGUE.rotate.weekSeconds); } return; }
    showing = true;
    clearTimeout(rotTimer);
    if (state.view !== 'week') show('week');
    var live = (state.week && state.week.rows.find(function (x) { return x.k === r.k; })) || r;
    var t = live.team;
    banner.innerHTML = '<div class="bl lab">Just posted<small>' + esc(state.event && state.event.course || 'Round complete') + '</small></div>' +
      '<div class="bt">' + (t ? '<i class="sw" style="background:' + t.color + '"></i><img src="' + BASE + t.logo + '" alt="' + esc(t.name) + '" style="--k:' + (t.rowH || 1) + '">' : '<span class="nm">' + esc((live.users || []).join(' / ')) + '</span>') + '</div>' +
      '<div class="bs' + (live.toPar < 0 ? ' under' : '') + '">' + fmt(live.toPar) + '</div>' +
      '<div class="bp lab">Position<b>' + esc(live.pos) + '</b></div>';
    var row = views.week.els[r.k];
    if (row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); clearTimeout(row._ft); row._ft = setTimeout(function () { row.classList.remove('flash'); }, 12500); }
    setTimeout(function () { banner.classList.add('show'); }, 900);
    setTimeout(function () { banner.classList.remove('show'); setTimeout(nextBanner, 1000); }, 9000);
  }

  // ---------- updates without a visible reload ----------
  var codeHash = null;
  function checkForUpdates() {
    fetch(BASE + 'board.js?_=' + now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; }).then(function (t) {
      if (!t) return;
      var h = hash(t);
      if (codeHash === null) codeHash = h;
      else if (h !== codeHash && !showing) { saveCache(); location.reload(); }
    }).catch(function () {});
    fetch(BASE + 'league.json?_=' + now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; }).then(function (t) {
      if (t && t !== LEAGUE_TXT) { setLeague(JSON.parse(t), t); refresh(); }
    }).catch(function () {});
  }
  function nightlyReload() {
    var n = new Date(), at = new Date(n); at.setHours(4, 10, 0, 0); if (at <= n) at.setDate(at.getDate() + 1);
    setTimeout(function () { saveCache(); location.reload(); }, at - n);
  }

  // ---------- boot ----------
  function start() {
    if (OPTS.debug) window.__bclive = { refresh: refresh, state: state, show: show };
    if (FIXED) show(FIXED); else { show('week'); schedule(LEAGUE.rotate.weekSeconds); }
    setInterval(refresh, 1000 * (LEAGUE.pollSeconds || 60));
    setInterval(function () { if (state.week || state.season) paint(); }, 60 * 1000 + 7000); // keeps NEW tags honest between polls
    checkForUpdates(); setInterval(checkForUpdates, 20 * 60 * 1000);
    nightlyReload();
  }

  function boot() {
    mount();
    if (!/(^|\.)simulatorgolftour\.com$/i.test(location.hostname)) {
      // the board needs SGT's own site (and its login) to read scores — send the viewer there
      message('Open on <em>SGT</em>', ['The board runs on the SGT site with your SGT login.', 'Taking you there now — then click BC Live Board again.']);
      setTimeout(function () { location.href = 'https://simulatorgolftour.com/tour/3766#bclive'; }, 3500);
      return;
    }
    var c = readCache(), started = false;
    if (c && c.league) {
      // paint the last known board immediately, then refresh from SGT
      try {
        setLeague(JSON.parse(c.league), c.league);
        state.event = c.event; state.week = c.week; state.season = c.season; state.finished = c.finished; state.updated = c.updated;
        paint(); start(); started = true;
      } catch (e) { started = false; }
    }
    if (!started) message('Leaderboard <em>Loading</em>', ['Pulling the latest scores from SGT…']);
    fetch(BASE + 'league.json?_=' + now(), { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        if (t !== LEAGUE_TXT) setLeague(JSON.parse(t), t);
        return refresh();
      })
      .then(function () { if (!started) start(); })
      .catch(function (e) {
        console.warn('[bclive]', e);
        if (started) return;
        message('Leaderboard <em>Offline</em>', ['Couldn’t load the board files. Retrying in 2 minutes.']);
        setTimeout(function () { location.reload(); }, 120000);
      });
  }

  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
