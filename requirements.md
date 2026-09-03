# Senior School GPA and CGPA Requirements

This document must be completed and agreed before coding begins.

## 1. Scope

1. Should GPA/CGPA apply only to SSS1, SSS2, and SSS3?
2. Should JSS students see no GPA or CGPA fields at all?
3. Should GPA/CGPA be calculated for every term, or only after a term is published?
4. Should students see GPA/CGPA on the report card, portal, profile, audit page, or all of them?
5. Should teachers and superadmins also see GPA/CGPA?

## 2. Grading Scale

Please confirm the senior-school grade scale. The current report card uses:

| Grade | Score Range | Grade Point | Remark |
|---|---:|---:|---|
| A1 | 75-100 | ? | Excellent |
| B2 | 71-74 | ? | Very Good |
| B3 | 65-70 | ? | Good |
| C4 | 61-64 | ? | Credit |
| C5 | 55-60 | ? | Credit |
| C6 | 50-54 | ? | Credit |
| D7 | 45-49 | ? | Pass |
| E8 | 40-44 | ? | Pass |
| F9 | 0-39 | ? | Fail |

Please provide the exact grade points for A1, B2, B3, C4, C5, C6, D7, E8, and F9.

Also confirm:

- Is the score range inclusive exactly as shown?
- Should a missing score count as 0, be excluded, or prevent GPA calculation?
- Should a failed subject contribute its grade point to GPA?
- Should GPA be rounded to 2 decimal places?
- Should CGPA be rounded to 2 decimal places?

## 3. Unit Weight / Credit Units

The database already has a `unit_weight` value for subjects.

Please confirm:

1. Is `unit_weight` the credit unit used for GPA calculations?
2. What is the credit unit for each senior subject?
3. Are all subjects worth the same number of units?
4. Should compulsory and elective subjects have different units?
5. Should a subject with no unit value be treated as 1 unit or excluded?
6. Can subject units change between sessions?
7. If units change, should old results keep the historical unit value?

## 4. GPA Formula

Please confirm which formula you want:

`GPA = Total Quality Points / Total Credit Units`

Where:

`Quality Points = Grade Point x Subject Unit Weight`

Questions:

1. Is this the correct formula?
2. Should GPA use all registered subjects for that term?
3. Should only subjects with uploaded scores be included?
4. Should unregistered subjects never be included, even if a score exists?
5. Should a student with no valid scores display `N/A` instead of `0.00`?

## 5. CGPA Formula

Please confirm how cumulative performance should work:

Option A:

`CGPA = Total Quality Points Across All Included Terms / Total Credit Units Across All Included Terms`

Option B:

`CGPA = Average of the term GPAs`

Recommended approach: Option A, because it correctly respects different subject unit weights.

Questions:

1. Which option should be used?
2. Should CGPA include only published terms?
3. Should CGPA include a term with incomplete scores?
4. Should CGPA include terms from previous academic sessions?
5. If a student changes class, should CGPA continue across the same session?
6. If a student repeats a class, should the previous attempt count?
7. Should SSS1, SSS2, and SSS3 CGPA be calculated separately or combined?

## 6. Academic Session Rules

1. What is the exact meaning of CGPA in your school: within one session or across the entire senior school journey?
2. Should 2025/2026 results be calculated independently from 2026/2027?
3. When a student is promoted from SSS1 to SSS2, should the new session continue the old CGPA?
4. If a student has no result in a term, should that term be skipped?
5. Should GPA calculations use the session in the result URL rather than the student's current class/session?

## 7. Subject Registration Rules

1. Must GPA use only subjects registered by the student for that session?
2. Should subjects registered but without scores appear in the GPA calculation?
3. Should subjects with scores but no registration be ignored?
4. Should duplicate subject registrations be prevented?
5. Should the subject's unit weight be copied into the student's session registration so later subject edits do not alter old calculations?
6. Should electives be marked separately from compulsory subjects?

