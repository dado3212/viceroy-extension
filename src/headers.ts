
/**
 * We need cookies/authorization tokens 
 */

let uberEatsHeaders: { [key: string]: string } | null = null;
let uberRidesHeaders: { [key: string]: string } | null = null;
let monarchHeaders: { [key: string]: string } | null = null;

export const getUberEatsHeaders = () => uberEatsHeaders;
export const getUberRidesHeaders = () => uberRidesHeaders;
export const getMonarchHeaders = () => monarchHeaders;

// Listen for any relevant requests, and steal the headers/cookies if we're missing them
chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    // Check for Uber Eats
    if (
      uberEatsHeaders === null &&
      details.initiator?.includes('ubereats.com') &&
      details.url.includes('https://www.ubereats.com/_p/api')
    ) {
      uberEatsHeaders = Object.fromEntries(
        (details.requestHeaders || []).map(h => [h.name, h.value || ''])
      );
      (async () => await chrome.storage.sync.set({ uberEatsHeaders }))();
    }
    // Check for Monarch
    if (
      monarchHeaders === null &&
      details.initiator?.includes('monarch.com') &&
      details.url === 'https://api.monarch.com/graphql'
    ) {
      monarchHeaders = Object.fromEntries(
        (details.requestHeaders || []).map(h => [h.name, h.value || ''])
      );
      // Only take if if you're actually logged in (otherwise it'll just be Token)
      if (monarchHeaders['authorization']?.length < 7) {
        monarchHeaders = null;
      } else {
        (async () => await chrome.storage.sync.set({ monarchHeaders }))();
      }
    }
    // Check for Uber Rides
    if (
      uberRidesHeaders === null &&
      details.initiator?.includes('riders.uber.com') &&
      details.url === 'https://riders.uber.com/graphql'
    ) {
      uberRidesHeaders = Object.fromEntries(
        (details.requestHeaders || []).map(h => [h.name, h.value || ''])
      );
      (async () => await chrome.storage.sync.set({ uberRidesHeaders }))();
    }
  },
  {
    urls: [
      'https://api.monarch.com/graphql',
      'https://www.ubereats.com/_p/api/*',
      'https://riders.uber.com/graphql'
    ],
  },
  ["requestHeaders", "extraHeaders"]
);

export const updateHeadersFromCache = async () => {
  ({
    uberEatsHeaders = uberEatsHeaders,
    uberRidesHeaders = uberRidesHeaders,
    monarchHeaders = monarchHeaders,
  } = await chrome.storage.sync.get(['uberEatsHeaders', 'uberRidesHeaders', 'monarchHeaders']));
}

// We need the headers, so if the tab's open force refresh it, and if it's not open
// then open it (and wait til they're finished loading)
export const syncHeaders = async (clearFromStorage = false) => {
  // First handle storage
  if (clearFromStorage) {
    await chrome.storage.sync.remove(['uberEatsHeaders', 'uberRidesHeaders', 'monarchHeaders']);
    uberEatsHeaders = null;
    uberRidesHeaders = null;
    monarchHeaders = null;
  } else {
    await updateHeadersFromCache();
  }
  // If not, check from tabs. If they're open, reload, if they're not open then open one
  let uberEats: chrome.tabs.Tab | null = null, uberRides: chrome.tabs.Tab | null = null, monarch: chrome.tabs.Tab | null = null;
  if (uberEatsHeaders == null) {
    [uberEats] = await chrome.tabs.query({ url: 'https://www.ubereats.com/orders*' });
    if (uberEats) {
      chrome.tabs.reload(uberEats.id!);
    } else {
      uberEats = await chrome.tabs.create({ url: 'https://www.ubereats.com/orders', active: false });
    }
  }
  if (uberRidesHeaders === null) {
    [uberRides] = await chrome.tabs.query({ url: 'https://riders.uber.com/trips*' });
    if (uberRides) {
      chrome.tabs.reload(uberRides.id!);
    } else {
      uberRides = await chrome.tabs.create({ url: 'https://riders.uber.com/trips', active: false });
    }
  }
  if (monarchHeaders === null) {
    [monarch] = await chrome.tabs.query({ url: 'https://app.monarch.com/*' });
    if (monarch) {
      chrome.tabs.reload(monarch.id!);
    } else {
      monarch = await chrome.tabs.create({ url: 'https://app.monarch.com/', active: false });
    }
  }
  // And if any tabs were opened, wait for them to complete
  await new Promise((resolve: any) => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (uberEats !== null && tabId === uberEats.id && info.status === "complete") {
        uberEats = null;
      }
      if (uberRides !== null && tabId === uberRides.id && info.status === "complete") {
        uberRides = null;
      }
      if (monarch !== null && tabId === monarch.id && info.status === "complete") {
        monarch = null;
      }
      if (uberEats === null && uberRides === null && monarch === null) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
};
