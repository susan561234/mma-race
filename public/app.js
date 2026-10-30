import { makeSeries, chartGeometry, toCsv } from './chart.js';
import { characterProfile } from './characters.js';
import { categoryName } from './categories.js';
import { dashboard as fetchDashboard, history as fetchHistory } from './data-client.js';

const $ = selector => document.querySelector(selector);
const number = new Intl.NumberFormat('zh-TW');
const time = value => new Date(value).toLocaleString('zh-TW', { hour12: false });
const shortTime = value => new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const pages = document.querySelector('meta[name="data-mode"]').content === 'pages';
const state = {
  dashboard: null, categoryId: new URLSearchParams(location.search).get('category'),
  range: '24h', metric: 'voteCount', points: [], selected: new Set(),
  expanded: false, search: '', historyError: null, connectionError: null,
  historyLoading: false, historyRequest: null, clockOffset: 0, refreshing: false,
  historyFetchedAt: 0,
  castPage: 0, focusId: null,
  paused: matchMedia('(prefers-reduced-motion: reduce)').matches
};
let race3d = null;

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function svgNode(tag, attributes = {}, text) {
  const result = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, String(value));
  if (text !== undefined) result.textContent = text;
  return result;
}

function category() {
  return state.dashboard?.categories.find(item => item.categoryId === state.categoryId);
}

function nominees() {
  return [...(category()?.nominees ?? [])].sort((a, b) => b.voteCount - a.voteCount || a.content.id.localeCompare(b.content.id));
}

function color(id) {
  const nominee = category().nominees.find(item => item.content.id === id);
  return characterProfile(nominee).color;
}

function initial(name) {
  return [...name.replace(/\s+/g, '')].slice(0, 2).join('').toUpperCase();
}

