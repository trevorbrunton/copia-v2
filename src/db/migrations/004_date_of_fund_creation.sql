-- Add date_of_fund_creation response category
INSERT INTO demo_responses (id, category, label, answer_text, sort_order)
VALUES (
  gen_random_uuid(),
  'date_of_fund_creation',
  'fund origin date',
  'The fund''s inception date is the sixteenth of November 2023.',
  31
);

-- Question patterns for date_of_fund_creation
INSERT INTO demo_question_patterns (response_id, pattern, is_canonical)
SELECT id, 'When was the fund created?', 1
FROM demo_responses WHERE category = 'date_of_fund_creation';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the inception date?'
FROM demo_responses WHERE category = 'date_of_fund_creation';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What was the funds inception date?'
FROM demo_responses WHERE category = 'date_of_fund_creation';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'When did the fund start?'
FROM demo_responses WHERE category = 'date_of_fund_creation';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'When was the fund launched?'
FROM demo_responses WHERE category = 'date_of_fund_creation';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How old is the fund?'
FROM demo_responses WHERE category = 'date_of_fund_creation';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the fund origin date?'
FROM demo_responses WHERE category = 'date_of_fund_creation';

-- Remove overlapping patterns from fund_details that now belong to date_of_fund_creation
DELETE FROM demo_question_patterns
WHERE pattern IN ('When did the fund start?', 'What is the inception date?')
AND response_id = (SELECT id FROM demo_responses WHERE category = 'fund_details');
