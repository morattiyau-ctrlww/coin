/* =========================================================================
   Gold Coin Flip  —  script.js
   RULES (pure, exported for the node tests) + the audio engine + the loop.
   ========================================================================= */
'use strict';

/* ------------------------------- utils ---------------------------------- */
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t){ return a + (b - a) * t; }

/* ============================== RULES ===================================
   Pure: no DOM, no audio. Every function here is exercised by the tests.  */
var RULES = (function(){

  var HISTORY_KEY = 'coin_flips_v2';   /* the old build used coinFlipHistory */
  var LEGACY_KEY  = 'coinFlipHistory';
  var KEEP = 40;                       /* how many flips we remember         */
  var SHOW = 5;                        /* how many the HUD lists             */

  /* An exactly fair bit. A byte has 256 equally likely values, so masking the
     low bit splits them 128/128 with no modulo bias — this is the difference
     between "random" and "fair", and it is why the odds can be shown honestly. */
  function fairBit(){
    if (typeof crypto !== 'undefined' && crypto.getRandomValues){
      return crypto.getRandomValues(new Uint8Array(1))[0] & 1;
    }
    /* no crypto: fall back, and say so rather than pretending */
    return (Math.random() < 0.5) ? 0 : 1;
  }

  /* 1 -> tails, 0 -> heads (the bit is the parity of the half-turn count) */
  function flip(bit){
    var b = (bit === undefined) ? fairBit() : (bit ? 1 : 0);
    return b ? 'tails' : 'heads';
  }

  function emptyStore(){
    return { v: 2, h: [], total: 0, heads: 0, best: 0, streak: 0 };
  }

  /* the old build stored a bare array of {result}; import it so nobody who has
     used the page before loses their history */
  function migrate(stored){
    if (!stored) return emptyStore();
    if (typeof stored === 'string'){
      try { stored = JSON.parse(stored); } catch (e){ return emptyStore(); }
    }
    if (Object.prototype.toString.call(stored) === '[object Array]'){
      var out = emptyStore();
      for (var i = stored.length - 1; i >= 0; i--){
        var r = stored[i] && stored[i].result;
        if (r === 'heads' || r === 'tails') record(out, r);
      }
      return out;
    }
    if (stored && stored.v === 2 && stored.h) return stored;
    return emptyStore();
  }

  /* record a flip. Mutates and returns the store; the tests run it thousands
     of times to check the streak and the cap behave. */
  function record(store, result){
    if (!store || store.v !== 2) store = emptyStore();
    store.h.unshift(result);
    while (store.h.length > KEEP) store.h.pop();
    store.total++;
    if (result === 'heads') store.heads++;
    /* the running streak comes off the front of the history */
    var s = 0;
    for (var i = 0; i < store.h.length && store.h[i] === result; i++) s++;
    store.streak = s;
    if (s > store.best) store.best = s;
    return store;
  }

  /* everything the HUD shows, derived from the store alone */
  function stats(store){
    var h = (store && store.h) || [];
    var total = (store && store.total) || 0;
    var heads = (store && store.heads) || 0;
    return {
      total: total,
      heads: heads,
      tails: total - heads,
      headsPct: total ? heads / total : 0,
      best: (store && store.best) || 0,
      streak: (store && store.streak) || 0,
      list: h.slice(0, SHOW),
      history: h.slice()
    };
  }

  return { HISTORY_KEY: HISTORY_KEY, LEGACY_KEY: LEGACY_KEY,
           KEEP: KEEP, SHOW: SHOW,
           fairBit: fairBit, flip: flip, emptyStore: emptyStore,
           record: record, stats: stats, migrate: migrate };
})();

/* the exports go at the very bottom of this file, once every module exists */

/* ---------------------------- audio engine ------------------------------
   One graph on the end of everything, because a coin landing fires a burst of
   sounds at once (clinks, the spin wash, the reveal) and a pile of raw voices
   straight to the output is how you get clipping:

       voice -> bus gain -> glue compressor -> limiter -> master -> output

   Every noise voice is band-limited and plays off one pre-baked buffer, so
   nothing hisses, and the mix spec is plain data (AUDIO) so the headroom can
   be checked without a browser.                                           */
var AUDIO = {
  master: 0.85,
  limiter: { threshold: -1.5, knee: 0, ratio: 20, attack: 0.003, release: 0.10 },
  glue:    { threshold: -14, knee: 6, ratio: 3, attack: 0.008, release: 0.25 },
  buses:   { sfx: 1.00, room: 0.55, ui: 0.40 },
  /* every voice's own peak: all below 1, and the sum is caught downstream */
  peak: { ting: 0.42, flick: 0.26, thud: 0.30, spin: 0.24, clink: 0.40,
          tick: 0.20, riser: 0.30, swell: 0.22, chimeA: 0.34, chimeB: 0.24,
          chimeC: 0.16, gong: 0.34, room: 0.12, ui: 0.12 },
  hp: 34, lp: 17000,
  noiseBand: { lo: 220, hi: 6000 },
  maxVoices: 24,
  fadeMs: 90
};

