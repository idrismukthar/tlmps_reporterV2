const assert = require("assert");
const { getNextAttendanceWeekday } = require("../services/attendanceDates");

assert.equal(
  getNextAttendanceWeekday(new Date("2026-10-12T12:00:00.000Z")),
  "2026-10-12",
  "Weekdays should default to the current Lagos date.",
);
assert.equal(
  getNextAttendanceWeekday(new Date("2026-10-10T12:00:00.000Z")),
  "2026-10-12",
  "Saturday should default to the coming Monday.",
);
assert.equal(
  getNextAttendanceWeekday(new Date("2026-10-11T12:00:00.000Z")),
  "2026-10-12",
  "Sunday should default to the coming Monday.",
);

console.log("attendance date defaults test passed");
