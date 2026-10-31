// Chinese translations of the Korean award names supplied by the site owner.
const names = new Map([
  ['V26002', '年度藝人'],
  ['V26003', '年度專輯'],
  ['V26004', '年度最佳歌曲'],
  ['V26005', '全球十大藝人'],
  ['V26006', '年度新人'],
  ['V26007', '最佳女歌手'],
  ['V26008', '最佳男歌手'],
  ['V26009', '最佳女子團體'],
  ['V26010', '最佳男子團體'],
  ['V26011', '最佳原聲帶'],
  ['V26012', '最佳流行音樂藝人'],
  ['V26013', 'Track Zero 之選']
]);

export function categoryName(categoryId) {
  return names.get(categoryId) ?? `未命名獎項（${categoryId}）`;
}
