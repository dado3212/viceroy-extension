import { getMonarchHeaders } from '../headers';
import { MERCHANT_IDS } from '../constants';

// pending Uber-ish transactions needing review
export async function getPendingUberTransactions({ limit = 200 } = {}): Promise<Array<MonarchTransaction>> {
  const data = await monarchQuery({
    operationName: 'Web_GetTransactionsList',
    variables: {
      orderBy: 'date',
      limit,
      filters: {
         search: '', // UBER *TRIP is just rides, but we're handling Uber Eats now too
         categories: [],
         accounts: [],
         tags: [],
         merchants: [
          MERCHANT_IDS.UBER_EATS,
          MERCHANT_IDS.UBER,
         ],
        //  needsReview: true, // TODO: only for testing
       },
    },
    query: `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {\n  allTransactions(filters: $filters) {\n    totalCount\n    totalSelectableCount\n    results(offset: $offset, limit: $limit, orderBy: $orderBy) {\n      id\n      ...TransactionOverviewFields\n      __typename\n    }\n    __typename\n  }\n  transactionRules {\n    id\n    __typename\n  }\n}\n\nfragment TransactionOverviewFields on Transaction {\n  id\n  amount\n  pending\n  date\n  hideFromReports\n  hiddenByAccount\n  plaidName\n  notes\n  isRecurring\n  reviewStatus\n  needsReview\n  isSplitTransaction\n  dataProviderDescription\n  attachments {\n    id\n    __typename\n  }\n  goal {\n    id\n    name\n    __typename\n  }\n  category {\n    id\n    name\n    icon\n    group {\n      id\n      type\n      __typename\n    }\n    __typename\n  }\n  merchant {\n    name\n    id\n    transactionsCount\n    logoUrl\n    recurringTransactionStream {\n      frequency\n      isActive\n      __typename\n    }\n    __typename\n  }\n  tags {\n    id\n    name\n    color\n    order\n    __typename\n  }\n  account {\n    id\n    displayName\n    icon\n    logoUrl\n    __typename\n  }\n  __typename\n}`
  });
  return data?.allTransactions?.results || [];
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
  const r = await fetch('https://api.monarch.com/graphql', {
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    headers: getMonarchHeaders()!,
    body: JSON.stringify(data),
  });
  if (!r.ok) { 
    console.log(r);
    throw new Error(`Monarch HTTP ${r.status}`);
  }
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0]?.message || 'GraphQL error');
  return j.data;
}