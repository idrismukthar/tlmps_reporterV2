const assert = require("assert");
const studentRoutes = require("../routes/student");

const rows = [
  {
    session_id: 1,
    session_name: "2024/2025",
    class_name: "SSS1",
    term_id: 10,
    term_name: "First Term",
    term_number: 1,
    subject_id: 1,
    unit_weight: 1,
    total_score: 80,
  },
  {
    session_id: 1,
    session_name: "2024/2025",
    class_name: "SSS1",
    term_id: 10,
    term_name: "First Term",
    term_number: 1,
    subject_id: 2,
    unit_weight: 1,
    total_score: 70,
  },
  {
    session_id: 1,
    session_name: "2024/2025",
    class_name: "SSS1",
    term_id: 11,
    term_name: "Second Term",
    term_number: 2,
    subject_id: 1,
    unit_weight: 1,
    total_score: 60,
  },
  {
    session_id: 1,
    session_name: "2024/2025",
    class_name: "SSS1",
    term_id: 11,
    term_name: "Second Term",
    term_number: 2,
    subject_id: 2,
    unit_weight: 1,
    total_score: 50,
  },
  {
    session_id: 2,
    session_name: "2025/2026",
    class_name: "SSS2",
    term_id: 20,
    term_name: "First Term",
    term_number: 1,
    subject_id: 3,
    unit_weight: 2,
    total_score: 90,
  },
];

const built = studentRoutes.buildSessionPerformance(rows);
assert.ok(
  Array.isArray(built),
  "buildSessionPerformance should return an array",
);
assert.equal(built.length, 2, "It should group by session");
assert.equal(built[0].session_name, "2024/2025");
assert.equal(built[0].class_name, "SSS1");
assert.equal(built[0].terms.length, 2);
assert.equal(Number(built[0].terms[0].gpa), 4.5);
assert.equal(Number(built[0].terms[1].gpa), 2.75);
assert.equal(Number(built[0].cgpa), 3.62);
assert.equal(built[1].class_name, "SSS2");
assert.equal(Number(built[1].cgpa), 5);
console.log("studentPerformance test passed");
