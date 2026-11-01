import * as THREE from './vendor/three.module.js';
import { characterProfile, runningPose, trackPosition } from './characters.js';

const number = new Intl.NumberFormat('zh-TW');
const white = '#f4f4ed';
const iveFaceSide = [
  [[0, .53], [.24, .53], [.4, .49], [.5, .39]],
  [[.5, .39], [.645, .3], [.605, .09], [.598, -.13]],
  [[.598, -.13], [.5951, -.22], [.606, -.32], [.5, -.4]],
  [[.5, -.4], [.43, -.453], [.19, -.47], [0, -.47]],
].map(points => new THREE.CubicBezierCurve(...points.map(([x, y]) => new THREE.Vector2(x, y))));

function material(color, roughness = .62) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function mesh(parent, geometry, surface, position = [0, 0, 0], scale = [1, 1, 1]) {
  const object = new THREE.Mesh(geometry, surface);
  object.position.set(...position);
  object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function ball(parent, surface, position, scale) {
  return mesh(parent, new THREE.SphereGeometry(1, 20, 14), surface, position, scale);
}

function box(parent, surface, position, scale) {
  return mesh(parent, new THREE.BoxGeometry(1, 1, 1), surface, position, scale);
}

function pivot(parent, x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

function disposeTree(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const surface of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(surface);
      if (surface.map) textures.add(surface.map);
    }
  });
  geometries.forEach(item => item.dispose());
  materials.forEach(item => item.dispose());
  textures.forEach(item => item.dispose());
}

function iveFaceWidth(y) {
  const curve = iveFaceSide.find(segment => y <= segment.v0.y && y >= segment.v3.y);
  if (!curve) throw new RangeError('CHERRY face coordinate is outside the head surface');
  let low = 0, high = 1;
  const point = new THREE.Vector2();
  for (let index = 0; index < 20; index++) {
    const t = (low + high) / 2;
    curve.getPoint(t, point);
    if (point.y > y) low = t;
    else high = t;
  }
  return curve.getPoint((low + high) / 2, point).x;
}

function iveFaceDepth(x, y) {
  const width = iveFaceWidth(y);
  return iveHeadDepth(y) * Math.sqrt(1 - (x / width) ** 2);
}

function iveHeadDepth(y) {
  return .46 * (1 - ((y - .03) / .5) ** 4) ** .25;
}

function createIveHeadGeometry() {
  const geometry = new THREE.SphereGeometry(1, 64, 64);
  const { position: positions, normal: normals } = geometry.attributes;
  const normal = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const height = y * .5 + .03;
    const radius = Math.hypot(x, z);
    if (radius < 1e-6) {
      positions.setXYZ(index, 0, height, 0);
      normals.setXYZ(index, 0, Math.sign(y), 0);
      continue;
    }
    const width = iveFaceWidth(height), depth = iveHeadDepth(height);
    const u = x / radius, v = z / radius;
    const widthSlope = (iveFaceWidth(height + .0001) - iveFaceWidth(height - .0001)) / .0002;
    const depthSlope = -.92 * y ** 3 / (1 - y ** 4) ** .75;
    positions.setXYZ(index, u * width, height, v * depth);
    // Keep the side full and the shading continuous across the sphere's UV seam.
    normal.set(u / width, -widthSlope / width * u * u - depthSlope / depth * v * v, v / depth).normalize();
    normals.setXYZ(index, normal.x, normal.y, normal.z);
  }
  return geometry;
}

function createLongEarGeometry(front) {
  const geometry = new THREE.SphereGeometry(1, 48, 48, front ? 0 : Math.PI, Math.PI);
  const { position: positions, normal: normals } = geometry.attributes;
  const normal = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const t = (1 - y) / 2;
    const width = .12 + .35 * t, depth = .14 + .12 * t;
    // The broad lower ear fans outward, then turns inward behind the hands.
    positions.setXYZ(index, .4 * Math.sin(Math.PI * t) + x * width, -1.55 * t, z * depth - .08 * t);
    const nx = x / width, nz = z / depth;
    // Transform the original sphere normal so both panels agree along their rim.
    const ny = (2 * y + (.4 * Math.PI * Math.cos(Math.PI * t) + .35 * x) * nx + (.12 * z - .08) * nz) / 1.55;
    normal.set(nx, ny, nz).normalize();
    normals.setXYZ(index, normal.x, normal.y, normal.z);
  }
  positions.needsUpdate = true;
  geometry.computeBoundingBox();
  return geometry;
}

