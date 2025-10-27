import './headers';
import { syncHeaders, getHeader, updateHeadersFromCache, Header } from './headers';
import { fetchUberEats } from './apis/eats';
import { fetchUberRides } from './apis/rides';
import { fetchBayWheels } from './apis/baywheels';
import { getPendingTransactions, applyMonarchDecision, fetchMonarchTags } from './apis/monarch';

// Handle opening the page when you click it
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab?.id) { chrome.tabs.update(tab.id, { active: true }); return; }
  await chrome.tabs.create({ url });
});

// yyyy-mm-dd from freeform
function toISODate(s: string) {
  const d = new Date(s);
  const z = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return z.toISOString().slice(0,10);
}
function daysBetween(a: string, b: string) {
  const da = new Date(a), db = new Date(b);
  return Math.round((db.getTime() - da.getTime())/86400000);
}

function getShortName(locations: { [key: string ]: string }, waypoint: string): [string | null, boolean] {
  const shortName = locations[waypoint];
  if (shortName !== undefined) {
    return [shortName, (shortName === 'my house' || shortName === 'my old apartment') ? true : false];
  }
  if (waypoint.includes('San Francisco International Airport') || waypoint.includes('San Francisco Airport')) {
    return ['the airport', false];
  }
  if (waypoint.includes('Newark Liberty International Airport')) {
    return ['EWR', false];
  }
  if (waypoint.includes('Boston Logan International')) {
    return ['Logan airport', false];
  }
  return [null, false]; 
}

function generateDescription(locations: { [key: string ]: string }, uber: UberRide) {
  let description = 'Uber from ';

  const waypoints = uber.details!.waypoints;
  const [startName, _isHome] = getShortName(locations, waypoints[0]);
  if (startName) {
    description += startName;
  } else {
    // If it's recent (last 4 months) then put '___' for you to fill it in.
    // Otherwise, assume you're lazy.
    if ((new Date().getTime() - new Date(uber.details!.startTime).getTime()) > 86400000 * 30 * 4) {
      description += waypoints[0].split(',')[0];
    } else {
      description += '___';
    }
  }
  const [endName, isHome] = getShortName(locations, waypoints[waypoints.length - 1]); 
  if (endName) {
    description += (isHome ? ' back to ' : ' to ') + endName;
  } else {
    description += ' to ' + uber.location;
  }

  if (waypoints.length > 2) {
    description += ' via ' + waypoints.slice(1, waypoints.length - 1).map(x => getShortName(locations, x)[0] ?? x).join(' and ');
  }
  return description;
}

