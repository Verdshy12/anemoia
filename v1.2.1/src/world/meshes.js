// src/world/meshes.js — turns a tile into 2 merged meshes (roads, buildings) = 2 draw calls total.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROAD_COLOR = [0x292c30, 0x2c2f33, 0x303338, 0x33363a, 0x36393d, 0x393c40, 0x3c3f43];   // by rank: busier = slightly lighter
const BUILDING_COLORS = [0xb8b2a4, 0xc8c0ad, 0xaaa9a1, 0xd1c7b5, 0x8f999a];

/** Roads: one quad per segment + a small disc at each joint (fills bend gaps, can never fold over like a mitered ribbon).
 *  Tiny y-offset per rank so crossing roads never z-fight. Whole network = 1 mesh. */
export function buildRoadMesh(roads) {
  const pos = [], col = [], idx = []; const c = new THREE.Color(); const RING = 8;
  for (const r of roads) {
    const n = r.pts.length / 2; if (n < 2) continue;
    const y = 0.02 + r.rank * 0.004, hw = r.w / 2; c.setHex(ROAD_COLOR[r.rank] ?? ROAD_COLOR[0]);
    const vert = (x, z) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
    for (let i = 0; i < n - 1; i++) {
      const ax = r.pts[i * 2], az = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2], bz = r.pts[i * 2 + 3];
      const l = Math.hypot(bx - ax, bz - az); if (l < 0.05) continue;
      const nx = (-(bz - az) / l) * hw, nz = ((bx - ax) / l) * hw;
      const La = vert(ax + nx, az + nz), Ra = vert(ax - nx, az - nz), Lb = vert(bx + nx, bz + nz), Rb = vert(bx - nx, bz - nz);
      idx.push(La, Lb, Ra, Ra, Lb, Rb);
    }
    for (let i = 1; i < n - 1; i++) {                                           // joint discs (interior vertices only)
      const cx = r.pts[i * 2], cz = r.pts[i * 2 + 1], ctr = vert(cx, cz), ring = [];
      for (let k = 0; k < RING; k++) { const t = (k / RING) * Math.PI * 2; ring.push(vert(cx + Math.cos(t) * hw, cz + Math.sin(t) * hw)); }
      for (let k = 0; k < RING; k++) idx.push(ctr, ring[(k + 1) % RING], ring[k]);   // clockwise in x-z == facing +Y
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  // Asphalt base: retain the existing road geometry and rank colours.
  const roadMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0.0
  });

  return new THREE.Mesh(g, roadMaterial);
}

/** Real footprints extruded to height, merged into ONE geometry with per-building vertex colour. */
export function buildBuildingMesh(buildings) {
  const geos = []; const c = new THREE.Color();
  for (const b of buildings) {
    try {
      const shape = new THREE.Shape(); const p = b.pts;
      shape.moveTo(p[0], -p[1]); for (let i = 2; i < p.length; i += 2) shape.lineTo(p[i], -p[i + 1]);   // shape-y = -world-z
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);                                                  // extrusion axis -> +Y (up)
      g.deleteAttribute('uv');
      c.setHex(BUILDING_COLORS[b.id % BUILDING_COLORS.length]);
      const colors = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geos.push(g);
    } catch (e) { console.warn('skip building', b.id, e.message); }
  }
  const merged = mergeGeometries(geos, false); geos.forEach((g) => g.dispose());
  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
}

/** v1.2.2: painted centre-line dashes along a route + a coloured post at its start and end. One merged mesh = 1 draw call. */
export function buildRouteMarkings(route) {
  const pos = [], col = [], idx = []; const P = route.path.pts, y = 0.055, hw = 0.075, DASH = 3.5, GAP = 5.5;
  const quad = (ax, az, bx, bz, w, yy, c) => {
    const l = Math.hypot(bx - ax, bz - az); if (l < 0.01) return;
    const nx = (-(bz - az) / l) * w, nz = ((bx - ax) / l) * w, b = pos.length / 3;
    for (const [px, pz] of [[ax + nx, az + nz], [ax - nx, az - nz], [bx + nx, bz + nz], [bx - nx, bz - nz]]) { pos.push(px, yy, pz); col.push(c.r, c.g, c.b); }
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  const paint = new THREE.Color(0xf5f2e8); let s = GAP / 2;
  for (let i = 0; i < P.length - 1; i++) {                                   // dashes follow the resampled route (2 m steps)
    const a = P[i], b = P[i + 1];
    if (s >= DASH + GAP) s -= DASH + GAP;
    if (s < DASH) quad(a.x, a.z, b.x, b.z, hw, y, paint);
    s += route.path.step;
  }
  const post = (p, hex) => {                                                  // 1 m square, 14 m tall pillar so the ends are visible from afar
    const c = new THREE.Color(hex), b = pos.length / 3, r = 0.5;
    const ring = [[p.x - r, p.z - r], [p.x + r, p.z - r], [p.x + r, p.z + r], [p.x - r, p.z + r]];
    for (const [px, pz] of ring) { pos.push(px, 0.05, pz); col.push(c.r, c.g, c.b); }
    for (const [px, pz] of ring) { pos.push(px, 14, pz); col.push(c.r, c.g, c.b); }
    for (let k = 0; k < 4; k++) { const n = (k + 1) % 4; idx.push(b + k, b + n, b + 4 + k, b + n, b + 4 + n, b + 4 + k, b + k, b + 4 + k, b + n, b + n, b + 4 + k, b + 4 + n); }
  };
  post(P[P.length - 1], 0xf05448);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
}
