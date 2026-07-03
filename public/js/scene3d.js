// 3D table scene: renderer, camera, lights, round table, draw/discard piles,
// seated 3D avatars with face-down card fans, projected HTML name labels,
// active-colour glow, and card play/draw animations.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildAvatar, animateAura } from './avatars.js';
import { getTexture, getTextureSync, getBackTexture, isWild, COLOR_HEX } from './cards.js';
import { sfx } from './sound.js';

const TABLE_R = 3.5;
const SEAT_R = 4.0;
const CARD_W = 0.82, CARD_H = 1.23, TABLE_Y = 0.92;
const FRONT = Math.PI / 2; // local player's angle (toward camera, +Z)

export class Scene3D {
  constructor() {
    this.tweens = [];
    this.anims = [];          // per-frame animations: fn(elapsedSeconds) => done?
    this.seats = new Map();   // playerId -> { group, avatar, fan, label, ringMesh, headY, pos }
    this.lastSeq = 0;
    this.displayedTopFile = null;
    this.onCatch = null;      // (playerId) => {}
    this.onDrawPile = null;   // () => {}
    this.state = null;
    this.celebration = null;  // active winner-podium celebration
  }

  init(canvas, labelsEl) {
    this.labelsEl = labelsEl;
    // floating "draw" hint over the draw pile
    this.drawHint = document.createElement('div');
    this.drawHint.className = 'draw-hint';
    this.drawHint.textContent = 'ÇEK';
    this.drawHint.addEventListener('click', () => { if (this.onDrawPile) this.onDrawPile(); });
    labelsEl.appendChild(this.drawHint);
    this.myTurnCanDraw = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x2a2118, 24, 58); // reach far enough to show the back wall props

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    this.camTarget = new THREE.Vector3(0, 0.95, 0.2);
    this.camera.position.set(0, 6, 11);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.camTarget);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 16;
    this.controls.minPolarAngle = 0.55;
    this.controls.maxPolarAngle = 1.35;
    this.controls.rotateSpeed = 0.7;

    this.buildEnvironment();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    // treat draw-pile interaction as a tap (down+up with little movement) so it
    // doesn't fire while dragging the camera
    canvas.addEventListener('pointerdown', (e) => { this._downX = e.clientX; this._downY = e.clientY; this._downT = performance.now(); });
    canvas.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - (this._downX || 0), e.clientY - (this._downY || 0));
      if (moved < 8 && performance.now() - (this._downT || 0) < 500) this.onPointer(e);
    });

    addEventListener('resize', () => this.resize());
    addEventListener('pagehide', () => { try { this.renderer.forceContextLoss(); } catch {} });
    this.resize();
    this.animate();
  }

  buildEnvironment() {
    const s = this.scene;
    this.ambient = new THREE.AmbientLight(0xffffff, 0.32); s.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xfff4e2, 0x40362a, 1.2); s.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff1da, 1.4);
    key.position.set(5, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.camera.left = -10; key.shadow.camera.right = 10;
    key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
    key.shadow.bias = -0.0004;
    s.add(key);
    const rim = new THREE.DirectionalLight(0x6da8ff, 0.45);
    rim.position.set(-6, 5, -7); s.add(rim);
    const fill = new THREE.DirectionalLight(0xffd9a0, 0.4);
    fill.position.set(0, 4, 9); s.add(fill);
    // warm overhead lamp glow over the table (kept on `this` so plays can flash it)
    this.lamp = new THREE.PointLight(0xffe2b0, 60, 26, 2);
    this.lamp.position.set(0, 7.5, 1); s.add(this.lamp);

    // floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(26, 64),
      new THREE.MeshStandardMaterial({ color: 0x1d1711, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    s.add(floor);
    // soft warm pool of light on the floor around the table
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(9, 64),
      new THREE.MeshBasicMaterial({ color: 0x6b5230, transparent: true, opacity: 0.35 }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.01; s.add(pool);
    const poolInner = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 64),
      new THREE.MeshBasicMaterial({ color: 0x9c7740, transparent: true, opacity: 0.28 }));
    poolInner.rotation.x = -Math.PI / 2; poolInner.position.y = 0.02; s.add(poolInner);
    // decorative outer ring
    const deco = new THREE.Mesh(
      new THREE.RingGeometry(8.6, 9.0, 64),
      new THREE.MeshBasicMaterial({ color: 0xE0A53D, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    deco.rotation.x = -Math.PI / 2; deco.position.y = 0.03; s.add(deco);

    // table: felt top + wood rim + pedestal
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.18, 64),
      new THREE.MeshStandardMaterial({ color: 0x2f6b4d, roughness: 0.9 }));
    felt.position.y = TABLE_Y - 0.09; felt.receiveShadow = true; felt.castShadow = true;
    s.add(felt);
    // felt centre accent ring
    const centre = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.75, 48),
      new THREE.MeshBasicMaterial({ color: 0x215338, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    centre.rotation.x = -Math.PI / 2; centre.position.y = TABLE_Y + 0.005; s.add(centre);
    const tableRim = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE_R, 0.17, 16, 64),
      new THREE.MeshStandardMaterial({ color: 0x6b4d2e, roughness: 0.55, metalness: 0.15 }));
    tableRim.rotation.x = Math.PI / 2; tableRim.position.y = TABLE_Y; s.add(tableRim);
    // pedestal — kept SHORTER than the table so its top cap tucks under the
    // opaque felt; otherwise the top cap is coplanar with the felt surface and
    // z-fights, poking a dark blotch through the centre of the table.
    const PED_H = TABLE_Y - 0.12;
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.95, PED_H, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.8 }));
    ped.position.y = PED_H / 2; ped.receiveShadow = true; s.add(ped);

    // cozy room dressing around the table
    this.buildDecor();

    // active colour glow ring under the discard pile
    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.5, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, side: THREE.DoubleSide }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.set(0, TABLE_Y + 0.012, 0);
    s.add(this.glow);

    // piles
    this.discardGroup = new THREE.Group();
    this.discardGroup.position.set(0.95, TABLE_Y + 0.02, 0);
    s.add(this.discardGroup);

    this.drawGroup = new THREE.Group();
    this.drawGroup.position.set(-0.95, TABLE_Y + 0.02, 0);
    s.add(this.drawGroup);
    this.buildDrawPile();

    // the local player's own cards, shown face-up as a 3D preview "held" in front
    this.localFan = new THREE.Group();
    s.add(this.localFan);

    // a glowing halo + arrow that hovers over whoever's turn it is
    this.buildTurnMarker();
  }

  // Spinning golden halo with a down-pointing arrow + soft light; parked above
  // the current player every frame (see stepLiveScene). Makes "whose turn" pop.
  buildTurnMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.055, 10, 32),
      new THREE.MeshBasicMaterial({ color: 0xE0A53D, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; g.add(ring);
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.42, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    arrow.rotation.x = Math.PI; arrow.position.y = -0.55; g.add(arrow); // point down at the head
    const light = new THREE.PointLight(0xffce6a, 9, 6, 2); light.position.y = 0.2; g.add(light);
    g.visible = false; this.scene.add(g);
    this.turnMarker = { group: g, ring, arrow };
  }

  // Warm embers drifting up out of the back-wall fireplace.
  buildEmbers() {
    const N = 46;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1.7;
      pos[i * 3 + 1] = 0.7 + Math.random() * 2.2;
      pos[i * 3 + 2] = -11.15 + (Math.random() - 0.5) * 0.5;
      vel[i] = 0.4 + Math.random() * 0.9;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xff8a3a, size: 0.07, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(pts);
    this.embers = { pts, vel, count: N };
  }

  // ---- ambient room dressing: walls, hanging lamp, plants, dust motes ------
  buildDecor() {
    const s = this.scene;

    // a warm enclosing room so the table no longer floats in a black void
    const walls = new THREE.Mesh(
      new THREE.CylinderGeometry(20, 20, 26, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 1, side: THREE.BackSide }));
    walls.position.y = 9; s.add(walls);
    // darker skirting near the floor for depth
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(19.7, 19.7, 3.2, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1e150e, roughness: 1, side: THREE.BackSide }));
    skirt.position.y = 1.6; s.add(skirt);
    // a faint amber band high up, like wall trim catching the light
    const trim = new THREE.Mesh(
      new THREE.CylinderGeometry(19.8, 19.8, 0.5, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6b4d2e, roughness: 0.7, side: THREE.BackSide }));
    trim.position.y = 6.5; s.add(trim);

    // hanging lamp over the table (the warm PointLight already sits here)
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 4.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x161310, roughness: 0.9 }));
    cord.position.set(0, 8.7, 0.4); s.add(cord);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(1.35, 1.05, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide }));
    shade.position.set(0, 6.7, 0.4); s.add(shade);
    const shadeTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.6 }));
    shadeTop.position.set(0, 7.2, 0.4); s.add(shadeTop);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe6b8 }));
    bulb.position.set(0, 6.35, 0.4); s.add(bulb);

    // ---- an orderly, mirror-symmetric room ---------------------------------
    // Everything is laid out in matched left/right pairs (mirrored across the
    // x=0 centre line) on clean, fixed-radius rings, kept past the rug ring
    // (r > ~7) so the play area stays clear. Every side is dressed, including
    // behind the local player (+z); only a narrow central corridor is kept
    // open there so the view to the table stays unblocked.
    this.buildRug();

    // place a prop and its mirror image across the centre line in one call
    const pair = (make, x, z, ...rest) => {
      s.add(make.call(this, x, z, ...rest));
      s.add(make.call(this, -x, z, ...rest));
    };

    // --- BACK WALL: symmetric focal composition around the fireplace --------
    s.add(this.buildFireplace(0, -11.6));     // hearth dead-centre
    this.buildEmbers();                       // warm sparks drifting up from it
    pair(this.buildBookshelf, 3.8, -11.2);    // bookshelves flanking it
    pair(this.buildTallPlant, 6.4, -10.2);    // tall palms just outside them
    pair(this.buildFloorLamp, 9.0, -8.4);     // warm lamps lighting the corners

    // --- SIDE WALLS: matched dressing, evenly spaced front-to-back ----------
    pair(this.buildFloorLamp,  9.4,  4.8);    // lamps framing the camera view
    pair(this.buildPlant,      8.8,  3.4);    // bushy pots toward the front
    pair(this.buildPlant,     10.6,  0.0);    // ...and dead on the sides
    pair(this.buildTallPlant, 10.4, -4.4);    // tall palms toward the back
    pair(this.buildStool,      7.4, -3.0);    // a pair of stools tucked in
    pair(this.buildBookshelf, 12.0, -6.0);    // side bookshelves facing in

    // --- tidy barrel + crate clusters in the rear corners -------------------
    pair(this.buildBarrel, 8.6, -6.6);
    pair(this.buildCrate,  9.8, -5.8, 1.0);

    // --- a matched pair of chip-topped side tables near the camera ----------
    pair(this.buildSideTable, 11.4, 1.6);
    pair(this.buildChipStack, 11.4, 1.6);

    // --- tall stone columns framing the room on a clean ring ----------------
    for (const [x, z] of [[12.2, 5.2], [12.6, -2.0], [10.4, -9.6]]) pair(this.buildColumn, x, z);
    s.add(this.buildColumn(0, -13.2));        // one anchoring the back centre

    // --- wall sconces: an even, fully symmetric ring all the way around -----
    for (let k = 0; k < 8; k++) s.add(this.buildSconce(k * Math.PI / 4, 18.9, 5.4));
    // --- framed pictures on BOTH the back and front walls, mirrored ---------
    for (const c of [-Math.PI / 2, Math.PI / 2]) {   // back-centre and front-centre
      for (const t of [0.45, 1.05]) {
        s.add(this.buildPicture(c + t, 19.0, 4.4));
        s.add(this.buildPicture(c - t, 19.0, 4.4));
      }
    }

    // --- FRONT: dress the area behind the local player too -------------------
    // Mirrored pairs flank the player and the front wall; a clear central
    // corridor (|x| < ~5 at +z) is left open so the table view stays unblocked.
    pair(this.buildPlant,      5.4,  7.8);    // bushy pots framing the player
    pair(this.buildFloorLamp,  8.4,  7.8);    // warm lamps lighting them
    pair(this.buildBookshelf,  4.0, 12.6);    // bookshelves flanking the front wall
    pair(this.buildTallPlant,  7.4, 11.6);    // tall palms just outside them
    s.add(this.buildColumn(0, 13.4));         // a column anchoring the front centre

    // floating dust motes drifting in the lamp light
    const N = 130;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 6.5;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.8 + Math.random() * 6;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0xffdca0, size: 0.05, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    s.add(this.dust);
  }

  buildPlant(x, z) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.3, 0.68, 16),
      new THREE.MeshStandardMaterial({ color: 0x9c5a36, roughness: 0.85 }));
    pot.position.y = 0.34; pot.castShadow = true; pot.receiveShadow = true; g.add(pot);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0xb06a42, roughness: 0.85 }));
    rim.position.y = 0.66; g.add(rim);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d46, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.25, 7), leafMat);
      const a = (i / 5) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.17, 1.25, Math.sin(a) * 0.17);
      blade.rotation.z = Math.cos(a) * 0.5; blade.rotation.x = Math.sin(a) * 0.5;
      blade.castShadow = true; g.add(blade);
    }
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.45, 8), leafMat);
    top.position.y = 1.45; top.castShadow = true; g.add(top);
    g.position.set(x, 0, z);
    return g;
  }

  buildTallPlant(x, z) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.9, 14),
      new THREE.MeshStandardMaterial({ color: 0x7a4a2c, roughness: 0.85 }));
    pot.position.y = 0.45; pot.castShadow = true; pot.receiveShadow = true; g.add(pot);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 0.9 }));
    trunk.position.y = 1.9; g.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f9152, roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.6, 5), leafMat);
      const a = (i / 7) * Math.PI * 2;
      frond.position.set(Math.cos(a) * 0.3, 3.0, Math.sin(a) * 0.3);
      frond.rotation.z = Math.cos(a) * 1.0; frond.rotation.x = Math.sin(a) * 1.0;
      frond.castShadow = true; g.add(frond);
    }
    g.position.set(x, 0, z);
    return g;
  }

  buildBarrel(x, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 1.3, 16),
      new THREE.MeshStandardMaterial({ color: 0x6e4527, roughness: 0.8 }));
    body.position.y = 0.65; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 });
    for (const y of [0.3, 0.65, 1.0]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 20), hoopMat);
      hoop.rotation.x = Math.PI / 2; hoop.position.y = y; g.add(hoop);
    }
    g.position.set(x, 0, z);
    return g;
  }

  buildCrate(x, z, sz = 1) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz),
      new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.9 }));
    box.position.y = sz / 2; box.castShadow = true; box.receiveShadow = true; g.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(sz * 1.02, sz * 0.12, sz * 1.02),
      new THREE.MeshStandardMaterial({ color: 0x5e3c20, roughness: 0.9 }));
    band.position.y = sz * 0.5; g.add(band);
    g.position.set(x, 0, z); g.rotation.y = Math.random() * Math.PI;
    return g;
  }

  buildBookshelf(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.85 });
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 0.5), wood);
    cabinet.position.y = 1.7; cabinet.castShadow = true; cabinet.receiveShadow = true; g.add(cabinet);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x1c120a, roughness: 1 }));
    back.position.set(0, 1.7, 0.18); g.add(back);
    const colors = [0xb24b3a, 0x3a6db2, 0x6aa15a, 0xd0a23e, 0x8a4fb0, 0xc56a3a];
    for (let shelf = 0; shelf < 3; shelf++) {
      for (let b = 0; b < 7; b++) {
        const h = 0.55 + Math.random() * 0.2;
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.34),
          new THREE.MeshStandardMaterial({ color: colors[(shelf * 7 + b) % colors.length], roughness: 0.8 }));
        book.position.set(-0.95 + b * 0.28, 0.55 + shelf * 1.0 + h / 2, 0.22);
        book.rotation.z = (Math.random() - 0.5) * 0.06; g.add(book);
      }
    }
    g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z); // face the table
    return g;
  }

  buildFloorLamp(x, z) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x33312e, roughness: 0.5, metalness: 0.5 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.1, 16), metal);
    base.position.y = 0.05; g.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 8), metal);
    pole.position.y = 1.5; g.add(pole);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.75, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xd9a04a, roughness: 0.6, emissive: 0xffb347, emissiveIntensity: 0.7, side: THREE.DoubleSide }));
    shade.position.y = 3.2; g.add(shade);
    g.position.set(x, 0, z);
    return g;
  }

  buildStool(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.85 });
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 16), wood);
    seat.position.y = 0.9; seat.castShadow = true; seat.receiveShadow = true; g.add(seat);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), wood);
      leg.position.set(Math.cos(a) * 0.28, 0.45, Math.sin(a) * 0.28);
      leg.rotation.z = Math.cos(a) * 0.12; leg.rotation.x = -Math.sin(a) * 0.12; g.add(leg);
    }
    g.position.set(x, 0, z);
    return g;
  }

  buildSideTable(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5e3c22, roughness: 0.8 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 20), wood);
    top.position.y = 1.0; top.castShadow = true; top.receiveShadow = true; g.add(top);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 10), wood);
    stem.position.y = 0.5; g.add(stem);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16), wood);
    foot.position.y = 0.04; g.add(foot);
    g.position.set(x, 0, z);
    return g;
  }

  buildChipStack(x, z) {
    const g = new THREE.Group();
    const cols = [0xc0392b, 0x2471a3, 0x27ae60, 0x34495e];
    for (let st = 0; st < 3; st++) {
      const n = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.035, 16),
          new THREE.MeshStandardMaterial({ color: cols[st % cols.length], roughness: 0.5 }));
        chip.position.set((st - 1) * 0.36, 1.07 + i * 0.037, 0); g.add(chip);
      }
    }
    g.position.set(x, 0, z);
    return g;
  }

  buildColumn(x, z) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3027, roughness: 0.9 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 7, 16), stone);
    shaft.position.y = 3.5; shaft.castShadow = true; g.add(shaft);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 1.3), stone);
    cap.position.y = 7.1; g.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.3), stone);
    base.position.y = 0.25; g.add(base);
    g.position.set(x, 0, z);
    return g;
  }

  buildSconce(angle, radius, y) {
    const g = new THREE.Group();
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8 }));
    g.add(bracket);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcf87 }));
    flame.position.y = 0.35; g.add(flame);
    g.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    g.rotation.y = Math.atan2(-Math.cos(angle), -Math.sin(angle));
    return g;
  }

  buildPicture(angle, radius, y) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x6b4d2e, roughness: 0.6, metalness: 0.2 }));
    g.add(frame);
    const arts = [0x2e5a7a, 0x7a5a2e, 0x4a6a3a, 0x6a3a4a];
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0),
      new THREE.MeshStandardMaterial({ color: arts[Math.floor(Math.random() * arts.length)], roughness: 0.9 }));
    art.position.z = 0.05; g.add(art);
    g.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    g.rotation.y = Math.atan2(-Math.cos(angle), -Math.sin(angle));
    return g;
  }

  buildFireplace(x, z) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x4a4039, roughness: 0.95 });
    const surround = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 0.8), stone);
    surround.position.y = 1.6; surround.castShadow = true; surround.receiveShadow = true; g.add(surround);
    const opening = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.9, 0.55),
      new THREE.MeshBasicMaterial({ color: 0x140a05 }));
    opening.position.set(0, 1.15, 0.25); g.add(opening);
    const fire = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.95 }));
    fire.position.set(0, 0.95, 0.34); g.add(fire);
    const mantel = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.32, 1.05),
      new THREE.MeshStandardMaterial({ color: 0x5e3c22, roughness: 0.8 }));
    mantel.position.set(0, 2.55, 0.1); g.add(mantel);
    // a framed picture above the mantel
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.5, metalness: 0.3 }));
    frame.position.set(0, 3.7, 0.2); g.add(frame);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x3a5a72, roughness: 0.9 }));
    art.position.set(0, 3.7, 0.27); g.add(art);
    // warm flickering light from the hearth
    const light = new THREE.PointLight(0xff8a3a, 16, 16, 2);
    light.position.set(0, 1.2, 1.1); g.add(light);
    this.fireLight = light;
    g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z);
    return g;
  }

  buildClock(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2516, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.4, 0.5), wood);
    body.position.y = 1.7; body.castShadow = true; g.add(body);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24),
      new THREE.MeshStandardMaterial({ color: 0xf0e6c8, roughness: 0.7 }));
    face.position.set(0, 2.75, 0.26); g.add(face);
    const pend = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16),
      new THREE.MeshStandardMaterial({ color: 0xc9a13a, roughness: 0.4, metalness: 0.6 }));
    pend.position.set(0, 1.4, 0.26); g.add(pend);
    g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z);
    return g;
  }

  buildRug() {
    const s = this.scene;
    const med = new THREE.Mesh(new THREE.CircleGeometry(4.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x7a3f2e, roughness: 1, transparent: true, opacity: 0.5 }));
    med.rotation.x = -Math.PI / 2; med.position.y = 0.038; s.add(med);
    const bands = [[4.4, 5.0, 0x9c5a3e], [5.0, 5.6, 0x6b3a2e], [5.6, 6.2, 0x8a4a36], [6.2, 6.6, 0x4a2a1e]];
    for (const [ri, ro, c] of bands) {
      const m = new THREE.Mesh(new THREE.RingGeometry(ri, ro, 48),
        new THREE.MeshStandardMaterial({ color: c, roughness: 1, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.042; s.add(m);
    }
  }

  async buildDrawPile() {
    const back = await getBackTexture();
    const mat = new THREE.MeshBasicMaterial({ map: back, transparent: true });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), mat);
      c.rotation.x = -Math.PI / 2;
      c.position.y = i * 0.018;
      c.rotation.z = (Math.random() - 0.5) * 0.06;
      this.drawGroup.add(c);
    }
    this.drawPileTop = this.drawGroup.children[this.drawGroup.children.length - 1];
  }

  // ---- helpers -------------------------------------------------------------
  cardMaterial(file) {
    // If the face is already cached (preloaded) use it on this very frame so the
    // card is never blank. Otherwise stay transparent — not black — and pop in
    // when the texture finishes loading.
    const ready = getTextureSync(file);
    const mat = new THREE.MeshBasicMaterial({
      map: ready || null,
      color: 0xffffff,
      transparent: true,
      opacity: ready ? 1 : 0,
      side: THREE.DoubleSide,
    });
    if (!ready) {
      getTexture(file).then((t) => { if (t) { mat.map = t; mat.opacity = 1; mat.needsUpdate = true; } });
    }
    return mat;
  }

  seatAngle(rank, n) { return FRONT + rank * (Math.PI * 2 / n); }

  // Elliptical seating: narrow in width on portrait phones (so left/right
  // players fit) and wider on landscape desktops.
  computeSeatRadii() {
    const a = this.camera.aspect || 1;
    // keep avatars hugging the table rim (TABLE_R = 3.5) on every aspect ratio
    this.rx = THREE.MathUtils.clamp(SEAT_R * (0.62 + a * 0.30), 3.6, 4.2);
    this.rz = THREE.MathUtils.clamp(SEAT_R * (1.12 - a * 0.12), 3.8, 4.3);
  }

  seatPos(rank, n) {
    if (this.rx == null) this.computeSeatRadii();
    const a = this.seatAngle(rank, n);
    return new THREE.Vector3(Math.cos(a) * this.rx, 0, Math.sin(a) * this.rz);
  }

  relayoutSeats() {
    for (const seat of this.seats.values()) {
      const pos = this.seatPos(seat.rank, seat.n);
      seat.group.position.copy(pos);
      seat.group.rotation.y = Math.atan2(-pos.x, -pos.z);
      seat.pos = pos;
    }
  }

  // ---- state sync ----------------------------------------------------------
  setState(state) {
    this.state = state;
    const players = state.players || [];
    const n = players.length;
    const localSeat = (players.find((p) => p.isYou) || players[0] || { seat: 0 }).seat;

    // rebuild seats if the roster / cosmetics changed
    const sig = players.map((p) => `${p.id}:${JSON.stringify(p.cosmetics)}:${n}`).join('|');
    if (sig !== this._seatSig) { this.rebuildSeats(players, localSeat, n); this._seatSig = sig; }

    // update fans + labels + turn rings
    for (const p of players) {
      const seat = this.seats.get(p.id);
      if (!seat) continue;
      this.updateFan(seat, p);
      this.updateLabel(seat, p, state);
      seat.ringMesh.material.opacity = p.isCurrent ? 0.9 : 0.0;
    }
    this.updateLocalPreview(state);

    // active colour glow
    const hex = COLOR_HEX[state.activeColor] || '#ffffff';
    this.glow.material.color.set(hex);

    // draw-pile "ÇEK" hint (only on my turn, before I've drawn)
    const meP = players.find((p) => p.isYou);
    this.myTurnCanDraw = !!(meP && state.currentPlayerId === meP.id &&
      state.phase === 'playing' && state.turnState === 'play');
    this.drawHint.textContent = state.pendingDraw > 0 ? `+${state.pendingDraw} ÇEK` : 'ÇEK';

    // discard top (animate if a play event just happened)
    const top = state.top;
    const ev = state.event;
    const isNewEvent = !!(ev && ev.seq !== this.lastSeq);
    if (top) {
      if (ev && ev.seq !== this.lastSeq && ev.type === 'play' && ev.card && ev.playerId) {
        this.lastSeq = ev.seq;
        // snapshot the intended target + running +stack now — the flight lands
        // ~0.5s later, after state may have advanced, so we can't read it then.
        this.animatePlay(ev.playerId, ev.card, { victimId: state.currentPlayerId, colorHex: COLOR_HEX[state.activeColor] || '#ffffff', pending: ev.pendingDraw || 0 });
      } else if (ev && ev.seq !== this.lastSeq && ev.type === 'draw') {
        this.lastSeq = ev.seq;
        this.animateDraw(ev.playerId, ev.count || 1); // fly a flurry for big busted stacks
        if (top.file !== this.displayedTopFile) this.setDiscardTop(top);
      } else if (top.file !== this.displayedTopFile) {
        if (ev) this.lastSeq = ev.seq;
        this.setDiscardTop(top);
      } else if (ev) {
        this.lastSeq = ev.seq;
      }
    }
    // seat-side reactions (lastcard bursts, penalties, bomb pops) — visual only;
    // sounds/toasts are handled in ui.js so this just adds 3D flair.
    if (isNewEvent) this.onGameEvent(ev);
  }

  // 3D flourishes tied to non-play events (play impacts live in animatePlay).
  onGameEvent(ev) {
    if (!ev) return;
    const seat = this.seats.get(ev.playerId);
    if (!seat) return;
    const head = seat.pos.clone(); head.y = 2.35;
    const above = new THREE.Vector3(seat.pos.x, 2.05, seat.pos.z);
    const chest = new THREE.Vector3(seat.pos.x, 1.5, seat.pos.z);
    if (ev.type === 'lastcard') {
      this.spawnRays(new THREE.Vector3(seat.pos.x, 2.2, seat.pos.z), '#ffb03a', { size: 3.0, life: 0.7, n: 16 });
      this.popText(head, 'Son kart!', '#ff6a2a', { size: 1.3, rise: 1.7, life: 1.35 });
      this.spawnBurst(chest, '#ffb03a', { count: 36, speed: 4.6 });
      this.spawnShock(seat.pos, '#ffb03a', { r1: 2.2 });
    } else if (ev.type === 'lastcardPenalty') {
      this.flashSeat(seat, '#e64a4a'); this.shakeSeat(seat);
      this.popText(head, '+2', '#ff8d6a', { size: 1.05 });
      this.popIcon(above, 'alert', '#ff6a4a', { y: 0.5, size: 0.85 });
      this.spawnBurst(chest, '#ff5a4a', { count: 20 });
    } else if (ev.type === 'draw' && ev.busted) {
      // scale the drama with the size of the busted +stack (+2 vs a huge +12)
      const n = ev.count || 2, big = n >= 6, huge = n >= 10, g = Math.min(n, 16);
      const hot = huge ? '#ff2f22' : '#ff7a3a';
      this.flashSeat(seat, '#e64a4a'); this.shakeSeat(seat, huge ? 0.14 : big ? 0.1 : 0.08, huge ? 0.7 : 0.5);
      this.spawnRays(new THREE.Vector3(seat.pos.x, 1.8, seat.pos.z), hot, { size: 2.2 + g * 0.16, life: 0.6, n: big ? 18 : 12 });
      this.spawnShock(seat.pos, hot, { r1: 2 + g * 0.14 });
      this.popText(head, `+${n}`, hot, { size: big ? 1.5 : 1.2, rise: 1.6 });
      this.popIcon(above, 'burst', hot, { y: 0.5, size: big ? 1.1 : 0.95, spin: 3 });
      this.spawnBurst(chest, hot, { count: 20 + g * 2, speed: 4.2 });
    } else if (ev.type === 'draw' && ev.bomb) {
      this.popText(head, '+2', '#ffae3a', { size: 1.1 });
      this.popIcon(above, 'bomb', '#ffae3a', { y: 0.5, size: 0.95 });
      this.spawnBurst(chest, '#ffae3a', { count: 24 });
      this.shakeSeat(seat, 0.06, 0.4);
    }
  }

  rebuildSeats(players, localSeat, n) {
    // clear old
    for (const seat of this.seats.values()) {
      this.scene.remove(seat.group);
      seat.label.remove();
    }
    this.seats.clear();
    // note: don't wipe labelsEl wholesale — it also holds the persistent draw hint
    this.computeSeatRadii();

    for (const p of players) {
      const rank = ((p.seat - localSeat) % n + n) % n;
      const pos = this.seatPos(rank, n);
      const group = new THREE.Group();
      group.position.copy(pos);
      const facing = Math.atan2(-pos.x, -pos.z); // look toward centre
      group.rotation.y = facing;

      const avatar = buildAvatar(p.cosmetics || {});
      group.add(avatar);

      // turn ring under the seat
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 0.95, 32),
        new THREE.MeshBasicMaterial({ color: 0xE0A53D, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
      group.add(ring);

      // fan container (held cards), in front of avatar toward the table
      const fan = new THREE.Group();
      fan.position.set(0, 1.0, 0.55);
      fan.rotation.x = -0.5;
      group.add(fan);

      this.scene.add(group);

      const label = document.createElement('div');
      label.className = 'nlabel';
      this.labelsEl.appendChild(label);

      this.seats.set(p.id, { id: p.id, group, avatar, fan, label, ringMesh: ring, pos, rank, n, isLocal: p.isYou });
    }
  }

  updateFan(seat, p) {
    if (seat.isLocal) { seat.fan.visible = false; return; } // shown via localFan preview
    const want = Math.min(p.handCount, 12);
    const fan = seat.fan;
    while (fan.children.length < want) {
      getBackTexture().then((t) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 0.62, CARD_H * 0.62),
          new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
        fan.add(m); this.layoutFan(fan);
      });
      // avoid tight loop; break and let async fill on subsequent frames
      break;
    }
    while (fan.children.length > want) { const c = fan.children.pop(); c.geometry.dispose(); }
    this.layoutFan(fan);
    seat.fan._count = p.handCount;
  }

  layoutFan(fan) {
    const c = fan.children.length;
    fan.children.forEach((card, i) => {
      const t = c === 1 ? 0 : (i - (c - 1) / 2);
      card.position.x = t * 0.16;
      card.position.z = Math.abs(t) * -0.02;
      card.rotation.z = -t * 0.10;
      card.position.y = -Math.abs(t) * 0.03;
    });
  }

  updateLabel(seat, p, state) {
    const el = seat.label;
    const bits = [];
    if (p.isBot) bits.push('🤖');
    bits.push(p.isYou ? 'Sen' : p.name);
    let html = `<span>${bits.join(' ')}</span><span class="cnt">${p.handCount}</span>`;
    if (p.lastcardPending) html += ` <span class="lastcard">Son kart?</span>`;
    el.innerHTML = html;
    el.classList.toggle('cur', !!p.isCurrent);
    el.classList.toggle('owes-lastcard', !!p.lastcardPending);
  }

  // Build / refresh the local player's face-up preview fan in front of their seat.
  updateLocalPreview(state) {
    const fan = this.localFan;
    if (!fan) return;
    // sit clearly in front of the local avatar (camera side) so the held cards
    // never clip into the head; the face stays visible just above them
    fan.position.set(0, 1.12, (this.rz || 4) + 0.62);
    fan.rotation.x = -0.62;
    const hand = state.hand || [];
    const sig = hand.map((c) => c.file).join(',') + '|' + hand.length;
    if (this._localSig === sig) return;
    this._localSig = sig;
    while (fan.children.length) { const c = fan.children.pop(); c.geometry.dispose(); }
    const want = Math.min(hand.length, 14);
    for (let i = 0; i < want; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 0.5, CARD_H * 0.5), this.cardMaterial(hand[i].file));
      fan.add(mesh);
    }
    const c = fan.children.length;
    fan.children.forEach((m, i) => {
      const t = c === 1 ? 0 : (i - (c - 1) / 2);
      m.position.set(t * (c > 9 ? 0.26 : 0.34), -Math.abs(t) * 0.025, Math.abs(t) * -0.02);
      m.rotation.z = -t * 0.05;
    });
  }

  setDiscardTop(card) {
    if (this.displayedTopFile === card.file && this._lastTopId === card.id) return;
    this.displayedTopFile = card.file;
    this._lastTopId = card.id;
    // keep only a couple of cards beneath for depth, dispose the rest
    while (this.discardGroup.children.length > 2) {
      const c = this.discardGroup.children.shift();
      this.disposeDiscard(c);
    }
    // re-stack remaining cards low so the newest always sits clearly on top
    this.discardGroup.children.forEach((c, i) => { c.position.y = i * 0.02; });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), this.cardMaterial(card.file));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = (Math.random() - 0.5) * 0.18; // gentle scatter, top stays readable
    mesh.position.y = this.discardGroup.children.length * 0.02 + 0.005;
    // a joker takes on the chosen colour: a coloured backing peeks around it
    if (isWild(card)) this.addColorBacking(mesh);
    this.discardGroup.add(mesh);
  }

  // Colour the wild card on the pile with the active colour (frame + tinted corners).
  addColorBacking(cardMesh) {
    const hex = COLOR_HEX[this.state && this.state.activeColor] || '#ffffff';
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W * 1.16, CARD_H * 1.10),
      new THREE.MeshBasicMaterial({ color: hex }));
    back.position.z = -0.012; // just below the (flat) face -> peeks as a coloured border
    back.userData.isBacking = true;
    cardMesh.add(back);
  }

  disposeDiscard(c) {
    if (c.geometry) c.geometry.dispose();
    c.children.forEach((ch) => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
  }

  // ---- animations ----------------------------------------------------------
  // A card flicked from a seat onto the discard pile: it leaps in a tumbling
  // arc, casts a soft growing shadow, then slaps down flat with a tiny bounce.
  animatePlay(playerId, card, ctx = {}) {
    const seat = this.seats.get(playerId);
    const start = seat
      ? new THREE.Vector3(0, 1.05, 0.55).applyMatrix4(seat.group.matrixWorld)
      : new THREE.Vector3(0, 3, 0);
    const end = new THREE.Vector3(0.95, TABLE_Y + 0.06, 0);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), this.cardMaterial(card.file));
    mesh.position.copy(start);
    this.scene.add(mesh);

    // soft contact shadow that tracks the card across the table
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 22),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(start.x, TABLE_Y + 0.018, start.z);
    this.scene.add(shadow);

    const dist = Math.hypot(end.x - start.x, end.z - start.z);
    const arcH = 1.25 + dist * 0.12;
    const spins = 2 + Math.floor(Math.random() * 2);
    const tumbleAxis = new THREE.Vector3(Math.random() * 0.5 - 0.25, 1, Math.random() * 0.5 - 0.25).normalize();
    const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.5));
    const FLIGHT = 0.5, BOUNCE = 0.16;
    sfx.play('whoosh');
    let landed = false;

    this.addAnim((el) => {
      const k = Math.min(1, el / FLIGHT);
      const ease = 1 - Math.pow(1 - k, 2);          // easeOut horizontal travel
      const x = start.x + (end.x - start.x) * ease;
      const z = start.z + (end.z - start.z) * ease;
      const baseY = start.y + (end.y - start.y) * ease;
      const arc = Math.sin(k * Math.PI) * arcH;
      mesh.position.set(x, baseY + arc, z);

      // tumble in flight, settling flat as it lands
      const spinQ = new THREE.Quaternion().setFromAxisAngle(tumbleAxis, (1 - k) * spins * Math.PI * 2);
      mesh.quaternion.copy(spinQ).slerp(flatQ, k * k);

      // shadow tracks the ground point and tightens/darkens near touchdown
      shadow.position.set(x, TABLE_Y + 0.018, z);
      const closeness = 1 - arc / (arcH + 0.001);
      shadow.scale.setScalar(THREE.MathUtils.lerp(1.25, 0.7, closeness));
      shadow.material.opacity = THREE.MathUtils.lerp(0.08, 0.3, closeness);

      if (k < 1) return false;
      if (!landed) { landed = true; sfx.play('land'); this.playImpact(card, end, ctx); }

      // little squash-bounce settle
      const b = el - FLIGHT;
      mesh.quaternion.copy(flatQ);
      if (b < BOUNCE) {
        mesh.position.set(end.x, end.y + Math.sin((b / BOUNCE) * Math.PI) * 0.07, end.z);
        shadow.material.opacity = 0.3 * (1 - b / BOUNCE);
        return false;
      }
      this.scene.remove(mesh); mesh.geometry.dispose();
      this.scene.remove(shadow); shadow.geometry.dispose(); shadow.material.dispose();
      this.setDiscardTop(card);
      return true;
    });
  }

  // Face-down cards lifted off the draw pile into a hand. A normal draw flies one;
  // a busted +2/+4 stack flies a whole flurry (capped) so a big +N feels big.
  animateDraw(playerId, count = 1) {
    const seat = this.seats.get(playerId);
    if (!seat || !this.drawGroup) return;
    this.jiggleDrawPile();
    const n = Math.min(Math.max(1, count | 0), 8); // cap the visual flurry; the badge shows the true number
    for (let i = 0; i < n; i++) this.flyDrawnCard(seat, i * 0.09);
  }

  flyDrawnCard(seat, delay = 0) {
    getBackTexture().then((t) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 0.8, CARD_H * 0.8),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
      const start = new THREE.Vector3(-0.95, TABLE_Y + 0.12, 0);
      const end = new THREE.Vector3(0, 1.0, 0.55).applyMatrix4(seat.group.matrixWorld);
      mesh.position.copy(start); mesh.rotation.x = -Math.PI / 2; mesh.visible = false;
      this.scene.add(mesh);
      const DUR = 0.4, arcH = 0.6;
      this.addAnim((el) => {
        if (el < delay) return false;
        mesh.visible = true;
        const k = Math.min(1, (el - delay) / DUR);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const x = start.x + (end.x - start.x) * ease;
        const z = start.z + (end.z - start.z) * ease;
        const baseY = start.y + (end.y - start.y) * ease;
        mesh.position.set(x, baseY + Math.sin(k * Math.PI) * arcH, z);
        mesh.rotation.set(-Math.PI / 2 + ease * 0.9, 0, ease * 0.3); // tilt up to face the holder
        if (k < 1) return false;
        this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
        return true;
      });
    });
  }

  // ---- gameplay impact effects --------------------------------------------
  // Fired the instant a played card slaps the discard pile. Colour burst +
  // shockwave for every card; extra flair for wilds, +2/+4, skip and reverse.
  playImpact(card, at, ctx = {}) {
    const hex = ctx.colorHex || COLOR_HEX[this.state && this.state.activeColor] || '#ffffff';
    this.spawnShock(at, hex, {});
    this.spawnBurst(at, hex, { count: 22 });
    this.spawnRays(at, hex, { size: 2.2, life: 0.45 });
    if (this.glow) this.glow.userData.flash = 1;   // active-colour ring flashes bright
    if (this.lamp) this.lamp.userData.flash = 1;   // whole table gets a light punch

    const isW = isWild(card);
    if (isW) {
      for (const c of ['#E0A53D', '#4E7FB5', '#D9764A', '#6E9457']) this.spawnBurst(at, c, { count: 14, speed: 4.4 });
      this.spawnRays(at, '#ffffff', { size: 2.9, life: 0.6, n: 16 });
      this.popIcon(at, 'wild', '#ffffff', { y: 0.55, size: 1.2, spin: 6 });
    }

    const victim = ctx.victimId && this.seats.get(ctx.victimId);
    if (card.kind === 'draw2' || card.kind === 'wild_draw4') {
      const step = card.kind === 'draw2' ? 2 : 4;
      const pend = Math.max(step, ctx.pending || step); // the running accumulated +stack
      const big = pend >= 6;                            // stacked past a single card
      const g = Math.min(pend, 16);                     // clamp so effects don't run away
      const hot = pend >= 10 ? '#ff2f22' : '#ff7a3a';
      this.spawnShock(at, '#ff5a4a', { r1: 2.5 + g * 0.13, life: 0.55 });
      this.spawnRays(at, hot, { size: 2.3 + g * 0.14, life: 0.5, n: big ? 16 : 12 });
      if (big) this.spawnBurst(at, hot, { count: 10 + g, speed: 4.4 });
      this.popText(at, `+${pend}`, hot, { y: 0.6, size: big ? 1.35 : 1.15 });
      this.popIcon(at, 'alert', '#ffb44a', { y: 1.3, size: big ? 0.9 : 0.78 });
      if (victim) { this.flashSeat(victim, '#e64a4a'); this.shakeSeat(victim, big ? 0.09 : 0.06, big ? 0.5 : 0.4); this.shootCards(at, victim, Math.min(pend, 8)); }
    } else if (card.kind === 'skip') {
      this.spawnShock(at, '#ffd24a', { r1: 2.4 });
      this.popIcon(at, 'skip', '#ffd24a', { y: 0.55, size: 1.05 });
    } else if (card.kind === 'reverse') {
      this.spawnShock(at, '#7ac6ff', { r1: 2.0 });
      this.spawnShock(at, '#7ac6ff', { r1: 2.7, life: 0.6 });
      this.popIcon(at, 'reverse', '#bfe3ff', { y: 0.55, size: 1.15, spin: 7 });
    }
  }

  // A puff of additive point-sprites that fly out, arc down under gravity and fade.
  spawnBurst(pos, hex, { count = 22, speed = 3.2, size = 0.13, life = 0.7, gravity = 6 } = {}) {
    const arr = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y; arr[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2, up = 0.5 + Math.random() * 1.4, sp = speed * (0.5 + Math.random() * 0.8);
      vel.push([Math.cos(a) * sp, up * sp, Math.sin(a) * sp]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(hex), size, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, mat);
    this.scene.add(pts);
    let last = 0;
    this.addAnim((el) => {
      const dt = Math.min(0.05, el - last); last = el;
      for (let i = 0; i < count; i++) {
        vel[i][1] -= gravity * dt;
        arr[i * 3] += vel[i][0] * dt; arr[i * 3 + 1] += vel[i][1] * dt; arr[i * 3 + 2] += vel[i][2] * dt;
        if (arr[i * 3 + 1] < TABLE_Y) { arr[i * 3 + 1] = TABLE_Y; vel[i][1] *= -0.35; }
      }
      g.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - el / life);
      if (el < life) return false;
      this.scene.remove(pts); g.dispose(); mat.dispose(); return true;
    });
  }

  // An expanding flat ring that fades — reads as a shockwave on the table.
  spawnShock(pos, hex, { r0 = 0.25, r1 = 2.0, life = 0.45, y = 0.02, width = 0.16 } = {}) {
    const geo = new THREE.RingGeometry(r0, r0 + width, 44);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, (pos.y || TABLE_Y) + y, pos.z);
    this.scene.add(ring);
    this.addAnim((el) => {
      const k = Math.min(1, el / life);
      const s = THREE.MathUtils.lerp(1, r1 / r0, k);
      ring.scale.set(s, s, s); mat.opacity = 0.85 * (1 - k);
      if (k < 1) return false;
      this.scene.remove(ring); geo.dispose(); mat.dispose(); return true;
    });
  }

  // Shared float-up-and-fade animation for any billboard sprite.
  floatSprite(mat, tex, sp, pos, { rise, life, y, baseW, baseH, spin = 0 }) {
    sp.position.set(pos.x, pos.y + y, pos.z);
    sp.scale.set(baseW * 0.55, baseH * 0.55, 1); // start small so the pop reads
    sp.renderOrder = 1000;
    this.scene.add(sp);
    this.addAnim((el) => {
      const k = Math.min(1, el / life);
      sp.position.y = pos.y + y + rise * k;
      const pop = 0.55 + 0.45 * Math.min(1, el / 0.15);
      sp.scale.set(baseW * pop, baseH * pop, 1);
      if (spin) mat.rotation = spin * el;
      mat.opacity = k < 0.62 ? 1 : 1 - (k - 0.62) / 0.38;
      if (k < 1) return false;
      this.scene.remove(sp); tex.dispose(); mat.dispose(); return true;
    });
  }

  // A rounded "pill" badge with a word/number (e.g. "+4", "Son kart!") — no emoji.
  popText(pos, text, hex = '#ffffff', { size = 1, rise = 1.3, life = 1.1, y = 0 } = {}) {
    const W = 256, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 66px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const pw = Math.min(W - 6, tw + 60), ph = 92, px = (W - pw) / 2, py = (H - ph) / 2;
    roundRect(ctx, px, py, pw, ph, 30);
    ctx.fillStyle = 'rgba(12,9,6,0.74)'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = hex; ctx.stroke();
    ctx.fillStyle = hex; ctx.shadowColor = hex; ctx.shadowBlur = 14; ctx.fillText(text, W / 2, H / 2 + 3);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    this.floatSprite(mat, tex, new THREE.Sprite(mat), pos, { rise, life, y, baseW: 1.9 * size, baseH: 0.95 * size });
  }

  // A crisp vector icon (drawn like an SVG) floating up — replaces emoji glyphs.
  popIcon(pos, name, hex = '#ffffff', { size = 1, rise = 1.15, life = 1.15, y = 0, spin = 0 } = {}) {
    const S = 128, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = S * 0.09;
    drawIcon(ctx, name, hex, S);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    this.floatSprite(mat, tex, new THREE.Sprite(mat), pos, { rise, life, y, baseW: size, baseH: size, spin });
  }

  // A radiating starburst of light lines that scales up, spins a touch and fades.
  spawnRays(pos, hex, { size = 2.4, life = 0.5, y = 0.3, n = 12, spin = 0.6 } = {}) {
    const S = 256, c = S / 2, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = hex; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.shadowColor = hex; ctx.shadowBlur = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * S * 0.15, c + Math.sin(a) * S * 0.15);
      ctx.lineTo(c + Math.cos(a) * S * 0.46, c + Math.sin(a) * S * 0.46);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const sp = new THREE.Sprite(mat);
    sp.position.set(pos.x, pos.y + y, pos.z); sp.renderOrder = 998;
    this.scene.add(sp);
    this.addAnim((el) => {
      const k = Math.min(1, el / life);
      const s = THREE.MathUtils.lerp(0.4, size, 1 - Math.pow(1 - k, 2));
      sp.scale.set(s, s, 1);
      mat.rotation = spin * k;
      mat.opacity = (1 - k) * 0.95;
      if (k < 1) return false;
      this.scene.remove(sp); tex.dispose(); mat.dispose(); return true;
    });
  }

  // A pulsing coloured disc under a seat — a hit/penalty flash.
  flashSeat(seat, hex) {
    const geo = new THREE.CircleGeometry(0.95, 32);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = -Math.PI / 2; disc.position.set(seat.pos.x, 0.05, seat.pos.z);
    this.scene.add(disc);
    const life = 0.6;
    this.addAnim((el) => {
      mat.opacity = 0.6 * Math.max(0, 1 - el / life) * (0.5 + 0.5 * Math.abs(Math.sin(el * 32)));
      if (el < life) return false;
      this.scene.remove(disc); geo.dispose(); mat.dispose(); return true;
    });
  }

  // Quick horizontal jitter on a seat's avatar (took a penalty).
  shakeSeat(seat, mag = 0.06, dur = 0.4) {
    const av = seat.avatar; if (!av) return;
    this.addAnim((el) => {
      if (el >= dur) { av.position.x = 0; return true; }
      av.position.x = Math.sin(el * 52) * mag * (1 - el / dur);
      return false;
    });
  }

  // Face-down cards fly from the discard onto a victim's seat (a +2/+4 landing).
  shootCards(fromPos, seat, n) {
    const start = fromPos.clone();
    const end = new THREE.Vector3(0, 1.0, 0.4).applyMatrix4(seat.group.matrixWorld);
    for (let i = 0; i < n; i++) {
      getBackTexture().then((t) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 0.5, CARD_H * 0.5),
          new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
        m.position.copy(start); this.scene.add(m);
        const delay = i * 0.08, DUR = 0.42, arcH = 1.0 + Math.random() * 0.4, spin = 0.25 + Math.random() * 0.2;
        this.addAnim((el) => {
          if (el < delay) return false;
          const k = Math.min(1, (el - delay) / DUR), e = 1 - Math.pow(1 - k, 2);
          m.position.set(start.x + (end.x - start.x) * e, start.y + (end.y - start.y) * e + Math.sin(k * Math.PI) * arcH, start.z + (end.z - start.z) * e);
          m.rotation.z += spin; m.rotation.x = -k * 1.2;
          if (k < 1) return false;
          this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return true;
        });
      });
    }
  }

  // A brief scatter/settle on the draw pile when a card is taken off it.
  jiggleDrawPile() {
    if (!this.drawGroup) return;
    const kids = this.drawGroup.children;
    this.addAnim((el) => {
      const dur = 0.35;
      const damp = Math.max(0, 1 - el / dur);
      kids.forEach((c, i) => { c.rotation.z = (Math.sin(el * 40 + i) * 0.05) * damp + (i - kids.length / 2) * 0.002; });
      return el >= dur;
    });
  }

  // ---- per-frame living-scene touches (called every frame) -----------------
  stepLiveScene(t) {
    const st = this.state;
    const cur = st && !this.celebration && st.phase === 'playing' && st.currentPlayerId && this.seats.get(st.currentPlayerId);
    // active-colour glow breathes, and flashes bright right after a card lands
    if (this.glow) {
      const base = 0.3 + Math.abs(Math.sin(t * 2)) * 0.12;
      let f = this.glow.userData.flash || 0; f = Math.max(0, f - 0.035);
      this.glow.userData.flash = f;
      this.glow.material.opacity = Math.min(0.95, base + f * 0.55);
      const s = 1 + f * 0.18; this.glow.scale.set(s, s, s);
    }
    // overhead lamp punches brighter for a moment when a card lands
    if (this.lamp) {
      let f = this.lamp.userData.flash || 0; f = Math.max(0, f - 0.06);
      this.lamp.userData.flash = f;
      this.lamp.intensity = 60 + f * 75;
    }
    // the current player's floor ring pulses so the active seat is obvious
    if (cur && cur.ringMesh) {
      cur.ringMesh.material.opacity = 0.55 + Math.abs(Math.sin(t * 3.2)) * 0.4;
      const rs = 1 + Math.abs(Math.sin(t * 3.2)) * 0.07; cur.ringMesh.scale.set(rs, rs, rs);
    }
    // halo marker hovers over the current player
    if (this.turnMarker) {
      this.turnMarker.group.visible = !!cur;
      if (cur) {
        const bob = Math.sin(t * 3) * 0.09;
        this.turnMarker.group.position.set(cur.pos.x, 2.6 + bob, cur.pos.z);
        this.turnMarker.ring.rotation.z = t * 2.0;
        this.turnMarker.arrow.position.y = -0.55 + Math.sin(t * 3 + 1) * 0.05;
      }
    }
    // embers drift up from the hearth and recycle
    if (this.embers) {
      const arr = this.embers.pts.geometry.attributes.position.array;
      for (let i = 0; i < this.embers.count; i++) {
        arr[i * 3 + 1] += this.embers.vel[i] * 0.016;
        arr[i * 3] += Math.sin(t * 2 + i) * 0.002;
        if (arr[i * 3 + 1] > 4.2) { arr[i * 3 + 1] = 0.7; arr[i * 3] = (Math.random() - 0.5) * 1.7; }
      }
      this.embers.pts.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ---- per-frame animation runner -----------------------------------------
  addAnim(fn) { this.anims.push({ fn, t0: performance.now() }); }
  stepAnims(now) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      let done = false;
      try { done = a.fn((now - a.t0) / 1000); } catch { done = true; }
      if (done) this.anims.splice(i, 1);
    }
  }

  tween(target, { dur, from, to, onUpdate, onDone }) {
    this.tweens.push({ target, dur, from, to, onUpdate, onDone, t0: performance.now() });
  }

  stepTweens(now) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      let k = (now - tw.t0) / tw.dur;
      if (k >= 1) k = 1;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
      const o = {};
      for (const key in tw.from) o[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
      tw.onUpdate && tw.onUpdate(o, tw.target);
      if (k >= 1) { tw.onDone && tw.onDone(tw.target); this.tweens.splice(i, 1); }
    }
  }

  // ---- winner celebration: podium climb OR a cartoon "finisher" on the losers.
  // `finisher` is one of the FINISHERS ids; the winner picks it, everyone watches.
  celebrateWinner(winner, losers = [], finisher = 'podium', onDone) {
    if (this.celebration) this.endCelebration();
    const cos = (winner && winner.cosmetics) || {};
    const y0 = TABLE_Y;
    const group = new THREE.Group();
    this.scene.add(group);

    // hide seated avatars, piles and the turn marker so the stage is clean
    const hidden = [];
    for (const seat of this.seats.values()) { if (seat.group.visible) { seat.group.visible = false; hidden.push(seat.group); } if (seat.label) seat.label.style.display = 'none'; }
    for (const g of [this.localFan, this.discardGroup, this.drawGroup, this.glow, this.turnMarker && this.turnMarker.group]) { if (g && g.visible) { g.visible = false; hidden.push(g); } }
    if (this.drawHint) this.drawHint.classList.remove('show');

    const saved = {
      ambient: this.ambient ? this.ambient.intensity : null,
      hemi: this.hemi ? this.hemi.intensity : null,
      camTargetX: this.controls.target.x, camTargetY: this.controls.target.y, camTargetZ: this.controls.target.z,
      autoRotate: this.controls.autoRotate, autoRotateSpeed: this.controls.autoRotateSpeed,
      minD: this.controls.minDistance, maxD: this.controls.maxDistance,
    };
    if (this.ambient) this.ambient.intensity = 0.14;
    if (this.hemi) this.hemi.intensity = 0.5;
    this.controls.minDistance = 4; this.controls.maxDistance = 20;

    // shared celebration fx (confetti cloud, orbiting stage lights, ground ring)
    const { confetti, vel } = this.makeConfetti(group, y0 + 2.5);
    const lights = this.makeStageLights(group, y0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.2, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = y0 + 0.02; group.add(ring);

    let avatar, arms, auraGroup, step, dur, topY = y0;
    const isPodium = !finisher || finisher === 'podium';

    if (isPodium) {
      // golden 3-tier podium; champion climbs it and dances
      const podium = new THREE.Group();
      const gold = () => new THREE.MeshStandardMaterial({ color: 0xf2c043, roughness: 0.28, metalness: 0.65, emissive: 0x5a3d00, emissiveIntensity: 0.35 });
      let y = y0;
      for (const [r, h] of [[1.35, 0.34], [1.02, 0.34], [0.74, 0.42]]) {
        const tt = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 40), gold());
        tt.position.y = y + h / 2; tt.castShadow = true; podium.add(tt);
        const trim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 10, 40),
          new THREE.MeshStandardMaterial({ color: 0xfff1b0, roughness: 0.2, metalness: 0.8, emissive: 0xffcf5a, emissiveIntensity: 0.6 }));
        trim.rotation.x = Math.PI / 2; trim.position.y = y + h; podium.add(trim);
        y += h;
      }
      topY = y; group.add(podium);
      avatar = buildAvatar(cos); avatar.scale.setScalar(1.35); avatar.position.set(0, topY, 0); group.add(avatar);
      arms = (avatar.userData && avatar.userData.arms) || []; auraGroup = avatar.userData && avatar.userData.auraGroup;
      this.controls.autoRotate = true; this.controls.autoRotateSpeed = 3.2;
      this.controls.target.set(0, topY - 0.2, 0);
      this._camTween(0, topY + 1.6, 8.5);
      const ctx = { avatar, arms, auraGroup, topY };
      step = (el, t) => this.stepPodium(ctx, el, t);
      dur = 10.5;
    } else {
      // winner gloats on a riser at the back; losers line up front for the gag
      const riser = new THREE.Group();
      const rg = () => new THREE.MeshStandardMaterial({ color: 0xf2c043, roughness: 0.3, metalness: 0.6, emissive: 0x5a3d00, emissiveIntensity: 0.3 });
      let ry = y0;
      for (const [r, h] of [[1.0, 0.5], [0.7, 0.5]]) { const tt = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 32), rg()); tt.position.set(0, ry + h / 2, -1.6); riser.add(tt); ry += h; }
      const wy = ry; group.add(riser);
      avatar = buildAvatar(cos); avatar.scale.setScalar(1.15); avatar.position.set(0, wy, -1.6); group.add(avatar);
      arms = (avatar.userData && avatar.userData.arms) || []; auraGroup = avatar.userData && avatar.userData.auraGroup;
      const L = this.mkLoserRow(group, losers, y0);
      const fin = this.buildFinisher(finisher, L, group, y0);
      this.controls.autoRotate = false;
      this.controls.target.set(0, y0 + 0.7, 0.4);
      this._camTween(2.6, y0 + 3.5, 9.6);
      const gctx = { avatar, arms, auraGroup, wy };
      step = (el, t) => { this.stepWinnerGloat(gctx, el); fin.step(el, t); };
      dur = fin.dur;
    }

    sfx.play('fanfare'); sfx.startAnthem(isPodium ? 11000 : Math.round(dur * 1000));
    this.celebration = { group, confetti, vel, lights, ring, hidden, saved, onDone, step, dur, done: false, topY, y0 };
  }

  _camTween(px, py, pz) {
    const p = this.camera.position;
    this.tween(p, { dur: 700, from: { px: p.x, py: p.y, pz: p.z }, to: { px, py, pz }, onUpdate: (o) => this.camera.position.set(o.px, o.py, o.pz) });
  }

  makeConfetti(group, top) {
    const N = 240, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = new Float32Array(N), cc = new THREE.Color();
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 9; pos[i * 3 + 1] = top + 1 + Math.random() * 9; pos[i * 3 + 2] = (Math.random() - 0.5) * 9;
      cc.setHSL(Math.random(), 0.85, 0.6); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; vel[i] = 1.6 + Math.random() * 2.6;
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const confetti = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.17, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    group.add(confetti);
    return { confetti, vel };
  }

  makeStageLights(group, y0) {
    const lights = [];
    for (let i = 0; i < 3; i++) { const pl = new THREE.PointLight(0xffffff, 30, 22, 2); pl.position.set(Math.cos(i / 3 * Math.PI * 2) * 4, y0 + 3.2, Math.sin(i / 3 * Math.PI * 2) * 4); group.add(pl); lights.push(pl); }
    return lights;
  }

  stepCelebration(now, t) {
    const c = this.celebration;
    if (!c) return;
    const el = (now - (c.t0 || (c.t0 = now))) / 1000;
    try { if (c.step) c.step(el, t); } catch { /* never let a gag error freeze the win flow */ }
    this.stepStageFx(c, el);
    if (el >= c.dur && !c.done) { c.done = true; this.finishCelebration(); }
  }

  // confetti rain + orbiting coloured lights + pulsing ground ring (all finishers)
  stepStageFx(c, el) {
    if (c.confetti) {
      const arr = c.confetti.geometry.attributes.position.array;
      for (let i = 0; i < c.vel.length; i++) {
        arr[i * 3 + 1] -= c.vel[i] * 0.016; arr[i * 3] += Math.sin((el + i) * 2) * 0.01;
        if (arr[i * 3 + 1] < 0.1) { arr[i * 3 + 1] = c.y0 + 4 + Math.random() * 6; arr[i * 3] = (Math.random() - 0.5) * 9; arr[i * 3 + 2] = (Math.random() - 0.5) * 9; }
      }
      c.confetti.geometry.attributes.position.needsUpdate = true; c.confetti.rotation.y = el * 0.2;
    }
    if (c.lights) c.lights.forEach((pl, i) => { const a = el * 1.6 + i / 3 * Math.PI * 2; pl.position.set(Math.cos(a) * 4.2, c.y0 + 3 + Math.sin(el * 3 + i) * 0.6, Math.sin(a) * 4.2); pl.color.setHSL((el * 0.25 + i / 3) % 1, 0.9, 0.6); });
    if (c.ring) { c.ring.material.opacity = 0.3 + Math.abs(Math.sin(el * 3)) * 0.3; c.ring.material.color.setHSL((el * 0.25) % 1, 0.9, 0.6); }
  }

  // champion rises out of the podium then dances with pumping arms
  stepPodium(ctx, el, t) {
    const riseE = 1 - Math.pow(1 - Math.min(1, el / 0.9), 3);
    const danceT = Math.max(0, el - 0.6);
    ctx.avatar.position.y = ctx.topY - (1 - riseE) * 1.4 + Math.abs(Math.sin(danceT * 5)) * 0.18;
    ctx.avatar.rotation.y = Math.sin(danceT * 2.2) * 0.6;
    ctx.avatar.rotation.z = Math.sin(danceT * 4) * 0.07;
    ctx.arms.forEach((arm, i) => { const ph = i === 0 ? 0 : Math.PI; arm.rotation.z = arm.userData.baseRot.z + arm.userData.side * (1.4 + Math.sin(danceT * 9 + ph) * 0.7); arm.rotation.x = arm.userData.baseRot.x - 0.4 + Math.sin(danceT * 9 + ph) * 0.5; });
    if (ctx.auraGroup) animateAura(ctx.auraGroup, t * 1.6);
  }

  // winner bounces + arms up, gloating while the losers get theirs
  stepWinnerGloat(ctx, el) {
    ctx.avatar.position.y = ctx.wy + Math.abs(Math.sin(el * 4)) * 0.12;
    ctx.avatar.rotation.z = Math.sin(el * 3) * 0.05;
    ctx.arms.forEach((arm, i) => { const ph = i === 0 ? 0 : Math.PI; arm.rotation.z = arm.userData.baseRot.z + arm.userData.side * (1.2 + Math.sin(el * 6 + ph) * 0.5); arm.rotation.x = arm.userData.baseRot.x - 0.5; });
    if (ctx.auraGroup) animateAura(ctx.auraGroup, el * 1.4);
  }

  // ---- cartoon "finisher" gags on the losing players -----------------------
  // A row of loser avatars facing the camera; the winner gloats behind them.
  mkLoserRow(group, losers, y0) {
    const list = (losers || []).slice(0, 7);
    const N = list.length || 1;
    const spacing = Math.min(1.7, 5.6 / N);
    const L = [];
    list.forEach((p, i) => {
      const av = buildAvatar((p && p.cosmetics) || {});
      const x = (i - (N - 1) / 2) * spacing, z = 1.6;
      av.scale.setScalar(0.92); av.position.set(x, y0, z);
      group.add(av);
      L.push({ av, x, z, hit: false, at: 0 });
    });
    return L;
  }
  _c01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  _squash(av, k) { k = this._c01(k); av.scale.set(0.92 * (1 + k * 0.8), 0.92 * Math.max(0.12, 1 - k * 0.86), 0.92 * (1 + k * 0.8)); }
  _launch(av, k, y0) { k = this._c01(k); av.position.y = y0 + k * k * 24; av.rotation.y += 0.35; av.scale.setScalar(0.92 * Math.max(0.03, 1 - k)); }
  _vanish(av, k) { av.scale.setScalar(0.92 * Math.max(0, 1 - this._c01(k))); }

  mkAnvil() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.5, metalness: 0.6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.26, 0.5), m); base.position.y = 0.13; g.add(base);
    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.32), m); waist.position.y = 0.35; g.add(waist);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.32, 0.56), m); top.position.y = 0.6; g.add(top);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 12), m); horn.rotation.z = -Math.PI / 2; horn.position.set(0.72, 0.6, 0); g.add(horn);
    return g; // origin at the bottom
  }
  mkChicken() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.75 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 16), white); body.position.y = 1.25; body.scale.set(1, 0.92, 1.2); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), white); head.position.set(0, 2.5, 0.5); g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0xf2a13a })); beak.rotation.x = Math.PI / 2; beak.position.set(0, 2.46, 1.05); g.add(beak);
    const comb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0xd23a3a })); comb.position.set(0, 2.98, 0.45); comb.scale.set(1.5, 0.7, 0.6); g.add(comb);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: 0x111111 })); eye.position.set(s * 0.22, 2.62, 0.96); g.add(eye);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xf2a13a })); leg.position.set(s * 0.3, 0.35, 0); g.add(leg);
    }
    return g; // origin at feet
  }

  // Build the chosen gag: adds props to `group`, returns { step(el), dur }.
  buildFinisher(name, L, group, y0) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    if (name === 'anvil') {
      L.forEach((l, i) => { const a = this.mkAnvil(); a.position.set(l.x, y0 + 9, l.z); a.visible = false; group.add(a); l.anvil = a; l.at = 0.7 + i * 0.5; });
      return { dur: 1 + L.length * 0.5 + 2.4, step: (el) => {
        L.forEach((l) => {
          if (el < l.at) { l.anvil.visible = false; return; }
          l.anvil.visible = true;
          const headY = y0 + 2.0, restY = y0 + 0.2, fall = this._c01((el - l.at) / 0.3);
          if (fall < 1) { l.anvil.position.y = y0 + 9 - (y0 + 9 - headY) * fall; return; }
          const sq = this._c01((el - (l.at + 0.3)) / 0.35);
          this._squash(l.av, sq); l.anvil.position.y = headY - (headY - restY) * sq;
          if (!l.hit) { l.hit = true; this.spawnBurst(V(l.x, y0 + 0.4, l.z), '#c9ccd2', { count: 18 }); this.spawnShock(V(l.x, y0, l.z), '#dddddd', { r1: 1.4 }); }
        });
      } };
    }
    if (name === 'flatten') {
      const roller = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 3.0, 24), new THREE.MeshStandardMaterial({ color: 0x9a9ea6, metalness: 0.5, roughness: 0.4 }));
      drum.rotation.x = Math.PI / 2; drum.position.y = 0.95; roller.add(drum);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 3.2), new THREE.MeshStandardMaterial({ color: 0xd23a3a, roughness: 0.6 })); frame.position.y = 1.65; roller.add(frame);
      const startX = -6.5, endX = 6.5, travel = 3.6;
      roller.position.set(startX, y0, 1.6); group.add(roller);
      return { dur: travel + 2.2, step: (el) => {
        const k = this._c01(el / travel), x = startX + (endX - startX) * k;
        roller.position.x = x; drum.rotation.y = -k * 40;
        L.forEach((l) => { if (x > l.x - 0.9) { const sq = this._c01((x - (l.x - 0.9)) / 0.9); this._squash(l.av, sq); if (!l.hit && sq > 0.1) { l.hit = true; this.spawnBurst(V(l.x, y0 + 0.3, l.z), '#c9ccd2', { count: 12 }); } } });
      } };
    }
    if (name === 'chicken') {
      const chicken = this.mkChicken(); chicken.position.set(-5, y0, 0.2); group.add(chicken);
      const per = 0.9;
      return { dur: 1 + L.length * per + 2, step: (el) => {
        const idx = Math.min(Math.floor(el / per), L.length - 1), tgt = L[idx];
        chicken.position.x += (tgt.x - chicken.position.x) * 0.15;
        chicken.position.z = tgt.z - 1.4;
        chicken.position.y = y0 + Math.abs(Math.sin(el * 9)) * 0.5;
        chicken.rotation.z = Math.sin(el * 9) * 0.08;
        L.forEach((l, i) => { const at = 0.6 + i * per; if (el > at) { const k = this._c01((el - at) / 0.5); this._vanish(l.av, k); if (!l.hit && k > 0.15) { l.hit = true; this.spawnBurst(V(l.x, y0 + 1, l.z), '#ffffff', { count: 20, gravity: 3 }); } } });
      } };
    }
    if (name === 'launch') {
      L.forEach((l, i) => { l.at = 0.6 + i * 0.35; const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xd23a3a, roughness: 0.5 })); cone.position.set(l.x, y0 - 0.6, l.z); cone.visible = false; group.add(cone); l.rocket = cone; });
      return { dur: 0.6 + L.length * 0.35 + 2.4, step: (el) => {
        L.forEach((l) => {
          if (el < l.at) return;
          const k = this._c01((el - l.at) / 1.6);
          if (!l.hit) { l.hit = true; this.spawnBurst(V(l.x, y0, l.z), '#ff8a3a', { count: 22, speed: 4 }); }
          this._launch(l.av, k, y0);
          l.rocket.visible = k < 0.98; l.rocket.position.set(l.x, y0 + k * k * 24 - 0.7, l.z); l.rocket.rotation.z += 0.2;
        });
      } };
    }
    if (name === 'tnt') {
      const tnt = new THREE.Group();
      const box = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.0, 16), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 })); box.position.y = 0.5; tnt.add(box);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd24a })); tip.position.set(0.16, 1.12, 0); tnt.add(tip);
      tnt.position.set(0, y0, 1.4); group.add(tnt);
      const boomAt = 2.2; let boomed = false;
      return { dur: boomAt + 2.2, step: (el) => {
        tip.scale.setScalar(0.7 + Math.abs(Math.sin(el * 20)) * 0.6);
        tnt.position.y = y0 + Math.abs(Math.sin(el * 10)) * 0.05;
        if (el < boomAt) return;
        if (!boomed) {
          boomed = true; tnt.visible = false;
          this.spawnShock(V(0, y0, 1.4), '#ffae3a', { r1: 5, life: 0.7 });
          for (const cc of ['#ffae3a', '#ff5a2a', '#ffffff']) this.spawnBurst(V(0, y0 + 0.5, 1.4), cc, { count: 40, speed: 6, life: 1.0 });
          if (this.lamp) this.lamp.userData.flash = 1.6;
        }
        const k = this._c01((el - boomAt) / 1.4);
        L.forEach((l) => { this._launch(l.av, k, y0); l.av.position.x = l.x + l.x * k * 0.6; });
      } };
    }
    if (name === 'freeze') {
      L.forEach((l, i) => { l.at = 0.5 + i * 0.3; const ice = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.6, 1.0), new THREE.MeshStandardMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.42, roughness: 0.1, metalness: 0.1 })); ice.position.set(l.x, y0 + 1.3, l.z); ice.scale.setScalar(0.01); ice.visible = false; group.add(ice); l.ice = ice; });
      return { dur: 0.5 + L.length * 0.3 + 2.6, step: (el) => {
        L.forEach((l) => {
          if (el < l.at) return;
          const k = this._c01((el - l.at) / 0.4);
          l.ice.visible = true; l.ice.scale.setScalar(k);
          l.av.rotation.z = Math.sin(el * 30) * 0.03 * (1 - k);
          if (!l.hit) { l.hit = true; this.spawnBurst(V(l.x, y0 + 1, l.z), '#cdeeff', { count: 16, gravity: 2 }); }
        });
      } };
    }
    if (name === 'pie') {
      L.forEach((l, i) => {
        l.at = 0.6 + i * 0.4;
        const pie = new THREE.Group();
        pie.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0xd9a24a, roughness: 0.8 })));
        const cream = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.9 })); cream.position.y = 0.12; pie.add(cream);
        pie.position.set(0, y0 + 1.2, -1.3); pie.visible = false; group.add(pie); l.pie = pie;
        const splat = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), new THREE.MeshBasicMaterial({ color: 0xf7f3ea, side: THREE.DoubleSide })); splat.position.set(l.x, y0 + 1.7, l.z + 0.42); splat.visible = false; group.add(splat); l.splat = splat;
      });
      return { dur: 0.6 + L.length * 0.4 + 2.2, step: (el) => {
        L.forEach((l) => {
          if (el < l.at) { l.pie.visible = false; return; }
          const k = this._c01((el - l.at) / 0.35);
          if (k < 1) { l.pie.visible = true; const ex = l.x, ey = y0 + 1.7, ez = l.z + 0.4; l.pie.position.set((ex) * k, (y0 + 1.2) + (ey - (y0 + 1.2)) * k + Math.sin(k * Math.PI) * 0.6, -1.3 + (ez + 1.3) * k); l.pie.rotation.x += 0.4; return; }
          l.pie.visible = false; l.splat.visible = true;
          l.av.rotation.x = -0.25 * Math.exp(-(el - (l.at + 0.35)) * 3);
          if (!l.hit) { l.hit = true; this.spawnBurst(V(l.x, y0 + 1.7, l.z), '#f7f3ea', { count: 16, gravity: 4 }); }
        });
      } };
    }
    // unknown id -> just a confetti moment so the flow always completes
    return { dur: 6, step: () => {} };
  }

  finishCelebration() {
    const c = this.celebration;
    if (!c) return;
    const cb = c.onDone;
    this.endCelebration();
    if (cb) cb();
  }

  // Called to bail out of the celebration early (skip button).
  skipCelebration() { if (this.celebration) this.finishCelebration(); }

  endCelebration() {
    const c = this.celebration;
    if (!c) return;
    this.celebration = null;
    sfx.stopAnthem();
    // restore lights + camera controls
    if (this.ambient && c.saved.ambient != null) this.ambient.intensity = c.saved.ambient;
    if (this.hemi && c.saved.hemi != null) this.hemi.intensity = c.saved.hemi;
    this.controls.autoRotate = c.saved.autoRotate;
    this.controls.autoRotateSpeed = c.saved.autoRotateSpeed;
    this.controls.minDistance = c.saved.minD;
    this.controls.maxDistance = c.saved.maxD;
    this.controls.target.set(c.saved.camTargetX, c.saved.camTargetY, c.saved.camTargetZ);
    // un-hide the table
    for (const g of c.hidden) g.visible = true;
    for (const seat of this.seats.values()) if (seat.label) seat.label.style.display = '';
    // dispose celebration objects
    this.scene.remove(c.group);
    c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
    this.frameCamera(true);
  }

  // ---- interaction ---------------------------------------------------------
  onPointer(e) {
    if (!this.drawGroup) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.drawGroup.children, false);
    if (hit.length && this.onDrawPile) this.onDrawPile();
  }

  // ---- labels projection + loop -------------------------------------------
  projectLabels() {
    if (this.celebration) return; // labels hidden during the podium celebration
    const w = innerWidth, h = innerHeight;
    const tmp = new THREE.Vector3();
    for (const seat of this.seats.values()) {
      seat.group.updateWorldMatrix(true, false);
      tmp.set(0, 3.05, 0).applyMatrix4(seat.group.matrixWorld); // clears even tall hats (wizard/party cones)
      const v = tmp.project(this.camera);
      const behind = v.z > 1;
      seat.label.style.left = (v.x * 0.5 + 0.5) * w + 'px';
      seat.label.style.top = (-v.y * 0.5 + 0.5) * h + 'px';
      seat.label.style.opacity = behind ? '0' : '1';
    }
    // draw-pile hint
    if (this.drawHint && this.drawGroup) {
      this.drawGroup.updateWorldMatrix(true, false);
      tmp.set(0, 0.25, 0).applyMatrix4(this.drawGroup.matrixWorld);
      const v = tmp.project(this.camera);
      const visible = this.myTurnCanDraw && v.z <= 1;
      this.drawHint.classList.toggle('show', visible);
      if (visible) {
        this.drawHint.style.left = (v.x * 0.5 + 0.5) * w + 'px';
        this.drawHint.style.top = (-v.y * 0.5 + 0.5) * h + 'px';
      }
    }
  }

  // Position the camera behind the local seat so the whole table + every
  // seat fits, adapting to the viewport aspect (portrait phones pull back).
  frameCamera(animate = false) {
    const a = this.camera.aspect;
    // wider lens on tall/narrow screens to keep the table from shrinking
    this.camera.fov = THREE.MathUtils.clamp(a < 1 ? 52 + (1 - a) * 16 : 52, 50, 66);
    this.camera.updateProjectionMatrix();
    this.computeSeatRadii();
    this.relayoutSeats();

    const halfW = this.rx + 1.4;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * a);
    const distH = halfW / Math.tan(hFov / 2);
    const distV = (this.rz + 1.3) / Math.tan(vFov / 2);
    let dist = Math.min(Math.max(Math.max(distH, distV) + 0.8, 7), 24);
    const elev = a < 1 ? 0.5 : 0.6;
    const target = new THREE.Vector3(0, this.camTarget.y + dist * Math.sin(elev), this.camTarget.z + dist * Math.cos(elev));
    this.controls.minDistance = Math.max(5, dist - 3);
    this.controls.maxDistance = dist + 9;
    this.controls.target.copy(this.camTarget);
    if (animate) {
      const p = this.camera.position;
      this.tween(p, { dur: 500, from: { px: p.x, py: p.y, pz: p.z }, to: { px: target.x, py: target.y, pz: target.z },
        onUpdate: (o) => this.camera.position.set(o.px, o.py, o.pz) });
    } else {
      this.camera.position.copy(target);
    }
    this.controls.update();
  }

  resetCamera() { this.frameCamera(true); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frameCamera(false);
  }

  animate() {
    const now = performance.now();
    const t = now / 1000;
    this.stepTweens(now);
    this.stepAnims(now);
    if (this.celebration) this.stepCelebration(now, t);
    this.controls.update();
    const st = this.state;
    const curId = st && st.currentPlayerId;
    for (const seat of this.seats.values()) {
      const av = seat.avatar; if (!av) continue;
      if (av.userData.auraGroup) animateAura(av.userData.auraGroup, t);
      // subtle idle breathing so nobody looks frozen; the active player perks up
      if (!this.celebration) {
        const ph = (seat.rank || 0) * 1.7;
        av.position.y = Math.sin(t * 1.6 + ph) * 0.025 + (seat.id === curId ? Math.abs(Math.sin(t * 3)) * 0.05 : 0);
        av.rotation.z = Math.sin(t * 1.1 + ph) * 0.015;
      }
    }
    this.stepLiveScene(t);
    if (this.dust) {
      const arr = this.dust.geometry.attributes.position.array;
      for (let i = 1; i < arr.length; i += 3) { arr[i] += 0.0028; if (arr[i] > 7) arr[i] = 0.8; }
      this.dust.geometry.attributes.position.needsUpdate = true;
      this.dust.rotation.y = t * 0.015;
    }
    if (this.fireLight) this.fireLight.intensity = 15 + Math.sin(t * 9) * 2.5 + Math.sin(t * 23) * 1.5;
    this.projectLabels();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animate());
  }
}