// simple matcher by amount and ±2 days
async function matchDataToTxns(
  uberRides: Array<UberRide>,
  uberEats: Array<UberEatsOrder>,
  bayWheels: Array<any>,
  txns: Array<MonarchTransaction>
): Promise<Array<MatchedRow>> {
  const { locations = {} }: { locations: { [key: string ]: string } } = await chrome.storage.sync.get('locations');

  // For Uber Rides
  const usdPool: Array<AnnotatedUberRide & { _amtNum: number }> = [];
  const diffCurrency: Array<AnnotatedUberRide> = [];
  uberRides.forEach(u => {
    let origAmount = u.cost;
    if (origAmount.includes('•')) {
      const [newAmount] = origAmount.split(' • ');
      origAmount = newAmount;
    }
    const date = toISODate(u.details!.startTime);
    const baseDesc = generateDescription(locations, u);

    const pushUSD = (amtStr: string, opts: Partial<AnnotatedUberRide["_norm"]> = {}) => {
      const ann: AnnotatedUberRide = { ...u, _norm: { amount: amtStr, date, description: opts.description ?? baseDesc, isTip: opts.isTip } };
      usdPool.push({ ...ann, _amtNum: Number(amtStr) });
    };
    const pushOtherCurrency = (amtStr: string, opts: Partial<AnnotatedUberRide["_norm"]> = {}) => {
      diffCurrency.push({ ...u, _norm: { amount: amtStr, date, description: opts.description ?? baseDesc, isTip: opts.isTip } });
    };

    // If you're paying in dollars, than we probably have the right amount in Monarch
    const amtStr = '-' + origAmount.replace(/^\$/, '');
    if (origAmount.startsWith('$')) pushUSD(amtStr); else pushOtherCurrency(amtStr);

    // If you tipped, then the cost will differ from the fare.
    // This can either be combined, or reported split out. Above
    // handles the case where the base is split out, we need to handle the
    // case where the tip is split out, or if they're combined
    if (origAmount !== u.details!.fare) {
      // Combined (just set from fare)
      const combined = '-' + u.details!.fare.replace(/^[^\d]/, '');
      u.cost = u.details!.fare;
      if (origAmount.startsWith('$')) pushUSD(combined); else pushOtherCurrency(combined);

      // Just tip (difference of the two)
      const tipValue = parseInt(u.details!.fare.replace(/^[^\d]/, '')) - parseInt(origAmount.replace(/^[^\d]/, ''));
      const tipAmount = (-1 * tipValue).toFixed(2);
      u.cost = origAmount[0] + tipValue.toFixed(2);
      u.location = u.location + ' [TIP]';
      const tipDesc = baseDesc + ' (tip)';
      if (origAmount.startsWith('$')) {
        pushUSD(tipAmount, { description: tipDesc, isTip: true });
      } else {
        pushOtherCurrency(tipAmount, { description: tipDesc, isTip: true });
      }
    }
  });

  const pickBestRide = (cands: Array<AnnotatedUberRide>, t: MonarchTransaction) => {
    let best: AnnotatedUberRide | null = null;
    let bestDelta = 99;
    for (const u of cands) {
      const delta = Math.abs(daysBetween(t.date, u._norm.date || t.date));
      // Larger window for tips because you can leave them
      // days later
      const limit = u._norm.isTip ? 14 : 2; 
      if (delta <= limit && delta < bestDelta) { best = u; bestDelta = delta; }
    }
    return best;
  };

  // For Uber Eats
  const uberEatsPool: Array<UberEatsOrder & { _amtNum: number, isTip: boolean, note: string, }> = [];
  uberEats.forEach(u => {
    const note = `Uber Eats from ${u.storeName}: ` + u.items.join(', ');
    uberEatsPool.push({ ...u, _amtNum: -1 * u.cost / 100, isTip: false, note });
    // If you tipped
    if (u.tip) {
      // Add the tip
      const tip = { ... u};
      tip.cost = u.tip * 100;
      tip.storeName = tip.storeName + ' [TIP]';
      uberEatsPool.push({ ...tip, _amtNum: -1 * u.tip, isTip: true, note: `${note} (tip)` });
      // And add minus the tip
      const withoutTip = { ... u};
      withoutTip.cost = withoutTip.cost - u.tip * 100;
      uberEatsPool.push({ ...withoutTip, _amtNum: -1 * withoutTip.cost / 100, isTip: false, note });
    }
  });

  type AnnotatedUberEatsOrder = UberEatsOrder & {
    _amtNum: number;
    isTip: boolean;
    note: string;
  };

  const pickBestEats = (cands: Array<AnnotatedUberEatsOrder>, t: MonarchTransaction): AnnotatedUberEatsOrder | null => {
    let best: AnnotatedUberEatsOrder | null = null;
    let bestDelta = 99;
    for (const u of cands) {
      const delta = Math.abs(daysBetween(t.date, u.date));
      if (delta <= 5 && delta < bestDelta) { best = u; bestDelta = delta; }
    }
    return best;
  };

  // For Bay wheels
  type AnnotatedBayWheelsRide = BayWheelsRide & {
    _amtNum: number,
    _dayString: string,
  };

  const bayWheelsPool: Array<AnnotatedBayWheelsRide> = [];
  bayWheels.forEach(u => {
    bayWheelsPool.push({
      ...u,
      _amtNum: -1 * parseFloat(u.cost.replace(/^\$/, '')),
      _dayString: new Date(u.date).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
      })
      .replace(/\//g, '-'),
    });
  });

  const pickBestBaywheelsRides = (t: MonarchTransaction): Array<AnnotatedBayWheelsRide> => {
    const [, rideNum, date] = t.dataProviderDescription.match(/\*(\d+)\s+RIDES?\s+(\d{1,2}-\d{1,2})/) || [];
    
    // If there's only one transaction, try to find it
    if (!rideNum || parseInt(rideNum) === 1) {
      let best: AnnotatedBayWheelsRide | null = null;
      let bestDelta = 99;
      for (const u of bayWheelsPool.filter(u => u._amtNum === t.amount)) {
        const delta = Math.abs(daysBetween(t.date, u.date));
        if (delta <= 5 && delta < bestDelta) { best = u; bestDelta = delta; }
      }
      if (best) {
        return [best];
      } else {
        return [];
      }
    // Otherwise there are *multiple* transactions
    } else {
      const sameDay = bayWheelsPool.filter(u => u._dayString === date);
      let total = 0;
      for (const ride of sameDay) {
        total += ride._amtNum;
      }
      if (Math.abs(total - t.amount) < 1e-9) {
        return sameDay.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      } else {
        console.log('Failed to find the transaction set', t, bayWheelsPool);
        return [];
      }
    }
  };

  const out: Array<MatchedRow> = [];
  txns.forEach(t => {
    const target = t.amount;

    let warn = false;
    let bestRide: AnnotatedUberRide | null = null;
    let bestEats: AnnotatedUberEatsOrder | null = null;
    let bestBayWheelsRides: Array<AnnotatedBayWheelsRide> = [];
    let suggestedNote = '';
    if (t.dataProviderDescription.startsWith('UBER *TRIP')) {
      bestRide = pickBestRide(usdPool.filter(u => u._amtNum === target), t);

      if (!bestRide) {
        const tol = Math.max(2.50, Math.abs(target) * 0.1); // up to $2.50 is fine
        bestRide = pickBestRide(usdPool.filter(u => Math.abs(u._amtNum - target) <= tol), t);
        if (bestRide) warn = true;
      }

      if (!bestRide) {
        const fxBest = pickBestRide(diffCurrency, t);
        if (fxBest) { bestRide = fxBest; warn = true; }
      }
      if (bestRide) {
        suggestedNote = bestRide._norm.description;
      }
    } else if (t.dataProviderDescription.startsWith('UBER *EATS')) {
      // Exact match
      bestEats = pickBestEats(uberEatsPool.filter(u => u._amtNum === t.amount), t);

      // Some window of 10%
      if (!bestEats) {
        const tol = Math.max(0.50, Math.abs(t.amount) * 0.1); // up to $0.50 is fine
        bestEats = pickBestEats(uberEatsPool.filter(u => Math.abs(u._amtNum - t.amount) <= tol), t);
        if (bestEats) {
          warn = true;
        }
      }

      if (bestEats) {
        suggestedNote = bestEats.note;
      }
    } else if (t.dataProviderDescription.startsWith('LYFT *')) {
      // Exact match
      bestBayWheelsRides = pickBestBaywheelsRides(t);

      if (bestBayWheelsRides.length > 0) {
        const rideText = bestBayWheelsRides.map((r: any) => {
          const start = r.details.startAddress;
          const end = r.details.endAddress;

          const [startName,] = getShortName(locations, start);
          const [endName,] = getShortName(locations, end);
          return `${startName ?? start} to ${endName ?? end}`;
        });
        if (bestBayWheelsRides.length === 1) {
          suggestedNote = `Lyft bike from ${rideText[0]}`;
        } else {
          suggestedNote = 'Multiple Lyft bike rides: ' + rideText.join(', ');
        }
      }
    } else {
      throw new Error('how did you get a transaction from a different merchant?');
    }

    out.push({
      txn: {
        id: t.id,
        amount: t.amount,
        date: t.date,
        accountName: t.account?.displayName || '',
      },
      warn,
      ride: bestRide,
      eats: bestEats,
      bayWheels: bestBayWheelsRides,
      suggestedNote,
    });
  });
  return out;
}