function portrait(nominee, className) {
  const element = node('span', className, initial(nominee.content.artistName ?? nominee.content.name));
  if (nominee.content.imageUrl) {
    const image = node('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = nominee.content.imageUrl;
    image.addEventListener('error', () => image.remove(), { once: true });
    element.replaceChildren(image);
    image.addEventListener('error', () => { element.textContent = initial(nominee.content.name); }, { once: true });
  }
  return element;
}

function renderStatus() {
  const data = state.dashboard;
  const element = $('#status');
  element.className = 'status-banner';
  let message;
  if (state.connectionError) {
    element.classList.add('error');
    message = `平台連線中斷：${state.connectionError}。畫面保留上次資料，15 秒後自動重試。`;
  } else if (!data) {
    message = '正在讀取觀測資料…';
  } else if (data.source === 'provided') {
    message = `提供的快照 · 非即時資料，原始觀測時間未知。${data.error ? `目前 ${data.error}；` : '正在等待首次成功收集；'}尚未累積歷史曲線。`;
  } else if (data.stale) {
    element.classList.add('error');
    message = `資料延遲 · 最後成功收集於 ${time(data.capturedAt)}。${data.error ?? '已超過預期更新時間。'} 保留最後成功資料，不補造紀錄。`;
  } else {
    element.classList.add('live');
    message = `API 已連線 · 最後成功收集於 ${time(data.capturedAt)}。${pages ? 'Actions 每 5 分鐘排程，實際執行與發布可能延遲。' : '背景每 5 分鐘更新，網頁自動同步。'}`;
  }
  element.replaceChildren(node('span', 'status-dot'), node('span', '', message));
}

function renderCategories() {
  $('#categories').replaceChildren(...state.dashboard.categories.map(item => {
    const button = node('button', 'category-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(item.categoryId === state.categoryId));
    button.append(node('strong', '', categoryName(item.categoryId)), node('small', '', `${item.categoryId} / ${item.nominees.length} 位候選`));
    button.addEventListener('click', () => switchCategory(item.categoryId));
    return button;
  }));
}

function renderStats() {
  const list = nominees();
  const leader = list[0];
  $('#total-votes').textContent = number.format(list.reduce((sum, item) => sum + item.voteCount, 0));
  $('#leader-name').textContent = leader.content.artistName ?? leader.content.name;
  $('#leader-name').title = leader.content.name;
  $('#leader-share').textContent = `官方得票率 ${leader.votePercent}% · ${number.format(leader.voteCount)} 票`;
  $('#lead-gap').textContent = list.length > 1 ? `${number.format(leader.voteCount - list[1].voteCount)} 票` : '—';
  $('#last-update').textContent = state.dashboard.capturedAt ? `成功收集 ${shortTime(state.dashboard.capturedAt)}` : '快照無原始觀測時間';
  $('#race-category').textContent = categoryName(state.categoryId);
  $('#race-category').title = state.categoryId;
  $('#nominee-count').textContent = `${list.length} 位候選`;
  renderClock();
}

function renderClock() {
  if (!state.dashboard) return;
  if (pages) {
    $('#countdown').textContent = state.connectionError ? '連線中斷' : '排程更新';
    return;
  }
  const next = state.dashboard.nextAttemptAt;
  const remaining = next ? Math.max(0, Math.ceil((next - Date.now() - state.clockOffset) / 1000)) : 0;
  $('#countdown').textContent = state.connectionError ? '連線中斷' :
    state.dashboard.collecting || !remaining ? '收集中…' :
    `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
}

function renderLanes() {
  const list = nominees();
  const displayed = state.expanded ? list : list.slice(0, 5);
  const container = $('#lanes');
  const existing = new Map([...container.children].map(element => [element.dataset.id, element]));
  for (const [index, nominee] of displayed.entries()) {
    let lane = existing.get(nominee.content.id);
    if (!lane) {
      lane = node('div', 'lane');
      lane.dataset.id = nominee.content.id;
      const identity = node('div', 'lane-identity');
      identity.append(node('strong'), node('small'));
      const name = node('div', 'lane-name');
      name.append(node('span', 'rank-num'), identity);
      const track = node('div', 'track');
      track.setAttribute('aria-hidden', 'true');
      track.append(node('span', 'track-trail'), node('span', 'track-value'));
      lane.append(name, track);
    }
    lane.style.setProperty('--color', color(nominee.content.id));
    lane.style.setProperty('--delay', `${-index * .13}s`);
    // Keep head room at both ends so the marker never clips outside its lane.
    lane.style.setProperty('--position', String(8 + (list[0].voteCount ? nominee.voteCount / list[0].voteCount : 0) * 84));
    lane.querySelector('.rank-num').textContent = String(index + 1).padStart(2, '0');
    lane.querySelector('.lane-identity strong').textContent = nominee.content.artistName ?? nominee.content.name;
    lane.querySelector('.lane-identity small').textContent = `${number.format(nominee.voteCount)} 票 · ${nominee.votePercent}%`;
    lane.querySelector('.lane-identity').title = `${nominee.content.name}：${number.format(nominee.voteCount)} 票`;
    lane.querySelector('.track-value').textContent = number.format(nominee.voteCount);
    container.append(lane);
    existing.delete(nominee.content.id);
  }
  for (const element of existing.values()) element.remove();
  $('#expand-race').hidden = list.length <= 5;
  $('#expand-race').textContent = state.expanded ? '收起為前五名 ↑' : `查看全部 ${list.length} 位候選人 ↓`;
  $('#expand-race').setAttribute('aria-expanded', String(state.expanded));
  renderCast();
}

function focusCharacter(id) {
  state.focusId = id;
  race3d?.focus(id);
  renderCastCards();
}

function renderCastCards() {
  const list = nominees();
  const cast = list.slice(state.castPage * 5, state.castPage * 5 + 5);
  $('#character-cards').replaceChildren(...cast.map((nominee, index) => {
    const profile = characterProfile(nominee);
    const button = node('button', 'character-card');
    button.type = 'button';
    button.style.setProperty('--team', profile.color);
    button.setAttribute('aria-pressed', String(nominee.content.id === state.focusId));
    button.setAttribute('aria-label', `${profile.name}：${profile.title}，${number.format(nominee.voteCount)} 票，切換 3D 特寫`);
    button.append(
      node('span', 'cast-number', `RACER ${String(state.castPage * 5 + index + 1).padStart(2, '0')}`),
      node('strong', '', profile.name), node('small', '', profile.title),
      node('span', 'cast-votes', `${number.format(nominee.voteCount)} 票`)
    );
    button.addEventListener('click', () => focusCharacter(nominee.content.id));
    return button;
  }));
  const focused = list.find(item => item.content.id === state.focusId);
  $('#race-commentary').textContent = focused
    ? `${characterProfile(focused).name} / ${characterProfile(focused).title}`
    : `${characterProfile(list[0]).name} 目前領跑 · 應援代表競速中`;
  $('#camera-overview').setAttribute('aria-pressed', String(!state.focusId));
  $('#cast-page').textContent = `${state.castPage + 1} / ${Math.ceil(list.length / 5)}`;
  $('#cast-prev').disabled = state.castPage === 0;
  $('#cast-next').disabled = (state.castPage + 1) * 5 >= list.length;
}

function renderCast() {
  const list = nominees();
  state.castPage = Math.min(state.castPage, Math.ceil(list.length / 5) - 1);
  const cast = list.slice(state.castPage * 5, state.castPage * 5 + 5);
  if (!cast.some(item => item.content.id === state.focusId)) state.focusId = null;
  race3d?.update(cast, list[0].voteCount, state.castPage * 5);
  race3d?.focus(state.focusId);
  renderCastCards();
}

function renderRankings() {
  const list = nominees();
  const query = state.search.toLocaleLowerCase().trim();
  const rows = list.flatMap((nominee, index) => {
    if (!`${nominee.content.name} ${nominee.content.artistName ?? ''}`.toLocaleLowerCase().includes(query)) return [];
    const row = node('div', 'ranking-row');
    row.style.setProperty('--color', color(nominee.content.id));
    const identity = node('div', 'identity');
    identity.append(node('strong', '', nominee.content.artistName ?? nominee.content.name));
    if (nominee.content.artistName) identity.append(node('small', '', nominee.content.name));
    identity.title = nominee.content.name;
    const votes = node('div', 'ranking-votes', number.format(nominee.voteCount));
    votes.append(node('small', '', `${nominee.votePercent}%`));
    row.append(node('span', 'rank-num', String(index + 1).padStart(2, '0')), portrait(nominee, 'avatar'), identity, votes);
    return [row];
  });
  $('#rankings').replaceChildren(...(rows.length ? rows : [node('p', 'no-results', '沒有符合的候選項目')]));
}

function renderLegend() {
  $('#legend').replaceChildren(...nominees().map(nominee => {
    const button = node('button');
    button.type = 'button';
    button.style.setProperty('--color', color(nominee.content.id));
    button.setAttribute('aria-pressed', String(state.selected.has(nominee.content.id)));
    button.append(node('i'), document.createTextNode(nominee.content.artistName ? `${nominee.content.artistName} · ${nominee.content.name}` : nominee.content.name));
    button.addEventListener('click', () => {
      if (state.selected.has(nominee.content.id)) state.selected.delete(nominee.content.id);
      else state.selected.add(nominee.content.id);
      renderLegend();
      renderChart();
    });
    return button;
  }));
}

function renderChart() {
  const container = $('#chart');
  $('#export').disabled = state.historyLoading || Boolean(state.historyError) || !state.points.length;
  const empty = (title, description) => {
    const wrapper = node('div', 'chart-empty');
    wrapper.append(node('span', 'empty-icon', '↗ · ↗'), node('strong', '', title), node('p', '', description));
    container.replaceChildren(wrapper);
  };
  if (state.historyLoading) return empty('正在讀取真實觀測紀錄', '曲線僅使用後端保存的 API 樣本。');
  if (state.historyError) return empty('歷史資料讀取失敗', `${state.historyError}。下次同步會自動重試。`);
  if (!state.points.length) return empty('第一條應援軌跡，等待啟程', '這個時間範圍還沒有成功收集的樣本。連線成功後會每 5 分鐘保存一次；你提供的快照不會被當作歷史紀錄。');
  if (!state.selected.size) return empty('選擇你想追蹤的應援軌跡', '點選下方候選人，即可比較累計票數或官方得票率。');
  const series = nominees().filter(item => state.selected.has(item.content.id)).map(item => ({
    nominee: item, points: makeSeries(state.points, item.content.id, state.metric)
  }));
  const width = Math.max(300, container.clientWidth);
  const height = container.clientHeight;
  const geometry = chartGeometry(series, state.metric, width, height);
  if (!geometry) return empty('所選候選人尚無樣本', '請選擇其他候選人，或等待後續資料收集。');
  const { left, right, top, bottom, start, end, ceiling, x, y, path } = geometry;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'chart-title chart-desc' });
  svg.append(svgNode('title', { id: 'chart-title' }, state.metric === 'voteCount' ? '累計票數趨勢' : '官方得票率趨勢'));
  svg.append(svgNode('desc', { id: 'chart-desc' }, '真實 API 觀測紀錄。滑鼠移動或以鍵盤選取最新資料點查看數值。超過 7.5 分鐘的缺口不連線。'));
  for (let index = 0; index <= 4; index++) {
    const value = ceiling * index / 4;
    const yy = y(value);
    svg.append(svgNode('line', { x1: left, y1: yy, x2: right, y2: yy, stroke: '#30372b', 'stroke-dasharray': '3 5' }));
    svg.append(svgNode('text', { x: left - 12, y: yy + 3, fill: '#8e9b81', 'font-size': 10, 'text-anchor': 'end' }, state.metric === 'votePercent' ? `${number.format(value)}%` : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)));
  }
  for (let index = 0; index <= 4; index++) {
    const stamp = start + (end - start) * index / 4;
    const label = end - start > 86400000 ? new Date(stamp).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) : shortTime(stamp);
    svg.append(svgNode('text', { x: x(stamp), y: bottom + 24, fill: '#8e9b81', 'font-size': 10, 'text-anchor': 'middle' }, label));
  }
  for (const item of series) {
    if (!item.points.length) continue;
    const shade = color(item.nominee.content.id);
    svg.append(svgNode('path', { d: path(item.points), fill: 'none', stroke: shade, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const last = item.points.at(-1);
    const dot = svgNode('circle', { cx: x(last.time), cy: y(last.value), r: 4, fill: shade, stroke: '#192015', 'stroke-width': 2, tabindex: 0 });
    dot.append(svgNode('title', {}, `${item.nominee.content.name} / ${time(last.time)} / ${number.format(last.value)}${state.metric === 'votePercent' ? '%' : ' 票'}`));
    svg.append(dot);
    // Isolated samples must remain visible even when there is no connecting segment.
    for (let index = 0; index < item.points.length - 1; index++) {
      const current = item.points[index];
      if ((index === 0 || current.time - item.points[index - 1].time > 450000) &&
          item.points[index + 1].time - current.time > 450000) {
        svg.append(svgNode('circle', { cx: x(current.time), cy: y(current.value), r: 3, fill: shade }));
      }
    }
  }
  const guide = svgNode('line', { x1: left, x2: left, y1: top, y2: bottom, stroke: '#7b8b68', 'stroke-dasharray': '3 4', visibility: 'hidden' });
  svg.append(guide);
  const tooltip = node('div', 'chart-tooltip');
  tooltip.hidden = true;
  const stamps = [...new Set(state.points.map(point => point.capturedAt))].sort((a, b) => a - b);
  svg.addEventListener('pointermove', event => {
    const bounds = svg.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width * width;
    if (px < left || px > right) { tooltip.hidden = true; guide.setAttribute('visibility', 'hidden'); return; }
    const targetTime = start + (px - left) / (right - left) * (end - start);
    const stamp = stamps.reduce((nearest, current) => Math.abs(current - targetTime) < Math.abs(nearest - targetTime) ? current : nearest, stamps[0]);
    const lines = [time(stamp)];
    for (const item of series) {
      const point = item.points.find(point => point.time === stamp);
      if (point) lines.push(`${item.nominee.content.name}  ${number.format(point.value)}${state.metric === 'votePercent' ? '%' : ' 票'}`);
    }
    tooltip.textContent = lines.join('\n');
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(0, Math.min(event.clientX - bounds.left + 12, container.clientWidth - tooltip.offsetWidth))}px`;
    tooltip.style.top = '20px';
    guide.setAttribute('x1', x(stamp));
    guide.setAttribute('x2', x(stamp));
    guide.setAttribute('visibility', 'visible');
  });
  svg.addEventListener('pointerleave', () => { tooltip.hidden = true; guide.setAttribute('visibility', 'hidden'); });
  container.replaceChildren(svg, tooltip);
  if (stamps.length === 1) {
    const note = svgNode('text', { x: right, y: top, 'text-anchor': 'end', fill: '#a5b397', 'font-size': 10 }, '目前只有 1 筆樣本，尚無變化曲線');
    svg.append(note);
  }
}

