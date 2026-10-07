/* =========================================================================
   Gold Coin Flip  —  renderer3d.js
   A real WebGL coin: geometry with a milled edge and relief, PBR gold lit by a
   procedural studio environment, one continuous camera, and a single composite
   pass. The outcome is never decided here — script.js hands over a solved toss
   and this file only draws it.

   Deliberately lighter than the sibling soccer build: no planar mirror and no
   depth of field. What is here earns its keep — real relief (the coin has
   thickness, so it cannot vanish edge-on like the CSS version did), a milled
   edge, an environment map for the metal, bloom, and a bounce flash.
   ========================================================================= */
'use strict';

var Renderer3D = (function(){
  var T = null;
  var renderer = null, scene = null, camera = null, canvas = null;
  var ready = false, dead = false, err = '';
  var W = 0, H = 0;

  /* ------------------------------ quality --------------------------------
     Every tier is a real render budget, so a phone gets the same coin with
     fewer teeth, no shadow and no bloom, rather than a broken page.        */
  var Q = { shadows: true, bloom: true, dpr: 1.5, aniso: 4, teeth: 120,
            seg: 128, envSize: 1024, fov: 34, grain: 0.045,
            ca: 0.0030, fog: 0.028 };

  function setQuality(level){
    if (level === 'low'){
      Q.shadows = false; Q.bloom = false; Q.dpr = 1; Q.aniso = 1;
      Q.teeth = 56; Q.seg = 64; Q.envSize = 256;
      Q.grain = 0.035; Q.ca = 0; Q.fog = 0.024;
    } else if (level === 'med'){
      Q.shadows = true; Q.bloom = true; Q.dpr = 1.35; Q.aniso = 2;
      Q.teeth = 88; Q.seg = 96; Q.envSize = 512;
      Q.grain = 0.040; Q.ca = 0.0016; Q.fog = 0.026;
    } else {
      Q.shadows = true; Q.bloom = true; Q.dpr = 2; Q.aniso = 8;
      Q.teeth = 120; Q.seg = 128; Q.envSize = 1024;
      Q.grain = 0.045; Q.ca = 0.0030; Q.fog = 0.028;
    }
  }

  function hasGL(){
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e){ return false; }
  }

  /* ?q=low|med|high pins a tier, ?q=2d refuses WebGL entirely */
  function want3d(){
    var s = (location.search || '') + (location.hash || '');
    if (/\bq=2d\b/.test(s)) return '2d';
    var m = /q=(low|med|high)/.exec(s);
    if (m) return m[1];
    var cores = (navigator.hardwareConcurrency || 4);
    var small = Math.min(window.screen ? window.screen.width : 9999,
                         window.screen ? window.screen.height : 9999) < 700;
    return (cores <= 4 || small) ? 'med' : 'high';
  }

  function loadThree(cb){
    if (window.THREE){ T = window.THREE; cb(true); return; }
    var s = document.createElement('script');
    s.src = 'vendor/three.min.js';
    s.onload = function(){ T = window.THREE; cb(!!T); };
    s.onerror = function(){ err = 'three.js failed to load'; cb(false); };
    document.head.appendChild(s);
  }

  /* ------------------------- canvas texture helpers ---------------------- */
  function canvasTex(w, h, draw){
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    draw(g, w, h);
    var t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = Q.aniso;
    return t;
  }


  /* A procedural studio, drawn as an equirectangular strip.
     This single image *is* the coin's colour: gold with metalness 1 has no
     colour of its own, it only reflects. A dark room makes a dark coin, so the
     room is a mid-grey studio with a few bright panels — the panels give the
     sparkle, the mid-grey gives the gold.                                  */
  function envCanvas(size){
    var w = size * 2, h = size;
    return canvasTex(w, h, function(g, w, h){
      var sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0.00, '#242a33');
      sky.addColorStop(0.24, '#333b46');
      sky.addColorStop(0.44, '#4d5665');
      sky.addColorStop(0.50, '#5b6472');
      sky.addColorStop(0.56, '#3a3d42');
      sky.addColorStop(0.72, '#241d14');
      sky.addColorStop(1.00, '#0b0d11');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);

      /* a soft panel: a radial smear, brightest in the middle */
      function panel(cx, cy, rx, ry, col, strength){
        g.save();
        g.globalAlpha = strength;
        var grd = g.createRadialGradient(cx, cy, 1, cx, cy, rx);
        grd.addColorStop(0, col);
        grd.addColorStop(0.5, col);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }

      /* the key: a big warm softbox, high and to the left */
      panel(w * 0.16, h * 0.29, w * 0.15, h * 0.26, '#fff6e6', 0.98);
      /* a cool fill across the room, so the shadow side is not dead */
      panel(w * 0.60, h * 0.38, w * 0.13, h * 0.30, '#dbe9ff', 0.62);
      /* the strip behind: the hard glint that reads as polished metal */
      panel(w * 0.82, h * 0.34, w * 0.055, h * 0.30, '#ffffff', 0.95);
      /* a warm bounce, low in front */
      panel(w * 0.34, h * 0.78, w * 0.24, h * 0.20, '#c98b3c', 0.34);
      /* a horizon band, so the coin's edge has something to catch */
      g.globalAlpha = 0.55;
      g.fillStyle = '#8d97a6';
      g.fillRect(0, h * 0.545, w, Math.max(1, h * 0.010));
      g.globalAlpha = 1;
    });
  }

  /* micro-scratches for the metal. It doubles as the roughness and bump map, so
     it is drawn around near-white: a mid-grey map would multiply the base
     roughness down into a mirror, which is exactly the trap here. */
  function wearCanvas(size){
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var g = cv.getContext('2d');
    g.fillStyle = '#efefef'; g.fillRect(0, 0, size, size);
    var i, x, y, r, a;
    /* long faint scratches, as if it has been carried in a pocket */
    for (i = 0; i < size * 0.9; i++){
      x = Math.random() * size; y = Math.random() * size;
      r = 2 + Math.random() * size * 0.16;
      a = Math.random() * Math.PI;
      g.strokeStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255,' : '60,60,60,') +
                      (0.10 + Math.random() * 0.16).toFixed(3) + ')';
      g.lineWidth = 0.5 + Math.random() * 1.1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      g.stroke();
    }
    /* and the fine speckle that makes a flat highlight break up */
    for (i = 0; i < size * 5; i++){
      x = Math.random() * size; y = Math.random() * size;
      g.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255,' : '40,40,40,') +
                    (0.10 + Math.random() * 0.14).toFixed(3) + ')';
      g.fillRect(x, y, 1, 1);
    }
    var t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = Q.aniso;
    return t;
  }

  /* the room the coin sits in: a dark gradient wall, no visible edge */
  function wallCanvas(){
    return canvasTex(8, 256, function(g, w, h){
      var grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0.00, '#05070a');
      grd.addColorStop(0.42, '#080b10');
      grd.addColorStop(0.72, '#0d1219');
      grd.addColorStop(0.90, '#131a23');
      grd.addColorStop(1.00, '#080c11');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
  }


  /* ============================== the coin =============================== */
  var W3 = null;                       /* WORLD, the pure model            */
  var coinG = null;                    /* the group everything hangs off   */
  var meshes = { bodies: [] };
  var matGold = null, matEdge = null, matRelief = null;
  
  function buildCoin(){
    var r = W3.COIN.r, t = W3.COIN.thick, bev = 0.0056;
    coinG = new T.Group();
    scene.add(coinG);

    var wear = wearCanvas(256);
    wear.repeat.set(9, 9);
    var wearEdge = wearCanvas(256);
    wearEdge.repeat.set(3, 3);

    matGold = new T.MeshStandardMaterial({
      color: 0xffb52e, metalness: 1.0, roughness: 0.42,
      envMapIntensity: 0.44, roughnessMap: wear, bumpMap: wear, bumpScale: 0.0012
    });
    matEdge = new T.MeshStandardMaterial({
      color: 0xf0ad33, metalness: 1.0, roughness: 0.50,
      envMapIntensity: 0.42, roughnessMap: wearEdge, bumpMap: wearEdge,
      bumpScale: 0.0016
    });

    /* The relief gets its own material. The reason is not aesthetic: the
       extruded emblems carry UVs in metres, so per screen pixel their UV
       gradient is a couple of hundred times smaller than the lathe's, and a
       bump map divides by exactly that gradient — on the emblems it explodes
       into noise and turns the relief black. Slightly rougher, too, because a
       struck relief is a touch more matte than the field, which is what makes
       it read as raised instead of carved. */
    matRelief = matGold.clone();
    matRelief.bumpMap = null;
    matRelief.roughness = 0.50;
    matRelief.envMapIntensity = 0.46;

    /* The body: a lathed solid, so it is a real coin with a real edge rather
       than two discs. The profile chamfers the rim, which is what gives a
       bright line right where the face turns away from the light. */
    var profile = [
      new T.Vector2(0, -t / 2),
      new T.Vector2(r - bev, -t / 2),
      new T.Vector2(r, -t / 2 + bev * 0.52),
      new T.Vector2(r,  t / 2 - bev * 0.52),
      new T.Vector2(r - bev, t / 2),
      new T.Vector2(0, t / 2)
    ];
    var body = new T.Mesh(new T.LatheGeometry(profile, Q.seg), matGold);
    body.castShadow = true; body.receiveShadow = true;
    coinG.add(body);
    meshes.bodies.push(body);

    /* The milled edge: one instanced draw call for every reed. This is the
       detail that reads as "minted" instead of "cylinder". */
    var toothW = (2 * Math.PI * r / Q.teeth) * 0.62;
    var tooth = new T.BoxGeometry(toothW, t * 0.80, 0.0034);
    var teeth = new T.InstancedMesh(tooth, matEdge, Q.teeth);
    teeth.castShadow = true;
    var m = new T.Matrix4(), qy = new T.Quaternion(), v = new T.Vector3();
    var sc = new T.Vector3(1, 1, 1), ax = new T.Vector3(0, 1, 0);
    for (var i = 0; i < Q.teeth; i++){
      var a = (i / Q.teeth) * Math.PI * 2;
      v.set(Math.cos(a) * (r - 0.0006), 0, Math.sin(a) * (r - 0.0006));
      qy.setFromAxisAngle(ax, Math.PI / 2 - a);
      m.compose(v, qy, sc);
      teeth.setMatrixAt(i, m);
    }
    teeth.instanceMatrix.needsUpdate = true;
    coinG.add(teeth);
    meshes.bodies.push(teeth);


    /* the raised rings and the bead circle, on both faces */
    var rimR = r * W3.COIN.rim;
    var ringGeo = new T.TorusGeometry(rimR, 0.0036, 8, Math.max(48, Q.seg));
    var beadGeo = new T.SphereGeometry(0.00235, 8, 6);
    var beads = new T.InstancedMesh(beadGeo, matGold, 88);
    var bm = new T.Matrix4(), bq = new T.Quaternion(), bv = new T.Vector3();
    var bax = new T.Vector3(1, 0, 0), bsc = new T.Vector3(1, 1, 1);
    bq.setFromAxisAngle(bax, 0);
    var bi = 0;
    [1, -1].forEach(function(sign){
      var ring = new T.Mesh(ringGeo, matGold);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = sign * (t / 2 - 0.0006);
      ring.castShadow = true;
      coinG.add(ring);
      meshes.bodies.push(ring);

      for (var k = 0; k < 44; k++){
        var ba = (k / 44) * Math.PI * 2;
        bv.set(Math.cos(ba) * r * 0.705, sign * (t / 2 + 0.0004),
               Math.sin(ba) * r * 0.705);
        bm.compose(bv, bq, bsc);
        beads.setMatrixAt(bi++, bm);
      }
    });
    beads.instanceMatrix.needsUpdate = true;
    coinG.add(beads);
    meshes.bodies.push(beads);

    /* The emblems, extruded from the very same 2D paths the flat fallback and
       the tests use. The crown is on +Y (heads), the bolt on -Y (tails), and
       each is oriented so it reads upright when its own face is the one up. */
    function extrude(path, sign){
      var sh = new T.Shape();
      sh.moveTo(path[0][0] * r, path[0][1] * r);
      for (var i = 1; i < path.length; i++) sh.lineTo(path[i][0] * r, path[i][1] * r);
      sh.closePath();
      var g = new T.ExtrudeGeometry(sh, {
        depth: W3.COIN.relief, bevelEnabled: true, bevelThickness: 0.0009,
        bevelSize: 0.0009, bevelSegments: 1, curveSegments: 1
      });
      /* +Z of the shape becomes the outward face normal */
      g.rotateX(sign > 0 ? -Math.PI / 2 : Math.PI / 2);
      g.translate(0, sign * (t / 2 - 0.0004), 0);
      return g;
    }
    var crown = new T.Mesh(extrude(W3.CROWN, 1), matRelief);
    crown.castShadow = true;
    coinG.add(crown);
    meshes.bodies.push(crown);
    var bolt = new T.Mesh(extrude(W3.BOLT, -1), matRelief);
    bolt.castShadow = true;
    coinG.add(bolt);
    meshes.bodies.push(bolt);

    /* The pearls on the crown's points. A crown with three bare triangles reads
       as a castle; the pearls are what make it read as a crown, and they cost
       one instanced draw call. */
    var pearls = new T.InstancedMesh(
      new T.SphereGeometry(r * 0.052, 12, 8), matRelief, 3);
    var pm = new T.Matrix4(), pq = new T.Quaternion(), pv = new T.Vector3();
    var one = new T.Vector3(1, 1, 1);
    pq.setFromAxisAngle(new T.Vector3(1, 0, 0), 0);
    [[-0.30, 0.42], [0.00, 0.545], [0.30, 0.42]].forEach(function(pt, i){
      pv.set(pt[0] * r, t / 2 + W3.COIN.relief * 0.55, -pt[1] * r);
      pm.compose(pv, pq, one);
      pearls.setMatrixAt(i, pm);
    });
    pearls.instanceMatrix.needsUpdate = true;
    pearls.castShadow = true;
    coinG.add(pearls);
    meshes.bodies.push(pearls);

    /* No speed trail here, on purpose. The cheap version of it is a stack of
       past poses, and a coin spends the top of its arc barely translating, so
       the stack collapses into a halo — and a frame-stack cannot express
       rotational blur, which is the blur a spinning coin actually has. It cost
       five draw calls to look worse, so it is gone; the milled edge turning
       through the light plus the spin wash in the audio carry the speed. */
  }


  /* ============================== the room =============================== */
  var lights = {};

  function buildArena(){
    /* The environment map first: gold with metalness 1 has no colour of its
       own, it only reflects, so this single image is what the coin *is*. It is
       drawn procedurally and pre-filtered with PMREM, which is also what gives
       the metal its roughness-aware, non-mirror blur. */
    var pmrem = new T.PMREMGenerator(renderer);
    if (pmrem.compileEquirectangularShader) pmrem.compileEquirectangularShader();
    var tex = envCanvas(Q.envSize);
    tex.mapping = T.EquirectangularReflectionMapping;
    var rt = pmrem.fromEquirectangular(tex);
    scene.environment = rt.texture;
    tex.dispose();
    pmrem.dispose();

    var floor = new T.Mesh(
      new T.CircleGeometry(3.4, 96),
      new T.MeshStandardMaterial({ color: 0x121821, roughness: 0.44,
        metalness: 0.45, envMapIntensity: 0.45 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    /* the room itself, open-ended, so there is no visible corner or edge. It is
       unlit on purpose: a backdrop that the key light can reach turns into a
       grey wash and swallows the coin's edge. */
    var wall = new T.Mesh(
      new T.CylinderGeometry(7, 7, 12, 48, 1, true),
      new T.MeshBasicMaterial({ map: wallCanvas(), side: T.BackSide, fog: true }));
    wall.position.y = 4.4;
    scene.add(wall);
  }

  function buildLights(){
    scene.add(new T.HemisphereLight(0x9fc4ff, 0x2a1c08, 0.20));

    /* the key: warm, high, front-left. It is the only shadow caster, so there
       is one clean shadow instead of a pile of weak ones. */
    var key = new T.SpotLight(0xfff2dc, 2.3, 0, 0.46, 0.66, 0);
    key.position.set(1.55, 2.85, 1.45);
    key.target.position.set(0, 0.06, 0);
    key.castShadow = !!Q.shadows;
    if (key.castShadow){
      var size = Q.dpr > 1.5 ? 2048 : 1024;
      key.shadow.mapSize.set(size, size);
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 9;
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = 0.0035;
      key.shadow.radius = 3.0;
    }
    scene.add(key); scene.add(key.target);
    lights.key = key;

    /* the rim: cool, behind and to the right. On a metal coin this is what
       draws the bright edge that separates it from the background. */
    var rim = new T.SpotLight(0xbcd6f2, 1.35, 0, 0.52, 0.74, 0);
    rim.position.set(-2.10, 1.75, -2.55);
    rim.target.position.set(0, 0.05, 0);
    scene.add(rim); scene.add(rim.target);
    lights.rim = rim;

    /* a warm bounce off the stone, so the underside never goes dead */
    var bounce = new T.PointLight(0xff9d4a, 1.15, 7, 2.0);
    bounce.position.set(0.55, 0.22, 1.05);
    scene.add(bounce);
    lights.bounce = bounce;

    /* the impact flash: dead until the coin actually hits, then a spike that
       decays. It is driven by the measured impact speed, not by a timer. */
    var flash = new T.PointLight(0xffe0a8, 0, 2.4, 2.0);
    flash.position.set(0, 0.06, 0);
    scene.add(flash);
    lights.flash = flash;
    lights.flashPower = 0;
  }


  /* ======================= the one camera rig ============================
     A single continuous rig, never cut. Four scalars are damped toward what
     the shot wants — azimuth, distance, height, aim — and the camera is placed
     from them, so the motion reads like an operator following a coin rather
     than a keyframed flythrough. The azimuth is deliberately the slowest to
     move: it is what gives the shot its weight.                            */
  var rig = { az: 4.0, dist: 1.0, camY: 0.40, lookY: 0.03, base: 4.0,
              push: 0 };
  var camPos = null, camLook = null;
  var AX_X = null, AX_Y = null, qA = null, qB = null, qC = null;
  var rigPush = 0;

  function approach(cur, target, k, dt){
    return cur + (target - cur) * (1 - Math.exp(-k * dt));
  }

  function camWant(view){
    var st = view.st;
    var h = view.reduce ? 0 : st.y;
    var w = {};
    /* The aim rides with the coin with a small downward bias, so the coin sits
       just above centre — the HUD owns the bottom third of the frame. During
       the flight the camera rises as fast as the coin and pulls back only a
       little: a crane that follows, not a dolly that runs away. */
    /* The aim leads a falling coin, exactly as an operator would: without it a
       follower that is chasing a steadily moving target settles behind it, and
       on the descent that lag is what would park the coin behind the HUD. */
    var lead = (view.vy || 0) * 0.030;
    w.lookY = st.y - 0.045 + Math.min(0, lead);
    w.camY = 0.42 + h * 0.68;
    w.dist = 0.92 + h * 0.26;
    w.az = rig.base + (view.reduce ? 0 : view.clock * 0.075);
    if (!st.airborne && st.t > 0){      /* the reveal: drift round, push in  */
      w.dist = 0.84 - rigPush * 0.12;
      w.camY = 0.45;
      w.lookY = -0.022;
      w.az = rig.base + 0.30 + rigPush * 0.34;
    }
    return w;
  }

  function updateCam(view, dt){
    var w = camWant(view);
    /* Fast enough to keep a coin that crosses 1.4 m in half a second in frame,
       slow enough that the move still reads as a camera and not a snap. These
       are deliberately high: a first-order follower chasing a target that is
       moving at a steady rate settles a fixed distance behind it, and on the
       descent that lag is exactly what pushes the coin off the bottom of the
       frame. */
    rig.dist = approach(rig.dist, w.dist, 6.0, dt);
    rig.camY = approach(rig.camY, w.camY, 11.0, dt);
    rig.lookY = approach(rig.lookY, w.lookY, 16.0, dt);
    rig.az = approach(rig.az, w.az, view.reduce ? 6.0 : 1.7, dt);
    if (!view.reduce && !view.st.airborne && view.st.t > 0){
      rigPush = Math.min(1, rigPush + dt * 0.55);     /* the slow push in */
    }
    camLook.set(0, rig.lookY, 0);
    camPos.set(Math.sin(rig.az) * rig.dist, Math.max(0.10, rig.camY),
               Math.cos(rig.az) * rig.dist);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.fov = Q.fov - rigPush * 1.8;               /* a touch of dolly */
    camera.updateProjectionMatrix();
  }

  /* ------------------------------ the pose -------------------------------- */
  function poseCoin(st){
    coinG.position.set(0, st.y, 0);
    qA.setFromAxisAngle(AX_Y, st.yaw);
    qB.setFromAxisAngle(AX_X, st.theta);      /* this is the face-decider */
    qC.setFromAxisAngle(AX_Y, st.roll);       /* about the coin's own axis */
    coinG.quaternion.copy(qA).multiply(qB).multiply(qC);
  }



  /* ============================== post ===================================
     One composite pass over the whole frame — bloom, a filmic vignette, film
     grain and a whisper of chromatic aberration. The coin is a small bright
     object in a dark room, which is exactly the case bloom exists for.     */
  var FX = { quadScene: null, cam: null, rt: null, rtA: null, rtB: null,
             bright: null, blur: null, comp: null };

  function fxQuad(mat){
    var mesh = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    FX.quadScene.add(mesh);
    return mesh;
  }

  function buildFx(){
    FX.quadScene = new T.Scene();
    FX.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var VS = 'varying vec2 vUv; void main(){ vUv = uv;' +
             ' gl_Position = vec4(position.xy, 0.0, 1.0); }';

    FX.bright = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, texel: { value: new T.Vector2() },
                  threshold: { value: 0.94 } },
      vertexShader: VS,
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold;' +
        'varying vec2 vUv;' +
        'void main(){' +
        ' vec4 c = texture2D(tDiffuse, vUv);' +
        ' c += texture2D(tDiffuse, vUv + vec2(texel.x, 0.0));' +
        ' c += texture2D(tDiffuse, vUv - vec2(texel.x, 0.0));' +
        ' c += texture2D(tDiffuse, vUv + vec2(0.0, texel.y));' +
        ' c += texture2D(tDiffuse, vUv - vec2(0.0, texel.y));' +
        ' c /= 5.0;' +
        ' float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));' +
        ' float k = smoothstep(threshold, threshold + 0.28, l);' +
        ' gl_FragColor = vec4(c.rgb * k, 1.0); }'
    });

    FX.blur = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, dir: { value: new T.Vector2() } },
      vertexShader: VS,
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;' +
        'void main(){' +
        ' vec4 s = texture2D(tDiffuse, vUv) * 0.227;' +
        ' s += (texture2D(tDiffuse, vUv + dir * 1.3846) +' +
        '       texture2D(tDiffuse, vUv - dir * 1.3846)) * 0.316;' +
        ' s += (texture2D(tDiffuse, vUv + dir * 3.2308) +' +
        '       texture2D(tDiffuse, vUv - dir * 3.2308)) * 0.070;' +
        ' gl_FragColor = s; }'
    });

    FX.comp = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, tBloom: { value: null },
        bloom: { value: 0.0 }, grain: { value: Q.grain },
        vig: { value: 0.55 }, ca: { value: Q.ca }, time: { value: 0 }
      },
      vertexShader: VS,
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform sampler2D tBloom;' +
        'uniform float bloom; uniform float grain; uniform float vig;' +
        'uniform float ca; uniform float time; varying vec2 vUv;' +
        'void main(){' +
        ' vec2 d = vUv - 0.5; float r2 = dot(d, d);' +
        ' float k = ca * r2 * 4.0;' +
        ' vec3 col;' +
        ' col.r = texture2D(tDiffuse, vUv - d * k).r;' +
        ' col.g = texture2D(tDiffuse, vUv).g;' +
        ' col.b = texture2D(tDiffuse, vUv + d * k).b;' +
        ' col += texture2D(tBloom, vUv).rgb * bloom;' +
        ' col *= 1.0 - vig * smoothstep(0.09, 0.60, r2 * 1.7);' +
        ' col = clamp(col, 0.0, 1.0);' +
        ' col = col * col * (3.0 - 2.0 * col) * 0.30 + col * 0.70;' +
        ' vec3 srgb = mix(col * 12.92,' +
        '   1.055 * pow(max(col, vec3(0.0)), vec3(0.4167)) - 0.055,' +
        '   step(vec3(0.0031308), col));' +
        /* the grain is applied last, on the display-referred value, so it also
           acts as the dither that hides 8-bit banding in a dark room */
        ' float n = fract(sin(dot(vUv * vec2(1234.5, 5678.9) + time,' +
        '   vec2(12.9898, 78.233))) * 43758.5453);' +
        ' srgb += (n - 0.5) * grain * 0.30;' +
        ' gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0); }'
    });

    fxQuad(FX.bright);
    fxQuad(FX.blur);
    fxQuad(FX.comp);
  }

  function fxTargets(w, h){
    var dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
    var pw = Math.max(2, Math.round(w * dpr)), ph = Math.max(2, Math.round(h * dpr));
    var bw = Math.max(2, Math.round(pw / 4)), bh = Math.max(2, Math.round(ph / 4));
    if (FX.rt) FX.rt.dispose();
    if (FX.rtA) FX.rtA.dispose();
    if (FX.rtB) FX.rtB.dispose();
    FX.rt = new T.WebGLRenderTarget(pw, ph, { minFilter: T.LinearFilter,
      magFilter: T.LinearFilter, depthBuffer: true });
    var opt = { minFilter: T.LinearFilter, magFilter: T.LinearFilter,
                depthBuffer: false };
    FX.rtA = new T.WebGLRenderTarget(bw, bh, opt);
    FX.rtB = new T.WebGLRenderTarget(bw, bh, opt);
  }

  function blit(mat, target){
    FX.quadScene.children.forEach(function(m){
      m.visible = (m.material === mat);
    });
    renderer.setRenderTarget(target || null);
    renderer.render(FX.quadScene, FX.cam);
  }

  function postFX(time){
    blit(FX.bright, FX.rtA);
    FX.blur.uniforms.tDiffuse.value = FX.rtA.texture;
    FX.blur.uniforms.dir.value.set(0.85 / FX.rtA.width, 0);
    blit(FX.blur, FX.rtB);
    FX.blur.uniforms.tDiffuse.value = FX.rtB.texture;
    FX.blur.uniforms.dir.value.set(0, 0.85 / FX.rtB.height);
    blit(FX.blur, FX.rtA);

    FX.comp.uniforms.tDiffuse.value = FX.rt.texture;
    FX.comp.uniforms.tBloom.value = FX.rtA.texture;
    FX.comp.uniforms.bloom.value = Q.bloom ? 0.30 : 0.0;
    FX.comp.uniforms.time.value = time;
    blit(FX.comp, null);
  }

  /* ============================== the frame ==============================
     `view` is handed over by script.js: the world state, the spin speed, the
     measured impact and whether the toss has changed. Nothing here decides an
     outcome — the coin is posed from the model that the tests already proved. */
  var seen = { tossId: -1 };
  var tmpUp = null;
  var sceneStats = { calls: 0, tris: 0 };
  /* a one-shot pixel sampler: the visual pass can be checked with numbers
     instead of by eye, which is how a black-on-gold relief gets caught */
  var sampleReq = null, sampleOut = null;

  function sample(pts){ sampleReq = pts || []; sampleOut = null; }

  function runSample(){
    if (!sampleReq) return;
    var gl = renderer.getContext();
    var w = renderer.domElement.width, h = renderer.domElement.height;
    var out = [];
    for (var i = 0; i < sampleReq.length; i++){
      var p = sampleReq[i];
      var px = Math.max(0, Math.min(w - 1, Math.round(p[0] * w)));
      var py = Math.max(0, Math.min(h - 1, Math.round((1 - p[1]) * h)));
      var buf = new Uint8Array(4);
      try { gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); }
      catch (e){ out.push({ err: String(e.message || e) }); continue; }
      out.push({ at: [+p[0].toFixed(3), +p[1].toFixed(3)],
                 rgb: [buf[0], buf[1], buf[2]],
                 lum: Math.round(0.299 * buf[0] + 0.587 * buf[1] + 0.114 * buf[2]) });
    }
    sampleOut = out;
    sampleReq = null;
  }

  function frame(dt, view){
    if (!ready) return false;
    if (view.tossId !== seen.tossId){
      seen.tossId = view.tossId;
      rigPush = 0;
    }
    poseCoin(view.st);
    if (view.inspect){
      /* the inspector: a straight-down shot, used only by the capture driver to
         check the struck relief on each face without any perspective games */
      camera.position.set(0, 0.52, 0.0001);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
      camera.fov = 42;
      camera.updateProjectionMatrix();
    } else {
      camera.up.set(0, 1, 0);
      updateCam(view, dt);
    }

    /* the impact flash: script.js measures the impact speed, this makes it
       visible. A spike, then an exponential fall — the signature of a knock. */
    if (view.impact > 0){
      lights.flashPower = Math.min(1.7, lights.flashPower + view.impact * 1.6);
      lights.flash.position.set(0, Math.max(0.05, view.st.y), 0);
    }
    lights.flashPower *= Math.exp(-dt * 10);
    lights.flash.intensity = lights.flashPower * 8;

    /* the reveal lifts the key a little, so the landing feels like an event */
    lights.key.intensity = 2.3 + rigPush * 0.5;

    renderer.setRenderTarget(FX.rt);
    renderer.render(scene, camera);
    /* the scene's own cost, before the composite pass overwrites the counter */
    sceneStats.calls = renderer.info.render.calls;
    sceneStats.tris = renderer.info.render.triangles;
    postFX(view.clock || 0);
    runSample();
    return true;
  }

  /* the face that is actually pointing up in the rendered scene — derived from
     the coin's world matrix, so it is an independent check on the model */
  function upFace3d(){
    if (!ready) return '';
    tmpUp.set(0, 1, 0).applyQuaternion(coinG.quaternion);
    return tmpUp.y >= 0 ? 'heads' : 'tails';
  }

  function probe(){
    if (!ready) return { ok: false, err: err, dead: dead };
    return { ok: true, err: err,
             calls: sceneStats.calls, tris: sceneStats.tris,
             camDist: +camera.position.length().toFixed(3),
             camY: +camera.position.y.toFixed(3),
             upFace3d: upFace3d(),
             upY: tmpUp ? +tmpUp.y.toFixed(4) : 0,
             coinY: +coinG.position.y.toFixed(4),
             samples: sampleOut,
             quality: lastQuality };
  }

  /* where the coin actually lands on screen, in 0..1 with y measured from the
     top. A negative or >1 value means it is out of frame, which is exactly the
     sort of thing that is invisible in a thumbnail. */
  function coinScreen(){
    if (!ready) return null;
    var p = coinG.position.clone();
    var v = p.clone().project(camera);
    /* the screen size of the coin as well as its centre: without it a sample
       point is just a guess about how big the thing is */
    var e = p.clone().add(new T.Vector3(W3.COIN.r, 0, 0)).project(camera);
    return { x: +((v.x * 0.5 + 0.5)).toFixed(4),
             y: +((-v.y * 0.5 + 0.5)).toFixed(4),
             z: +v.z.toFixed(4),
             r: +Math.abs(e.x - v.x).toFixed(4) };
  }

  /* ----------------------- housekeeping / build --------------------------- */
  var lastQuality = '';

  function resize(){
    if (!ready) return;
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
    renderer.setSize(W, H, false);
    fxTargets(W, H);
    if (canvas){
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
    }
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  function build(level){
    lastQuality = level;
    canvas = document.createElement('canvas');
    canvas.id = 'coin3d';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
      'display:block;pointer-events:none';
    var stage = document.getElementById('stage') || document.body;
    stage.appendChild(canvas);

    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true,
                                     powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = Q.shadows;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.outputColorSpace = T.SRGBColorSpace;

    scene = new T.Scene();
    scene.background = new T.Color(0x05070a);
    scene.fog = new T.FogExp2(0x05070a, Q.fog);

    camera = new T.PerspectiveCamera(Q.fov, 1, 0.05, 60);
    camPos = new T.Vector3(); camLook = new T.Vector3();
    tmpUp = new T.Vector3();
    AX_X = new T.Vector3(1, 0, 0); AX_Y = new T.Vector3(0, 1, 0);
    qA = new T.Quaternion(); qB = new T.Quaternion(); qC = new T.Quaternion();

    W3 = window.WORLD;
    buildArena();
    buildLights();
    buildCoin();
    buildFx();
    resize();
    frame(0.016, { st: { y: W3.COIN.thick / 2, theta: 0, yaw: 0, roll: 0,
                         aerial: false, airborne: false, t: 0, height01: 0 },
                   spin01: 0, impact: 0, clock: 0, tossId: 0, reduce: false });
    return true;
  }

  function boot(done){
    if (ready){ done(true); return; }
    var want = want3d();
    if (want === '2d'){ dead = true; err = '2d requested'; done(false); return; }
    if (!window.WORLD){ dead = true; err = 'world.js missing'; done(false); return; }
    if (!hasGL()){ dead = true; err = 'no webgl'; done(false); return; }
    setQuality(want);
    loadThree(function(ok){
      if (!ok){ dead = true; err = err || 'three.js missing'; done(false); return; }
      try { build(want); ready = true; done(true); }
      catch (e){
        dead = true;
        err = String((e && e.message) || e);
        try { console.error('[coin] 3D build failed', e); } catch (e2){}
        done(false);
      }
    });
  }

  return { boot: boot, frame: frame, resize: resize, probe: probe,
           setQuality: setQuality, upFace3d: upFace3d, sample: sample,
           coinScreen: coinScreen,
           isReady: function(){ return ready; },
           isDead: function(){ return dead; },
           error: function(){ return err; },
           quality: function(){ return Q; } };
})();

