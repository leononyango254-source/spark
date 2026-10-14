import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@spark/referral": "/Users/leonokwatch/Spark/packages/referral/src",
      "@spark/reward": "/Users/leonokwatch/Spark/packages/reward/src",
      "@spark/campaign": "/Users/leonokwatch/Spark/packages/campaign/src",
      "@spark/db": "/Users/leonokwatch/Spark/packages/db/src",
      "@spark/telegram": "/Users/leonokwatch/Spark/packages/telegram/src",
      "@spark/settlement": "/Users/leonokwatch/Spark/packages/settlement/src",
    },
  },
});
