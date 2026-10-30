// These palettes and mascots are original designs, not official fan colors.
const designs = [
  ['PLAVE', '#9d8bff', '#d2f4ff', 'headphones', '星際領航員'],
  ['NCT WISH', '#b5f36d', '#def8b3', 'cap', '幸運追風手'],
  ['방탄소년단', '#b38af6', '#29253d', 'headband', '紫夜疾風'],
  ['Hearts2Hearts (하츠투하츠)', '#ff8cb4', '#583655', 'heart', '心動快遞員'],
  ['CORTIS (코르티스)', '#70d7e3', '#183a45', 'goggles', '藍焰先鋒'],
  ['IVE (아이브)', '#f4c778', '#4b2a46', 'crown', '星冠挑戰者'],
  ['AKMU (악뮤)', '#87d3a3', '#563e2d', 'cap', '森林旅人'],
  ['아이오아이 (I.O.I)', '#ff9c88', '#6b3f42', 'bow', '日落飛行員'],
  ['아일릿(ILLIT)', '#b6c8ff', '#4c4a86', 'cat', '雲朵跳躍者'],
  ['KiiiKiii (키키)', '#f5e878', '#a76435', 'goggles', '檸檬閃電'],
  ['aespa', '#88e9e1', '#b8ccf6', 'headphones', '極光巡航員'],
  ['RESCENE (리센느)', '#f2a9d1', '#63336b', 'bow', '花火衝刺手'],
  ['G-DRAGON', '#ff786c', '#ecf1e0', 'crown', '赤焰隊長'],
  ['RIIZE', '#ffa55b', '#553b2e', 'headband', '橙光躍進者'],
  ['NCT DREAM', '#a7ee74', '#3c5430', 'headphones', '綠野夢行者'],
  ['TWS (투어스)', '#89bdfb', '#273c64', 'cap', '晴空追逐者'],
  ['BOYNEXTDOOR', '#f8ca77', '#714633', 'cap', '街角跑酷手']
];

const known = new Map(designs.map(([name, color, hair, accessory, title]) => [name, { color, hair, accessory, title }]));
const accessories = ['headphones', 'cap', 'headband', 'heart', 'goggles', 'crown', 'bow', 'cat'];
const skins = ['#f1bd98', '#dca67e', '#eac4a9', '#b9805b'];
export function hashName(name) {
  let hash = 2166136261;
  for (const character of name.normalize('NFKC').trim()) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return hash;
}

export function characterProfile(nominee) {
  const name = (nominee.content.artistName || nominee.content.name).normalize('NFKC').trim();
  const seed = hashName(name);
  const specific = known.get(name);
  return {
    name, seed,
    color: specific?.color ?? `hsl(${seed % 360}, 72%, 69%)`,
    hair: specific?.hair ?? ['#302a40', '#855e42', '#d8b87c', '#527b8b', '#80567d'][seed % 5],
    accessory: specific?.accessory ?? accessories[seed % accessories.length],
    title: specific?.title ?? ['星光追風手', '夢想領航員', '應援衝刺手', '舞台冒險家'][seed % 4],
    skin: skins[(seed >>> 4) % skins.length],
    hairStyle: (seed >>> 8) % 3
  };
}

export function runningPose(time, seed) {
  const phase = time * 10 + (seed % 100) / 10;
  return {
    bob: Math.abs(Math.sin(phase)) * .105,
    sway: Math.sin(phase) * .035,
    leftHip: Math.sin(phase) * .88,
    rightHip: Math.sin(phase + Math.PI) * .88,
    leftKnee: .18 + Math.max(0, -Math.cos(phase)) * 1.15,
    rightKnee: .18 + Math.max(0, -Math.cos(phase + Math.PI)) * 1.15,
    leftArm: -Math.sin(phase) * .85,
    rightArm: Math.sin(phase) * .85,
    elbow: -.95,
    scarf: Math.sin(phase - .6) * .22
  };
}

export function trackPosition(votes, leaderVotes) {
  return -8 + (leaderVotes > 0 ? Math.max(0, Math.min(1, votes / leaderVotes)) : 0) * 16;
}
