import { runSilIngestion } from "../ingestion/adapters/sil/index.js";

async function main() {
  const result = await runSilIngestion({
    maxDiscoveryPages: getNumberArg("--max-discovery-pages"),
    maxDetailPages: getNumberArg("--max-detail-pages")
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error("SIL ingestion failed", error);
  process.exitCode = 1;
});

function getNumberArg(flag: string): number | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((value) => value === flag);

  if (index === -1) {
    return undefined;
  }

  const rawValue = args[index + 1];
  const value = rawValue ? Number(rawValue) : NaN;

  return Number.isFinite(value) ? value : undefined;
}

