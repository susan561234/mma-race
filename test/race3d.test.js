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
        const offset = mark.name === 'ive-blush' ? .003 : .006;
        assert.ok(Math.abs(((z - offset) / .4) ** 2 + (x / .59) ** 4 + (y / .5) ** 4 - 1) < 1e-6);
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
    assert.ok(width(blush[0]) > bounds(blush[0]).max.y - bounds(blush[0]).min.y);
    assert.ok(centerX(dots[0]) < 0 && centerX(dots[1]) > 0);
    assert.ok(centerX(dots[1]) < centerX(blush[1]));
    assert.ok(centerY(dots[1]) < centerY(dots[0]) - .05);
    for (let index = 0; index < 2; index++) {
      const dx = (centerX(dots[index]) - centerX(blush[index])) / .115;
      const dy = (centerY(dots[index]) - centerY(blush[index])) / .07;
      assert.ok(dx * dx + dy * dy < 1, 'both dots lie within their blush patch');
    }
    assert.ok(width(dots[0]) < width(blush[0]) * .1);
    assert.ok(width(dots[1]) < width(blush[1]) * .1);
    assert.deepEqual(character.head.scale.toArray(), [1.18, 1.14, 1.14]);
    const named = name => character.head.children.filter(object => object.name === name);
    const eyes = named('ive-eye'), highlights = named('ive-eye-highlight');
    assert.equal(eyes.length, 2);
    assert.equal(highlights.length, 2);
    assert.equal(named('ive-eye-low-reflection').length, 2);
    assert.equal(named('ive-upper-eyelid').length, 2);
    assert.equal(named('ive-outer-eye-arc').length, 2);
    assert.equal(named('ive-outer-eye-corner').length, 2);
    assert.equal(named('ive-outer-eyelash').length, 0);
    assert.equal(named('ive-forelock').length, 2);
    assert.equal(named('ive-mouth').length, 2);
    const face = character.head.getObjectByName('ive-face');
    assert.ok(width(face) > bounds(face).max.y - bounds(face).min.y);
    assert.ok(face.getObjectByName('ive-face-outline'));
    for (let index = 0; index < 2; index++) {
      const eye = eyes[index], highlight = highlights[index];
      assert.ok(bounds(eye).max.y - bounds(eye).min.y > width(eye));
      assert.ok(width(eye) / width(face) >= 1 / 6 && width(eye) / width(face) <= 1 / 5);
      assert.ok(centerY(eye) < 0);
      assert.ok(centerY(highlight) > centerY(eye));
      assert.ok(bounds(highlight).max.y - bounds(highlight).min.y > width(highlight));
      assert.equal(highlight.material.color.getHexString(), 'ffffff');
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
      const surface = ear.getObjectByName('ive-ear-surface');
      const box = bounds(surface);
      assert.ok(ear.getObjectByName('ive-ear-outline'));
      assert.equal(surface.material.color.getHexString(), 'ffffff');
      assert.equal(surface.children.length, 1);
      assert.ok(width(surface) > .5);
      assert.ok(box.max.z - box.min.z > .3, 'ears retain rounded 3D thickness');
      assert.ok(ear.position.z + box.max.z < .03, 'ear surfaces stay behind face and hands');
      const earBottom = character.head.position.y + character.head.scale.y * (ear.position.y + box.min.y);
      assert.ok(Math.abs(earBottom - (character.skirt.position.y - .13)) < .08);
      assert.ok(Math.abs((box.max.y - box.min.y) / .9 - 1.7) < .1);
    }
    character.head.traverse(object => {
      if (!object.geometry) return;
      for (const value of object.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
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