chrome.runtime.onConnect.addListener(async port => {
  if (port.name !== 'fetch') return;
  try {
    port.postMessage({ progress: 'Checking headers…' });
    await syncHeaders();

    // If they're still not set after syncing, we're logged out and we need to get the user to log in
    const headerStatus: Partial<Record<Header, Record<string, string>>> = {};
    let missingHeader = false;
    for (const headerName of Object.values(Header)) {
      const header = getHeader(headerName);
      headerStatus[headerName] = header;
      if (header == null) {
        missingHeader = true;
      }
    }    

    if (missingHeader) {
      port.postMessage({ data: { error: 'Not logged in.', headers: headerStatus}});
      port.disconnect();
      return;
    }

    port.postMessage({ progress: 'Fetching pending transactions from Monarch…' });
    const lookback = 200;
    const pending = await getPendingTransactions({ limit: lookback });
    if (pending.length === 0) {
      port.postMessage({ data: [] });
      port.disconnect();
      return;
    }

    port.postMessage({ progress: 'Fetching Uber and Lyft data…' });
    const uberRideTransactions = pending.filter(x => x.dataProviderDescription.startsWith('UBER *TRIP'));
    const oldestUberEats = pending.filter(x => x.dataProviderDescription.startsWith('UBER *EATS')).at(-1);
    const oldestBayWheels = pending.filter(x => x.dataProviderDescription.startsWith('LYFT *')).at(-1);
    // Look back 5 days older than the oldest transaction
    const [uberRides, uberEats, bayWheels] = await Promise.all([
      uberRideTransactions.length > 0 ? fetchUberRides(lookback, new Date(uberRideTransactions.at(0)!.date).getTime(), new Date(uberRideTransactions.at(-1)!.date).getTime()  - 60 * 60 * 24 * 5) : [],
      oldestUberEats ? fetchUberEats(new Date(oldestUberEats.date).getTime() - 60 * 60 * 24 * 5) : [],
      oldestBayWheels ? fetchBayWheels(new Date(oldestBayWheels.date).getTime() - 60 * 60 * 24 * 5) : [],
    ]);

    port.postMessage({ data: await matchDataToTxns(uberRides, uberEats, bayWheels, pending) });

    port.disconnect();
  } catch (err: any) {
    port.postMessage({ data: { error: String((err as Error)?.message || err) } });
    port.disconnect();
  }
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'applyDecision') return;

    const { transactionId, note, tag } = msg.payload;
    await applyMonarchDecision({ transactionId, note, tag });

    sendResponse({ data: { ok: true } });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'fetchCredentials') return;
    await updateHeadersFromCache();
    // If they're still not set after syncing, we're logged out and we need to get the user to log in
    const headerStatus: Partial<Record<Header, boolean>> = {};
    for (const headerName of Object.values(Header)) {
      headerStatus[headerName] = getHeader(headerName) != null;
    }
    
    sendResponse({ data: headerStatus });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'updateCredentials') return;
    await syncHeaders(true);
    
    sendResponse({ data: { ok: true } });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});

