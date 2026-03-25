/**
 * Keyword-based question classifier.
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
  {
    category: "fund_manager",
    keywords: ["manager", "manages", "who runs", "portfolio manager", "robert frost", "who is", "management team", "in charge", "nga lucas", "who manages"],
    weight: 1,
  },
  {
    category: "investment_strategy",
    keywords: ["strategy", "investment approach", "how do you invest", "invest in", "select stocks", "philosophy", "bottom-up", "benchmark unaware", "long-only", "stock selection", "how do you pick"],
    weight: 1,
  },
  {
    category: "since_inception_return",
    keywords: ["since inception", "total return", "lifetime", "overall performance", "inception return", "how much has it returned", "cumulative"],
    weight: 1.5,
  },
  {
    category: "recent_performance",
    keywords: ["year-to-date", "ytd", "recent performance", "last month", "three month", "one year", "short-term", "this year", "recent returns", "how did you do", "monthly return"],
    weight: 1,
  },
  {
    category: "benchmark_comparison",
    keywords: ["benchmark", "compare", "index", "outperform", "underperform", "beating the market", "alpha", "relative", "asx midcap", "stack up", "versus the index", "compared to"],
    weight: 1,
  },
  {
    category: "fund_overview",
    keywords: ["tell me about the fund", "fund overview", "what is the fund", "describe the fund", "summary of the fund", "about the fund"],
    weight: 1,
  },
  {
    category: "fund_details",
    keywords: ["apir", "arsn", "inception date", "responsible entity", "fund details", "fund code", "registration", "objective"],
    weight: 1.5,
  },
  {
    category: "fees",
    keywords: ["fees", "management fee", "performance fee", "cost", "charges", "expense", "how much does it cost", "buy-sell spread", "entry fee", "exit fee"],
    weight: 1,
  },
  {
    category: "minimum_investment",
    keywords: ["minimum investment", "minimum amount", "how much to invest", "minimum balance", "minimum withdrawal", "how much do i need"],
    weight: 1.5,
  },
  {
    category: "how_to_invest",
    keywords: ["how to invest", "how do i invest", "application form", "apply", "sign up", "get started", "invest in the fund", "bpay", "direct debit"],
    weight: 1,
  },
  {
    category: "distributions",
    keywords: ["distribution", "dividend", "income", "payout", "reinvest", "franking", "annual distribution"],
    weight: 1,
  },
  {
    category: "investment_universe",
    keywords: ["investment universe", "what stocks", "which companies", "market cap", "top 100", "midcap 50", "universe", "what do you invest in"],
    weight: 1,
  },
  {
    category: "portfolio_holdings",
    keywords: ["holdings", "portfolio", "positions", "car group", "rea group", "fisher and paykel", "what do you hold", "top holdings", "current positions"],
    weight: 1,
  },
  {
    category: "why_mid_caps",
    keywords: ["why mid cap", "mid-cap", "midcap", "why mid", "sweet spot", "mid cap advantage", "why not large cap", "why not small cap"],
    weight: 1,
  },
  {
    category: "risk_management",
    keywords: ["risk", "risk management", "downside", "hedging", "cash weighting", "risk committee", "how do you manage risk", "protect"],
    weight: 1,
  },
  {
    category: "about_oc",
    keywords: ["about oc", "oc funds", "who is oc", "tell me about oc", "oc funds management", "history of oc", "when was oc founded", "boutique"],
    weight: 1,
  },
  {
    category: "team_overview",
    keywords: ["team", "investment team", "who works", "how many people", "analysts", "robert calnon", "stephen evans", "aaron yeoh", "daniel stein"],
    weight: 1,
  },
  {
    category: "nga_lucas",
    keywords: ["nga lucas", "nga", "portfolio manager background", "who is nga", "nga's experience"],
    weight: 2,
  },
  {
    category: "ratings",
    keywords: ["rating", "lonsec", "zenith", "recommended", "highly recommended", "award", "money management", "fund manager of the year"],
    weight: 1,
  },
  {
    category: "esg",
    keywords: ["esg", "environmental", "social", "governance", "responsible investment", "sustainable", "pri", "ethics", "ethical"],
    weight: 1,
  },
  {
    category: "other_funds",
    keywords: ["other funds", "small companies", "micro-cap", "dynamic equity", "what else", "other strategies", "premium small"],
    weight: 1,
  },
  {
    category: "copia",
    keywords: ["copia", "copia partners", "copia investment", "responsible entity", "distribution partner", "who is copia"],
    weight: 1,
  },
  {
    category: "mlc_mandate",
    keywords: ["mlc", "mandate", "institutional", "500 million", "five hundred million", "mlc asset"],
    weight: 1.5,
  },
  {
    category: "withdrawal",
    keywords: ["withdraw", "withdrawal", "redeem", "redemption", "sell units", "get my money out", "exit", "cash out"],
    weight: 1,
  },
  {
    category: "cooling_off",
    keywords: ["cooling off", "cooling-off", "cancel", "change my mind", "14 day", "fourteen day"],
    weight: 1.5,
  },
  {
    category: "tax",
    keywords: ["tax", "amit", "capital gains", "taxable income", "franking credits", "tax return", "tax implications"],
    weight: 1,
  },
  {
    category: "contact",
    keywords: ["contact", "phone number", "email", "address", "call", "complaints", "reach you", "get in touch", "1800"],
    weight: 1,
  },
  {
    category: "active_vs_passive",
    keywords: ["active vs passive", "active management", "passive", "index fund", "etf", "why active", "why not passive", "active manager"],
    weight: 1,
  },
];

// Pre-generated audio files and answer texts for all categories
export const PREGENERATED: Record<string, { audioUrl: string; pcmUrl: string; text: string }> = {
  greeting: {
    audioUrl: "/audio/greeting.mp3",
    pcmUrl: "/audio/greeting.pcm",
    text: "Hello, I'm Robert Frost, Head of Investments at OC Funds Management. Welcome — I'm happy to answer any questions you have about the OC Mid-Cap Fund or our investment approach.",
  },
  fund_manager: {
    audioUrl: "/audio/fund_manager.mp3",
    pcmUrl: "/audio/fund_manager.pcm",
    text: "The OC Mid-Cap Fund is managed by myself, Robert Frost, as Head of Investments at OC Funds Management, alongside Nga Lucas who serves as Portfolio Manager for the Mid-Cap strategy. Between us we oversee the full investment process, from idea generation through to portfolio construction.",
  },
  investment_strategy: {
    audioUrl: "/audio/investment_strategy.mp3",
    pcmUrl: "/audio/investment_strategy.pcm",
    text: "Our strategy is a long-only, benchmark-unaware approach focused on Australian mid-cap equities. We typically hold between twenty and fifty stocks, selected through a rigorous bottom-up process. We are looking for quality businesses with strong management teams, sustainable competitive advantages, and attractive valuations. Being benchmark-unaware means we are not constrained by index composition — we invest based on conviction, not index weight.",
  },
  since_inception_return: {
    audioUrl: "/audio/since_inception_return.mp3",
    pcmUrl: "/audio/since_inception_return.pcm",
    text: "Since inception in November 2023 through to the end of February 2026, the OC Mid-Cap Fund has returned positive nine point four percent. The fund is still relatively young with just over two years of track record, and we believe the portfolio is well positioned for the medium to long term.",
  },
  recent_performance: {
    audioUrl: "/audio/recent_performance.mp3",
    pcmUrl: "/audio/recent_performance.pcm",
    text: "Looking at our recent performance to the end of February 2026 — over the past month the fund returned negative two point five percent, over three months negative four point four percent, and over the past year we have returned positive one point eight percent. It has been a challenging period for mid-cap equities broadly, and our benchmark-unaware positioning has meant some short-term divergence from the broader market.",
  },
  benchmark_comparison: {
    audioUrl: "/audio/benchmark_comparison.mp3",
    pcmUrl: "/audio/benchmark_comparison.pcm",
    text: "Our benchmark is the S and P ASX MidCap 50 Index. Since inception, the fund has returned nine point four percent compared to the benchmark's sixteen point three percent, which is an underperformance of six point nine percent. I want to be upfront about that. Over the past year specifically, the fund returned one point eight percent versus the benchmark's eighteen point six percent. However, it is important to put this in context. The fund has only been operating for just over two years, which is a very short period to judge a long-only equity strategy. Our benchmark-unaware approach means we will have periods of divergence from the index — both positive and negative. We are focused on long-term capital appreciation through high-conviction stock selection, and we are confident in the quality of the businesses we hold.",
  },
  fund_overview: {
    audioUrl: "/audio/fund_overview.mp3",
    pcmUrl: "/audio/fund_overview.pcm",
    text: "The OC Mid-Cap Fund is a long-only, benchmark-unaware Australian equity strategy focused on high-quality, well-managed mid-cap stocks. We invest in twenty-five to fifty companies listed on the ASX, targeting the segment of the market that has produced superior investment returns over the past two decades. The fund launched in December 2024 as a registered managed investment scheme, though the strategy has been managed as a wholesale trust since November 2023.",
  },
  fund_details: {
    audioUrl: "/audio/fund_details.mp3",
    pcmUrl: "/audio/fund_details.pcm",
    text: "The key details are as follows. The APIR code is OPS0472AU, and the ARSN is 679 449 293. The fund's inception date is the sixteenth of November 2023. The responsible entity is Copia Investment Partners Limited. The benchmark is the S and P ASX MidCap 50 Accumulation Index, and our objective is to outperform that benchmark by two percent per annum over rolling five-year periods, after fees and taxes.",
  },
  fees: {
    audioUrl: "/audio/fees.mp3",
    pcmUrl: "/audio/fees.pcm",
    text: "Our management fee is zero point eight five percent per annum of the net asset value, inclusive of GST net of reduced input tax credits. The performance fee is fifteen point three seven five percent of any outperformance above the benchmark, subject to a high-water mark — so we only earn a performance fee when the fund's return is positive and above the previous high. There is also a buy-sell spread of plus or minus zero point two five percent when you invest or withdraw. There are no entry fees, exit fees, or contribution fees.",
  },
  minimum_investment: {
    audioUrl: "/audio/minimum_investment.mp3",
    pcmUrl: "/audio/minimum_investment.pcm",
    text: "The minimum initial investment is twenty thousand dollars. Additional investments can be made at any time with a minimum of five thousand dollars. The minimum withdrawal amount is also five thousand dollars, and your account balance must remain at or above twenty thousand dollars.",
  },
  how_to_invest: {
    audioUrl: "/audio/how_to_invest.mp3",
    pcmUrl: "/audio/how_to_invest.pcm",
    text: "You can invest directly by completing the online application form available on our website at ocfunds.com.au. You will need to read the Product Disclosure Statement and Target Market Determination first. Paper application forms are also available on request. Alternatively, you can access the fund through various investment platforms. Payment can be made by direct debit, EFT, or BPay. If you need any help, you can call Copia on 1800 442 129.",
  },
  distributions: {
    audioUrl: "/audio/distributions.mp3",
    pcmUrl: "/audio/distributions.pcm",
    text: "The fund distributes net income and realised capital gains annually, usually within two months following the end of the financial year. You can choose to have distributions paid directly to your bank account or reinvested as additional units. If you don't nominate a preference, distributions will be automatically reinvested. Any franking credits or foreign tax credits will be distributed with the June payments.",
  },
  investment_universe: {
    audioUrl: "/audio/investment_universe.mp3",
    pcmUrl: "/audio/investment_universe.pcm",
    text: "Our primary investment universe is companies in the S and P ASX MidCap 50 Index — essentially Australia's fifty-first to one-hundredth largest companies by market capitalisation. Up to twenty percent of the portfolio may also be invested in companies from the S and P ASX 50 Index, and likewise up to twenty percent in high-conviction companies outside the top one hundred. Many of these stocks have been part of our small-cap and micro-cap portfolios before they grew into larger companies, so they are well known to us.",
  },
  portfolio_holdings: {
    audioUrl: "/audio/portfolio_holdings.mp3",
    pcmUrl: "/audio/portfolio_holdings.pcm",
    text: "I can share that the fund has historically held positions in quality companies such as CAR Group, REA Group, and Fisher and Paykel Healthcare. These are businesses that were long-term holdings in our small-cap strategies before they graduated to the mid-cap universe. We have previously owned forty-two of the fifty stocks currently in the ASX Mid-Cap Index through our other funds, so we have deep knowledge of these businesses.",
  },
  why_mid_caps: {
    audioUrl: "/audio/why_mid_caps.mp3",
    pcmUrl: "/audio/why_mid_caps.pcm",
    text: "Mid-cap companies represent a sweet spot in the market. They have typically moved past the early-stage risks of smaller companies — they tend to be more established and financially stable — yet they still offer significant growth potential with greater flexibility than mature large-cap companies. Historically, the S and P ASX MidCap 50 Index has outperformed both the large-cap ASX 50 and the Small Ordinaries over three, five, seven, and ten-year periods. Despite this track record, mid-caps typically only represent around fifteen percent of an investor's broad-based portfolio, which means many investors are underweight this attractive segment.",
  },
  risk_management: {
    audioUrl: "/audio/risk_management.mp3",
    pcmUrl: "/audio/risk_management.pcm",
    text: "Risk management is central to our process. We employ a top-down macro risk overlay through our proven OC Risk Management Committee, which is applied across all OC funds. We screen out complex or speculative businesses from our investment process. The portfolio is concentrated at twenty-five to fifty stocks, which means each holding is high conviction, but we maintain flexible cash weightings of up to twenty percent to manage downside risk. We also limit our funds under management to a maximum of one percent of the S and P ASX MidCap 50 Index to ensure we maintain transactional flexibility.",
  },
  about_oc: {
    audioUrl: "/audio/about_oc.mp3",
    pcmUrl: "/audio/about_oc.pcm",
    text: "OC Funds Management was established in the year 2000 and is a boutique investment manager specialising in Australian mid, small, and micro-cap equities. We are led by a long-standing team of six specialist investors who together combine over one hundred years of investment management experience. Copia Investment Partners is our exclusive distribution partner and also serves as the responsible entity for our funds. We are proud to be a signatory to the United Nations-supported Principles for Responsible Investment.",
  },
  team_overview: {
    audioUrl: "/audio/team_overview.mp3",
    pcmUrl: "/audio/team_overview.pcm",
    text: "Our team of six includes myself, Robert Frost, as Head of Investments. Nga Lucas is the Portfolio Manager for the Mid-Cap Fund, bringing over two decades of experience including a decade at AFIC. Robert Calnon and Stephen Evans are Portfolio Managers who have been with OC since 2007 and 2004 respectively. Aaron Yeoh is a Senior Investment Analyst who joined from Cooper Investors in 2022, and Daniel Stein is a Senior Investment Analyst who covers financial modelling and Australian small and micro-cap research.",
  },
  nga_lucas: {
    audioUrl: "/audio/nga_lucas.mp3",
    pcmUrl: "/audio/nga_lucas.pcm",
    text: "Nga Lucas joined OC Funds Management in 2024 as Portfolio Manager for the Mid-Cap Fund. She has responsibility for the construction, stock selection, and performance of the mid-cap portfolio. Prior to joining OC, Nga worked at the Australian Foundation Investment Company, known as AFIC, for over a decade as a Senior Investment Analyst specialising in technology, telecommunications, industrial, and small companies. Before AFIC, she spent ten years on the sell side as a Research Analyst at Goldman Sachs and HSBC.",
  },
  ratings: {
    audioUrl: "/audio/ratings.mp3",
    pcmUrl: "/audio/ratings.pcm",
    text: "The OC Mid-Cap Fund has received a Highly Recommended rating from Lonsec and a Recommended rating from Zenith. These are independent research ratings that assess the fund's investment process, team, and overall quality. Our Premium Small Companies Fund also won the 2024 Money Management Fund Manager of the Year Award in the Australian Small Cap Equity category, which speaks to the broader capability of the OC team.",
  },
  esg: {
    audioUrl: "/audio/esg.mp3",
    pcmUrl: "/audio/esg.pcm",
    text: "OC Funds Management is a signatory to the United Nations-supported Principles for Responsible Investment. While the responsible entity does not take ESG considerations into account in making investment decisions, the investment manager — that is, our team — may at our discretion take environmental, social, and governance factors into account where we believe they are relevant to the financial performance of an investment. We do not have a predetermined view on ESG, but we integrate these considerations as part of our broader fundamental analysis.",
  },
  other_funds: {
    audioUrl: "/audio/other_funds.mp3",
    pcmUrl: "/audio/other_funds.pcm",
    text: "In addition to the Mid-Cap Fund, OC manages three other strategies. The OC Premium Small Companies Fund invests in small to mid-cap Australian listed companies outside the S and P ASX 100, with around seven hundred and sixty-eight million dollars in assets. The OC Micro-Cap Fund focuses on companies with a market capitalisation below five hundred million dollars at purchase. And the OC Dynamic Equity Fund provides a more flexible approach. All of our funds have been ranked in the top quartile of their peer group over five years.",
  },
  copia: {
    audioUrl: "/audio/copia.mp3",
    pcmUrl: "/audio/copia.pcm",
    text: "Copia Investment Partners is our responsible entity and exclusive distribution partner. Copia was originally formed in 2000 as part of Opis Capital, and rebranded to Copia Investment Partners in 2014. They are independently owned with offices in Melbourne, Sydney, and Brisbane. Copia undertakes distribution, marketing, compliance, and operations support, which allows our investment team to focus entirely on managing money for clients. Their contact details are 1800 442 129 or clientservices at copiapartners.com.au.",
  },
  mlc_mandate: {
    audioUrl: "/audio/mlc_mandate.mp3",
    pcmUrl: "/audio/mlc_mandate.pcm",
    text: "MLC Asset Management appointed OC Funds Management to manage over five hundred million dollars in the OC Mid-Cap strategy. This was a significant endorsement of our investment capabilities and the mid-cap opportunity. It reflects the strong demand we have seen from institutional investors for a quality, active mid-cap strategy managed by a team with deep experience in this segment of the market.",
  },
  withdrawal: {
    audioUrl: "/audio/withdrawal.mp3",
    pcmUrl: "/audio/withdrawal.pcm",
    text: "You can withdraw all or part of your investment at any time by completing a withdrawal request form, available on our website or by calling Copia on 1800 442 129. The minimum withdrawal is five thousand dollars. If your request is received by 2pm AEST on a business day, it will generally be processed at that day's exit price. Withdrawal proceeds are usually paid to your nominated bank account within ten business days.",
  },
  cooling_off: {
    audioUrl: "/audio/cooling_off.mp3",
    pcmUrl: "/audio/cooling_off.pcm",
    text: "Yes, retail investors have a fourteen-day cooling-off period after making an application. This begins from the earlier of receiving your investment confirmation or the end of the fifth business day after units are issued. If you cancel during this period, the amount repaid will be adjusted for market movements, administration costs, and any applicable taxes. Investments made through distribution reinvestment are not subject to cooling off.",
  },
  tax: {
    audioUrl: "/audio/tax.mp3",
    pcmUrl: "/audio/tax.pcm",
    text: "The fund has elected to be an Attribution Managed Investment Trust, or AMIT. This means the fund itself does not pay tax — instead, all taxable income, including net capital gains, is attributed to investors each year on an AMIT Member Annual statement. You include your share of the fund's net taxable income in your own tax return. I would strongly recommend speaking with your tax adviser about your specific circumstances, as tax laws are complex.",
  },
  contact: {
    audioUrl: "/audio/contact.mp3",
    pcmUrl: "/audio/contact.pcm",
    text: "You can reach Copia Investment Partners, our responsible entity, on their free call number 1800 442 129. By email at clientservices at copiapartners.com.au. Or by post at Level 47, North Tower, 80 Collins Street, Melbourne, Victoria 3000. For complaints, you can also contact the Australian Financial Complaints Authority on 1800 931 678.",
  },
  active_vs_passive: {
    audioUrl: "/audio/active_vs_passive.mp3",
    pcmUrl: "/audio/active_vs_passive.pcm",
    text: "We believe active management is particularly well suited to the mid-cap and small-cap segments of the market. Research shows that active managers have clear dominance in the Australian small and mid-cap category, supported by their ability to exploit pricing inefficiencies in relatively under-researched segments. The median Australian small-cap active fund has outperformed the index by one point eight percentage points over three years, two point two over five years, and three point three over ten years, after fees. Our benchmark-unaware approach allows us to invest based purely on conviction rather than index weight.",
  },
  fallback: {
    audioUrl: "/audio/fallback.mp3",
    pcmUrl: "/audio/fallback.pcm",
    text: "That's a great question. For more detail on that topic, I'd suggest speaking directly with our investor relations team who can provide you with the most current and comprehensive information.",
  },
};

/**
 * Classify a question into a response category.
 * Returns the category if confident, null if the question should go to the live agent.
 */
export function classifyQuestion(question: string): ResponseCategory | null {
  const lower = question.toLowerCase();

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

  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  if (top.score >= 1) {
    return top.category;
  }

  return null;
}
