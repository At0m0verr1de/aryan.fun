// "How long together" for the couple home: days at first, then months, then years.
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// since, today: 'YYYY-MM-DD'. Returns null before the date is set or if it's in the future.
export function togetherLabel(since, today) {
  if (!since || since > today) return null;
  const [sy, sm, sd] = since.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  const t = Date.parse(today);
  // Same day-of-month, n months on; Jan 31 + 1 month lands on Feb 28/29.
  const monthsOn = (n) => {
    const last = new Date(Date.UTC(sy, sm - 1 + n + 1, 0)).getUTCDate();
    return Date.UTC(sy, sm - 1 + n, Math.min(sd, last));
  };
  let months = (ty - sy) * 12 + (tm - sm);
  if (monthsOn(months) > t) months -= 1;
  const days = Math.round((t - monthsOn(months)) / 86400000);
  const years = Math.floor(months / 12);
  months %= 12;
  if (!years && !months) {
    const n = Math.round((Date.parse(today) - Date.parse(since)) / 86400000) + 1;
    return n === 1 ? 'day 1 together 🌱' : `day ${n} together`;
  }
  if (!days && !months) return `${plural(years, 'year')} together today 🎉`;
  if (!days && !years) return `${plural(months, 'month')} together today 🎉`;
  if (!years) return `${plural(months, 'month')}, ${plural(days, 'day')} together`;
  return `${plural(years, 'year')}${months ? `, ${plural(months, 'month')}` : ''} together`;
}
