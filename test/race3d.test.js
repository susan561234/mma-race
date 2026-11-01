import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPages } from '../scripts/build-pages.js';
import { collect } from '../scripts/collect.js';
import { seedCategories } from '../seed.js';

test('CHERRY follows the stylized face, eye, cheek and long-ear reference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mma-face-'));
  const previousDocument = globalThis.document;
  try {
    await collect(join(directory, 'state'), {
      fetchFn: async () => ({ ok: true, json: async () => ({ response: { status: 'ok', categories: seedCategories } }) }),
    });
    buildPages(join(directory, 'state'), join(directory, 'site'));
    const { Race3D } = await import(pathToFileURL(join(directory, 'site/race3d.js')).href);
    const { Raycaster, Vector3 } = await import(pathToFileURL(join(directory, 'site/vendor/three.module.js')).href);
    globalThis.document = {
      createElement: () => ({
        style: { setProperty() {} }, dataset: {},
        append(first, last) { this.firstChild = first; this.lastChild = last; },
        remove() {},
      }),
    };
    const race = Object.assign(Object.create(Race3D.prototype), {
      characters: new Map(), scene: { add() {} }, labels: { append() {} },
      time: 0, paused: true, schedule() {},
    });
    const nominee = seedCategories[7].nominees[0];
    race.update([nominee], nominee.voteCount);
    const character = race.characters.get(nominee.content.id);
    const face = character.head.getObjectByName('ive-face');
    const ray = new Raycaster();
    const blush = character.head.children.filter(object => object.name === 'ive-blush');
    const dots = ['ive-left-cheek-dot', 'ive-right-cheek-dot']
      .map(name => character.head.getObjectByName(name));
    assert.equal(blush.length, 2);
    assert.ok(dots.every(Boolean));
    assert.equal(character.head.getObjectByName('ive-right-cheek-tiny-dot'), undefined);
    for (const mark of [...blush, ...dots]) {
      assert.equal(mark.castShadow, false);
      assert.equal(mark.receiveShadow, false);
      assert.equal(mark.material.transparent, true);
      assert.equal(mark.material.depthWrite, false);
      const { position, color } = mark.geometry.attributes;
      assert.equal(color.itemSize, 4);
      const alphas = [];
      for (let index = 0; index < position.count; index++) {
        const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
        if (index % 96 === 0) {
          ray.set(new Vector3(x, y, 1), new Vector3(0, 0, -1));
          const hit = ray.intersectObject(face)[0];
          assert.ok(hit, 'cheek details remain within the face silhouette');
          assert.ok(z - hit.point.z > .001 && z - hit.point.z < .012, 'details follow the face without floating');
        }
        alphas.push(color.getW(index));
      }
      assert.equal(Math.min(...alphas), 0);
      assert.equal(Math.max(...alphas), 1);
      assert.ok(alphas.some(alpha => alpha > 0 && alpha < 1));
      mark.geometry.computeBoundingBox();
    }
    const bounds = mark => {
      mark.geometry.computeBoundingBox();
      return mark.geometry.boundingBox;
    };
    const centerX = mark => (bounds(mark).min.x + bounds(mark).max.x) / 2;
    const centerY = mark => (bounds(mark).min.y + bounds(mark).max.y) / 2;
    const width = mark => bounds(mark).max.x - bounds(mark).min.x;
    assert.ok(Math.abs(centerX(blush[0]) + centerX(blush[1])) < 1e-6);
    assert.equal(centerY(blush[0]), centerY(blush[1]));
    assert.ok(Math.abs(width(blush[0]) - width(blush[1])) < 1e-6);
    assert.ok(Math.abs(width(blush[0]) / (bounds(blush[0]).max.y - bounds(blush[0]).min.y) - 1) < .1);
    assert.ok(centerX(dots[0]) < 0 && centerX(dots[1]) > 0);
    assert.ok(centerX(dots[1]) < centerX(blush[1]));
    assert.ok(centerY(dots[1]) < centerY(dots[0]) - .05);
    const dx = (centerX(dots[0]) - centerX(blush[0])) / .09;
    const dy = (centerY(dots[0]) - centerY(blush[0])) / .095;
    assert.ok(dx * dx + dy * dy < 1, 'left dot lies within the blush patch');
    assert.ok(Math.abs(centerX(dots[1]) - bounds(blush[1]).min.x) < .02);
    assert.ok(width(dots[0]) < width(blush[0]) * .1);
    assert.ok(width(dots[1]) < width(blush[1]) * .1);
    assert.deepEqual(character.head.scale.toArray(), [1.18, 1.14, 1.14]);
    const named = name => character.head.children.filter(object => object.name === name);
    const eyes = named('ive-eye'), highlights = named('ive-eye-highlight');
    assert.equal(eyes.length, 2);
    assert.equal(highlights.length, 2);
    assert.equal(named('ive-eye-secondary-highlight').length, 2);
    assert.equal(named('ive-eye-low-reflection').length, 0);
    assert.equal(named('ive-upper-eyelid').length, 2);
    assert.equal(named('ive-outer-eye-arc').length, 2);
    assert.equal(named('ive-outer-eye-corner').length, 2);
    assert.equal(named('ive-outer-eyelash').length, 0);
    assert.equal(named('ive-forelock').length, 2);
    assert.equal(named('ive-mouth').length, 2);
    assert.ok(width(face) > bounds(face).max.y - bounds(face).min.y);
    assert.equal(face.getObjectByName('ive-face-outline'), undefined);
    const facePositions = face.geometry.attributes.position;
    const sideContour = [];
    for (let index = 0; index < facePositions.count; index++) {
      const x = facePositions.getX(index), y = facePositions.getY(index), z = facePositions.getZ(index);
      if (x > 0 && Math.abs(z) < 1e-6 && y < .39 && y > -.4) sideContour.push({ x, y });
    }
    const transition = sideContour.reduce((nearest, point) =>
      Math.abs(point.y + .13) < Math.abs(nearest.y + .13) ? point : nearest);
    const upper = sideContour.filter(point => point.y > -.10);
    const cheek = sideContour.filter(point => point.y < -.16 && point.y > -.34);
    const upperWidth = Math.max(...upper.map(point => point.x));
    const cheekWidth = Math.max(...cheek.map(point => point.x));
    assert.ok(upperWidth >= transition.x && upperWidth - transition.x < .025);
    assert.ok(cheekWidth <= transition.x && transition.x - cheekWidth < .015,
      'the short cheek arc stays subtle without narrowing and expanding into a groove');
    for (const point of sideContour) {
      const mirrored = [...facePositions.array].some((value, index) =>
        index % 3 === 0 && Math.abs(value + point.x) < 1e-6 &&
        Math.abs(facePositions.array[index + 1] - point.y) < 1e-6 &&
        Math.abs(facePositions.array[index + 2]) < 1e-6);
      assert.ok(mirrored, 'the side contours are symmetrical');
    }
    const faceNormals = face.geometry.attributes.normal;
    const rows = [];
    for (let row = 1; row < 64; row++) {
      const start = row * 65, end = start + 64;
      const points = Array.from({ length: 65 }, (_, column) => new Vector3().fromBufferAttribute(facePositions, start + column));
      const y = points[0].y;
      const depth = Math.max(...points.map(point => point.z));
      rows.push({ y, points });
      if (y > -.34 && y < .3) assert.ok(depth > .42, 'the side remains full from forehead to lower cheek');
      const firstNormal = new Vector3().fromBufferAttribute(faceNormals, start);
      const lastNormal = new Vector3().fromBufferAttribute(faceNormals, end);
      assert.ok(firstNormal.distanceTo(lastNormal) < 1e-6, 'the head UV seam cannot create a shaded crease');
    }
    for (const angle of [Math.PI / 4, Math.PI / 3, Math.PI / 2]) {
      const profile = rows.map(row => Math.max(...row.points.map(point => point.x * Math.cos(angle) + point.z * Math.sin(angle))));
      for (let index = 4; index < rows.length - 4; index++) {
        const before = index - 4, after = index + 4;
        const t = (rows[index].y - rows[before].y) / (rows[after].y - rows[before].y);
        const chord = profile[before] * (1 - t) + profile[after] * t;
        assert.ok(profile[index] >= chord - .001, 'side and oblique silhouettes must not dip inward');
      }
    }
    for (let index = 0; index < 2; index++) {
      const eye = eyes[index], highlight = highlights[index];
      assert.ok(bounds(eye).max.y - bounds(eye).min.y > width(eye));
      assert.ok((bounds(eye).max.y - bounds(eye).min.y) / width(eye) < 1.1);
      assert.ok(width(eye) / width(face) >= 1 / 6 && width(eye) / width(face) <= 1 / 5);
      assert.ok(centerY(eye) < 0);
      assert.ok(centerY(highlight) > centerY(eye));
      assert.ok(bounds(highlight).max.y - bounds(highlight).min.y > width(highlight));
      assert.equal(highlight.material.color.getHexString(), 'ffffff');
      const secondary = named('ive-eye-secondary-highlight')[index];
      assert.equal(secondary.material.color.getHexString(), 'ffffff');
      assert.ok(centerY(secondary) < centerY(eye));
      assert.ok(width(secondary) < width(highlight));
      const arc = named('ive-outer-eye-arc')[index].geometry.parameters.path.getPoint(.6);
      const side = index === 0 ? -1 : 1;
      const outerEdge = side < 0 ? bounds(eye).min.x : bounds(eye).max.x;
      assert.ok(side * (arc.x - outerEdge) > .025, 'outer arc leaves a narrow white crescent');
    }
    assert.ok(bounds(eyes[1]).min.x - bounds(eyes[0]).max.x > width(eyes[0]));
    const nose = character.head.getObjectByName('ive-nose');
    assert.ok(bounds(nose).max.y < bounds(eyes[0]).min.y);
    assert.ok(bounds(named('ive-mouth')[0]).max.y < bounds(nose).min.y);
    assert.ok(Math.abs(centerY(dots[0]) - centerY(nose)) < .01);
    assert.equal(character.ears.length, 2);
    for (const ear of character.ears) {
      const front = ear.getObjectByName('ive-ear-front');
      const back = ear.getObjectByName('ive-ear-back');
      assert.equal(ear.children.length, 2);
      assert.ok(front && back);
      assert.equal(ear.getObjectByName('ive-ear-outline'), undefined);
      assert.equal(front.material.color.getHexString(), 'ffffff');
      assert.equal(back.material.color.getHexString(), 'ffffff');
      assert.ok(width(front) > .5);
      const box = bounds(front).clone().union(bounds(back));
      assert.ok(box.max.z - box.min.z > .3, 'ears retain rounded 3D thickness');
      assert.ok(ear.position.z + box.max.z < .03, 'ear surfaces stay behind face and hands');
      const frontPositions = front.geometry.attributes.position;
      const backPositions = back.geometry.attributes.position;
      const frontNormals = front.geometry.attributes.normal;
      const backNormals = back.geometry.attributes.normal;
      for (let row = 0; row <= 48; row++) {
        for (const edge of [0, 48]) {
          const a = row * 49 + edge, b = row * 49 + 48 - edge;
          for (const axis of ['getX', 'getY', 'getZ']) {
            assert.ok(Math.abs(frontPositions[axis](a) - backPositions[axis](b)) < 1e-6,
              'front and back panels meet along the same edge without a gap');
            assert.ok(Math.abs(frontNormals[axis](a) - backNormals[axis](b)) < 1e-6,
              'ear panels share smooth normals rather than a concave-looking seam');
          }
        }
      }
      const earBottom = character.head.position.y + character.head.scale.y * (ear.position.y + box.min.y);
      assert.ok(Math.abs(earBottom - (character.skirt.position.y - .13)) < .08);
      assert.ok(Math.abs((box.max.y - box.min.y) / .9 - 1.7) < .1);
    }
    character.head.traverse(object => {
      assert.ok(!object.name.includes('outline'), 'no black outline shells remain');
      if (!object.geometry) return;
      for (const value of object.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      if (object.name === 'ive-face' || object.name.startsWith('ive-ear-')) {
        const normals = object.geometry.attributes.normal;
        for (let index = 0; index < normals.count; index++) {
          assert.ok(Math.abs(new Vector3().fromBufferAttribute(normals, index).length() - 1) < 1e-6);
        }
      }
    });
    assert.equal(character.skirt.name, 'ive-skirt');
    assert.equal(character.label.firstChild.textContent, 'CHERRY');
    let disposed = 0;
    for (const mark of [...blush, ...dots]) {
      mark.geometry.addEventListener('dispose', () => disposed++);
      mark.material.addEventListener('dispose', () => disposed++);
    }
    race.update([], 0);
    assert.equal(disposed, 8);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    rmSync(directory, { recursive: true });
  }
});
