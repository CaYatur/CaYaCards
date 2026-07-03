// Procedural low-poly 3D characters built from primitives, with cosmetics
// (hats / glasses / faces / auras). Each avatar is a THREE.Group facing +Z.
import * as THREE from 'three';
import { AURAS } from './cosmetics.js';

function lighten(hex, amt = 0.25) { return new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amt); }
function darken(hex, amt = 0.3) { return new THREE.Color(hex).lerp(new THREE.Color('#000000'), amt); }
const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04 });
const shiny = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.25 });

function makeHat(id, bodyColor) {
  const g = new THREE.Group();
  switch (id) {
    case 'cap': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), matte('#d8453f'));
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 18, 1, false, 0, Math.PI), matte('#b5322d'));
      brim.position.set(0, 0.01, 0.34); brim.scale.set(1, 1, 1.4);
      g.add(dome, brim); break;
    }
    case 'tophat': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.06, 24), matte('#16130f'));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.7, 24), matte('#16130f')); top.position.y = 0.38;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.12, 24), matte('#a8333a')); band.position.y = 0.12;
      g.add(brim, top, band); break;
    }
    case 'crown': {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.34, 7), shiny('#f2c043')); g.add(ring);
      for (let i = 0; i < 7; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 5), shiny('#f2c043'));
        const a = (i / 7) * Math.PI * 2; spike.position.set(Math.cos(a) * 0.42, 0.26, Math.sin(a) * 0.42); g.add(spike);
      }
      break;
    }
    case 'beanie': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.47, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.7), matte('#6f5bd6'));
      const fold = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.09, 10, 24), matte('#5a47b8')); fold.rotation.x = Math.PI / 2;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), matte('#efe7d2')); pom.position.y = 0.46;
      g.add(dome, fold, pom); break;
    }
    case 'party': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 18), matte('#e0843d')); cone.position.y = 0.4;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), matte('#efe7d2')); pom.position.y = 0.86;
      g.add(cone, pom); break;
    }
    case 'wizard': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 20), matte('#3b2c7a')); cone.position.y = 0.5;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.05, 24), matte('#2c2160'));
      const star = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), shiny('#f2c043')); star.position.set(0, 0.7, 0.34);
      g.add(cone, brim, star); break;
    }
    case 'halo': {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 12, 28),
        new THREE.MeshStandardMaterial({ color: '#fff0a8', emissive: '#f2c043', emissiveIntensity: 0.9, roughness: 0.3 }));
      halo.rotation.x = Math.PI / 2; halo.position.y = 0.5; g.add(halo); break;
    }
    case 'horns': {
      for (const x of [-0.26, 0.26]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 10), matte('#c43a2e'));
        horn.position.set(x, 0.16, 0); horn.rotation.z = x < 0 ? 0.35 : -0.35; g.add(horn);
      }
      break;
    }
    case 'headphones': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 10, 24, Math.PI), matte('#222'));
      band.rotation.z = Math.PI; band.position.y = 0.06;
      for (const x of [-0.46, 0.46]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 16), matte('#e0843d'));
        cup.rotation.z = Math.PI / 2; cup.position.set(x, -0.1, 0); g.add(cup);
      }
      g.add(band); break;
    }
    case 'cowboy': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.05, 28), matte('#8a5a2b')); brim.scale.z = 1.15;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.8), matte('#9c6a33')); dome.position.y = 0.04;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.08, 18), matte('#5a3d1e')); band.position.y = 0.04;
      g.add(brim, dome, band); break;
    }
    case 'flower': {
      const center = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), matte('#f2c043')); center.position.set(0.22, 0.06, 0.28);
      for (let i = 0; i < 5; i++) {
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), matte('#e06a8b'));
        const a = (i / 5) * Math.PI * 2; petal.position.set(0.22 + Math.cos(a) * 0.13, 0.06 + Math.sin(a) * 0.13, 0.28); petal.scale.z = 0.5; g.add(petal);
      }
      g.add(center); break;
    }
    default: return null;
  }
  return g;
}

function makeGlasses(id) {
  if (id === 'none' || !id) return null;
  const g = new THREE.Group();
  const frame = matte('#15110b');
  if (id === 'round') {
    for (const x of [-0.18, 0.18]) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 18), frame); l.position.set(x, 0, 0.02); g.add(l); }
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), frame));
  } else if (id === 'shades') {
    const glass = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.15, metalness: 0.5 });
    for (const x of [-0.18, 0.18]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.04), glass); l.position.set(x, 0, 0.02); g.add(l); }
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.03), frame));
  } else if (id === 'visor') {
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 20, 1, true, -0.9, 1.8),
      new THREE.MeshStandardMaterial({ color: '#4ec2ff', roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    visor.rotation.x = Math.PI / 2; visor.position.z = 0.05; g.add(visor);
  } else if (id === 'monocle') {
    const l = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 20), shiny('#f2c043')); l.position.set(0.18, 0, 0.02); g.add(l);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22), matte('#f2c043')); chain.position.set(0.18, -0.16, 0.02); g.add(chain);
  } else if (id === 'star') {
    for (const x of [-0.18, 0.18]) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.05, 5), shiny('#ffd24a')); s.rotation.x = -Math.PI / 2; s.position.set(x, 0, 0.04); g.add(s); }
  } else if (id === 'eyepatch') {
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.04), matte('#111')); patch.position.set(0.18, 0, 0.04);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.015, 6, 24), matte('#111')); strap.rotation.y = 0.2; strap.position.y = 0.02; g.add(patch, strap);
  }
  return g;
}

