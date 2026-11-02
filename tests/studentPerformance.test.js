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
assert.equal(Number(built[0].cgpa), 3.63);
assert.equal(built[1].class_name, "SSS2");
assert.equal(Number(built[1].cgpa), 5);

const historicalClasses = ["JSS1", "JSS2", "JSS3", "SSS1", "SSS2", "SSS3"];
const historicalClassRows = historicalClasses.flatMap((className, index) => [
  {
    session_id: index + 10,
    session_name: `201${index}/201${index + 1}`,
    class_name: "SSS3",
    term_id: index + 100,
    term_name: "First Term",
    term_number: 1,
    subject_id: 1,
    unit_weight: 1,
    score_id: null,
    total_score: null,
  },
  {
    session_id: index + 10,
    session_name: `201${index}/201${index + 1}`,
    class_name: "SSS3",
    score_class_name: className,
    term_id: index + 100,
    term_name: "First Term",
    term_number: 1,
    subject_id: 1,
    unit_weight: 1,
    score_id: index + 1,
    total_score: 76,
  },
]);
const historicalSummaries =
  studentRoutes.buildSessionPerformance(historicalClassRows);
assert.deepEqual(
  historicalSummaries.map((session) => session.class_name),
  historicalClasses,
  "Recorded results should retain the correct class for JSS and SSS students",
);
console.log("studentPerformance test passed");

const incompleteTerm = studentRoutes.buildSessionPerformance([
  { session_id: 3, session_name: "2026/2027", class_name: "SSS1", term_id: 30, term_name: "First Term", term_number: 1, subject_id: 1, unit_weight: 1, score_id: 1, total_score: 76 },
  { session_id: 3, session_name: "2026/2027", class_name: "SSS1", term_id: 30, term_name: "First Term", term_number: 1, subject_id: 2, unit_weight: 1, score_id: null, total_score: null },
]);
assert.equal(incompleteTerm[0].terms[0].gpa, null, "An incomplete term must not receive a GPA");
assert.equal(incompleteTerm[0].cgpa, null, "An incomplete term must not receive a CGPA");
