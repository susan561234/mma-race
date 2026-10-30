export function makeSeries(points, nomineeId, metric) {
  return points.filter(point => point.nomineeId === nomineeId)
    .map(point => ({ time: point.capturedAt, value: point[metric] }))
    .sort((a, b) => a.time - b.time);
}

export function chartGeometry(series, metric, width = 720, height = 270) {
  const all = series.flatMap(item => item.points);
  if (!all.length) return null;
  const left = 64, right = width - 18, top = 18, bottom = height - 33;
  const minTime = all.reduce((min, point) => Math.min(min, point.time), Infinity);
  const maxTime = all.reduce((max, point) => Math.max(max, point.time), -Infinity);
  const start = minTime === maxTime ? minTime - 150000 : minTime;
  const end = minTime === maxTime ? maxTime + 150000 : maxTime;
  const maxValue = all.reduce((max, point) => Math.max(max, point.value), 0);
  const ceiling = metric === 'votePercent' ? Math.min(100, Math.max(10, Math.ceil(maxValue / 10) * 10)) : Math.max(10, Math.ceil(maxValue * 1.08 / 10) * 10);
  const x = time => left + (time - start) / (end - start) * (right - left);
  const y = value => bottom - value / ceiling * (bottom - top);
  const path = points => points.map((point, index) => {
    const command = index === 0 || point.time - points[index - 1].time > 450000 ? 'M' : 'L';
    return `${command}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`;
  }).join(' ');
  return { left, right, top, bottom, start, end, ceiling, x, y, path };
}

export function toCsv(points, categoryId, nominees) {
  const escape = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const names = new Map(nominees.map(nominee => [nominee.content.id, nominee.content.name]));
  const rows = [
    ['observed_at_utc', 'category_id', 'nominee_id', 'name', 'vote_count', 'official_vote_percent'],
    ...points.map(point => [new Date(point.capturedAt).toISOString(), categoryId, point.nomineeId, names.get(point.nomineeId) ?? point.nomineeId, point.voteCount, point.votePercent])
  ];
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