function createIveFaceShape(head, name, shape, surface) {
  const points = shape.getPoints(24);
  if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector2()).divideScalar(points.length);
  const positions = [], indices = [];
  // Radial subdivisions keep the filled graphic flush with the curved face.
  for (let ring = 0; ring <= 10; ring++) {
    for (const point of points) {
      const x = THREE.MathUtils.lerp(center.x, point.x, ring / 10);
      const y = THREE.MathUtils.lerp(center.y, point.y, ring / 10);
      positions.push(x, y, iveFaceDepth(x, y) + .004);
    }
  }
  for (let ring = 0; ring < 10; ring++) {
    for (let index = 0; index < points.length - 1; index++) {
      const a = ring * points.length + index, b = a + points.length;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const object = mesh(head, geometry, surface);
  object.name = name;
  object.castShadow = false;
  object.receiveShadow = false;
  return object;
}

function createIveFaceCurve(head, name, points, ink, radius = .008) {
  const curve = new THREE.CubicBezierCurve(...points.map(([x, y]) => new THREE.Vector2(x, y)));
  const path = new THREE.CatmullRomCurve3(curve.getPoints(32).map(point =>
    new THREE.Vector3(point.x, point.y, iveFaceDepth(point.x, point.y) + .009)));
  const object = mesh(head, new THREE.TubeGeometry(path, 40, radius, 8, false), ink);
  object.name = name;
  object.castShadow = false;
  object.receiveShadow = false;
}

function createIveEye(head, side, ink) {
  const x = side * .24, y = -.125;
  const eye = new THREE.Shape();
  eye.absellipse(x, y, .118, .122, 0, Math.PI * 2, false, 0);
  createIveFaceShape(head, 'ive-eye', eye, ink);
  createIveFaceMark(head, 'ive-eye-highlight', x - side * .015, y + .045, .03, .033, '#ffffff', 1, .85, .011);
  createIveFaceMark(head, 'ive-eye-secondary-highlight', x + side * .008, y - .05, .021, .023, '#ffffff', 1, .85, .011);
  createIveFaceCurve(head, 'ive-upper-eyelid',
    [[x - .115, y + .015], [x - .12, y + .155], [x + .11, y + .158], [x + .118, y + .012]], ink);
  createIveFaceCurve(head, 'ive-outer-eye-arc',
    [[x + side * .095, y + .085], [x + side * .169, y + .082],
      [x + side * .175, y - .075], [x + side * .14, y - .12]], ink);
  const corner = new THREE.Shape();
  corner.moveTo(x + side * .091, y + .08);
  corner.quadraticCurveTo(x + side * .13, y + .096, x + side * .157, y + .125);
  corner.quadraticCurveTo(x + side * .153, y + .086, x + side * .117, y + .058);
  corner.closePath();
  createIveFaceShape(head, 'ive-outer-eye-corner', corner, ink);
}

function createIveSkirtGeometry() {
  const geometry = new THREE.CylinderGeometry(.3, .43, .26, 96, 6);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const radius = Math.hypot(x, z);
    if (radius < .001) continue;
    const angle = Math.atan2(z, x);
    const flare = (.13 - y) / .26;
    const fold = Math.cos(angle * 10) * .017 * flare;
    const hem = .006 * Math.cos(angle * 10) * flare ** 4;
    positions.setXYZ(index, x * (radius + fold) / radius, y + hem, z * (radius + fold) / radius);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function createIveFaceMark(head, name, x, y, width, height, color, opacity, fadeStart, offset = .003) {
  const geometry = new THREE.RingGeometry(0, 1, 48, 12);
  const positions = geometry.attributes.position;
  const colors = [];
  for (let index = 0; index < positions.count; index++) {
    const u = positions.getX(index), v = positions.getY(index);
    const px = x + u * width, py = y + v * height;
    // Follow the curved face so cheek details never look like raised accessories.
    const pz = iveFaceDepth(px, py) + offset;
    positions.setXYZ(index, px, py, pz);
    colors.push(1, 1, 1, 1 - THREE.MathUtils.smoothstep(Math.hypot(u, v), fadeStart, 1));
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.computeVertexNormals();
  const surface = new THREE.MeshBasicMaterial({ color });
  surface.vertexColors = true;
  surface.transparent = true;
  surface.opacity = opacity;
  surface.depthWrite = false;
  const mark = mesh(head, geometry, surface);
  mark.name = name;
  mark.castShadow = false;
  mark.receiveShadow = false;
  return mark;
}

function createIveCharacter(profile) {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const fur = material('#ffffff', .9);
  const blue = material('#315eaa');
  const piping = material('#203b65');
  const pink = material('#f3a5be');
  const black = new THREE.MeshBasicMaterial({ color: '#111314' });
  const torso = ball(body, blue, [0, 1.18, 0], [.35, .37, .255]);
  torso.rotation.x = -.08;
  const shirt = mesh(body, new THREE.ConeGeometry(.15, .29, 3), fur, [0, 1.3, .252], [1, 1, .16]);
  shirt.rotation.z = Math.PI;
  for (const side of [-1, 1]) {
    const lapel = box(body, piping, [side * .14, 1.34, .245], [.07, .28, .04]);
    lapel.rotation.z = side * -.5;
    ball(body, pink, [side * .075, 1.43, .28], [.07, .08, .045]);
  }
  ball(body, fur, [0, 1.43, .3], [.04, .045, .025]);
  for (let index = 0; index < 3; index++) ball(body, fur, [0, 1.24 - index * .12, .262], [.027, .027, .025]);
  const skirt = pivot(body, 0, .86, 0);
  skirt.name = 'ive-skirt';
  mesh(skirt, createIveSkirtGeometry(), pink);
  const head = pivot(body, 0, 2.08, 0);
  head.scale.set(1.18, 1.14, 1.14);
  const face = mesh(head, createIveHeadGeometry(), fur);
  face.name = 'ive-face';
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = pivot(head, side * .44, .37, -.2);
    ear.name = 'ive-long-ear';
    for (const front of [true, false]) {
      const panel = mesh(ear, createLongEarGeometry(front), fur);
      panel.name = front ? 'ive-ear-front' : 'ive-ear-back';
    }
    ear.scale.x = side;
    ears.push(ear);
    createIveEye(head, side, black);
    createIveFaceMark(head, 'ive-blush', side * .445, -.31, .09, .095, '#f2b0c9', .65, .6);
  }
  // Left and right refer to the viewer looking straight at CHERRY.
  createIveFaceMark(head, 'ive-left-cheek-dot', -.448, -.29, .008, .008, '#343638', 1, .7, .006);
  createIveFaceMark(head, 'ive-right-cheek-dot', .35, -.373, .0075, .0075, '#343638', 1, .7, .006);
  createIveFaceMark(head, 'ive-nose', 0, -.29, .028, .016, '#111314', 1, .85);
  for (const side of [-1, 1]) {
    createIveFaceCurve(head, 'ive-mouth',
      [[side * .12, -.34], [side * .12, -.405], [side * .035, -.408], [0, -.365]], black);
  }
  createIveFaceCurve(head, 'ive-forelock',
    [[-.065, .27], [-.09, .11], [-.032, .105], [.012, .165]], black, .009);
  createIveFaceCurve(head, 'ive-forelock',
    [[.012, .25], [-.015, .155], [.042, .12], [.084, .178]], black, .009);
  const hat = pivot(head, 0, .42, -.025);
  hat.rotation.z = -.1;
  ball(hat, blue, [0, .085, 0], [.65, .28, .51]);
  mesh(hat, new THREE.TorusGeometry(.54, .037, 8, 32), piping, [0, -.025, 0], [1, .86, 1]).rotation.x = Math.PI / 2;
  ball(hat, piping, [0, .37, 0], [.055, .055, .05]);
  for (const side of [-1, 1]) {
    const x = .35 + side * .035;
    ball(hat, fur, [x, .13, .449], [.041, .04, .018]);
    const leaf = ball(hat, fur, [x, .235, .43], [.04, .018, .012]);
    leaf.rotation.z = side * .45;
    const stem = new THREE.CubicBezierCurve3(
      new THREE.Vector3(.35, .225, .435), new THREE.Vector3(.35, .2, .447),
      new THREE.Vector3(x, .195, .451), new THREE.Vector3(x, .16, .451));
    mesh(hat, new THREE.TubeGeometry(stem, 12, .007, 6, false), fur);
  }
  const scarf = pivot(body, 0, 1.5, -.1);
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = pivot(body, side * .32, 1.34, 0);
    arm.rotation.z = side * .2;
    mesh(arm, new THREE.CapsuleGeometry(.12, .16, 4, 8), blue, [0, -.13, 0]);
    const elbow = pivot(arm, 0, -.25, 0);
    mesh(elbow, new THREE.CapsuleGeometry(.11, .13, 4, 8), fur, [0, -.12, 0]);
    mesh(elbow, new THREE.CylinderGeometry(.125, .125, .07, 12), pink, [0, -.02, 0]);
    ball(elbow, fur, [0, -.24, .01], [.125, .13, .11]);
    arms.push({ arm, elbow });
    const hip = pivot(body, side * .17, .7, 0);
    mesh(hip, new THREE.CapsuleGeometry(.115, .16, 4, 8), fur, [0, -.13, 0]);
    const knee = pivot(hip, 0, -.27, 0);
    mesh(knee, new THREE.CapsuleGeometry(.11, .14, 4, 8), fur, [0, -.13, 0]);
    ball(knee, fur, [0, -.27, .07], [.15, .13, .22]);
    legs.push({ hip, knee });
  }
  root.rotation.y = Math.PI / 2;
  return { root, body, head, scarf, arms, legs, ears, skirt, profile };
}

function createCharacter(profile) {
  if (profile.model === 'ive-long-ear') return createIveCharacter(profile);
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const skin = material(profile.skin);
  const uniform = material(profile.color);
  const trim = material(white);
  const dark = material('#202d3f');
  const hair = material(profile.hair);
  const eyes = material('#192333', .35);
  const blush = material('#dd8e89');
  const accent = material('#f7d67d', .3);
  const torso = ball(body, uniform, [0, 1.15, 0], [.38, .44, .25]);
  torso.rotation.x = -.13;
  ball(body, dark, [0, .87, -.01], [.33, .18, .24]);
  box(body, trim, [0, 1.22, .242], [.055, .5, .035]);
  for (const side of [-1, 1]) {
    box(body, trim, [side * .27, 1.36, .12], [.1, .07, .27]);
  }
  const scarf = pivot(body, 0, 1.52, -.11);
  mesh(scarf, new THREE.CapsuleGeometry(.085, .63, 4, 8), uniform, [0, -.03, -.34]).rotation.x = 1.8;
  mesh(body, new THREE.TorusGeometry(.2, .055, 8, 24), trim, [0, 1.47, 0]).rotation.x = Math.PI / 2;

  const head = pivot(body, 0, 1.98, 0);
  ball(head, skin, [0, 0, 0], [.58, .6, .49]);
  for (const side of [-1, 1]) {
    ball(head, skin, [side * .57, -.03, 0], [.1, .145, .09]);
    ball(head, eyes, [side * .2, -.025, .451], [.052, .085, .028]);
    ball(head, trim, [side * .19, .005, .475], [.016, .025, .012]);
    ball(head, blush, [side * .32, -.16, .423], [.087, .035, .012]);
    const brow = ball(head, hair, [side * .2, .135, .454], [.085, .022, .025]);
    brow.rotation.z = side * -.13;
  }
  ball(head, skin, [0, -.12, .48], [.065, .07, .06]);
  const smile = mesh(head, new THREE.TorusGeometry(.09, .018, 6, 16, Math.PI), eyes, [0, -.23, .443]);
  smile.rotation.z = Math.PI;
  // Upper hemisphere leaves the face visible; separate locks give each mascot a silhouette.
  mesh(head, new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * .48), hair, [0, .04, -.025], [.61, .62, .52]);
  for (let index = 0; index < 5; index++) {
    const lock = ball(head, hair, [(index - 2) * .19, .34 - Math.abs(index - 2) * .035, .38], [.16, .2 + (index === profile.hairStyle ? .09 : 0), .13]);
    lock.rotation.z = -.3 + index * .12;
  }
  if (profile.hairStyle === 1) {
    for (const side of [-1, 1]) ball(head, hair, [side * .48, -.12, -.16], [.16, .4, .26]);
  } else if (profile.hairStyle === 2) {
    ball(head, hair, [0, .4, -.48], [.3, .26, .25]);
  }

  const accessory = new THREE.Group();
  head.add(accessory);
  if (profile.accessory === 'headphones') {
    mesh(accessory, new THREE.TorusGeometry(.62, .055, 8, 30, Math.PI), uniform, [0, .01, 0]);
    for (const side of [-1, 1]) {
      ball(accessory, dark, [side * .59, -.02, 0], [.11, .23, .2]);
      ball(accessory, uniform, [side * .67, -.02, .015], [.04, .16, .14]);
    }
  } else if (profile.accessory === 'cap') {
    mesh(accessory, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, 1.12), uniform, [0, .12, 0], [.63, .57, .55]);
    ball(accessory, uniform, [0, .4, .5], [.48, .055, .33]);
    ball(accessory, trim, [0, .72, 0], [.07, .06, .07]);
  } else if (profile.accessory === 'cat') {
    for (const side of [-1, 1]) {
      const ear = mesh(accessory, new THREE.ConeGeometry(.2, .4, 3), uniform, [side * .4, .6, .02]);
      ear.rotation.z = side * -.25;
      ball(accessory, blush, [side * .4, .63, .12], [.075, .13, .025]);
    }
  } else if (profile.accessory === 'crown') {
    mesh(accessory, new THREE.CylinderGeometry(.28, .3, .14, 16), accent, [0, .64, 0]);
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * Math.PI * 2;
      mesh(accessory, new THREE.ConeGeometry(.085, .22, 4), accent, [Math.cos(angle) * .24, .81, Math.sin(angle) * .24]);
    }
  } else if (profile.accessory === 'goggles') {
    for (const side of [-1, 1]) {
      ball(accessory, dark, [side * .24, .35, .43], [.22, .15, .12]);
      ball(accessory, material('#b4f4ff', .12), [side * .24, .35, .52], [.16, .1, .035]);
    }
    box(accessory, accent, [0, .35, .5], [.1, .055, .05]);
  } else if (profile.accessory === 'bow' || profile.accessory === 'heart') {
    for (const side of [-1, 1]) {
      const bow = ball(accessory, uniform, [side * .18, .62, .16], [.23, .14, .12]);
      bow.rotation.z = side * .45;
    }
    ball(accessory, accent, [0, .63, .2], [.09, .1, .09]);
    if (profile.accessory === 'heart') {
      for (const side of [-1, 1]) ball(body, trim, [side * .065, 1.27, .261], [.085, .075, .025]);
      mesh(body, new THREE.ConeGeometry(.105, .13, 3), trim, [0, 1.19, .266]).rotation.z = Math.PI;
    }
  } else {
    mesh(accessory, new THREE.TorusGeometry(.57, .055, 8, 30), uniform, [0, .2, 0], [1, 1, .88]).rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const tail = box(accessory, uniform, [side * .08, .08, -.56], [.08, .32, .04]);
      tail.rotation.x = -.55;
    }
  }

  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = pivot(body, side * .37, 1.38, 0);
    arm.rotation.z = side * .13;
    mesh(arm, new THREE.CapsuleGeometry(.115, .23, 4, 8), uniform, [0, -.15, 0]);
    const elbow = pivot(arm, 0, -.3, 0);
    mesh(elbow, new THREE.CapsuleGeometry(.09, .2, 4, 8), skin, [0, -.13, 0]);
    ball(elbow, skin, [0, -.3, 0], [.115, .12, .1]);
    arms.push({ arm, elbow });
    const hip = pivot(body, side * .18, .85, 0);
    mesh(hip, new THREE.CapsuleGeometry(.125, .24, 4, 8), dark, [0, -.17, 0]);
    const knee = pivot(hip, 0, -.36, 0);
    mesh(knee, new THREE.CapsuleGeometry(.09, .23, 4, 8), skin, [0, -.16, 0]);
    mesh(knee, new THREE.CapsuleGeometry(.1, .12, 4, 8), trim, [0, -.27, 0]);
    ball(knee, uniform, [0, -.36, .09], [.155, .11, .25]);
    ball(knee, trim, [0, -.42, .1], [.16, .045, .25]);
    legs.push({ hip, knee });
  }
  root.rotation.y = Math.PI / 2;
  return { root, body, head, scarf, arms, legs, profile };
}

