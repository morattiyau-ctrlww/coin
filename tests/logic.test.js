/* =========================================================================
   Gold Coin Flip  —  tests/logic.test.js
   Headless, no browser, no three.js:  node tests/logic.test.js

   The claim this project makes is that the coin is not animated to a result —
   it is *thrown* so that it lands on one. That is a testable claim, and this
   file is the test. If the maths is wrong the picture lies, and no screenshot
   would ever tell you.
   ========================================================================= */
'use strict';

var path = require('path');
var W = require(path.join(__dirname, '..', 'world.js'));
var S = require(path.join(__dirname, '..', 'script.js'));
var RULES = S.RULES, AUDIO = S.AUDIO, Sound = S.Sound;

var pass = 0, fail = 0, group = '';
var failures = [];

function ok(cond, what, detail){
  if (cond){ pass++; return true; }
  fail++;
  failures.push(group + ' :: ' + what + (detail ? ('  [' + detail + ']') : ''));
  return false;
}
function near(a, b, tol, what){
  var d = Math.abs(a - b);
  return ok(d <= tol, what, 'got ' + a + ', expected ' + b + ' +-' + tol);
}
function section(name){ group = name; console.log('\n' + name); }
function done(){
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' checks passed, ' +
              fail + ' failed');
  if (fail){
    failures.forEach(function(f){ console.log('  x ' + f); });
    process.exit(1);
  }
  process.exit(0);
}

section('1. the toss lands on the face the rules decided');
{
  var wrong = 0, notFlat = 0, N = 20000, worstFlat = 1;
  for (var i = 0; i < N; i++){
    var result = (i % 2) ? 'heads' : 'tails';
    var t = W.toss(result, Math.random);
    var end = W.stateAt(W.totalTime(t), t);
    if (W.upFace(end.theta) !== result) wrong++;
    var fl = W.flatness(end.theta);
    if (fl < 0.999999) notFlat++;
    worstFlat = Math.min(worstFlat, fl);
  }
  ok(wrong === 0, 'every one of ' + N + ' tosses rests on the decided face',
     wrong + ' wrong');
  ok(notFlat === 0, 'every settled coin is lying flat on that face',
     'worst flatness ' + worstFlat);
}

section('2. the parity rule (heads = even half-turns, tails = odd)');
{
  var bad = 0;
  for (var i = 0; i < 5000; i++){
    var r = (i % 2) ? 'heads' : 'tails';
    var t = W.toss(r, Math.random);
    var isOdd = W.mod(t.halfTurns, 2) === 1;
    if ((r === 'tails') !== isOdd) bad++;
  }
  ok(bad === 0, 'parity always matches the result', bad);

  /* the free rotations really are free: they cannot change which face is up */
  var t2 = W.toss('heads', Math.random);
  var spun = W.stateAt(W.totalTime(t2), t2);
  ok(W.upFace(spun.theta) === W.upFace(t2.halfTurns * Math.PI),
     'the face depends on the tumble alone');
}

section('3. does it reach the face by turning, or is it snapped there?');
{
  var t = W.toss('tails', function(){ return 0.5; });
  var samples = 400, monotonic = true, prev = -1;
  for (var i = 0; i <= samples; i++){
    var st = W.stateAt(t.airtime * i / samples, t);
    if (st.theta <= prev) monotonic = false;
    prev = st.theta;
  }
  ok(monotonic, 'the tumble increases through the whole flight');
  var half = W.stateAt(t.airtime * 0.5, t);
  near(half.theta, t.halfTurns * Math.PI * 0.5, 1e-9,
       'at the midpoint it is exactly half way round');
}

