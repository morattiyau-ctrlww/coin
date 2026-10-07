/* =========================================================================
   Gold Coin Flip  —  renderer2d.js
   The no-WebGL fallback (?q=2d, or a browser without a context). It is not a
   cartoon stand-in for the coin: the silhouette is a true orthographic
   projection of the same cylinder, so a coin seen edge-on becomes a thin bar
   rather than vanishing the way the old CSS version did. It follows the same
   toss from the same model, and it is framed by the same idea as the 3D rig —
   the coin rises in frame and the view pulls back as it goes.
   ========================================================================= */
'use strict';

var Renderer2D = (function(){
  var cv = null, g = null, W = 0, H = 0, base = 640, lastTheta = 0;
  var ready = false, W3 = null;

  function boot(done){
    W3 = window.WORLD;
    cv = document.getElementById('coin2d');
    if (!cv || !W3){ done(false); return; }
    g = cv.getContext('2d');
    if (!g){ done(false); return; }
    if (document.body) document.body.classList.add('flat');
    resize();
    ready = true;
    done(true);
  }

  function resize(){
    if (!cv) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* pixels per metre. The HUD owns the bottom third of the screen, so the
       coin is kept in the band above it rather than pinned to a fixed ground
       line the panel would then cover. */
    base = Math.min(W * 0.90, H * 1.10);
  }

  function bg(){
    var grd = g.createRadialGradient(W * 0.5, H * 0.30, H * 0.04,
                                     W * 0.5, H * 0.40, Math.max(W, H) * 0.74);
    grd.addColorStop(0, '#17222f');
    grd.addColorStop(0.55, '#0b1017');
    grd.addColorStop(1, '#040608');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }

  function pool(cx, gy, scale){
    var r = scale * 0.42;
    var grd = g.createRadialGradient(cx, gy, 2, cx, gy, r);
    grd.addColorStop(0, 'rgba(130,160,200,0.22)');
    grd.addColorStop(1, 'rgba(130,160,200,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(cx, gy, r, r * 0.34, 0, 0, Math.PI * 2);
    g.fill();
  }

  /* The exact silhouette of a disc of radius hw, tilted so its projection is
     squashed to hw*flat, and `band` thick: an ellipse plus the edge band on
     either side. Two subpaths in one fill give the union, which is exactly the
     shape a coin makes — no rounded-rectangle stand-in. */
  function silhouette(x, y, hw, hh, flat){
    g.beginPath();
    g.ellipse(x, y, hw, hh, 0, 0, Math.PI * 2);
    var band = hh - hw * flat;
    if (band > 0.4) g.rect(x - hw, y - band, hw * 2, band * 2);
  }

  function facePath(x, y, hw, flat){
    g.beginPath();
    g.ellipse(x, y, hw, Math.max(0.4, hw * flat), 0, 0, Math.PI * 2);
  }

  function medal(x, y, hw, hh, flat){
    var edge = 1 - flat;

    /* the milled edge, behind the face */
    silhouette(x, y, hw, hh, flat);
    var eg = g.createLinearGradient(0, y - hh, 0, y + hh);
    eg.addColorStop(0.00, '#e9c368');
    eg.addColorStop(0.28, '#b8862a');
    eg.addColorStop(0.62, '#825c14');
    eg.addColorStop(1.00, '#e5b655');
    g.fillStyle = eg;
    g.fill();

    if (edge > 0.10){
      g.save();
      silhouette(x, y, hw, hh, flat);
      g.clip();
      g.strokeStyle = 'rgba(66,45,6,0.40)';
      g.lineWidth = Math.max(1, hw * 0.012);
      var step = Math.max(3, hw * 0.055);
      for (var tx = x - hw; tx <= x + hw; tx += step){
        g.beginPath();
        g.moveTo(tx, y - hh);
        g.lineTo(tx + hw * 0.03, y + hh);
        g.stroke();
      }
      g.restore();
    }

    /* the face on top of it */
    facePath(x, y, hw, flat);
    var top = g.createLinearGradient(x - hw, y - hh, x + hw, y + hh);
    top.addColorStop(0.00, '#fff4d0');
    top.addColorStop(0.20, '#f9d476');
    top.addColorStop(0.48, '#dda93e');
    top.addColorStop(0.76, '#b07d24');
    top.addColorStop(1.00, '#f3cb6c');
    g.fillStyle = top;
    g.fill();

    /* a specular sweep across the face */
    g.save();
    facePath(x, y, hw, flat);
    g.clip();
    var sp = g.createLinearGradient(x - hw * 0.9, y - hh, x + hw * 0.3, y + hh);
    sp.addColorStop(0.00, 'rgba(255,255,255,0.00)');
    sp.addColorStop(0.32, 'rgba(255,255,255,0.38)');
    sp.addColorStop(0.52, 'rgba(255,255,255,0.06)');
    sp.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    g.fillStyle = sp;
    g.fillRect(x - hw, y - hh, hw * 2, hh * 2);
    g.restore();

    facePath(x, y, hw, flat);
    g.strokeStyle = 'rgba(255,240,196,0.50)';
    g.lineWidth = Math.max(1, hw * 0.018);
    g.stroke();

    /* the raised rim, the same ring the 3D coin carries */
    if (flat > 0.30){
      g.beginPath();
      g.ellipse(x, y, hw * 0.86, Math.max(0.4, hw * 0.86 * flat), 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,238,186,0.30)';
      g.lineWidth = Math.max(1, hw * 0.035);
      g.stroke();
      g.beginPath();
      g.ellipse(x, y, hw * 0.80, Math.max(0.4, hw * 0.80 * flat), 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(120,82,16,0.26)';
      g.lineWidth = Math.max(1, hw * 0.022);
      g.stroke();
    }
  }


  function emblem(x, y, hw, hh, flat, path){
    /* the emblem, foreshortened by exactly the same cosine as the face */
    var sc = hw * 0.80;
    g.save();
    g.beginPath();
    g.moveTo(x, y);
    for (var i = 0; i < path.length; i++){
      g.lineTo(x + path[i][0] * sc, y - path[i][1] * sc * flat);
    }
    g.closePath();
    /* struck relief reads as a soft depression in the field, so the emblem is
       a shade darker than the face with a bright lower lip */
    var eg = g.createLinearGradient(x, y - hh, x, y + hh);
    eg.addColorStop(0.00, '#9a6a12');
    eg.addColorStop(0.50, '#c1902c');
    eg.addColorStop(1.00, '#f0d489');
    g.fillStyle = eg;
    g.fill();
    g.strokeStyle = 'rgba(74,50,6,0.50)';
    g.lineWidth = Math.max(1, hw * 0.014);
    g.stroke();
    g.restore();
  }

  /* The whole frame: a tracking camera rather than a fixed one. The coin is
     held in the band between the masthead and the HUD panel, and the scale
     eases back as it rises — the same idea as the 3D rig, so the two renderers
     compose the same shot. */
  function frame(dt, view){
    if (!ready) return false;
    var st = view.st;
    lastTheta = st.theta;
    var h01 = W3.clamp(st.height01, 0, 1);
    var S = base * (1 - 0.30 * h01);
    var r = W3.COIN.r * S;
    var cx = W / 2;
    var coinY = H * (0.56 - 0.12 * h01);
    var groundY = coinY + st.y * S;

    bg();
    pool(cx, groundY, S * 0.85);

    /* the shadow on the stone, tightening as the coin comes down */
    var sh = Math.max(0.10, 1 - Math.max(0, st.y) / 1.5);
    g.fillStyle = 'rgba(0,0,0,' + (0.40 * sh).toFixed(3) + ')';
    g.beginPath();
    g.ellipse(cx, groundY + 1, r * (0.55 + 0.65 * sh), r * 0.20 * (0.55 + 0.65 * sh),
              0, 0, Math.PI * 2);
    g.fill();

    var c = Math.cos(st.theta), s = Math.sin(st.theta);
    var flat = Math.abs(c);
    var hw = r;
    var hh = r * flat + (W3.COIN.thick / 2) * Math.abs(s) * S;

    medal(cx, coinY, hw, hh, flat);
    if (flat > 0.12 && hh > 2){
      emblem(cx, coinY, hw, hw * flat, flat, c >= 0 ? W3.CROWN : W3.BOLT);
    }
    return true;
  }

  function probe(){
    return { ok: ready, mode: '2d', W: W, H: H, scale: +base.toFixed(1),
             upFace3d: Math.cos(lastTheta) >= 0 ? 'heads' : 'tails',
             upY: +Math.abs(Math.cos(lastTheta)).toFixed(4) };
  }

  return { boot: boot, frame: frame, resize: resize, probe: probe,
           isReady: function(){ return ready; } };
})();
