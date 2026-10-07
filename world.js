/* =========================================================================
   Gold Coin Flip  —  world.js
   The shared model of the coin and its toss. Pure maths: no DOM, no THREE.
   Exported under CommonJS, because the interesting claim in this project is a
   testable one: the coin is not animated to a result, it is *thrown* so that it
   lands on it, and the tests prove the picture can never lie about the outcome.

   Units are metres, and y is up with the floor at y = 0.
   ========================================================================= */
'use strict';

var WORLD = (function(){

  /* ---------------- the coin ----------------
     A 24 cm commemorative piece with a milled (reeded) edge. Bigger than any
     real coin because this is a showpiece, and readable at a glance.        */
  var COIN = {
    r: 0.12,          /* radius: 24 cm across                            */
    thick: 0.022,
    teeth: 120,       /* the reed count on the edge                      */
    relief: 0.0075,   /* how far the emblems stand off the face          */
    rim: 0.86,        /* the raised ring, as a fraction of the radius    */
    emblemMax: 0.72   /* every emblem point sits inside this radius      */
  };

  var G = 9.81;

  /* ---------------- the toss envelope ----------------
     Half-turns are what a coin toss really is: an even number leaves the
     original face up (heads), an odd number turns it over (tails).         */
  var TOSS = {
    airMin: 0.92, airMax: 1.12,     /* seconds of airtime                  */
    turnsMin: 7, turnsMax: 13,      /* half-turns, parity forced to result */
    yawMax: 2.6,                    /* rad/s about the world up axis       */
    rollMax: 1.5,                   /* rad/s about the face normal         */
    wobbleMax: 0.16,                /* rad of decaying tip as it settles   */
    wobbleFreq: 26,
    wobbleDecay: 7,
    bounceH: 0.012,                 /* how high it hops on landing         */
    bounceDecay: 11,
    clearMargin: 1.30,              /* safety factor on the rim clearance  */
    settleTime: 1.05                /* contact to fully at rest, seconds   */
  };

  function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function smoothstep(a, b, x){
    var t = clamp((x - a) / (b - a || 1), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function mod(n, m){ return ((n % m) + m) % m; }

  /* ---------------- the emblems ----------------
     Plain 2D paths in face units (the face is a disc of radius 1), shared by
     the WebGL relief, the flat fallback and the tests. No text anywhere: the
     emblems are the identity.                                             */
  var CROWN = [
    [-0.50, -0.46], [ 0.50, -0.46], [ 0.50, -0.29],
    [ 0.36, -0.29], [ 0.30,  0.34], [ 0.16, -0.06],
    [ 0.00,  0.46], [-0.16, -0.06], [-0.30,  0.34],
    [-0.36, -0.29], [-0.50, -0.29]
  ];
  var BOLT = [
    [ 0.14,  0.62], [-0.40,  0.02], [-0.06,  0.02],
    [-0.26, -0.64], [ 0.36,  0.06], [ 0.02,  0.06]
  ];

  /* ---------------- geometry helpers ---------------- */

  /* How far the coin's lowest point sits below its centre, for a tumble angle
     of `theta`. Flat on a face it is half the thickness; edge-on it is the
     full radius. This is what keeps the coin out of the floor on the way in. */
  function halfSpan(theta){
    return Math.abs(Math.cos(theta)) * COIN.thick / 2 +
           Math.abs(Math.sin(theta)) * COIN.r;
  }

  /* the clearance under the coin: positive means it is above the floor */
  function clearance(y, theta){ return y - halfSpan(theta); }

  /* Which face is looking up after `theta` radians of tumble? An even number
     of half-turns leaves the coin as it started; an odd number flips it. */
  function upFace(theta){
    var halves = Math.round(theta / Math.PI);
    return (mod(halves, 2) === 0) ? 'heads' : 'tails';
  }
  /* how flat it is lying: 1 when perfectly on a face, 0 when edge-on */
  function flatness(theta){ return Math.abs(Math.cos(theta)); }

  /* ---------------- the toss ----------------
     `result` is decided by the rules *first*; this solves a throw that really
     lands on it. The spin rate is the half-turn count over the airtime, so at
     the moment of contact the coin has turned exactly n half-turns.        */
  function toss(result, rnd){
    rnd = rnd || Math.random;
    var airtime = lerp(TOSS.airMin, TOSS.airMax, rnd());
    var want = (result === 'tails') ? 1 : 0;

    /* draw a plausible turn count, then force the parity to match the result */
    var n = TOSS.turnsMin + Math.floor(rnd() * (TOSS.turnsMax - TOSS.turnsMin + 1));
    if (mod(n, 2) !== want) n = (n + 1 <= TOSS.turnsMax) ? n + 1 : n - 1;

    /* Near the floor the coin is dropping at v = g*airtime/2 while its rim is
       sweeping upward at r*omega. If the rim wins, the coin would clip through
       the floor on the way in, so the spin count comes down in steps of two —
       which preserves the parity, and therefore the result.                */
    var vLand = G * airtime / 2;
    while (n > 3 && vLand < (COIN.r * n * Math.PI / airtime) * TOSS.clearMargin){
      n -= 2;
    }

    var v0 = vLand;                                   /* symmetrical arc    */
    return {
      result: result,
      airtime: airtime,
      halfTurns: n,
      omega: n * Math.PI / airtime,                   /* tumble, rad/s      */
      v0: v0,
      apex: v0 * v0 / (2 * G),
      yawRate: (rnd() * 2 - 1) * TOSS.yawMax,         /* free: no effect    */
      rollRate: (rnd() * 2 - 1) * TOSS.rollMax,       /* free: no effect    */
      wobbleAmp: (rnd() * 2 - 1) * TOSS.wobbleMax,
      wobbleFreq: TOSS.wobbleFreq * lerp(0.85, 1.15, rnd())
    };
  }

  /* ---------------- where the coin is at time t ----------------
     Phases: rest (on the pedestal), rise, fall, settle, rest (landed).
     `theta` is the tumble, and it alone decides the face — the yaw and the
     roll are free, because neither changes which side is looking up.       */
  function stateAt(t, toss){
    var T = (toss && toss.airtime) || 1;
    var out = { t: t, phase: 'rest', theta: 0, yaw: 0, roll: 0,
                y: COIN.thick / 2, height01: 1, airborne: false, settled: false };

    if (!toss || t <= 0){                          /* waiting on the pedestal */
      out.flat = 1;
      return out;
    }

    if (t < T){
      out.phase = (t < T / 2) ? 'rise' : 'fall';
      out.y = COIN.thick / 2 + toss.v0 * t - 0.5 * G * t * t;
      out.theta = toss.omega * t;
      out.roll = toss.rollRate * t;
      out.yaw = toss.yawRate * t;
      out.airborne = true;
    } else {
      var s = t - T;                               /* seconds since contact  */
      out.theta = toss.halfTurns * Math.PI;        /* exactly on the face    */
      out.yaw = toss.yawRate * (T + s * 0.25);
      /* a hop and a tip that damp away to nothing, so it comes to rest flat on
         the face the toss was solved for */
      var hop = Math.exp(-s * TOSS.bounceDecay);
      out.y = COIN.thick / 2 + Math.abs(Math.sin(s * 21)) * TOSS.bounceH * hop;
      out.roll = toss.rollRate * T +
                 toss.wobbleAmp * Math.cos(toss.wobbleFreq * s) *
                 Math.exp(-s * TOSS.wobbleDecay);
      out.phase = (s < TOSS.settleTime) ? 'settle' : 'rest';
      out.settled = s >= TOSS.settleTime;
    }
    out.height01 = clamp(out.y / Math.max((toss && toss.apex) || 1, 1e-6), 0, 1);
    out.flat = flatness(out.theta);
    return out;
  }

  /* total time to play a toss out: contact plus the settle */
  function totalTime(toss){ return toss.airtime + TOSS.settleTime; }

  return {
    COIN: COIN, TOSS: TOSS, G: G,
    CROWN: CROWN, BOLT: BOLT,
    clamp: clamp, lerp: lerp, smoothstep: smoothstep, mod: mod,
    halfSpan: halfSpan, clearance: clearance, flatness: flatness,
    upFace: upFace, toss: toss, stateAt: stateAt, totalTime: totalTime
  };
})();

if (typeof module !== 'undefined' && module.exports){ module.exports = WORLD; }

