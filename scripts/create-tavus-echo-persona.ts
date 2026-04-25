/**
 * Create a Tavus persona in echo mode (pipeline_mode: "echo") so the
 * replica acts as a pure rendering layer — STT/LLM/TTS auto-pipeline
 * disabled. The replica only speaks what we send via
 * `conversation.echo` events. See docs/TAVUS-PERSONA-SETUP.md.
 *
 * Usage:
 *   bun scripts/create-tavus-echo-persona.ts \
 *     --name "Pep Generic" \
 *     --replica-id r1234567890
 *
 *   bun scripts/create-tavus-echo-persona.ts --name "Pep Custom" --replica-id rABCDE
 *
 * Run once per persona slot you want (Generic, Custom, …). The script
 * prints the resulting persona_id; copy it into the matching env var:
 *   NEXT_PUBLIC_TAVUS_PERSONA_GENERIC=<id>
 *   NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM=<id>
 *
 * Reads TAVUS_API_KEY from the environment. Loads .env.local if present.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(file: string): void {
  try {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key]) continue;
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local — fine, rely on process env.
  }
}

interface Args {
  name: string;
  replicaId: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") out.name = argv[++i];
    else if (arg === "--replica-id") out.replicaId = argv[++i];
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  if (!out.name || !out.replicaId) {
    console.error("Both --name and --replica-id are required.");
    printHelp();
    process.exit(2);
  }
  return out as Args;
}

function printHelp(): void {
  console.log(`Usage: bun scripts/create-tavus-echo-persona.ts --name <persona name> --replica-id <rXXX>

Creates a Tavus persona with pipeline_mode="echo" so the replica acts as a
pure rendering layer (no autonomous LLM). Prints the new persona_id.`);
}

async function main(): Promise<void> {
  loadDotEnv(resolve(process.cwd(), ".env.local"));

  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    console.error("TAVUS_API_KEY is not set (checked process env and .env.local).");
    process.exit(1);
  }

  const { name, replicaId } = parseArgs(process.argv.slice(2));

  const body = {
    persona_name: name,
    pipeline_mode: "echo",
    default_replica_id: replicaId,
  };

  console.log(`Creating echo-mode persona "${name}" (replica ${replicaId})…`);

  const res = await fetch("https://tavusapi.com/v2/personas", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Tavus API error ${res.status}: ${text}`);
    process.exit(1);
  }

  let parsed: { persona_id?: string; pipeline_mode?: string } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`Tavus returned non-JSON response: ${text}`);
    process.exit(1);
  }

  const id = parsed.persona_id;
  if (!id) {
    console.error(`Tavus did not return a persona_id. Raw response:\n${text}`);
    process.exit(1);
  }

  console.log("");
  console.log(`✓ Created persona`);
  console.log(`  persona_id:    ${id}`);
  console.log(`  pipeline_mode: ${parsed.pipeline_mode ?? "?"}`);
  console.log("");
  console.log(`Add to your env (.env.local / Vercel):`);
  console.log(`  NEXT_PUBLIC_TAVUS_PERSONA_GENERIC=${id}`);
  console.log(`    or`);
  console.log(`  NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM=${id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