async function loadHistory() {
  state.historyRequest?.abort();
  const controller = new AbortController();
  state.historyRequest = controller;
  state.historyLoading = true;
  state.historyError = null;
  state.points = [];
  renderChart();
  const timer = setTimeout(() => controller.abort(new Error('讀取逾時')), 15000);
  try {
    const result = await fetchHistory(pages, state.categoryId, state.range, controller.signal);
    if (controller !== state.historyRequest) return;
    state.points = result.points;
    state.historyFetchedAt = Date.now();
  } catch (error) {
    if (controller !== state.historyRequest) return;
    state.historyError = error.message;
    console.error('[history]', error);
  } finally {
    clearTimeout(timer);
    if (controller === state.historyRequest) {
      state.historyLoading = false;
      renderChart();
    }
  }
}

function switchCategory(id) {
  state.categoryId = id;
  state.selected = new Set(nominees().slice(0, 3).map(item => item.content.id));
  state.expanded = false;
  state.castPage = 0;
  state.focusId = null;
  state.search = '';
  $('#search').value = '';
  const url = new URL(location.href);
  url.searchParams.set('category', id);
  history.replaceState(null, '', url);
  $('#lanes').replaceChildren();
  renderCategories();
  renderStats();
  renderLanes();
  renderRankings();
  renderLegend();
  void loadHistory();
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const data = await fetchDashboard(pages);
    if (!Array.isArray(data.categories) || !data.categories.length) throw new Error('平台回傳資料格式不正確');
    const previous = state.dashboard;
    state.dashboard = data;
    state.clockOffset = data.serverTime - Date.now();
    state.connectionError = null;
    if (!data.categories.some(item => item.categoryId === state.categoryId)) state.categoryId = null;
    if (!state.categoryId) switchCategory(data.categories[0].categoryId);
    else if (!$('#categories').children.length) switchCategory(state.categoryId);
    else {
      renderStats();
      const newObservation = data.capturedAt !== previous?.capturedAt;
      if (newObservation || JSON.stringify(data.categories) !== JSON.stringify(previous?.categories)) {
        const ids = new Set(category().nominees.map(item => item.content.id));
        state.selected = new Set([...state.selected].filter(id => ids.has(id)));
        renderCategories();
        renderLanes();
        renderRankings();
        renderLegend();
      }
      if (newObservation || state.historyError || Date.now() - state.historyFetchedAt > 60000) await loadHistory();
    }
  } catch (error) {
    state.connectionError = error.message;
    console.error('[dashboard]', error);
  } finally {
    state.refreshing = false;
    renderStatus();
  }
}

