-- 002_demo_responses: Pre-produced Q&A for avatar demo

-- Pre-produced answers keyed by category
CREATE TABLE demo_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  audio_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Question variants that map to a response
CREATE TABLE demo_question_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES demo_responses(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  is_canonical INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_demo_patterns_response ON demo_question_patterns(response_id);

-- ─── Seed: Responses ──────────────────────────────────────────

INSERT INTO demo_responses (category, label, answer_text, sort_order) VALUES

('fund_manager', 'Who manages the fund?',
'The OC Mid-Cap Fund is managed by myself, Robert Frost, as Head of Investments at OC Funds Management, alongside Nga Lucas who serves as Portfolio Manager for the Mid-Cap strategy. Between us we oversee the full investment process, from idea generation through to portfolio construction.',
1),

('investment_strategy', 'What is the investment strategy?',
'Our strategy is a long-only, benchmark-unaware approach focused on Australian mid-cap equities. We typically hold between twenty and fifty stocks, selected through a rigorous bottom-up process. We are looking for quality businesses with strong management teams, sustainable competitive advantages, and attractive valuations. Being benchmark-unaware means we are not constrained by index composition — we invest based on conviction, not index weight.',
2),

('since_inception_return', 'Rate of return since inception?',
'Since inception in November 2023 through to the end of February 2026, the OC Mid-Cap Fund has returned positive nine point four percent. The fund is still relatively young with just over two years of track record, and we believe the portfolio is well positioned for the medium to long term.',
3),

('recent_performance', 'Year-to-date and recent performance?',
'Looking at our recent performance to the end of February 2026 — over the past month the fund returned negative two point five percent, over three months negative four point four percent, and over the past year we have returned positive one point eight percent. It has been a challenging period for mid-cap equities broadly, and our benchmark-unaware positioning has meant some short-term divergence from the broader market.',
4),

('benchmark_comparison', 'How does performance compare to the benchmark?',
'Our benchmark is the S and P ASX MidCap 50 Index. Since inception, the fund has returned nine point four percent compared to the benchmark''s sixteen point three percent, which is an underperformance of six point nine percent. I want to be upfront about that. Over the past year specifically, the fund returned one point eight percent versus the benchmark''s eighteen point six percent. However, it is important to put this in context. The fund has only been operating for just over two years, which is a very short period to judge a long-only equity strategy. Our benchmark-unaware approach means we will have periods of divergence from the index — both positive and negative. We are focused on long-term capital appreciation through high-conviction stock selection, and we are confident in the quality of the businesses we hold.',
5),

('fallback', 'Out-of-scope question',
'That''s a great question. For more detail on that topic, I''d suggest speaking directly with our investor relations team who can provide you with the most current and comprehensive information.',
99);


-- ─── Seed: Question Patterns ──────────────────────────────────

-- fund_manager patterns
INSERT INTO demo_question_patterns (response_id, pattern, is_canonical)
SELECT id, 'Who is the manager of the fund?', 1
FROM demo_responses WHERE category = 'fund_manager';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Who manages the fund?'
FROM demo_responses WHERE category = 'fund_manager';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Who runs the fund?'
FROM demo_responses WHERE category = 'fund_manager';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Who is the portfolio manager?'
FROM demo_responses WHERE category = 'fund_manager';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Tell me about the fund management team'
FROM demo_responses WHERE category = 'fund_manager';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Who is Robert Frost?'
FROM demo_responses WHERE category = 'fund_manager';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Who is in charge of the fund?'
FROM demo_responses WHERE category = 'fund_manager';

-- investment_strategy patterns
INSERT INTO demo_question_patterns (response_id, pattern, is_canonical)
SELECT id, 'What is the investment strategy of the fund?', 1
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is your investment strategy?'
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How do you invest?'
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is your investment approach?'
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What kind of stocks do you invest in?'
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How does the fund select stocks?'
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the fund''s philosophy?'
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Tell me about the investment process'
FROM demo_responses WHERE category = 'investment_strategy';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Is it an active or passive fund?'
FROM demo_responses WHERE category = 'investment_strategy';

-- since_inception_return patterns
INSERT INTO demo_question_patterns (response_id, pattern, is_canonical)
SELECT id, 'What is the rate of return since inception?', 1
FROM demo_responses WHERE category = 'since_inception_return';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the return since inception?'
FROM demo_responses WHERE category = 'since_inception_return';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How has the fund performed since it started?'
FROM demo_responses WHERE category = 'since_inception_return';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the total return?'
FROM demo_responses WHERE category = 'since_inception_return';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How much has the fund returned?'
FROM demo_responses WHERE category = 'since_inception_return';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the overall performance?'
FROM demo_responses WHERE category = 'since_inception_return';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What are the lifetime returns?'
FROM demo_responses WHERE category = 'since_inception_return';

-- recent_performance patterns
INSERT INTO demo_question_patterns (response_id, pattern, is_canonical)
SELECT id, 'What is the year-to-date performance?', 1
FROM demo_responses WHERE category = 'recent_performance';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How has the fund performed recently?'
FROM demo_responses WHERE category = 'recent_performance';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What are the recent returns?'
FROM demo_responses WHERE category = 'recent_performance';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How did the fund do last month?'
FROM demo_responses WHERE category = 'recent_performance';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the one-year return?'
FROM demo_responses WHERE category = 'recent_performance';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the three-month return?'
FROM demo_responses WHERE category = 'recent_performance';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How is the fund tracking this year?'
FROM demo_responses WHERE category = 'recent_performance';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the short-term performance?'
FROM demo_responses WHERE category = 'recent_performance';

-- benchmark_comparison patterns
INSERT INTO demo_question_patterns (response_id, pattern, is_canonical)
SELECT id, 'How does your performance compare to the benchmark index?', 1
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How do you compare to the benchmark?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How does the fund compare to the index?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Are you outperforming or underperforming?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the benchmark?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How does the fund stack up against the ASX?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Are you beating the market?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is your alpha?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'How does the fund perform relative to its peers?'
FROM demo_responses WHERE category = 'benchmark_comparison';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the outperformance or underperformance?'
FROM demo_responses WHERE category = 'benchmark_comparison';

-- fallback patterns (common off-topic questions)
INSERT INTO demo_question_patterns (response_id, pattern, is_canonical)
SELECT id, 'What will the fund return next year?', 1
FROM demo_responses WHERE category = 'fallback';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the current share price?'
FROM demo_responses WHERE category = 'fallback';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'Is this fund better than Vanguard?'
FROM demo_responses WHERE category = 'fallback';

INSERT INTO demo_question_patterns (response_id, pattern)
SELECT id, 'What is the five-year return?'
FROM demo_responses WHERE category = 'fallback';
