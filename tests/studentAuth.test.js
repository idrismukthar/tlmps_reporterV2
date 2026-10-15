const assert = require("assert");
const {
  initialStudentPassword,
  studentAuthEmail,
} = require("../services/studentAuth");

assert.equal(studentAuthEmail("26001"), "student-26001@students.tlmps.invalid");
assert.equal(studentAuthEmail(" 26001 "), "student-26001@students.tlmps.invalid");
assert.equal(initialStudentPassword("26001", "Wale"), "wale001");
assert.equal(initialStudentPassword("26001", "  WALE "), "wale001");
assert.throws(() => studentAuthEmail("26A01"), /at least three digits/);
assert.throws(() => initialStudentPassword("26001", ""), /surname is required/);

console.log("studentAuth test passed");