// ---- vector icon drawing (canvas paths, SVG-style — no emoji glyphs) --------
// Each icon draws centred in an S×S canvas, tinted by `color`. Used by popIcon.
function drawIcon(ctx, name, color, S) {
  const c = S / 2, R = S * 0.34;
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = S * 0.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (name) {
    case 'skip': { // prohibition sign: ring + diagonal slash
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
      const d = R * Math.SQRT1_2;
      ctx.beginPath(); ctx.moveTo(c - d, c - d); ctx.lineTo(c + d, c + d); ctx.stroke();
      break;
    }
    case 'reverse': { // two curved arrows chasing each other
      ctx.lineWidth = S * 0.09;
      ctx.beginPath(); ctx.arc(c, c, R, Math.PI * 1.12, Math.PI * 1.92); ctx.stroke();
      arrowHead(ctx, c + Math.cos(Math.PI * 1.92) * R, c + Math.sin(Math.PI * 1.92) * R, Math.PI * 1.92 + Math.PI / 2, S * 0.16);
      ctx.beginPath(); ctx.arc(c, c, R, Math.PI * 0.12, Math.PI * 0.92); ctx.stroke();
      arrowHead(ctx, c + Math.cos(Math.PI * 0.92) * R, c + Math.sin(Math.PI * 0.92) * R, Math.PI * 0.92 + Math.PI / 2, S * 0.16);
      break;
    }
    case 'wild': { // 4-colour pinwheel (ignores tint, uses the classic palette)
      const cols = ['#E0A53D', '#4E7FB5', '#D9764A', '#6E9457'];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = cols[i];
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, i * Math.PI / 2, (i + 1) * Math.PI / 2); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(c, c, S * 0.08, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'alert': { // warning triangle with a bang
      ctx.beginPath(); ctx.moveTo(c, c - R); ctx.lineTo(c + R * 0.95, c + R * 0.72); ctx.lineTo(c - R * 0.95, c + R * 0.72); ctx.closePath(); ctx.stroke();
      ctx.lineWidth = S * 0.085;
      ctx.beginPath(); ctx.moveTo(c, c - R * 0.22); ctx.lineTo(c, c + R * 0.24); ctx.stroke();
      ctx.beginPath(); ctx.arc(c, c + R * 0.5, S * 0.038, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'burst': { // explosion star
      star(ctx, c, c, R, R * 0.42, 8, true);
      break;
    }
    case 'bomb': { // round bomb with a lit fuse
      const br = R * 0.82, by = c + S * 0.05;
      ctx.beginPath(); ctx.arc(c, by, br, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = S * 0.045;
      ctx.beginPath(); ctx.moveTo(c + br * 0.55, by - br * 0.75); ctx.quadraticCurveTo(c + br * 1.25, by - br * 1.2, c + br * 0.85, by - br * 1.7); ctx.stroke();
      ctx.fillStyle = '#ffd24a'; star(ctx, c + br * 0.85, by - br * 1.8, S * 0.07, S * 0.03, 5, true);
      break;
    }
    default: {
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function arrowHead(ctx, x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle + 2.5) * size, y + Math.sin(angle + 2.5) * size);
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle - 2.5) * size, y + Math.sin(angle - 2.5) * size);
  ctx.stroke();
}

function star(ctx, cx, cy, outer, inner, points, fill) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer, a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath(); fill ? ctx.fill() : ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
