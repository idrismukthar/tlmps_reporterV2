const NEXT_CLASS = {
  JSS1: "JSS2",
  JSS2: "JSS3",
  JSS3: "SSS1",
  SSS1: "SSS2",
  SSS2: "SSS3",
};

const calculatePromotionOutcome = (rows) => {
  const terms = new Map([[1, []], [2, []], [3, []]]);
  (rows || []).forEach((row) => {
    const number = Number(row.term_number);
    if (terms.has(number)) terms.get(number).push(row);
  });

  const averages = [];
  for (const termNumber of [1, 2, 3]) {
    const subjects = terms.get(termNumber);
    if (!subjects.length || subjects.some((row) => row.score_id == null)) {
      return { complete: false, cumulativeAverage: null, termAverages: averages };
    }
    averages.push(
      subjects.reduce((total, row) => total + Number(row.total_score || 0), 0) /
        subjects.length,
    );
  }

  const cumulativeAverage = averages.reduce((sum, average) => sum + average, 0) / 3;
  return {
    complete: true,
    cumulativeAverage,
    termAverages: averages,
    outcome: cumulativeAverage >= 51 ? "Promoted" : "Repeated",
  };
};

module.exports = { NEXT_CLASS, calculatePromotionOutcome };
