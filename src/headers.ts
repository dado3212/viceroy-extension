
/**
 * We need cookies/authorization tokens 
 */
export enum Header {
  Monarch = 'monarchHeaders',
  UberEats = 'uberEatsHeaders',
  UberRides = 'uberRidesHeaders',
}

export const HeaderInfo: Record<Header, {
  api: string,
  initiatorFilter: string,
  cookieURL: string,
  headerValidator?: (h: { [k: string]: string; }) => boolean,

  buttonName: string,
  buttonColor: string,
}> = {
  [Header.Monarch]: {
    api: 'https://api.monarch.com/graphql',
    initiatorFilter: 'monarch.com',
    cookieURL: 'https://app.monarch.com/',
    headerValidator: (h) => h['authorization']?.length >= 7,
    buttonName: 'Monarch',
    buttonColor: '#ff692d',
  },
  [Header.UberEats]: {
    api: 'https://www.ubereats.com/_p/api',
    initiatorFilter: 'ubereats.com',
    cookieURL: 'https://www.ubereats.com/orders',
    buttonName: 'Uber Eats',
    buttonColor: '#03c16b',
  },
  [Header.UberRides]: {
    api: 'https://riders.uber.com/graphql',
    initiatorFilter: 'riders.uber.com',
    cookieURL: 'https://riders.uber.com/trips',
    buttonName: 'Uber',
    buttonColor: 'black',
  },
};

let headers: Partial<Record<Header, Record<string, string>>> = {};

export const getHeader = (header: Header) => headers[header];

// Listen for any relevant requests, and steal the headers/cookies if we're missing them
const listenerUrls: Array<string> = [];
for (const header of Object.values(Header)) {
  listenerUrls.push(`${HeaderInfo[header].api}*`);
}
chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    for (const header of Object.values(Header)) {
      if (!headers[header]) {
        const {api, initiatorFilter, headerValidator} = HeaderInfo[header];
        if (details.initiator?.includes(initiatorFilter) && details.url.includes(api)) {
          let requestHeaders = Object.fromEntries(
            (details.requestHeaders || []).map(h => [h.name, h.value || ''])
          );
          if (headerValidator == null || headerValidator(requestHeaders)) {
            headers[header] = requestHeaders;
            (async () => await chrome.storage.sync.set({ [header]: requestHeaders }))();
          }
        }
      }
    }
  },
  {
    urls: listenerUrls,
  },
  ["requestHeaders", "extraHeaders"]
);

export const updateHeadersFromCache = async () => {
  const cachedHeaders = await chrome.storage.sync.get(Object.values(Header));
  for (const header of Object.values(Header)) {
    if (cachedHeaders[header]) {
      headers[header] = cachedHeaders[header];
    }
  }
}

// We need the headers, so if the tab's open force refresh it, and if it's not open
// then open it (and wait til they're finished loading)
export const syncHeaders = async (clearFromStorage = false) => {
  // First handle storage
  if (clearFromStorage) {
    await chrome.storage.sync.remove(Object.values(Header) as string[]);
    headers = {};
  } else {
    await updateHeadersFromCache();
  }
  // If not, check from tabs. If they're open, reload, if they're not open then open one
  let tabs: { [key: number]: boolean } = {};
  for (const header of Object.values(Header)) {
    if (!headers[header]) {
      const queryUrl = HeaderInfo[header].cookieURL;
      let [tab] = await chrome.tabs.query({ url: `${queryUrl}*` });
      if (tab) {
        chrome.tabs.reload(tab.id!);
        tabs[tab.id!] = true;
      } else {
        tabs[(await chrome.tabs.create({ url: queryUrl, active: false })).id!] = true;
      }
    }
  }
  // We're good!
  if (Object.keys(tabs).length === 0) {
    return;
  }
  // And if any tabs were opened, wait for them to complete
  await new Promise((resolve: any) => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      // If a tab finishes loading, then remove the relevant one
      if (info.status === 'complete') {
        delete tabs[tabId];
      }
      if (Object.keys(tabs).length === 0) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
};