function poseCharacter(character, time) {
  const pose = runningPose(time, character.profile.seed);
  character.body.position.y = pose.bob + .04;
  character.body.rotation.set(-.1, pose.sway, pose.sway * .4);
  character.head.rotation.y = -.22 + pose.sway;
  character.arms[0].arm.rotation.x = pose.leftArm;
  character.arms[1].arm.rotation.x = pose.rightArm;
  character.arms.forEach(({ elbow }) => { elbow.rotation.x = pose.elbow; });
  character.legs[0].hip.rotation.x = pose.leftHip;
  character.legs[1].hip.rotation.x = pose.rightHip;
  character.legs[0].knee.rotation.x = pose.leftKnee;
  character.legs[1].knee.rotation.x = pose.rightKnee;
  character.scarf.rotation.x = pose.scarf;
  if (character.ears) {
    character.ears.forEach((ear, index) => {
      ear.rotation.z = (index === 0 ? -1 : 1) * (.04 + pose.sway * 2);
      ear.rotation.x = pose.scarf * .6;
    });
    character.skirt.rotation.z = pose.sway * .65;
  }
}

export class Race3D {
  constructor({ viewport, labels, status, onFocus }) {
    this.viewport = viewport;
    this.labels = labels;
    this.status = status;
    this.onFocus = onFocus;
    this.characters = new Map();
    this.paused = false;
    this.visible = true;
    this.time = 0;
    this.focusId = null;
    this.failed = false;
    this.disposed = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#162435');
    this.scene.fog = new THREE.Fog('#162435', 42, 85);
    this.camera = new THREE.PerspectiveCamera(36, 1, .1, 120);
    this.camera.position.set(13, 18, 30);
    this.lookAt = new THREE.Vector3(0, .3, 0);
    this.camera.lookAt(this.lookAt);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    viewport.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.scene.add(new THREE.HemisphereLight('#d8efff', '#75857e', 2.7));
    const light = new THREE.DirectionalLight('#fff0d6', 3.2);
    light.position.set(-5, 16, 9);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16, near: .5, far: 60 });
    light.shadow.normalBias = .035;
    this.scene.add(light);
    const rim = new THREE.DirectionalLight('#a2c6ff', 1.8);
    rim.position.set(0, 5, -12);
    this.scene.add(rim);
    this.stage = new THREE.Group();
    this.scene.add(this.stage);
    this.createStage();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.intersectionObserver = new IntersectionObserver(entries => {
      this.visible = entries[0].isIntersecting;
      if (this.visible) this.schedule();
    });
    this.intersectionObserver.observe(viewport);
    this.visibilityHandler = () => { if (!document.hidden) this.schedule(); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.contextLostHandler = event => {
      event.preventDefault();
      this.failed = true;
      cancelAnimationFrame(this.frameId);
      this.status.hidden = false;
      this.status.textContent = '3D 顯示連線中斷。請重新整理頁面重建場景；下方票數與曲線仍可使用。';
      console.error('[race3d] WebGL context lost');
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLostHandler);
    this.clickHandler = event => {
      const bounds = viewport.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, this.camera);
      const hit = ray.intersectObjects([...this.characters.values()].map(item => item.root), true)[0];
      if (!hit) return;
      let object = hit.object;
      while (object && !object.userData.nomineeId) object = object.parent;
      if (object) this.onFocus(object.userData.nomineeId);
    };
    viewport.addEventListener('click', this.clickHandler);
    this.status.hidden = true;
    this.resize();
  }

  createStage() {
    const asphalt = material('#394757');
    const floor = box(this.stage, asphalt, [0, -.3, 0], [27, .55, 17.5]);
    floor.receiveShadow = true;
    for (let index = 0; index < 5; index++) {
      const z = (index - 2) * 2.9;
      box(this.stage, material(index % 2 ? '#364557' : '#405166'), [0, -.01, z], [26, .03, 2.8]);
      for (let x = -12; x < 13; x += 2) {
        box(this.stage, material('#788a9c'), [x, .012, z + 1.44], [.95, .025, .045]);
      }
      box(this.stage, material('#a8d1c5'), [-10, .016, z], [.08, .025, 2.8]);
    }
    for (let row = 0; row < 24; row++) {
      for (let col = 0; col < 2; col++) {
        box(this.stage, material((row + col) % 2 ? '#263240' : '#d8e6e5'), [10.5 + col * .32, .022, -8 + row * .68], [.32, .025, .68]);
      }
    }
    const rail = material('#677a91');
    for (const z of [-8.7, 8.7]) {
      box(this.stage, rail, [0, .22, z], [27, .16, .14]);
      for (let x = -13; x <= 13; x += 3.25) box(this.stage, rail, [x, .08, z], [.12, .5, .12]);
    }
    // Miniature grandstands and colored crowd beads use no external model assets.
    for (let row = 0; row < 3; row++) {
      box(this.stage, material('#263b52'), [0, row * .4, -10.5 - row * 1.3], [29, .6 + row * .8, 1.25]);
      for (let index = 0; index < 32; index++) {
        const color = ['#d7c3ff', '#77c9ce', '#e7cc88', '#a8bbce'][(index + row * 3) % 4];
        ball(this.stage, material(color), [-13.5 + index * .87, .6 + row * .8, -10.5 - row * 1.3], [.15, .2, .15]);
      }
    }
    const sign = document.createElement('canvas');
    sign.width = 1024; sign.height = 128;
    const context = sign.getContext('2d');
    context.fillStyle = '#baf36a'; context.fillRect(0, 0, 1024, 128);
    context.fillStyle = '#172717'; context.font = 'bold 53px sans-serif'; context.textAlign = 'center';
    context.fillText('MMA RACE   /   FANDOM GRAND PRIX', 512, 82);
    const texture = new THREE.CanvasTexture(sign);
    texture.colorSpace = THREE.SRGBColorSpace;
    mesh(this.stage, new THREE.PlaneGeometry(16, 2), new THREE.MeshBasicMaterial({ map: texture }), [0, 3.7, -13.8]);
    for (const x of [-12, 12]) {
      box(this.stage, rail, [x, 3, -9], [.15, 6, .15]);
      box(this.stage, material('#d9f4f8'), [x, 6, -8.9], [2, .35, .3]);
    }
  }

  update(nominees, leaderVotes, rankOffset = 0) {
    const ids = new Set(nominees.map(nominee => nominee.content.id));
    for (const [id, character] of this.characters) {
      if (ids.has(id)) continue;
      character.root.removeFromParent();
      character.label.remove();
      disposeTree(character.root);
      this.characters.delete(id);
    }
    nominees.forEach((nominee, index) => {
      const id = nominee.content.id;
      let character = this.characters.get(id);
      if (character && character.profile.name !== characterProfile(nominee).name) {
        character.root.removeFromParent();
        character.label.remove();
        disposeTree(character.root);
        this.characters.delete(id);
        character = null;
      }
      if (!character) {
        character = createCharacter(characterProfile(nominee));
        character.root.userData.nomineeId = id;
        const label = document.createElement('div');
        label.className = 'racer-label';
        const name = document.createElement('strong');
        const votes = document.createElement('small');
        label.append(name, votes);
        this.labels.append(label);
        character.label = label;
        this.scene.add(character.root);
        this.characters.set(id, character);
        character.root.position.set(trackPosition(nominee.voteCount, leaderVotes), 0, (index - (nominees.length - 1) / 2) * 2.9);
      }
      character.targetX = trackPosition(nominee.voteCount, leaderVotes);
      character.targetZ = (index - (nominees.length - 1) / 2) * 2.9;
      character.label.style.setProperty('--team', character.profile.color);
      character.label.dataset.rank = String(rankOffset + index + 1).padStart(2, '0');
      character.label.firstChild.textContent = character.profile.characterName;
      character.label.lastChild.textContent = `${number.format(nominee.voteCount)} 票`;
      poseCharacter(character, this.time);
    });
    if (!ids.has(this.focusId)) this.focusId = null;
    if (this.paused) this.snapPositions();
    this.schedule();
  }

  snapPositions() {
    for (const character of this.characters.values()) {
      character.root.position.x = character.targetX;
      character.root.position.z = character.targetZ;
    }
  }

  focus(id) {
    this.focusId = id;
    this.schedule();
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.snapPositions();
    this.schedule();
  }

  resize() {
    const { width, height } = this.viewport.getBoundingClientRect();
    if (!width || !height || this.disposed) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.schedule();
  }

  schedule() {
    if (this.frameId || this.failed || this.disposed || document.hidden || !this.visible) return;
    this.frameId = requestAnimationFrame(timestamp => this.render(timestamp));
  }

  render(timestamp) {
    this.frameId = null;
    if (this.failed || this.disposed || document.hidden || !this.visible) return;
    const delta = Math.min((timestamp - (this.lastFrame ?? timestamp)) / 1000, .05);
    this.lastFrame = timestamp;
    if (!this.paused) this.time += delta;
    const smoothing = 1 - Math.exp(-delta * 5);
    for (const character of this.characters.values()) {
      if (!this.paused) {
        character.root.position.x = THREE.MathUtils.lerp(character.root.position.x, character.targetX, smoothing);
        character.root.position.z = THREE.MathUtils.lerp(character.root.position.z, character.targetZ, smoothing);
        poseCharacter(character, this.time);
      }
    }
    const focus = this.characters.get(this.focusId);
    const target = focus ? focus.root.position.clone().add(new THREE.Vector3(0, 1.3, 0)) : new THREE.Vector3(0, .2, 0);
    const narrow = this.camera.aspect < 1;
    const destination = focus ? target.clone().add(new THREE.Vector3(3.9, 2.6, 6)) :
      new THREE.Vector3(narrow ? 11 : 9, narrow ? 24 : 18, narrow ? 41 : 29);
    // Explicit camera changes remain available when animation is paused.
    const cameraBlend = this.paused ? 1 : smoothing;
    this.camera.position.lerp(destination, cameraBlend);
    this.lookAt.lerp(target, cameraBlend);
    this.camera.lookAt(this.lookAt);
    this.renderer.render(this.scene, this.camera);
    const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    for (const [id, character] of this.characters) {
      const location = character.root.position.clone().add(new THREE.Vector3(0, 3.05, 0)).project(this.camera);
      character.label.hidden = Boolean(focus && id !== this.focusId) || location.z > 1 || Math.abs(location.x) > .95 || Math.abs(location.y) > .95;
      character.label.style.left = `${(location.x + 1) * width / 2}px`;
      character.label.style.top = `${(1 - location.y) * height / 2}px`;
      character.label.classList.toggle('is-focused', id === this.focusId);
    }
    if (!this.paused) this.schedule();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.viewport.removeEventListener('click', this.clickHandler);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLostHandler);
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.replaceChildren();
  }
}