section('4. the coin clears the floor on the way in');
{
  var worst = 1e9, below = 0;
  for (var i = 0; i < 3000; i++){
    var t = W.toss((i % 2) ? 'heads' : 'tails', Math.random);
    for (var k = 0; k <= 240; k++){
      var st = W.stateAt(W.totalTime(t) * k / 240, t);
      var c = W.clearance(st.y, st.theta);
      if (c < worst) worst = c;
      if (c < -1e-9) below++;
    }
  }
  ok(below === 0, 'no frame puts the rim through the floor', below + ' frames');
  ok(worst > -1e-9, 'minimum clearance is never negative', worst);
}

section('5. the arc is a real arc');
{
  var t = W.toss('heads', Math.random);
  ok(t.airtime > 0.5 && t.airtime < 2, 'airtime is human', t.airtime);
  ok(t.apex > 0.3 && t.apex < 3, 'apex is a plausible throw', t.apex);
  ok(t.v0 > 0, 'launched upward');

  /* The top of the arc is where the vertical speed changes sign. Sampling hard
     against the midpoint only measures float noise, because the vertex of a
     parabola has zero slope there, so step far enough away for the curvature to
     speak instead. */
  var h = 0.02;
  var before = W.stateAt(t.airtime / 2 - h, t);
  var mid = W.stateAt(t.airtime / 2, t);
  var after = W.stateAt(t.airtime / 2 + h, t);
  ok(mid.y > before.y && mid.y > after.y,
     'the midpoint of the flight is the top of the arc',
     before.y.toFixed(6) + ' < ' + mid.y.toFixed(6) + ' > ' + after.y.toFixed(6));
  near(before.y, after.y, 1e-12, 'and the arc is symmetric about it');
  near(t.airtime / 2, t.v0 / W.G, 1e-12, 'the apex comes at v/g');

  var impact = W.stateAt(t.airtime - 1e-6, t);
  ok(Math.abs(impact.y - W.COIN.thick / 2) < 1e-4,
     'and it comes back to the floor at the end of the airtime', impact.y);
}

section('6. the settle damps out and leaves the coin at rest');
{
  var t = W.toss('heads', Math.random);
  var at = function(s){ return W.stateAt(t.airtime + s, t); };
  var off = function(st){ return Math.abs(st.y - W.COIN.thick / 2); };
  var a = at(0.02), b = at(0.5), c = at(1.04);
  ok(off(b) < off(a), 'the hop dies away', off(a) + ' -> ' + off(b));
  ok(off(c) < 1e-6, 'by the end of the settle it is still to within a micron',
     off(c));
  ok(off(at(3)) < 1e-12, 'and a moment later, exactly still', off(at(3)));
  /* 1.06, not 1.05: (airtime + 1.05) - airtime is not exactly 1.05 in binary
     floating point, so sampling exactly on the boundary tests the FPU rather
     than the model */
  near(at(1.06).y, W.COIN.thick / 2, 1e-6, 'resting on the floor');
  ok(at(1.06).settled === true, 'flagged as settled');
  near(at(1.06).theta, t.halfTurns * Math.PI, 1e-12,
       'the resting angle is exact, so the face cannot drift after the reveal');
  ok(at(1.06).flat > 0.999999, 'lying flat on the face');
}

section('7. the physics does not depend on the frame rate');
{
  /* a fine step and a coarse step must land in the same place: the state is a
     pure function of the simulated clock, which is what makes the slow motion
     safe to bolt on later */
  var t = W.toss('tails', Math.random);
  var total = W.totalTime(t);
  var coarse = W.stateAt(total, t);
  var acc = 0, fine = null;
  while (acc < total - 1e-12){
    acc = Math.min(total, acc + total / 600);
    fine = W.stateAt(acc, t);
  }
  near(fine.theta, coarse.theta, 1e-12, 'the tumble is frame-rate independent');
  near(fine.y, coarse.y, 1e-12, 'so is the height');
  ok(W.upFace(fine.theta) === W.upFace(coarse.theta), 'and so is the outcome');
}