/**
 * TAGS
 */
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'fetchTags') return;

    const { tags = {} }: { tags: { [key: string ]: MonarchTag & { checked: boolean } } } = await chrome.storage.sync.get('tags');
    
    sendResponse({ data: tags });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'updateTags') return;
    const { tags = {} }: { tags: { [key: string ]: MonarchTag & { checked: boolean } } } = await chrome.storage.sync.get('tags');
    const { id, checked } = msg.payload;
    tags[id].checked = checked;
    await chrome.storage.sync.set({ tags });

    sendResponse({ data: { ok: true } });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'syncTags') return;

    const monarchTags = await fetchMonarchTags();
    const { tags = {} }: { tags: { [key: string ]: MonarchTag & { checked: boolean } } } = await chrome.storage.sync.get('tags');
    
    const newTags: { [key: string ]: MonarchTag & { checked: boolean } } = {};
    for (const monarchTag of monarchTags) {
      newTags[monarchTag.id] = { ...monarchTag, checked: tags[monarchTag.id]?.checked ?? false };
    }

    await chrome.storage.sync.set({ tags: newTags });
    
    sendResponse({ data: newTags });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});

/**
 * LOCATIONS
 */
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'fetchLocations') return;

    const { locations = {} }: { locations: { [key: string ]: string } } = await chrome.storage.sync.get('locations');
    
    sendResponse({ data: locations });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'updateLocations') return;
    
    await chrome.storage.sync.set({ locations: msg.payload.locations });

    sendResponse({ data: { ok: true } });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});
