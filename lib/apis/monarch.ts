import { getHeader, Header } from '../headers';

// Log collector for debugging
export const monarchLogs: string[] = [];
function log(...args: any[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  monarchLogs.push(`[${new Date().toISOString()}] ${msg}`);
  console.log(...args);
}

export async function getPendingTransactions({ limit = 200, needsReview = true } = {}): Promise<Array<MonarchTransaction>> {
  monarchLogs.length = 0; // Clear logs for fresh run
  log('[Monarch] getPendingTransactions called with:', { limit, needsReview });
  log('[Monarch] Filter mode:', needsReview ? 'ONLY UNREVIEWED (needsReview=true)' : 'ALL TRANSACTIONS (needsReview=false)');

  // Build filters - only include needsReview if it's true
  // Search for "Uber" which should match Uber transactions in Monarch
  const uberFilters: Record<string, any> = {
    search: 'Uber',  // Changed from 'UBER *' - simpler search
    categories: [],
    accounts: [],
    tags: [],
    merchants: [],
  };
  if (needsReview) {
    uberFilters.needsReview = true;
  }

  const lyftFilters: Record<string, any> = {
    search: 'Lyft',  // Changed from 'LYFT *'
    categories: [],
    accounts: [],
    tags: [],
    merchants: [],
  };
  if (needsReview) {
    lyftFilters.needsReview = true;
  }

  log('[Monarch] UBER filters:', uberFilters);
  log('[Monarch] LYFT filters:', lyftFilters);

  const [uberData, lyftData] = await Promise.all([
    monarchQuery({
      operationName: 'Web_GetTransactionsList',
      variables: {
        orderBy: 'date',
        limit,
        filters: uberFilters,
      },
      query: `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {\n  allTransactions(filters: $filters) {\n    totalCount\n    totalSelectableCount\n    results(offset: $offset, limit: $limit, orderBy: $orderBy) {\n      id\n      ...TransactionOverviewFields\n      __typename\n    }\n    __typename\n  }\n  transactionRules {\n    id\n    __typename\n  }\n}\n\nfragment TransactionOverviewFields on Transaction {\n  id\n  amount\n  pending\n  date\n  hideFromReports\n  hiddenByAccount\n  plaidName\n  notes\n  isRecurring\n  reviewStatus\n  needsReview\n  isSplitTransaction\n  dataProviderDescription\n  attachments {\n    id\n    __typename\n  }\n  goal {\n    id\n    name\n    __typename\n  }\n  category {\n    id\n    name\n    icon\n    group {\n      id\n      type\n      __typename\n    }\n    __typename\n  }\n  merchant {\n    name\n    id\n    transactionsCount\n    logoUrl\n    recurringTransactionStream {\n      frequency\n      isActive\n      __typename\n    }\n    __typename\n  }\n  tags {\n    id\n    name\n    color\n    order\n    __typename\n  }\n  account {\n    id\n    displayName\n    icon\n    logoUrl\n    __typename\n  }\n  __typename\n}`
    }),
    monarchQuery({
      operationName: 'Web_GetTransactionsList',
      variables: {
        orderBy: 'date',
        limit,
        filters: lyftFilters,
      },
      query: `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {\n  allTransactions(filters: $filters) {\n    totalCount\n    totalSelectableCount\n    results(offset: $offset, limit: $limit, orderBy: $orderBy) {\n      id\n      ...TransactionOverviewFields\n      __typename\n    }\n    __typename\n  }\n  transactionRules {\n    id\n    __typename\n  }\n}\n\nfragment TransactionOverviewFields on Transaction {\n  id\n  amount\n  pending\n  date\n  hideFromReports\n  hiddenByAccount\n  plaidName\n  notes\n  isRecurring\n  reviewStatus\n  needsReview\n  isSplitTransaction\n  dataProviderDescription\n  attachments {\n    id\n    __typename\n  }\n  goal {\n    id\n    name\n    __typename\n  }\n  category {\n    id\n    name\n    icon\n    group {\n      id\n      type\n      __typename\n    }\n    __typename\n  }\n  merchant {\n    name\n    id\n    transactionsCount\n    logoUrl\n    recurringTransactionStream {\n      frequency\n      isActive\n      __typename\n    }\n    __typename\n  }\n  tags {\n    id\n    name\n    color\n    order\n    __typename\n  }\n  account {\n    id\n    displayName\n    icon\n    logoUrl\n    __typename\n  }\n  __typename\n}`
    })
  ]);

  // Log raw response data
  log('[Monarch] Raw UBER response:', {
    totalCount: uberData?.allTransactions?.totalCount,
    resultsCount: uberData?.allTransactions?.results?.length,
    firstFew: uberData?.allTransactions?.results?.slice(0, 3).map((x: any) => ({
      id: x.id,
      date: x.date,
      amount: x.amount,
      dataProviderDescription: x.dataProviderDescription,
      needsReview: x.needsReview,
    })),
  });
  log('[Monarch] Raw LYFT response:', {
    totalCount: lyftData?.allTransactions?.totalCount,
    resultsCount: lyftData?.allTransactions?.results?.length,
  });

  // Filter and log - match various formats of Uber/Lyft descriptions
  // Include ALL Uber transactions (not just those with TRIP or EATS in description)
  // Examples: "UBER EATS help.uber.com CA", "Uber Trip help.uber.com CA", "UBER", "PAYPAL *UBER", etc.
  const uberResults = (uberData?.allTransactions?.results || []).filter((x: any) => {
    const desc = (x.dataProviderDescription || '').toUpperCase();
    // Match any transaction that contains UBER - will categorize as EATS or RIDES later
    return desc.includes('UBER');
  });
  const lyftResults = (lyftData?.allTransactions?.results || []).filter((x: any) => {
    const desc = (x.dataProviderDescription || '').toUpperCase();
    return desc.includes('LYFT');
  });

  log('[Monarch] After filtering - UBER count:', uberResults.length, 'LYFT count:', lyftResults.length);

  return [...uberResults, ...lyftResults];
}

export async function fetchMonarchTags(): Promise<Array<MonarchTag>> {
  const data = await monarchQuery({
    operationName: 'Common_GetHouseholdTransactionTags',
    variables: {
      includeTransactionCount: false,
    },
    query: `query Common_GetHouseholdTransactionTags($search: String, $limit: Int, $bulkParams: BulkTransactionDataParams, $includeTransactionCount: Boolean = false) {\n  householdTransactionTags(\n    search: $search\n    limit: $limit\n    bulkParams: $bulkParams\n  ) {\n    id\n    name\n    color\n    order\n    transactionCount @include(if: $includeTransactionCount)\n    __typename\n  }\n}`
  });
  return data?.householdTransactionTags || [];
}

// update: mark reviewed + set note, optionally add tag
export async function applyMonarchDecision({ transactionId, note, tag }: {transactionId: number, note: string | null, tag: string | null }) {
  // 1) set notes + mark reviewed
  await monarchQuery({
    operationName: 'Web_TransactionDrawerUpdateTransaction',
    variables: {
      input: {
        id: String(transactionId),
        notes: note || '',
        reviewed: true,
      }
    },
    query: `mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!) {\n  updateTransaction(input: $input) {\n    transaction {\n      id\n      ...TransactionDrawerFields\n      __typename\n    }\n    errors {\n      ...PayloadErrorFields\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment TransactionDrawerSplitMessageFields on Transaction {\n  id\n  amount\n  merchant {\n    id\n    name\n    __typename\n  }\n  category {\n    id\n    icon\n    name\n    __typename\n  }\n  __typename\n}\n\nfragment OriginalTransactionFields on Transaction {\n  id\n  date\n  amount\n  merchant {\n    id\n    name\n    __typename\n  }\n  __typename\n}\n\nfragment AccountLinkFields on Account {\n  id\n  displayName\n  icon\n  logoUrl\n  id\n  __typename\n}\n\nfragment TransactionOverviewFields on Transaction {\n  id\n  amount\n  pending\n  date\n  hideFromReports\n  hiddenByAccount\n  plaidName\n  notes\n  isRecurring\n  reviewStatus\n  needsReview\n  isSplitTransaction\n  dataProviderDescription\n  attachments {\n    id\n    __typename\n  }\n  goal {\n    id\n    name\n    __typename\n  }\n  category {\n    id\n    name\n    icon\n    group {\n      id\n      type\n      __typename\n    }\n    __typename\n  }\n  merchant {\n    name\n    id\n    transactionsCount\n    logoUrl\n    recurringTransactionStream {\n      frequency\n      isActive\n      __typename\n    }\n    __typename\n  }\n  tags {\n    id\n    name\n    color\n    order\n    __typename\n  }\n  account {\n    id\n    displayName\n    icon\n    logoUrl\n    __typename\n  }\n  __typename\n}\n\nfragment TransactionDrawerFields on Transaction {\n  id\n  amount\n  pending\n  isRecurring\n  date\n  originalDate\n  hideFromReports\n  needsReview\n  reviewedAt\n  reviewedByUser {\n    id\n    name\n    __typename\n  }\n  plaidName\n  notes\n  hasSplitTransactions\n  isSplitTransaction\n  isManual\n  updatedByRetailSync\n  splitTransactions {\n    id\n    ...TransactionDrawerSplitMessageFields\n    __typename\n  }\n  originalTransaction {\n    id\n    updatedByRetailSync\n    ...OriginalTransactionFields\n    __typename\n  }\n  attachments {\n    id\n    extension\n    sizeBytes\n    filename\n    originalAssetUrl\n    __typename\n  }\n  account {\n    id\n    hideTransactionsFromReports\n    ...AccountLinkFields\n    __typename\n  }\n  category {\n    id\n    __typename\n  }\n  goal {\n    id\n    __typename\n  }\n  merchant {\n    id\n    name\n    transactionCount\n    logoUrl\n    hasActiveRecurringStreams\n    recurringTransactionStream {\n      id\n      frequency\n      __typename\n    }\n    __typename\n  }\n  tags {\n    id\n    name\n    color\n    order\n    __typename\n  }\n  needsReviewByUser {\n    id\n    __typename\n  }\n  ownedByUser {\n    id\n    __typename\n  }\n  ownershipOverriddenAt\n  ...TransactionOverviewFields\n  __typename\n}\n\nfragment PayloadErrorFields on PayloadError {\n  fieldErrors {\n    field\n    messages\n    __typename\n  }\n  message\n  code\n  __typename\n}`
  });

  // Update the tag if requested
  if (tag) {
    await monarchQuery({
      operationName: 'Web_SetTransactionTags',
      variables: {
        input: {
          tagIds: [tag],
          transactionId: String(transactionId),
        }
      },
      query: `mutation Web_SetTransactionTags($input: SetTransactionTagsInput!) {\n  setTransactionTags(input: $input) {\n    errors {\n      ...PayloadErrorFields\n      __typename\n    }\n    transaction {\n      id\n      tags {\n        id\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment PayloadErrorFields on PayloadError {\n  fieldErrors {\n    field\n    messages\n    __typename\n  }\n  message\n  code\n  __typename\n}`
    });
  }
}

async function monarchQuery(data: any) {
  log('[Monarch API] Request:', data.operationName, 'variables:', data.variables);

  const headers = getHeader(Header.Monarch);
  log('[Monarch API] Headers present:', !!headers);

  const r = await fetch('https://api.monarch.com/graphql', {
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    headers: headers!,
    body: JSON.stringify(data),
  });

  log('[Monarch API] Response status:', r.status, r.statusText);

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    log('[Monarch API] Error response:', text.slice(0, 500));
    throw new Error(`Monarch HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  const j = await r.json();
  if (j.errors?.length) {
    log('[Monarch API] GraphQL errors:', j.errors);
    throw new Error(j.errors[0]?.message || 'GraphQL error');
  }
  return j.data;
}