function makeFace(face, root) {
  const eyeMat = matte('#1a1410');
  const whiteMat = matte('#fbf7ef');
  const eyeY = 1.54;
  const eyes = [];
  [-0.18, 0.18].forEach((x, i) => {
    if (face === 'wink' && i === 1) { // closed eye (line)
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), eyeMat);
      line.position.set(x, eyeY, 0.47); root.add(line); return;
    }
    const big = face === 'surprised' ? 1.25 : 1;
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.11 * big, 14, 12), whiteMat);
    white.position.set(x, eyeY, 0.42); white.scale.z = 0.6;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055 * big, 12, 10), eyeMat);
    pupil.position.set(x, eyeY, 0.5);
    root.add(white, pupil); eyes.push(pupil);
  });
  if (face === 'grumpy') { // angled brows
    for (const x of [-0.18, 0.18]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), eyeMat);
      brow.position.set(x, 1.68, 0.46); brow.rotation.z = x < 0 ? -0.4 : 0.4; root.add(brow);
    }
  }
  // mouth
  let mouth;
  if (face === 'robot') { mouth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.02), matte('#222')); mouth.position.set(0, 1.32, 0.46); }
  else if (face === 'surprised') { mouth = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 16), matte('#7a4a2a')); mouth.position.set(0, 1.3, 0.45); }
  else if (face === 'grumpy') { mouth = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 16, Math.PI), matte('#7a4a2a')); mouth.position.set(0, 1.28, 0.45); }
  else { mouth = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 16, Math.PI), matte('#7a4a2a')); mouth.position.set(0, 1.34, 0.45); mouth.rotation.z = Math.PI; }
  root.add(mouth);
}

function makeAura(id, color) {
  if (!id || id === 'none') return null;
  const g = new THREE.Group();
  const rainbow = color === 'rainbow';
  const baseCol = new THREE.Color(rainbow ? '#ff4d4d' : color);
  const mkMat = () => new THREE.MeshBasicMaterial({ color: baseCol.clone(), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.06, 12, 40), mkMat());
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.06;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.03, 10, 40), mkMat());
  ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.06; ring2.material.opacity = 0.4;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 40), mkMat());
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.material.opacity = 0.14;
  g.add(ring, ring2, disc);

  const particles = [];
  const pCount = id === 'volt' ? 10 : 7;
  for (let i = 0; i < pCount; i++) {
    const geo = id === 'volt' ? new THREE.OctahedronGeometry(0.06) : new THREE.SphereGeometry(0.06, 8, 6);
    const p = new THREE.Mesh(geo, mkMat());
    const a = (i / pCount) * Math.PI * 2;
    p.userData.a = a; p.userData.r = 0.62 + Math.random() * 0.2; p.userData.base = 0.2 + Math.random() * 1.3;
    g.add(p); particles.push(p);
  }
  g.userData = { id, rainbow, ring, ring2, disc, particles };
  return g;
}

// Animate an aura group (called from render loops). t = seconds.
export function animateAura(aura, t) {
  if (!aura || !aura.userData) return;
  const u = aura.userData;
  aura.rotation.y = t * 0.6;
  const pulse = 0.55 + 0.3 * Math.sin(t * 3);
  if (u.ring) u.ring.material.opacity = pulse;
  if (u.ring2) u.ring2.material.opacity = pulse * 0.5;
  u.particles.forEach((p, i) => {
    const a = p.userData.a + t * 0.8;
    p.position.set(Math.cos(a) * p.userData.r, p.userData.base + Math.sin(t * 2 + i) * 0.25 + 0.3, Math.sin(a) * p.userData.r);
  });
  if (u.rainbow) {
    const c = new THREE.Color().setHSL((t * 0.15) % 1, 0.8, 0.6);
    if (u.ring) u.ring.material.color.copy(c);
    if (u.ring2) u.ring2.material.color.copy(c);
    if (u.disc) u.disc.material.color.copy(c);
    u.particles.forEach((p, i) => p.material.color.setHSL((t * 0.15 + i / u.particles.length) % 1, 0.8, 0.6));
  }
}

export function buildAvatar(cos = {}) {
  const bodyColor = cos.body || '#5b8fd6';
  const root = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.5, 8, 18), matte(bodyColor));
  body.position.y = 0.55; body.castShadow = true; root.add(body);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.16, 20), matte(darken(bodyColor, 0.25)));
  collar.position.y = 1.02; root.add(collar);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), matte(lighten(bodyColor, 0.55)));
  head.position.y = 1.5; head.castShadow = true; root.add(head);

  makeFace(cos.face || 'happy', root);

  const armMat = matte(bodyColor);
  const arms = [];
  for (const x of [-0.55, 0.55]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.35, 6, 10), armMat);
    arm.position.set(x, 0.6, 0.32); arm.rotation.x = 1.1; arm.rotation.z = x < 0 ? -0.3 : 0.3; root.add(arm);
    arm.userData.baseRot = { x: arm.rotation.x, z: arm.rotation.z };
    arm.userData.side = x < 0 ? -1 : 1;
    arms.push(arm);
  }
  root.userData.arms = arms;
  root.userData.head = head;

  const glasses = makeGlasses(cos.glasses);
  if (glasses) { glasses.position.set(0, 1.54, 0.46); root.add(glasses); }
  const hat = makeHat(cos.hat, bodyColor);
  if (hat) { hat.position.set(0, 1.92, 0); root.add(hat); }

  const auraDef = AURAS.find((a) => a.id === cos.aura);
  const aura = makeAura(cos.aura, auraDef && auraDef.color);
  if (aura) { root.add(aura); root.userData.auraGroup = aura; }

  root.userData.cosmetics = cos;
  return root;
}