section('8. the coin itself is a coin');
{
  ok(W.COIN.r > 0 && W.COIN.thick > 0, 'has size');
  ok(W.COIN.thick < W.COIN.r, 'thinner than it is wide');
  ok(W.COIN.teeth >= 40, 'the edge is milled', W.COIN.teeth);
  ok(W.COIN.relief > 0, 'the emblems stand proud', W.COIN.relief);
  ok(W.COIN.relief < W.COIN.thick / 2, 'the relief is not a tower',
     W.COIN.relief + ' of ' + W.COIN.thick);

  var biggest = 0;
  [W.CROWN, W.BOLT].forEach(function(p){
    p.forEach(function(pt){
      biggest = Math.max(biggest, Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]));
    });
  });
  ok(biggest <= W.COIN.rim, 'both emblems fit inside the raised ring',
     biggest.toFixed(3) + ' vs rim ' + W.COIN.rim);
  ok(biggest <= W.COIN.emblemMax + 1e-9, 'and inside the stated limit',
     biggest.toFixed(3));

  /* a self-intersecting outline would triangulate into a mess */
  function simple(p){
    function crosses(a, b, c, d){
      function side(x, y, z){
        return (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]);
      }
      var d1 = side(a, b, c), d2 = side(a, b, d);
      var d3 = side(c, d, a), d4 = side(c, d, b);
      return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
    }
    var n = p.length;
    for (var i = 0; i < n; i++){
      for (var j = i + 2; j < n; j++){
        if (i === 0 && j === n - 1) continue;
        if (crosses(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return false;
      }
    }
    return true;
  }
  function area(p){
    var a = 0;
    for (var i = 0; i < p.length; i++){
      var q = p[(i + 1) % p.length];
      a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    return a / 2;
  }
  ok(W.CROWN.length >= 8, 'the crown is a crown, not a triangle', W.CROWN.length);
  ok(simple(W.CROWN), 'the crown outline does not cross itself');
  ok(simple(W.BOLT), 'the bolt outline does not cross itself');
  ok(area(W.CROWN) > 0 && area(W.BOLT) > 0,
     'both wind counter-clockwise, so they extrude facing outward',
     area(W.CROWN).toFixed(3) + ', ' + area(W.BOLT).toFixed(3));
}

section('9. the rules are fair, and provably so');
{
  var b = [0, 0], N = 200000;
  for (var i = 0; i < N; i++) b[RULES.fairBit()]++;
  var dev = Math.abs(b[0] - b[1]) / N;
  ok(dev < 0.01, 'the bit is even over ' + N + ' draws',
     dev.toFixed(5) + ' deviation');
  ok(RULES.flip(0) === 'heads' && RULES.flip(1) === 'tails',
     '0 is heads and 1 is tails');

  /* the whole 0..255 space maps 128/128, so there is no modulo bias to argue
     about and the percentages in the HUD can be believed */
  var heads = 0;
  for (var v = 0; v < 256; v++) if ((v & 1) === 0) heads++;
  ok(heads === 128, 'a byte splits exactly 128/128', heads);
}

section('10. stats, streaks and the history cap');
{
  var st = RULES.emptyStore();
  RULES.record(st, 'heads'); RULES.record(st, 'heads'); RULES.record(st, 'heads');
  RULES.record(st, 'tails');
  var s = RULES.stats(st);
  ok(s.total === 4 && s.heads === 3 && s.tails === 1, 'the tally adds up');
  ok(s.best === 3, 'the best streak is remembered', s.best);
  ok(s.streak === 1, 'the current streak is the run at the front', s.streak);
  near(s.headsPct, 0.75, 1e-12, 'the crown share is exact');
  ok(s.list.length === 4 && s.list[0] === 'tails', 'newest first');

  for (var i = 0; i < 60; i++) RULES.record(st, (i % 2) ? 'heads' : 'tails');
  ok(st.h.length === RULES.KEEP, 'the history is capped', st.h.length);
  var s2 = RULES.stats(st);
  ok(s2.total === 64, 'but the lifetime count keeps going', s2.total);
  ok(s2.best >= 3, 'and the best streak survives the cap', s2.best);
  ok(s2.list.length === RULES.SHOW, 'the HUD shows five', s2.list.length);
}

section('11. the old build\'s history is not lost');
{
  var legacy = JSON.stringify([
    { result: 'heads', time: '2026-01-01' },
    { result: 'tails' },
    { result: 'heads' }
  ]);
  var m = RULES.migrate(legacy);
  var s = RULES.stats(m);
  ok(s.total === 3 && s.heads === 2 && s.tails === 1, 'the legacy array imports',
     JSON.stringify({ t: s.total, h: s.heads }));
  ok(s.list.join(',') === 'heads,tails,heads', 'in the right order',
     s.list.join(','));

  ok(RULES.migrate(null).total === 0, 'nothing in, nothing out');
  ok(RULES.migrate('{not json').total === 0, 'a corrupt value does not throw');
  ok(RULES.migrate({ v: 2, h: ['heads'], total: 1, heads: 1, best: 1 }).total === 1,
     'a current store passes straight through');
  ok(RULES.HISTORY_KEY !== RULES.LEGACY_KEY &&
     RULES.LEGACY_KEY === 'coinFlipHistory',
     'and the old key really is the one the previous build wrote',
     RULES.LEGACY_KEY);
}

section('12. the audio graph is safe to fire all at once');
{
  var peaks = Object.keys(AUDIO.peak).map(function(k){ return AUDIO.peak[k]; });
  var loudest = Math.max.apply(null, peaks);
  ok(loudest < 1, 'no single voice can clip on its own', loudest);
  var sum = peaks.reduce(function(a, b2){ return a + b2; }, 0);
  ok(sum > 1, 'but a burst of them would, without a limiter', sum.toFixed(2));
  ok(AUDIO.limiter.threshold < 0 && AUDIO.limiter.ratio >= 10,
     'so there is a limiter on the end of it',
     AUDIO.limiter.threshold + 'dB @ ' + AUDIO.limiter.ratio + ':1');
  ok(AUDIO.glue.ratio < AUDIO.limiter.ratio, 'glue before limiter');
  ok(AUDIO.master <= 1, 'and a master gain that is not a boost', AUDIO.master);
  ok(AUDIO.hp >= 20 && AUDIO.lp <= 20000, 'the output is band limited',
     AUDIO.hp + '..' + AUDIO.lp);
  ok(AUDIO.noiseBand.lo < AUDIO.noiseBand.hi, 'noise voices have a band');
  ok(AUDIO.maxVoices >= 8, 'a voice cap, so nothing can pile up', AUDIO.maxVoices);
  ok(AUDIO.fadeMs >= 30, 'the mute is a ramp, not a click', AUDIO.fadeMs);

  ['sfx', 'room', 'ui'].forEach(function(b2){
    ok(AUDIO.buses[b2] > 0 && AUDIO.buses[b2] <= 1, 'bus ' + b2 + ' is sane');
  });
}

section('13. every sound still works with no audio hardware at all');
{
  /* node has no Web Audio. Every voice has to degrade to a silent no-op rather
     than throw, or these headless tests could never exercise those paths. */
  var threw = null;
  try {
    Sound.wake();
    Sound.launch(1);
    Sound.clink(5.2); Sound.clink(0.3); Sound.clink();
    Sound.uiTick();
    Sound.spinStart(); Sound.spinSet(1, 0.01); Sound.spinSet(0); Sound.spinStop();
    var r = Sound.riser(0.4);
    ok(r === null, 'the riser refuses cleanly with no context', String(r));
    Sound.reveal('heads'); Sound.reveal('tails');
    Sound.set(false); Sound.set(true);
  } catch (e){ threw = e; }
  ok(!threw, 'no voice throws without a context',
     threw ? String(threw.message || threw) : '');
  ok(Sound.voices() === 0, 'and none of them leak a voice', Sound.voices());
  ok(Sound.enabled() === true, 'the sound flag survives being toggled');
}

done();
