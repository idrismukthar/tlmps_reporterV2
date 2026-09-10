const assert = require("assert");
const { calculatePromotionOutcome } = require("../services/promotion");

const termRows = (term_number, scores) =>
  scores.map((total_score, index) => ({
    term_number,
    subject_id: index + 1,
    score_id: index + 1,
    total_score,
  }));

const promoted = calculatePromotionOutcome([
  ...termRows(1, [50, 52]),
  ...termRows(2, [51, 53]),
  ...termRows(3, [52, 54]),
]);
assert.equal(promoted.complete, true);
assert.equal(promoted.outcome, "Promoted");
assert.equal(promoted.cumulativeAverage, 52);

const repeated = calculatePromotionOutcome([
  ...termRows(1, [50]),
  ...termRows(2, [50]),
  ...termRows(3, [50]),
]);
assert.equal(repeated.outcome, "Repeated");

const pending = calculatePromotionOutcome([
  ...termRows(1, [60]),
  ...termRows(2, [60]),
  { term_number: 3, subject_id: 1, score_id: null, total_score: 0 },
]);
assert.equal(pending.complete, false);
console.log("promotion test passed");
