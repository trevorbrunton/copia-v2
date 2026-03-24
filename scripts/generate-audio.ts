/**
 * Generate pre-recorded audio files for demo responses using ElevenLabs TTS.
 * Outputs MP3 files to public/audio/<category>.mp3
 *
 * Usage: bun scripts/generate-audio.ts
 */

const VOICE_ID = "ixN1ejtr8VuHmrwZTAgr";
const MODEL_ID = "eleven_flash_v2";
const API_KEY = process.env.ELEVENLABS_API_KEY;

if (!API_KEY) {
  console.error("ELEVENLABS_API_KEY not set");
  process.exit(1);
}

const responses: Record<string, string> = {
  fund_manager:
    "The OC Mid-Cap Fund is managed by myself, Robert Frost, as Head of Investments at OC Funds Management, alongside Nga Lucas who serves as Portfolio Manager for the Mid-Cap strategy. Between us we oversee the full investment process, from idea generation through to portfolio construction.",

  investment_strategy:
    "Our strategy is a long-only, benchmark-unaware approach focused on Australian mid-cap equities. We typically hold between twenty and fifty stocks, selected through a rigorous bottom-up process. We are looking for quality businesses with strong management teams, sustainable competitive advantages, and attractive valuations. Being benchmark-unaware means we are not constrained by index composition — we invest based on conviction, not index weight.",

  since_inception_return:
    "Since inception in November 2023 through to the end of February 2026, the OC Mid-Cap Fund has returned positive nine point four percent. The fund is still relatively young with just over two years of track record, and we believe the portfolio is well positioned for the medium to long term.",

  recent_performance:
    "Looking at our recent performance to the end of February 2026 — over the past month the fund returned negative two point five percent, over three months negative four point four percent, and over the past year we have returned positive one point eight percent. It has been a challenging period for mid-cap equities broadly, and our benchmark-unaware positioning has meant some short-term divergence from the broader market.",

  benchmark_comparison:
    "Our benchmark is the S and P ASX MidCap 50 Index. Since inception, the fund has returned nine point four percent compared to the benchmark's sixteen point three percent, which is an underperformance of six point nine percent. I want to be upfront about that. Over the past year specifically, the fund returned one point eight percent versus the benchmark's eighteen point six percent. However, it is important to put this in context. The fund has only been operating for just over two years, which is a very short period to judge a long-only equity strategy. Our benchmark-unaware approach means we will have periods of divergence from the index — both positive and negative. We are focused on long-term capital appreciation through high-conviction stock selection, and we are confident in the quality of the businesses we hold.",

  fallback:
    "That's a great question. For more detail on that topic, I'd suggest speaking directly with our investor relations team who can provide you with the most current and comprehensive information.",

  greeting:
    "Hello, I'm Robert Frost, Head of Investments at OC Funds Management. How can I help you today?",
};

async function generateAudio(category: string, text: string): Promise<void> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TTS failed for ${category}: ${res.status} ${body}`);
  }

  const buffer = await res.arrayBuffer();
  const path = `public/audio/${category}.mp3`;
  await Bun.write(path, buffer);
  const sizeKB = Math.round(buffer.byteLength / 1024);
  console.log(`  ✓ ${category}.mp3 (${sizeKB} KB)`);
}

console.log(`Generating audio with voice ${VOICE_ID}...\n`);

for (const [category, text] of Object.entries(responses)) {
  await generateAudio(category, text);
}

console.log("\n✓ All audio files generated in public/audio/");
