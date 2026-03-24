/**
 * Simple keyword-based question classifier.
 * Maps user questions to pre-generated response categories.
 * Returns null if no confident match — falls back to live agent.
 */

import type { ResponseCategory } from "@/src/services/demo/types";

interface Pattern {
  category: ResponseCategory;
  keywords: string[];
  weight: number;
}

const patterns: Pattern[] = [
  // fund_manager
  {
    category: "fund_manager",
    keywords: ["manager", "manages", "who runs", "portfolio manager", "robert frost", "who is", "management team", "in charge"],
    weight: 1,
  },
  // investment_strategy
  {
    category: "investment_strategy",
    keywords: ["strategy", "investment approach", "how do you invest", "invest in", "select stocks", "philosophy", "active", "passive", "bottom-up", "benchmark unaware", "long-only"],
    weight: 1,
  },
  // since_inception_return
  {
    category: "since_inception_return",
    keywords: ["since inception", "total return", "lifetime", "overall performance", "how much has", "inception return"],
    weight: 1.5,
  },
  // recent_performance
  {
    category: "recent_performance",
    keywords: ["year-to-date", "ytd", "recent", "last month", "three month", "one year", "short-term", "this year", "recent returns", "how did"],
    weight: 1,
  },
  // benchmark_comparison
  {
    category: "benchmark_comparison",
    keywords: ["benchmark", "compare", "index", "outperform", "underperform", "beating the market", "alpha", "relative", "peers", "asx midcap", "stack up"],
    weight: 1,
  },
];

// Pre-generated audio files and answer texts
export const PREGENERATED: Record<string, { audioUrl: string; text: string }> = {
  fund_manager: {
    audioUrl: "/audio/fund_manager.mp3",
    text: "The OC Mid-Cap Fund is managed by myself, Robert Frost, as Head of Investments at OC Funds Management, alongside Nga Lucas who serves as Portfolio Manager for the Mid-Cap strategy. Between us we oversee the full investment process, from idea generation through to portfolio construction.",
  },
  investment_strategy: {
    audioUrl: "/audio/investment_strategy.mp3",
    text: "Our strategy is a long-only, benchmark-unaware approach focused on Australian mid-cap equities. We typically hold between twenty and fifty stocks, selected through a rigorous bottom-up process. We are looking for quality businesses with strong management teams, sustainable competitive advantages, and attractive valuations. Being benchmark-unaware means we are not constrained by index composition — we invest based on conviction, not index weight.",
  },
  since_inception_return: {
    audioUrl: "/audio/since_inception_return.mp3",
    text: "Since inception in November 2023 through to the end of February 2026, the OC Mid-Cap Fund has returned positive nine point four percent. The fund is still relatively young with just over two years of track record, and we believe the portfolio is well positioned for the medium to long term.",
  },
  recent_performance: {
    audioUrl: "/audio/recent_performance.mp3",
    text: "Looking at our recent performance to the end of February 2026 — over the past month the fund returned negative two point five percent, over three months negative four point four percent, and over the past year we have returned positive one point eight percent. It has been a challenging period for mid-cap equities broadly, and our benchmark-unaware positioning has meant some short-term divergence from the broader market.",
  },
  benchmark_comparison: {
    audioUrl: "/audio/benchmark_comparison.mp3",
    text: "Our benchmark is the S and P ASX MidCap 50 Index. Since inception, the fund has returned nine point four percent compared to the benchmark's sixteen point three percent, which is an underperformance of six point nine percent. I want to be upfront about that. Over the past year specifically, the fund returned one point eight percent versus the benchmark's eighteen point six percent. However, it is important to put this in context. The fund has only been operating for just over two years, which is a very short period to judge a long-only equity strategy. Our benchmark-unaware approach means we will have periods of divergence from the index — both positive and negative. We are focused on long-term capital appreciation through high-conviction stock selection, and we are confident in the quality of the businesses we hold.",
  },
  fallback: {
    audioUrl: "/audio/fallback.mp3",
    text: "That's a great question. For more detail on that topic, I'd suggest speaking directly with our investor relations team who can provide you with the most current and comprehensive information.",
  },
  greeting: {
    audioUrl: "/audio/greeting.mp3",
    text: "Hello, I'm Robert Frost, Head of Investments at OC Funds Management. How can I help you today?",
  },
};

/**
 * Classify a question into a response category.
 * Returns the category if confident, null if the question should go to the live agent.
 */
export function classifyQuestion(question: string): ResponseCategory | null {
  const lower = question.toLowerCase();

  // Score each category
  const scores: { category: ResponseCategory; score: number }[] = [];

  for (const pattern of patterns) {
    let score = 0;
    for (const keyword of pattern.keywords) {
      if (lower.includes(keyword)) {
        score += pattern.weight;
      }
    }
    if (score > 0) {
      scores.push({ category: pattern.category, score });
    }
  }

  if (scores.length === 0) return null;

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Only return if top score is confident enough (at least 1 keyword match)
  // and there's clear separation from second place
  const top = scores[0];
  if (top.score >= 1) {
    return top.category;
  }

  return null;
}