var Sound = (function(){
  var ctx = null, on = true, graph = null, voices = 0;
  var whiteBuf = null, pinkBuf = null, roomNode = null, spinWash = null;

  function ac(){
    if (ctx) return ctx;
    /* node has no Web Audio: every voice degrades to a no-op, which is what
       lets the busiest sound paths be tested headlessly */
    if (typeof window === 'undefined') return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function build(){
    if (graph || !ac()) return graph;
    var c = ctx;
    graph = { bus: {} };

    var hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = AUDIO.hp; hp.Q.value = 0.7;
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = AUDIO.lp; lp.Q.value = 0.5;

    var glue = c.createDynamicsCompressor();
    glue.threshold.value = AUDIO.glue.threshold;
    glue.knee.value = AUDIO.glue.knee;
    glue.ratio.value = AUDIO.glue.ratio;
    glue.attack.value = AUDIO.glue.attack;
    glue.release.value = AUDIO.glue.release;

    var lim = c.createDynamicsCompressor();
    lim.threshold.value = AUDIO.limiter.threshold;
    lim.knee.value = AUDIO.limiter.knee;
    lim.ratio.value = AUDIO.limiter.ratio;
    lim.attack.value = AUDIO.limiter.attack;
    lim.release.value = AUDIO.limiter.release;

    var master = c.createGain();
    master.gain.value = on ? AUDIO.master : 0;

    hp.connect(glue); glue.connect(lim); lim.connect(lp); lp.connect(master);
    master.connect(c.destination);
    graph.master = master;

    ['sfx', 'room', 'ui'].forEach(function(name){
      var b = c.createGain();
      b.gain.value = AUDIO.buses[name];
      b.connect(hp);
      graph.bus[name] = b;
    });
    return graph;
  }

  function resume(){ if (ac() && ctx.state === 'suspended') ctx.resume(); }
  function now(){ return ac().currentTime + 0.001; }


  /* ---- noise, baked once: one white buffer for transients, one smoothed
     ("pink-ish") for everything breathy ------------------------------------ */
  function bake(){
    if (whiteBuf || !ac()) return;
    var c = ctx, sr = c.sampleRate, len = Math.floor(sr * 2), i, x, l1 = 0, l2 = 0;
    whiteBuf = c.createBuffer(1, len, sr);
    var w = whiteBuf.getChannelData(0);
    for (i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    pinkBuf = c.createBuffer(1, len, sr);
    var p = pinkBuf.getChannelData(0);
    for (i = 0; i < len; i++){
      x = w[i];
      l1 += (x - l1) * 0.085;
      l2 += (l1 - l2) * 0.085;
      p[i] = Math.max(-1, Math.min(1, l2 * 3.1));
    }
  }

  /* an envelope that starts from silence linearly (no click) and decays
     exponentially (a natural tail) */
  function env(param, t0, peak, atk, dec, dur){
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + atk);
    param.exponentialRampToValueAtTime(Math.max(0.0004, peak * 0.30), t0 + atk + dec);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function track(node){
    voices++;
    node.onended = function(){
      voices--;
      if (voices < 0) voices = 0;
      try { node.disconnect(); } catch (e){}
    };
    return node;
  }

  function live(){ return on && !!ac() && !!build() && voices < AUDIO.maxVoices; }
  function busOf(name){ var b = build(); return b ? b.bus[name || 'sfx'] : null; }

  /* one band-limited noise voice; the centre sweeps down from `hi` to `lo` */
  function noiseVoice(o){
    if (!live()) return null;
    var c = ctx, dest = busOf(o.bus);
    var t0 = now() + (o.delay || 0);
    var src = c.createBufferSource();
    src.buffer = (o.colour === 'pink') ? pinkBuf : whiteBuf;
    var f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q === undefined ? 0.8 : o.q;
    var hi = Math.min(o.hi || 1200, AUDIO.noiseBand.hi);
    var lo = Math.max(o.lo || 400, AUDIO.noiseBand.lo);
    f.frequency.setValueAtTime(hi, t0);
    if (lo !== hi) f.frequency.exponentialRampToValueAtTime(lo, t0 + o.dur * 0.8);
    var vg = c.createGain();
    env(vg.gain, t0, o.peak, o.atk === undefined ? 0.006 : o.atk, o.dur * 0.35, o.dur);
    src.connect(f); f.connect(vg); vg.connect(dest);
    src.start(t0); src.stop(t0 + o.dur + 0.05);
    return track(src);
  }

  /* one filtered tone, with an optional pitch sweep */
  function toneVoice(o){
    if (!live()) return null;
    var c = ctx, dest = busOf(o.bus);
    var t0 = now() + (o.delay || 0);
    var osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t0);
    if (o.to && o.to !== o.from){
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
    }
    var vg = c.createGain();
    env(vg.gain, t0, o.peak, o.atk === undefined ? 0.003 : o.atk, o.dur * 0.3, o.dur);
    var tail = osc;
    if (o.lp){
      var f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 0.6;
      f.frequency.value = Math.min(o.lp, AUDIO.lp);
      osc.connect(f); tail = f;
    }
    tail.connect(vg); vg.connect(dest);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
    return track(osc);
  }


  /* ---- the spin wash: one continuous voice whose filter and level track how
     fast the coin is actually turning, so the sound is driven by the physics */
  function spinStart(){
    if (!on || !ac() || !build() || spinWash) return;
    bake();
    var c = ctx;
    var src = c.createBufferSource();
    src.buffer = pinkBuf; src.loop = true;
    var f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.1; f.frequency.value = 700;
    var g = c.createGain(); g.gain.value = 0.0001;
    src.connect(f); f.connect(g); g.connect(busOf('sfx'));
    src.start();
    spinWash = { src: src, f: f, g: g };
  }
  /* rate01 is the spin speed normalised: 0 at rest, 1 at full tilt */
  function spinSet(rate01, ramp){
    if (!spinWash || !on) return;
    var t0 = now(), u = clamp(rate01 || 0, 0, 1);
    var p = spinWash;
    p.g.gain.cancelScheduledValues(t0);
    p.g.gain.setValueAtTime(Math.max(p.g.gain.value, 0.0001), t0);
    p.g.gain.linearRampToValueAtTime(AUDIO.peak.spin * (0.25 + 0.75 * u), t0 + (ramp || 0.08));
    p.f.frequency.cancelScheduledValues(t0);
    p.f.frequency.setValueAtTime(p.f.frequency.value, t0);
    p.f.frequency.linearRampToValueAtTime(620 + 2100 * u, t0 + (ramp || 0.08));
  }
  function spinStop(){
    if (!spinWash) return;
    var t0 = now();
    spinWash.g.gain.cancelScheduledValues(t0);
    spinWash.g.gain.setValueAtTime(Math.max(spinWash.g.gain.value, 0.0001), t0);
    spinWash.g.gain.linearRampToValueAtTime(0.0001, t0 + 0.12);
    try { spinWash.src.stop(t0 + 0.2); } catch (e){}
    spinWash = null;
  }

  /* ---- the room: a very quiet bed, so silence never sounds like a fault --- */
  function roomStart(){
    if (!on || !ac() || !build() || roomNode) return;
    bake();
    var c = ctx;
    var src = c.createBufferSource();
    src.buffer = pinkBuf; src.loop = true;
    var f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.6;
    var g = c.createGain(); g.gain.value = AUDIO.peak.room;
    src.connect(f); f.connect(g); g.connect(busOf('room'));
    src.start();
    roomNode = { src: src, g: g };
  }



  /* -------------------------- voices ------------------------------------- */

  /* thumb meets metal: a click, a thump and a bright ting, in that order */
  function launch(power){
    var u = clamp(power === undefined ? 1 : power, 0, 1);
    noiseVoice({ hi: 5200 + 1400 * u, lo: 2600, q: 1.4, dur: 0.055,
                 peak: AUDIO.peak.flick * (0.5 + 0.5 * u), atk: 0.001 });
    toneVoice({ type: 'sine', from: 170, to: 62, dur: 0.22,
                peak: AUDIO.peak.thud * (0.5 + 0.5 * u), atk: 0.002 });
    toneVoice({ type: 'triangle', from: 2480, to: 2210, dur: 0.30,
                peak: AUDIO.peak.ting * (0.4 + 0.6 * u), atk: 0.001, lp: 9000 });
    toneVoice({ type: 'sine', from: 3760, to: 3520, dur: 0.16,
                peak: AUDIO.peak.ting * 0.35 * (0.4 + 0.6 * u), atk: 0.001 });
  }

  /* the coin on stone. Brightness and level follow the measured impact speed,
     so a big first bounce rings and the little ones tick. */
  function clink(speed){
    var u = clamp((speed === undefined ? 2 : speed) / 6, 0.08, 1);
    var base = 1750 + 2050 * u;
    var pk = AUDIO.peak.clink * (0.30 + 0.70 * u);
    toneVoice({ type: 'triangle', from: base, to: base * 0.94,
                dur: 0.16 + 0.26 * u, peak: pk, atk: 0.0012, lp: 12000 });
    toneVoice({ type: 'sine', from: base * 1.53, to: base * 1.44,
                dur: 0.10 + 0.16 * u, peak: pk * 0.55, atk: 0.001 });
    toneVoice({ type: 'sine', from: base * 2.07, to: base * 1.95,
                dur: 0.06 + 0.10 * u, peak: pk * 0.30, atk: 0.001 });
    noiseVoice({ hi: 2600 + 3000 * u, lo: 1200 + 1200 * u, q: 1.1,
                 dur: 0.035 + 0.03 * u, peak: pk * 0.45, atk: 0.001 });
  }

  /* the swell under the last half-turn, cut dead on the reveal */
  function riser(dur){
    if (!live()) return null;
    var c = ctx, dest = busOf('sfx'), t0 = now(), d = clamp(dur || 1.1, 0.2, 3);
    var src = c.createBufferSource();
    src.buffer = pinkBuf;
    var f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.0;
    f.frequency.setValueAtTime(320, t0);
    f.frequency.exponentialRampToValueAtTime(AUDIO.noiseBand.hi * 0.75, t0 + d);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(AUDIO.peak.riser, t0 + d * 0.82);
    g.gain.exponentialRampToValueAtTime(AUDIO.peak.riser * 0.6, t0 + d);
    g.gain.linearRampToValueAtTime(0.0001, t0 + d + 0.012);   /* the cut */
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + d + 0.06);
    track(src);

    var osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(760, t0 + d);
    var og = c.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(AUDIO.peak.swell, t0 + d * 0.9);
    og.gain.linearRampToValueAtTime(0.0001, t0 + d + 0.012);
    osc.connect(og); og.connect(dest);
    osc.start(t0); osc.stop(t0 + d + 0.06);
    track(osc);

    return { stop: function(){
      var t1 = now();
      try {
        g.gain.cancelScheduledValues(t1);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t1);
        g.gain.linearRampToValueAtTime(0.0001, t1 + 0.012);
        og.gain.cancelScheduledValues(t1);
        og.gain.setValueAtTime(Math.max(og.gain.value, 0.0001), t1);
        og.gain.linearRampToValueAtTime(0.0001, t1 + 0.012);
        src.stop(t1 + 0.05); osc.stop(t1 + 0.05);
      } catch (e){}
    } };
  }

  /* the verdict: a bright major stack for the crown, a deep gong for the bolt */
  function reveal(result){
    if (result === 'tails'){
      [220, 329.6, 440].forEach(function(f, i){
        toneVoice({ type: i === 0 ? 'sine' : 'triangle', from: f, to: f * 0.992,
                    dur: 1.5 - i * 0.35, peak: AUDIO.peak.gong * (1 - i * 0.25),
                    atk: 0.004, lp: 3800 });
      });
      noiseVoice({ hi: 700, lo: 300, q: 0.7, dur: 0.5,
                   peak: AUDIO.peak.gong * 0.35, atk: 0.004 });
    } else {
      [1046.5, 1568, 2093].forEach(function(f, i){
        toneVoice({ type: 'triangle', from: f, to: f * 0.997,
                    dur: 1.1 - i * 0.22, peak: AUDIO.peak.chimeA * (1 - i * 0.30),
                    atk: 0.002, lp: 12000 });
      });
      toneVoice({ type: 'sine', from: 523.25, to: 521, dur: 0.9,
                  peak: AUDIO.peak.chimeB, atk: 0.003 });
    }
  }

  function uiTick(){ toneVoice({ type: 'sine', from: 1240, to: 1180, dur: 0.05,
                                 peak: AUDIO.peak.ui, atk: 0.001, bus: 'ui' }); }

  /* ----------------------------- control --------------------------------- */
  function set(onNow){
    on = !!onNow;
    if (ac() && build()){
      var t0 = now(), g = graph.master.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(Math.max(g.value, 0.0001), t0);
      g.linearRampToValueAtTime(on ? AUDIO.master : 0.0001,
                                t0 + AUDIO.fadeMs / 1000);   /* ramp, not a snap */
    }
    if (!on) spinStop();
  }
  function wake(){
    if (!on) return;
    resume(); build(); bake(); roomStart();
  }

  return { AUDIO: AUDIO, set: set, enabled: function(){ return on; },
           wake: wake, voices: function(){ return voices; },
           launch: launch, clink: clink, riser: riser, reveal: reveal,
           uiTick: uiTick, spinStart: spinStart, spinSet: spinSet,
           spinStop: spinStop, roomStart: roomStart };
})();

