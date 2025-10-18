
// Listen for the relevant requests, and steal the headers/cookies if it's the first time
let uberEatsHeaders: { [key: string]: string } | null = null;
let uberRidesHeaders: { [key: string]: string } | null = null;
let monarchHeaders: { [key: string]: string } | null = null;

export const getUberEatsHeaders = () => uberEatsHeaders!;
export const getUberRidesHeaders = () => uberRidesHeaders!;
export const getMonarchHeaders = () => monarchHeaders!;

chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    if (
      uberEatsHeaders === null &&
      details.initiator?.includes('ubereats.com') &&
      details.url.includes('https://www.ubereats.com/_p/api')
    ) {
      uberEatsHeaders = Object.fromEntries(
        (details.requestHeaders || []).map(h => [h.name, h.value || ''])
      );
    } else if (
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
      }
    } else if (
      uberRidesHeaders === null &&
      details.initiator?.includes('riders.uber.com') &&
      details.url === 'https://riders.uber.com/graphql'
    ) {
      uberRidesHeaders = Object.fromEntries(
        (details.requestHeaders || []).map(h => [h.name, h.value || ''])
      );
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

// We need the headers, so if the tab's open force refresh it, and if it's not open
// then open it (and wait til they're finished loading)
export const syncHeaders = async () => {
  let [uberEats]: (chrome.tabs.Tab | null)[] = await chrome.tabs.query({ url: 'https://www.ubereats.com/orders*' });
  let [uberRides]: (chrome.tabs.Tab | null)[] = await chrome.tabs.query({ url: 'https://riders.uber.com/trips*' });
  let [monarch]: (chrome.tabs.Tab | null)[] = await chrome.tabs.query({ url: 'https://app.monarch.com/*' });
  if (uberEats) {
    chrome.tabs.reload(uberEats.id!);
  } else {
    uberEats = await chrome.tabs.create({ url: 'https://www.ubereats.com/orders', active: false });
  }
  if (uberRides) {
    chrome.tabs.reload(uberRides.id!);
  } else {
    uberRides = await chrome.tabs.create({ url: 'https://riders.uber.com/trips', active: false });
  }
  if (monarch) {
    chrome.tabs.reload(monarch.id!);
  } else {
    monarch = await chrome.tabs.create({ url: 'https://app.monarch.com/', active: false });
  }
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