## 8. Result and Score Rules

1. Should CA and exam combine exactly as the current total score does?
2. Should GPA use the final `total_score` only?
3. What should happen when a score is corrected after GPA has already been displayed?
4. Should GPA update immediately after score editing/upload?
5. Should a term be considered complete only when every registered subject has a score?
6. Should administrators be able to manually override GPA or CGPA?
7. If manual overrides are allowed, who can edit them and should the reason be recorded?

## 9. Where Results Should Display

Please select all required locations:

- [ ] Student report card
- [ ] Student portal session card
- [ ] Student profile
- [ ] Student performance audit
- [ ] Teacher dashboard
- [ ] Teacher score page
- [ ] Superadmin student profile
- [ ] Superadmin session detail
- [ ] PDF report card
- [ ] Excel export

Please provide the preferred labels, for example:

- `GPA: 3.42 / 5.00`
- `CGPA: 3.18 / 5.00`
- `Quality Points: 42.50`
- `Credit Units: 15`

## 10. Ranking and Tie Rules

1. Should students be ranked by GPA or by percentage average?
2. Should class position use GPA for senior students?
3. If two students have the same GPA, should total quality points be used next?
4. If they still tie, should total percentage marks be used next?
5. If they still tie, should grade performance be used next?
6. Should tied students share the same position?
7. Should ranking be calculated among the entire class or only students with published results?
8. Should students with incomplete results be excluded from ranking?

## 11. Senior Grade Point Scale

Please provide the grading system source or school policy if one exists.

- Maximum GPA scale: `__________`
- Minimum passing grade: `__________`
- A1 point: `__________`
- B2 point: `__________`
- B3 point: `__________`
- C4 point: `__________`
- C5 point: `__________`
- C6 point: `__________`
- D7 point: `__________`
- E8 point: `__________`
- F9 point: `__________`

## 12. Data Needed From You

Please provide:

1. The official senior-school grading table.
2. The official GPA formula, if different from the standard weighted formula.
3. The official CGPA formula.
4. Subject credit units for each senior subject.
5. Whether units are session-specific.
6. Whether all terms have equal importance.
7. Whether missing or incomplete results should be excluded or treated as zero.
8. Whether GPA/CGPA should appear on printed and downloaded report cards.
9. One worked example for a student with at least 5 subjects.
10. One worked example covering first term, second term, and cumulative CGPA.
11. The expected GPA/CGPA result for both examples, so the implementation can be checked against school policy.

## 13. Worked Example Template

### One-Term GPA Example

| Subject | Score | Grade | Grade Point | Units | Quality Points |
|---|---:|---|---:|---:|---:|
| Subject 1 |  |  |  |  |  |
| Subject 2 |  |  |  |  |  |
| Subject 3 |  |  |  |  |  |
| Subject 4 |  |  |  |  |  |
| Subject 5 |  |  |  |  |  |

- Total Units: `__________`
- Total Quality Points: `__________`
- Expected GPA: `__________`

### Multi-Term CGPA Example

| Term | GPA | Units | Quality Points |
|---|---:|---:|---:|
| First Term |  |  |  |
| Second Term |  |  |  |
| Third Term |  |  |  |

- Expected CGPA: `__________`

## 14. Acceptance Criteria

Before coding is approved, the finished feature must satisfy these checks:

1. JSS students do not receive GPA/CGPA calculations.
2. Senior GPA uses only subjects registered in the selected session.
3. Senior GPA uses the approved grade-point scale.
4. Unit weights are applied correctly.
5. First-term GPA is correct.
6. Second-term GPA is correct and does not reuse first-term values incorrectly.
7. CGPA uses the approved cumulative formula.
8. Missing terms do not silently reduce CGPA unless school policy says they should.
9. Class position follows the approved GPA/percentage ranking rule.
10. Report-card and PDF values match the database calculation.
11. Results are correct for students with different subject combinations.
12. Results remain correct after score edits and bulk uploads.