/* =============================== the app ===============================
   The loop, the HUD, the audio wiring and the headless capture driver. None
   of it decides anything: the rules pick the face, WORLD solves the throw,
   and this only plays the result out and reports it honestly.            */
var APP = (function(){
  var S = {
    phase: 'ready',      /* ready | tossing | landed                     */
    toss: null, t: 0, result: '', tossId: 0,
    timeScale: 1, clock: 0, reduce: false, sound: true, mode: '3d',
    capture: null, settledAt: 0, frozen: false, inspect: false
  };
  var renderer = null, store = null, last = 0, running = false;
  var prevY = 0, prevVy = 0, wasAir = false, riser = null, lastSt = null;
  var rng = Math.random;
  var announced = '', errors = [], el = {};

  function $(id){ return document.getElementById(id); }

  function prefersReduce(){
    try {
      return !!(window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e){ return false; }
  }

  /* ------------------------------ storage ------------------------------- */
  function load(){
    try {
      var raw = window.localStorage.getItem(RULES.HISTORY_KEY);
      if (raw) return RULES.migrate(raw);
      /* nobody who used the old build should lose their history */
      var legacy = window.localStorage.getItem(RULES.LEGACY_KEY);
      if (legacy){
        var st = RULES.migrate(legacy);
        save(st);
        return st;
      }
    } catch (e){}
    return RULES.emptyStore();
  }
  function save(st){
    try { window.localStorage.setItem(RULES.HISTORY_KEY, JSON.stringify(st)); }
    catch (e){}
  }

  /* -------------------------------- HUD ---------------------------------- */
  function renderHUD(){
    var s = RULES.stats(store);
    if (el.total) el.total.textContent = s.total;
    if (el.heads) el.heads.textContent = s.heads;
    if (el.tails) el.tails.textContent = s.tails;
    if (el.streak) el.streak.textContent = s.streak;
    if (el.best) el.best.textContent = s.best;
    var pct = s.total ? s.headsPct * 100 : 50;
    if (el.bar) el.bar.style.width = pct.toFixed(1) + '%';
    if (el.capHeads) el.capHeads.textContent = 'crown ' + Math.round(pct) + '%';
    if (el.capTails) el.capTails.textContent = 'bolt ' + Math.round(100 - pct) + '%';
    if (el.split) el.split.setAttribute('aria-label',
      'Crown has come up ' + s.heads + ' times and bolt ' + s.tails +
      ' times, out of ' + s.total + ' flips.');
    if (el.history){
      el.history.innerHTML = '';
      if (!s.list.length){
        var li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No flips yet — this is a fair coin';
        el.history.appendChild(li);
      } else {
        s.list.forEach(function(r){
          var li = document.createElement('li');
          li.className = (r === 'heads') ? 'crown' : 'bolt';
          li.textContent = (r === 'heads') ? 'crown' : 'bolt';
          el.history.appendChild(li);
        });
      }
    }
  }

  function showVerdict(result, stats){
    if (!el.verdict) return;
    var word = (result === 'heads') ? 'crown' : 'bolt';
    var sub = '';
    if (stats.streak > 1) sub = stats.streak + ' in a row';
    else sub = 'flip ' + stats.total;
    el.verdict.innerHTML = '';
    var w = document.createElement('div');
    w.className = 'word'; w.textContent = word;
    var s = document.createElement('div');
    s.className = 'sub'; s.textContent = sub;
    el.verdict.appendChild(w);
    el.verdict.appendChild(s);
    el.verdict.className = 'verdict show ' + (result === 'heads' ? 'crown' : 'bolt');
    announced = word + ', ' + sub;
  }
  function hideVerdict(){
    if (el.verdict) el.verdict.className = 'verdict';
  }


  /* ------------------------------ the flip -------------------------------- */
  function resetRig(){ prevVy = 0; wasAir = false; }

  function flip(){
    if (S.phase === 'tossing') return;
    /* the rules decide first. Everything after this is the throw being solved
       to land on what was already decided. */
    S.result = S.capture ? (rng() < 0.5 ? 'heads' : 'tails') : RULES.flip();
    S.toss = WORLD.toss(S.result, rng);
    S.t = 0;
    S.tossId++;
    S.phase = 'tossing';
    S.settledAt = 0;
    S.timeScale = 1;
    resetRig();
    prevY = WORLD.COIN.thick / 2;
    hideVerdict();

    store = RULES.record(store, S.result);
    save(store);
    renderHUD();

    if (S.sound){
      Sound.wake();
      Sound.launch(WORLD.clamp(S.toss.apex / 1.6, 0.35, 1));
      Sound.spinStart();
      Sound.spinSet(0.6, 0.05);
    }
    if (el.flip) el.flip.disabled = true;
    return S.result;
  }

  /* the spin, as the *screen* sees it: the angular rate times the time scale,
     1 meaning "as fast as this coin ever spins" */
  function spin01(){
    if (!S.toss) return 0;
    var omegaMax = 2 * Math.PI * 8;
    return WORLD.clamp(S.toss.omega * S.timeScale / omegaMax, 0, 1);
  }

  function timeScaleTarget(st){
    if (S.reduce) return 1;
    if (!S.toss) return 1;
    if (st.airborne){
      if (st.phase === 'rise') return 1;
      /* as it comes down it eases into slow motion, so the last half-turn is
         readable. It cannot change the outcome — the toss was solved before
         the coin was ever drawn. */
      return lerp(1, 0.28, WORLD.smoothstep(0.72, 0.05, st.height01));
    }
    var s = S.t - S.toss.airtime;
    return lerp(0.28, 1, WORLD.smoothstep(0.05, 0.85, s));
  }

  /* ------------------------- one simulated step --------------------------
     Everything that animates happens here; the renderers only draw.        */
  function step(dt){
    if (!S.toss){
      S.clock += dt;
      return { st: WORLD.stateAt(0, null), impact: 0, vy: 0 };
    }
    var asc = timeScaleTarget(WORLD.stateAt(S.t, S.toss));
    S.timeScale = asc === 1 ? 1
      : S.timeScale + (asc - S.timeScale) * (1 - Math.exp(-9 * dt));
    var dts = dt * S.timeScale;
    S.t += dts;

    var st = WORLD.stateAt(S.t, S.toss);
    var hit = 0;

    /* impacts, straight off the motion: the speed is dy/dt in simulated time,
       so slow motion changes how it looks and not how hard it hit. */
    var vy = (st.y - prevY) / Math.max(dts, 1e-5);
    if (wasAir && !st.airborne){
      hit = WORLD.clamp(Math.abs(prevVy) / 6, 0.10, 1);
      if (S.sound){
        Sound.clink(Math.abs(prevVy));
        Sound.spinStop();
        riser = Sound.riser(Math.max(0.35, WORLD.TOSS.settleTime * 0.85));
      }
    } else if (!wasAir && !st.airborne && prevVy < -0.05 && vy >= -0.05){
      /* the little hops after it lands */
      hit = WORLD.clamp(Math.abs(prevVy) / 6, 0.06, 0.5);
      if (S.sound) Sound.clink(Math.abs(prevVy));
    } else if (st.airborne && S.sound){
      Sound.spinSet(spin01(), 0.12);
    }

    prevY = st.y; prevVy = vy; wasAir = st.airborne;

    /* the reveal, exactly on the settle */
    if (S.phase === 'tossing' &&
        S.t >= S.toss.airtime + WORLD.TOSS.settleTime){
      S.phase = 'landed';
      if (riser && riser.stop) riser.stop();
      riser = null;
      if (S.sound) Sound.reveal(S.result);
      showVerdict(S.result, RULES.stats(store));
      if (el.flip) el.flip.disabled = false;
      if (el.note) el.note.textContent = 'Tap or press space to throw again.';
    }
    return { st: st, impact: hit, vy: vy };
  }


  /* ------------------------------- the loop ------------------------------ */
  function view(st, hit, vy){
    return { phase: S.phase, st: st, impact: hit, spin01: spin01(),
             vy: vy || 0, clock: S.clock, tossId: S.tossId,
             reduce: S.reduce, result: S.result, inspect: S.inspect };
  }

  function draw(dt, st, hit, vy){
    if (!st) st = WORLD.stateAt(0, null);
    if (renderer) renderer.frame(dt, view(st, hit, vy));
  }

  function tick(now){
    if (!running) return;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    if (S.frozen){
      /* a pinned capture frame is redrawn every rAF without advancing: the
         drawing buffer is not preserved, so one render is not enough for a
         screenshot to find it */
      draw(0, lastSt, 0);
    } else {
      S.clock += dt;
      var r = step(dt);
      lastSt = r.st;
      draw(dt, r.st, r.impact, r.vy);
    }
    if (window.requestAnimationFrame) window.requestAnimationFrame(tick);
  }

  function start(){
    if (running) return;
    running = true;
    last = 0;
    if (window.requestAnimationFrame) window.requestAnimationFrame(tick);
  }
  function stop(){ running = false; }

  /* ========================= the capture driver ==========================
     #cap=idle|flip|slowmo|result|e2e|audio steps the world with a fixed dt and
     pins a frame, so a screenshot is reproducible and the report can be read
     back from #probe without a human looking at it.                       */
  function captureMode(){
    var s = (location.hash || '') + (location.search || '');
    var m = /cap=([a-z0-9-]+)/.exec(s);
    return m ? m[1] : null;
  }

  function report(obj){
    obj.mode = S.mode;
    obj.phase = S.phase;
    obj.result = S.result;
    obj.errors = errors.slice(0, 6);
    obj.title = '';
    try {
      var p = document.getElementById('probe');
      if (p) p.textContent = JSON.stringify(obj);
      window.__coinProbe = obj;
      document.title = 'cap ' + JSON.stringify(obj);
      obj.title = document.title;
    } catch (e){}
    return obj;
  }

  /* run the toss forward at a fixed step; returns the state it stopped on */
  function runFor(seconds, stepSize){
    var dt = stepSize || (1 / 60), n = Math.max(1, Math.round(seconds / dt)), r = null;
    for (var i = 0; i < n; i++){
      S.clock += dt;
      r = step(dt);
      lastSt = r.st;
      draw(dt, r.st, r.impact, r.vy);
    }
    return r;
  }

  /* Advance until the *simulated* clock reaches a target. Wall-clock stepping
     would be wrong here, because slow motion deliberately stretches the sim:
     pinning "0.9 of the airtime" has to mean the world's clock, not the
     browser's. The guard is a hard stop so a capture can never hang. */
  function runUntil(tTarget){
    var dt = 1 / 60, guard = 0, r = null;
    while (S.t < tTarget && guard++ < 40000){
      S.clock += dt;
      r = step(dt);
      lastSt = r.st;
      draw(dt, r.st, r.impact);
    }
    return r;
  }

  /* Ask the renderer to read a pixel back at the coin's own screen position, so
     "is the coin bright and actually in frame" is a number rather than a hope.
     This is the check that caught the relief rendering black on gold. */
  function sampleCoin(){
    if (!renderer || !renderer.sample || !renderer.coinScreen) return;
    var p = renderer.coinScreen();
    if (!p) return;
    /* Sample across the whole face, not just near the middle: the centre of a
       coin that is catching the key light is the *least* representative pixel
       on it, and five clustered points once told me the coin was white when
       most of it was gold. */
    var d = (p.r || 0.05) * 0.62;
    renderer.sample([[p.x, p.y], [p.x - d, p.y], [p.x + d, p.y],
                     [p.x, p.y - d * 0.8], [p.x, p.y + d * 0.8],
                     [p.x - d * 0.5, p.y - d * 0.4]]);
    draw(0, lastSt, 0);
  }

  /* A capture run must be reproducible, or two screenshots of "the same"
     moment differ and nothing can be compared. When a capture mode is active
     the toss uses a seeded generator instead of the crypto bit. */
  function seedRng(seed){
    var t = seed >>> 0;
    return function(){
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function capture(mode){
    S.capture = mode;
    var sm = /seed=(\d+)/.exec((location.hash || '') + (location.search || ''));
    rng = seedRng(sm ? parseInt(sm[1], 10) : 20260101);
    if (mode === 'help'){
      return report({ help: 'idle | flip | slowmo | result | e2e | audio' });
    }
    if (mode === 'audio'){
      /* every voice, and the bus that stops them adding up to a clip */
      var before = Sound.voices();
      Sound.wake();
      Sound.launch(1); Sound.clink(5.4); Sound.clink(1.1); Sound.uiTick();
      Sound.spinStart(); Sound.spinSet(0.9, 0.01);
      var r = Sound.riser(0.4);
      Sound.reveal('heads'); Sound.reveal('tails');
      if (r && r.stop) r.stop();
      Sound.spinStop();
      return report({
        voices: Sound.voices(), before: before, enabled: Sound.enabled(),
        buses: Object.keys(Sound.AUDIO.buses), peakMax: Math.max(
          Sound.AUDIO.peak.ting, Sound.AUDIO.peak.clink, Sound.AUDIO.peak.gong),
        limiter: Sound.AUDIO.limiter.threshold, hp: Sound.AUDIO.hp,
        lp: Sound.AUDIO.lp, maxVoices: Sound.AUDIO.maxVoices, fadeMs: Sound.AUDIO.fadeMs
      });
    }
    if (mode === 'heads' || mode === 'tails'){
      /* the inspector: both faces flat under a straight-down camera, so the
         struck relief can be checked for real. The sample points land on the
         emblem's band and on plain face, so the two can be compared. */
      S.inspect = true;
      S.phase = 'ready';
      lastSt = { t: 0, phase: 'rest', theta: (mode === 'tails') ? Math.PI : 0,
                 yaw: 0, roll: 0, y: WORLD.COIN.thick / 2, height01: 1,
                 airborne: false, settled: true, flat: 1 };
      draw(0, lastSt, 0);
      if (renderer && renderer.sample){
        /* [0.5, 0.61] is the emblem's band, [0.68, 0.5] plain face beside it */
        renderer.sample([[0.5, 0.613], [0.678, 0.5], [0.5, 0.284], [0.5, 0.06]]);
        draw(0, lastSt, 0);
      }
      return report(hud({ inspected: mode,
                          relief: mode === 'heads' ? 'crown' : 'bolt' }));
    }
    if (mode === 'idle'){
      runFor(1.6);
      sampleCoin();
      return report(hud());
    }
    if (mode === 'flip'){
      if (S.phase === 'tossing') runUntil(WORLD.totalTime(S.toss));
      flip();
      runUntil(S.toss.airtime * 0.45);       /* rising, just past the top */
      sampleCoin();
      return report(hud());
    }
    if (mode === 'slowmo'){
      if (S.phase === 'tossing') runUntil(WORLD.totalTime(S.toss));
      flip();
      /* low on the way down, where the slow motion is doing its work */
      runUntil(S.toss.airtime * 0.90);
      sampleCoin();
      return report(hud());
    }
    if (mode === 'result'){
      if (S.phase === 'tossing') runUntil(WORLD.totalTime(S.toss));
      var want = flip();
      runUntil(WORLD.totalTime(S.toss) + 1.6);
      sampleCoin();
      return report(hud());
    }
    if (mode === 'e2e'){
      /* 2000 solves proved against the model, then real rendered tosses checked
         against the face the picture is actually showing */
      var wrongModel = 0, wrongRender = 0, shots = 6;
      for (var k = 0; k < 2000; k++){
        var res = (k % 2) ? 'heads' : 'tails';
        var tt = WORLD.toss(res, Math.random);
        if (WORLD.upFace(WORLD.stateAt(WORLD.totalTime(tt), tt).theta) !== res) wrongModel++;
      }
      for (var j = 0; j < shots; j++){
        if (S.phase === 'tossing') runUntil(WORLD.totalTime(S.toss));
        var res2 = flip();
        runUntil(WORLD.totalTime(S.toss) + 0.9);
        var shown = renderer && renderer.probe ? renderer.probe().upFace3d : '';
        if (shown && shown !== res2) wrongRender++;
      }
      return report(hud({ modelTosses: 2000, modelWrong: wrongModel,
                          renderedTosses: shots, renderedWrong: wrongRender }));
    }
    return report(hud({ unknown: mode })); 
  }

  /* everything worth reading back, in one object */
  function hud(extra){
    var s = RULES.stats(store);
    var o = {
      flips: s.total, crown: s.heads, bolt: s.tails,
      pct: +(s.headsPct * 100).toFixed(1),
      streak: s.streak, best: s.best, last5: s.list.join(','),
      verdict: announced,
      theta: S.toss ? +WORLD.stateAt(S.t, S.toss).theta.toFixed(4) : 0,
      coinY: S.toss ? +WORLD.stateAt(S.t, S.toss).y.toFixed(4) : 0,
      timeScale: +S.timeScale.toFixed(3),
      upModel: S.toss ? WORLD.upFace(WORLD.stateAt(S.t, S.toss).theta) : '',
      upDrawn: renderer && renderer.probe ? renderer.probe().upFace3d : '',
      agree: true
    };
    o.agree = (!S.toss || !o.upDrawn || o.upDrawn === o.upModel) ? true : false;
    if (o.agree === false) o.MISMATCH = o.upModel + ' model vs ' + o.upDrawn + ' drawn';
    var pr = renderer && renderer.probe ? renderer.probe() : {};
    for (var k in pr) if (pr.hasOwnProperty(k)) o['r3_' + k] = pr[k];
    if (renderer && renderer.coinScreen) o.coinScreen = renderer.coinScreen();
    if (window.Renderer3D && window.Renderer3D.error){
      o.r3err = window.Renderer3D.error();
      o.r3dead = window.Renderer3D.isDead();
    }
    if (extra) for (var k2 in extra) if (extra.hasOwnProperty(k2)) o[k2] = extra[k2];
    return o;
  }

  /* ------------------------------ wire-up -------------------------------- */
  function note(txt){ if (el.note) el.note.textContent = txt; }

  function setSound(onNow){
    S.sound = !!onNow;
    Sound.set(S.sound);
    if (S.sound) Sound.wake();
    if (el.sound){
      el.sound.setAttribute('aria-pressed', S.sound ? 'true' : 'false');
      el.sound.textContent = S.sound ? 'Sound on' : 'Sound off';
    }
    try { window.localStorage.setItem('coin_sound', S.sound ? '1' : '0'); } catch (e){}
    if (S.sound) Sound.uiTick();
  }

  function wake(){
    Sound.wake();
    if (S.sound) Sound.roomStart();
  }

  function wire(){
    if (el.flip){
      el.flip.addEventListener('click', function(){ wake(); flip(); });
    }
    if (el.sound){
      el.sound.addEventListener('click', function(){
        setSound(!S.sound);
      });
    }
    var stage = document.getElementById('stage');
    if (stage){
      stage.style.pointerEvents = 'auto';
      stage.addEventListener('pointerdown', function(e){
        e.preventDefault(); wake(); flip();
      });
    }
    window.addEventListener('keydown', function(e){
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter'){
        var t = e.target;
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT')) return;
        e.preventDefault();
        wake(); flip();
      }
    });
    window.addEventListener('resize', function(){
      if (renderer && renderer.resize) renderer.resize();
    });
    window.addEventListener('orientationchange', function(){
      if (renderer && renderer.resize) renderer.resize();
    });
    document.addEventListener('pointerdown', function(){ wake(); }, { once: true });
    /* a browser error must not be a silent white page */
    window.addEventListener('error', function(e){
      errors.push(String((e && e.message) || e));
    });
  }

  function resizeAll(){ if (renderer && renderer.resize) renderer.resize(); }

  function afterReady(cap){
    resizeAll();
    if (S.mode === '2d'){
      note('Running without WebGL: the same toss, drawn flat.');
    }
    if (cap){
      try { capture(cap); }
      catch (e){
        errors.push(String((e && e.message) || e));
        report({ captureFailed: true, message: String((e && e.message) || e) });
      }
      /* hold the pinned frame, but keep redrawing it */
      S.frozen = true;
      start();
      return;
    }
    start();
    note(S.reduce ? 'Reduced motion: the coin still tumbles, without slow motion.'
                  : 'Tap or press space to throw.');
  }

  function init(){
    el = { total: $('stTotal'), heads: $('stHeads'), tails: $('stTails'),
           streak: $('stStreak'), best: $('stBest'), bar: $('barHeads'),
           capHeads: $('capHeads'), capTails: $('capTails'),
           split: $('splitBar'), history: $('history'), verdict: $('verdict'),
           flip: $('flipBtn'), sound: $('soundBtn'), note: $('note') };

    store = load();
    S.reduce = prefersReduce();
    var cap = captureMode();
    if (cap === '2d') cap = null;          /* ?q=2d already forces the fallback */

    try {
      var sv = window.localStorage.getItem('coin_sound');
      if (sv === '0') S.sound = false;
    } catch (e){}
    if (el.sound){
      el.sound.setAttribute('aria-pressed', S.sound ? 'true' : 'false');
      el.sound.textContent = S.sound ? 'Sound on' : 'Sound off';
    }

    renderHUD();
    wire();

    Renderer3D.boot(function(ok){
      if (ok){
        renderer = Renderer3D;
        S.mode = '3d';
        afterReady(cap);
        return;
      }
      /* the flat fallback: same model, same outcome, no WebGL */
      Renderer2D.boot(function(ok2){
        if (ok2){
          renderer = Renderer2D;
          S.mode = '2d';
          afterReady(cap);
        } else {
          document.body.classList.add('failed');
          note('This browser cannot draw the coin: ' + Renderer3D.error());
          report({ failed: true, reason: Renderer3D.error() });
        }
      });
    });
    return true;
  }

  return { init: init, flip: flip, capture: capture, report: report, hud: hud,
           step: step, start: start, stop: stop, state: S,
           sound: setSound,
           isRunning: function(){ return running; } };
})();

/* exports for the node tests; in the browser these names are globals */
if (typeof module !== 'undefined' && module.exports){
  module.exports = { RULES: RULES, AUDIO: AUDIO, Sound: Sound, APP: APP };
}

/* boot the page. Everything above is loadable headlessly, so the tests can
   require this file without a DOM. */
if (typeof window !== 'undefined' && typeof document !== 'undefined'){
  window.COIN = { RULES: RULES, WORLD: window.WORLD, AUDIO: AUDIO, Sound: Sound,
                  APP: APP, Renderer3D: window.Renderer3D,
                  Renderer2D: window.Renderer2D };
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ APP.init(); });
  } else {
    APP.init();
  }
}

