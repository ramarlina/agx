import { vaultStore } from "@/lib/vault-store";

function main() {
  const result = vaultStore.migrateFromLegacyDb();
  const output = {
    vaultRoot: vaultStore.rootDir,
    ...result,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
