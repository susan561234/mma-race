import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryName } from '../public/categories.js';
import { seedCategories } from '../seed.js';

test('all twelve award codes use the supplied award order, independent of API ordering', () => {
  const expected = [
    '年度藝人', '年度專輯', '年度最佳歌曲', '全球十大藝人',
    '年度新人', '最佳女歌手', '最佳男歌手', '最佳女子團體',
    '最佳男子團體', '最佳原聲帶', '最佳流行音樂藝人', 'Track Zero 之選'
  ];
  assert.equal(seedCategories.length, expected.length);
  for (const [index, name] of expected.entries()) {
    assert.equal(categoryName(`V${26002 + index}`), name);
  }
  assert.deepEqual(seedCategories.toReversed().map(category => categoryName(category.categoryId)), expected.toReversed());
});

test('an unknown category is explicitly unnamed, not mislabeled as another award', () => {
  assert.equal(categoryName('V26014'), '未命名獎項（V26014）');
  assert.equal(categoryName('constructor'), '未命名獎項（constructor）');
});
