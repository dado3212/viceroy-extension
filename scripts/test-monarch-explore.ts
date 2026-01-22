#!/usr/bin/env npx tsx

/**
 * Exploration script to find ALL relevant transaction descriptions
 * and determine the best filtering strategy
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadHeaders(): Record<string, Record<string, string>> {
  const configPath = join(__dirname, 'test-headers.json');
  if (!existsSync(configPath)) {
    console.error('ERROR: scripts/test-headers.json not found!');
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

async function monarchQuery(headers: Record<string, string>, data: any): Promise<any> {
  const r = await fetch('https://api.monarch.com/graphql', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(data),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Monarch HTTP ${r.status}: ${text.slice(0, 200)}`);
  }

  const j = await r.json();
  if (j.errors?.length) {
    throw new Error(j.errors[0]?.message || 'GraphQL error');
  }

  return j.data;
}

const query = `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {
  allTransactions(filters: $filters) {
    totalCount
    totalSelectableCount
    results(offset: $offset, limit: $limit, orderBy: $orderBy) {
      id
      amount
      date
      needsReview
      dataProviderDescription
      merchant { name }
      __typename
    }
    __typename
  }
}`;

async function searchAndAnalyze(headers: Record<string, string>, searchTerm: string, needsReview: boolean | null = null): Promise<any[]> {
  const filters: Record<string, any> = {
    search: searchTerm,
    categories: [],
    accounts: [],
    tags: [],
    merchants: [],
  };
  if (needsReview !== null) {
    filters.needsReview = needsReview;
  }

  const data = await monarchQuery(headers, {
    operationName: 'Web_GetTransactionsList',
    variables: { orderBy: 'date', limit: 500, filters },
    query,
  });

  return data?.allTransactions?.results || [];
}

async function main() {
  console.log('=================================================');
  console.log('  Monarch Transaction Description Explorer');
  console.log('=================================================\n');

  const allHeaders = loadHeaders();
  const monarchHeaders = allHeaders.monarchHeaders;

  // Search for various terms and analyze unique descriptions
  const searchTerms = ['Uber', 'UBER', 'Lyft', 'LYFT', 'uber', 'lyft'];

  const allResults: Map<string, any> = new Map();

  for (const term of searchTerms) {
    console.log(`\nSearching for "${term}"...`);
    const results = await searchAndAnalyze(monarchHeaders, term);
    console.log(`  Found ${results.length} results`);

    for (const r of results) {
      // Use ID as key to dedupe
      if (!allResults.has(r.id)) {
        allResults.set(r.id, r);
      }
    }
  }

  console.log(`\n\n========================================`);
  console.log(`UNIQUE TRANSACTION DESCRIPTIONS`);
  console.log(`========================================`);

  // Group by unique descriptions
  const descriptionCounts: Map<string, { count: number; needsReview: number; examples: any[] }> = new Map();

  for (const r of allResults.values()) {
    const desc = r.dataProviderDescription || '(empty)';
    if (!descriptionCounts.has(desc)) {
      descriptionCounts.set(desc, { count: 0, needsReview: 0, examples: [] });
    }
    const entry = descriptionCounts.get(desc)!;
    entry.count++;
    if (r.needsReview) entry.needsReview++;
    if (entry.examples.length < 2) {
      entry.examples.push({ date: r.date, amount: r.amount, merchant: r.merchant?.name });
    }
  }

  // Sort by count descending
  const sorted = [...descriptionCounts.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log(`\nTotal unique descriptions: ${sorted.length}`);
  console.log(`Total transactions: ${allResults.size}\n`);

  // Categorize descriptions
  const categories = {
    uberTrip: [] as string[],
    uberEats: [] as string[],
    uberOther: [] as string[],
    lyft: [] as string[],
    unknown: [] as string[],
  };

  for (const [desc, data] of sorted) {
    const upper = desc.toUpperCase();

    console.log(`"${desc}"`);
    console.log(`  Count: ${data.count}, Needs Review: ${data.needsReview}`);
    console.log(`  Examples: ${data.examples.map(e => `${e.date} $${Math.abs(e.amount).toFixed(2)}`).join(', ')}`);

    // Categorize
    if (upper.includes('UBER') && upper.includes('EATS')) {
      categories.uberEats.push(desc);
      console.log(`  -> Category: UBER EATS`);
    } else if (upper.includes('UBER') && upper.includes('TRIP')) {
      categories.uberTrip.push(desc);
      console.log(`  -> Category: UBER TRIP`);
    } else if (upper.includes('UBER')) {
      categories.uberOther.push(desc);
      console.log(`  -> Category: UBER OTHER (NEEDS MANUAL REVIEW)`);
    } else if (upper.includes('LYFT')) {
      categories.lyft.push(desc);
      console.log(`  -> Category: LYFT`);
    } else {
      categories.unknown.push(desc);
      console.log(`  -> Category: UNKNOWN`);
    }
    console.log('');
  }

  console.log(`\n========================================`);
  console.log(`CATEGORY SUMMARY`);
  console.log(`========================================`);
  console.log(`\nUBER TRIP (${categories.uberTrip.length} patterns):`);
  categories.uberTrip.forEach(d => console.log(`  - "${d}"`));

  console.log(`\nUBER EATS (${categories.uberEats.length} patterns):`);
  categories.uberEats.forEach(d => console.log(`  - "${d}"`));

  console.log(`\nUBER OTHER - These need attention (${categories.uberOther.length} patterns):`);
  categories.uberOther.forEach(d => console.log(`  - "${d}"`));

  console.log(`\nLYFT (${categories.lyft.length} patterns):`);
  categories.lyft.forEach(d => console.log(`  - "${d}"`));

  if (categories.unknown.length > 0) {
    console.log(`\nUNKNOWN (${categories.unknown.length} patterns):`);
    categories.unknown.forEach(d => console.log(`  - "${d}"`));
  }

  // Recommendation
  console.log(`\n========================================`);
  console.log(`RECOMMENDATIONS`);
  console.log(`========================================`);

  if (categories.uberOther.length > 0) {
    console.log(`\n⚠️  Found ${categories.uberOther.length} UBER descriptions without TRIP or EATS:`);
    categories.uberOther.forEach(d => console.log(`    "${d}"`));
    console.log(`\n   These are likely Uber RIDES that just don't have the word "TRIP".`);
    console.log(`   Suggestion: Treat any "UBER" that doesn't contain "EATS" as a RIDE.`);
  }
}

main().catch(console.error);
