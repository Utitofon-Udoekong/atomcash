import { defineConfig } from "@solidcash/solidhat/config";

const strictLimits = {
  maximumInputBytes: 10_000,
  maximumStackItemBytes: 10_000,
  maximumTransactionBytes: 100_000,
  maximumNftCommitmentBytes: 128,
};

export default defineConfig({
  paths: {
    contracts: "contracts",
    artifacts: "artifacts",
    tests: "test",
  },
  compiler: { evmCompat: false },
  accounts: { count: 4, satoshis: 100_000_000n },
  networks: {
    mock: { type: "mock" },
    strict: {
      type: "mock",
      consensus: strictLimits,
      policy: { enforceDust: true },
    },
  },
  defaultNetwork: "strict",
});