$('#expand-race').addEventListener('click', () => {
  if (!state.dashboard) return;
  state.expanded = !state.expanded;
  renderLanes();
});
$('#search').addEventListener('input', event => {
  state.search = event.target.value;
  renderRankings();
});
function renderMotion() {
  document.body.classList.toggle('motion-paused', state.paused);
  $('#motion-toggle').setAttribute('aria-pressed', String(state.paused));
  $('#motion-toggle').textContent = state.paused ? '啟用動畫' : '暫停動畫';
  race3d?.setPaused(state.paused);
}
$('#motion-toggle').addEventListener('click', () => { state.paused = !state.paused; renderMotion(); });
for (const button of document.querySelectorAll('[data-metric]')) {
  button.addEventListener('click', () => {
    state.metric = button.dataset.metric;
    for (const item of document.querySelectorAll('[data-metric]')) item.setAttribute('aria-pressed', String(item === button));
    renderChart();
  });
}
for (const button of document.querySelectorAll('[data-range]')) {
  button.addEventListener('click', () => {
    state.range = button.dataset.range;
    for (const item of document.querySelectorAll('[data-range]')) item.setAttribute('aria-pressed', String(item === button));
    if (state.dashboard) void loadHistory();
  });
}
$('#export').addEventListener('click', () => {
  if (!state.points.length) return;
  const blob = new Blob([toCsv(state.points, state.categoryId, category().nominees)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = node('a');
  link.href = url;
  link.download = `mma-${state.categoryId}-${state.range}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
$('#camera-overview').addEventListener('click', () => { if (state.dashboard) focusCharacter(null); });
for (const [selector, direction] of [['#cast-prev', -1], ['#cast-next', 1]]) {
  $(selector).addEventListener('click', () => {
    if (!state.dashboard) return;
    state.castPage += direction;
    state.focusId = null;
    renderCast();
  });
}
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
  state.paused = event.matches;
  renderMotion();
});
async function initializeRace() {
  try {
    const { Race3D } = await import('./race3d.js');
    race3d = new Race3D({
      viewport: $('#race-viewport'), labels: $('#race-labels'),
      status: $('#race-render-status'), onFocus: focusCharacter
    });
    race3d.setPaused(state.paused);
    if (state.dashboard) renderCast();
  } catch (error) {
    console.error('[race3d]', error);
    $('#race-render-status').hidden = false;
    $('#race-render-status').textContent = '無法啟用 3D 場景，請確認瀏覽器支援 WebGL 2 與硬體加速，並確認 3D 模組已安裝。下方票數與歷史曲線仍可使用。';
  }
}
renderMotion();
void initializeRace();
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
setInterval(renderClock, 1000);
new ResizeObserver(() => { if (state.dashboard) renderChart(); }).observe($('#chart'));
