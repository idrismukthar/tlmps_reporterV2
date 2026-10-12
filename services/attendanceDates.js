const getNextAttendanceWeekday = (now = new Date()) => {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const day = date.getUTCDay();
  if (day === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (day === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

module.exports = { getNextAttendanceWeekday };
