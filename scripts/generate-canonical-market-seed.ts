#!/usr/bin/env node
/**
 * Write the canonical market mirror seed migration from the code registry.
 *
 * Thin by design: the rendering lives in src/lib/markets/canonicalSeed.ts so a
 * test can call it directly and compare against the file this script wrote.
 */
import { writeFileSync } from "node:fs";
import { buildCanonicalSeedSql, CANONICAL_SEED_PATH } from "@/lib/markets/canonicalSeed";
import { CANONICAL_MARKETS } from "@/lib/markets/canonicalMarkets";

writeFileSync(CANONICAL_SEED_PATH, buildCanonicalSeedSql(), "utf8");
console.log(`Wrote ${CANONICAL_SEED_PATH} — ${CANONICAL_MARKETS.length} markets.`);
