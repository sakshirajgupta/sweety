function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const key = userId => `sweety.selectedDate.${userId}`;

// Each account remembers its own day in this tab, independently of login tokens.
export function loadSelectedDate(userId, today, storage) {
  try {
    const date = (storage ?? window.sessionStorage).getItem(key(userId));
    return isCalendarDate(date) && date <= today ? date : today;
  } catch { return today; }
}
export function saveSelectedDate(userId, date, storage) {
  if (!isCalendarDate(date)) return;
  try { (storage ?? window.sessionStorage).setItem(key(userId), date); }
  catch { /* Browsing still works if storage is blocked; refresh uses today. */ }
}
