import { runSenadoGacetaIngestion } from "../ingestion/adapters/senado-gaceta/index.js";

async function main() {
  const result = await runSenadoGacetaIngestion({
    maxDiscoveryPages: getNumberArg("--max-discovery-pages"),
    maxSessionPages: getNumberArg("--max-session-pages"),
    maxDetailPages: getNumberArg("--max-detail-pages"),
    seedUrls: getStringArgs("--seed-url")
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error("Senado Gaceta ingestion failed", error);
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

function getStringArgs(flag: string): string[] | undefined {
  const args = process.argv.slice(2);
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (value) {
        values.push(value);
      }
    }
  }

  return values.length > 0 ? values : undefined;
}
