// 3D character "wardrobe": renders the real avatar on a rotating podium in a
// small dedicated canvas, live-updating as cosmetics change. Drag to spin.
import * as THREE from 'three';
import { buildAvatar, animateAura } from './avatars.js';

export class CharCreator {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;
    this.spin = 0.5;          // idle auto-rotation speed
    this.dragging = false;
    this.lastX = 0;
    this.targetRotVel = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
    this.camera.position.set(0, 1.65, 4.1);
    this.camera.lookAt(0, 1.12, 0);

    this.scene.add(new THREE.HemisphereLight(0xfff0d8, 0x2a221a, 1.0));
    const key = new THREE.DirectionalLight(0xfff1da, 1.3); key.position.set(3, 6, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6da8ff, 0.5); rim.position.set(-4, 3, -3); this.scene.add(rim);
    const spot = new THREE.SpotLight(0xffffff, 1.1, 20, 0.7, 0.6); spot.position.set(0, 7, 2); this.scene.add(spot);

    // podium
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.45, 0.28, 40),
      new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.6, metalness: 0.2 }));
    podium.position.y = -0.14; this.scene.add(podium);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.26, 0.05, 12, 48),
      new THREE.MeshStandardMaterial({ color: 0xE0A53D, roughness: 0.3, metalness: 0.5, emissive: 0x6e4a12, emissiveIntensity: 0.5 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; this.scene.add(ring);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);

    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX; this.lastX = e.clientX;
      this.holder.rotation.y += dx * 0.01;
      this.targetRotVel = dx * 0.01;
    });
    const end = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointerleave', end);

    addEventListener('resize', () => { if (this.active) this.resize(); });
    addEventListener('pagehide', () => { try { this.renderer.forceContextLoss(); } catch {} });

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setCosmetics(cos) {
    // dispose previous avatar
    while (this.holder.children.length) {
      const c = this.holder.children.pop();
      c.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    }
    const avatar = buildAvatar(cos || {});
    this.holder.add(avatar);
  }

  start() { this.active = true; this.resize(); }
  stop() { this.active = false; }

  resize() {
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 220;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    requestAnimationFrame(this._loop);
    if (!this.active) return;
    if (!this.dragging) {
      this.targetRotVel *= 0.92;
      this.holder.rotation.y += this.targetRotVel + this.spin * 0.0025;
    }
    const avatar = this.holder.children[0];
    if (avatar && avatar.userData.auraGroup) animateAura(avatar.userData.auraGroup, performance.now() / 1000);
    this.renderer.render(this.scene, this.camera);
  }
}
