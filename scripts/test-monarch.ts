#!/usr/bin/env npx tsx

/**
 * Test script for Monarch API
 *
 * Usage:
 *   npx tsx scripts/test-monarch.ts
 *
 * First, copy scripts/test-headers.example.json to scripts/test-headers.json
 * and fill in your headers from the extension.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load headers from config
function loadHeaders(): Record<string, Record<string, string>> {
  const configPath = join(__dirname, 'test-headers.json');
  if (!existsSync(configPath)) {
    console.error('ERROR: scripts/test-headers.json not found!');
    console.error('Copy scripts/test-headers.example.json to scripts/test-headers.json and fill in your headers.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

// Monarch API query
async function monarchQuery(headers: Record<string, string>, data: any): Promise<any> {
  console.log(`\n[API] Request: ${data.operationName}`);
  console.log(`[API] Variables:`, JSON.stringify(data.variables, null, 2));

  const r = await fetch('https://api.monarch.com/graphql', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(data),
  });

  console.log(`[API] Response status: ${r.status} ${r.statusText}`);

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error(`[API] Error response:`, text.slice(0, 500));
    throw new Error(`Monarch HTTP ${r.status}: ${text.slice(0, 200)}`);
  }

  const j = await r.json();
  if (j.errors?.length) {
    console.error(`[API] GraphQL errors:`, j.errors);
    throw new Error(j.errors[0]?.message || 'GraphQL error');
  }

  return j.data;
}

// Get pending transactions (same query as the extension)
async function getPendingTransactions(headers: Record<string, string>, { limit = 200, needsReview = true } = {}): Promise<any[]> {
  console.log('\n========================================');
  console.log('[Monarch] getPendingTransactions');
  console.log(`[Monarch] limit=${limit}, needsReview=${needsReview}`);
  console.log('========================================');

  // Build filters
  const uberFilters: Record<string, any> = {
    search: 'Uber',
    categories: [],
    accounts: [],
    tags: [],
    merchants: [],
  };
  if (needsReview) {
    uberFilters.needsReview = true;
  }

  const lyftFilters: Record<string, any> = {
    search: 'Lyft',
    categories: [],
    accounts: [],
    tags: [],
    merchants: [],
  };
  if (needsReview) {
    lyftFilters.needsReview = true;
  }

  console.log('\n[Monarch] UBER filters:', JSON.stringify(uberFilters));
  console.log('[Monarch] LYFT filters:', JSON.stringify(lyftFilters));

  const query = `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {
  allTransactions(filters: $filters) {
    totalCount
    totalSelectableCount
    results(offset: $offset, limit: $limit, orderBy: $orderBy) {
      id
      ...TransactionOverviewFields
      __typename
    }
    __typename
  }
  transactionRules {
    id
    __typename
  }
}

fragment TransactionOverviewFields on Transaction {
  id
  amount
  pending
  date
  hideFromReports
  hiddenByAccount
  plaidName
  notes
  isRecurring
  reviewStatus
  needsReview
  isSplitTransaction
  dataProviderDescription
  attachments {
    id
    __typename
  }
  goal {
    id
    name
    __typename
  }
  category {
    id
    name
    icon
    group {
      id
      type
      __typename
    }
    __typename
  }
  merchant {
    name
    id
    transactionsCount
    logoUrl
    recurringTransactionStream {
      frequency
      isActive
      __typename
    }
    __typename
  }
  tags {
    id
    name
    color
    order
    __typename
  }
  account {
    id
    displayName
    icon
    logoUrl
    __typename
  }
  __typename
}`;

  const [uberData, lyftData] = await Promise.all([
    monarchQuery(headers, {
      operationName: 'Web_GetTransactionsList',
      variables: { orderBy: 'date', limit, filters: uberFilters },
      query,
    }),
    monarchQuery(headers, {
      operationName: 'Web_GetTransactionsList',
      variables: { orderBy: 'date', limit, filters: lyftFilters },
      query,
    }),
  ]);

  // Log raw response
  console.log('\n[Monarch] Raw UBER response:');
  console.log(`  totalCount: ${uberData?.allTransactions?.totalCount}`);
  console.log(`  resultsCount: ${uberData?.allTransactions?.results?.length}`);

  const firstFewUber = (uberData?.allTransactions?.results || []).slice(0, 5);
  console.log('  First 5 results:');
  firstFewUber.forEach((x: any, i: number) => {
    console.log(`    ${i + 1}. ${x.date} | $${Math.abs(x.amount).toFixed(2)} | "${x.dataProviderDescription}" | needsReview=${x.needsReview}`);
  });

  console.log('\n[Monarch] Raw LYFT response:');
  console.log(`  totalCount: ${lyftData?.allTransactions?.totalCount}`);
  console.log(`  resultsCount: ${lyftData?.allTransactions?.results?.length}`);

  // Filter results - include ALL UBER transactions (not just TRIP/EATS)
  const uberResults = (uberData?.allTransactions?.results || []).filter((x: any) => {
    const desc = (x.dataProviderDescription || '').toUpperCase();
    return desc.includes('UBER');
  });
  const lyftResults = (lyftData?.allTransactions?.results || []).filter((x: any) => {
    const desc = (x.dataProviderDescription || '').toUpperCase();
    return desc.includes('LYFT');
  });

  // Categorize for display
  const uberEats = uberResults.filter((x: any) => {
    const desc = (x.dataProviderDescription || '').toUpperCase();
    return desc.includes('EATS');
  });
  const uberRides = uberResults.filter((x: any) => {
    const desc = (x.dataProviderDescription || '').toUpperCase();
    return !desc.includes('EATS');
  });

  console.log(`\n[Monarch] Categorized:`);
  console.log(`  UBER RIDES (no EATS): ${uberRides.length}`);
  console.log(`  UBER EATS: ${uberEats.length}`);
  console.log(`  LYFT: ${lyftResults.length}`);

  console.log(`\n[Monarch] After filtering:`);
  console.log(`  UBER count: ${uberResults.length}`);
  console.log(`  LYFT count: ${lyftResults.length}`);

  const allResults = [...uberResults, ...lyftResults];

  console.log('\n[Monarch] Final filtered results:');
  allResults.forEach((x: any, i: number) => {
    console.log(`  ${i + 1}. ${x.date} | $${Math.abs(x.amount).toFixed(2)} | "${x.dataProviderDescription}"`);
  });

  return allResults;
}

// Main
async function main() {
  console.log('=================================================');
  console.log('  Viceroy Monarch API Test Script');
  console.log('=================================================\n');

  const allHeaders = loadHeaders();
  const monarchHeaders = allHeaders.monarchHeaders;

  if (!monarchHeaders) {
    console.error('ERROR: monarchHeaders not found in config!');
    process.exit(1);
  }

  console.log('[Config] Loaded headers:');
  console.log(`  authorization: ${monarchHeaders.authorization ? monarchHeaders.authorization.slice(0, 20) + '...' : 'MISSING'}`);
  console.log(`  content-type: ${monarchHeaders['content-type'] || 'MISSING'}`);

  // Test with needsReview = true
  console.log('\n\n>>> TEST 1: needsReview = true (unreviewed only)');
  try {
    const results1 = await getPendingTransactions(monarchHeaders, { needsReview: true });
    console.log(`\n[RESULT] Found ${results1.length} unreviewed Uber/Lyft transactions`);
  } catch (err: any) {
    console.error(`\n[ERROR] ${err.message}`);
  }

  // Test with needsReview = false
  console.log('\n\n>>> TEST 2: needsReview = false (all transactions)');
  try {
    const results2 = await getPendingTransactions(monarchHeaders, { needsReview: false });
    console.log(`\n[RESULT] Found ${results2.length} total Uber/Lyft transactions`);
  } catch (err: any) {
    console.error(`\n[ERROR] ${err.message}`);
  }

  console.log('\n=================================================');
  console.log('  Test Complete');
  console.log('=================================================');
}

main().catch(console.error);
