import './headers';
import { syncHeaders, getUberEatsHeaders, getUberRidesHeaders, getMonarchHeaders, updateHeadersFromCache } from './headers';
import { fetchUberEats } from './apis/eats';
import { fetchUberRides } from './apis/rides';
import { getPendingUberTransactions, applyMonarchDecision, fetchMonarchTags } from './apis/monarch';
import { MERCHANT_IDS, SHORT_NAMES } from './constants';

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

function getShortName(waypoint: string): [string | null, boolean] {
  const shortName = SHORT_NAMES[waypoint];
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

function generateDescription(uber: UberRide) {
  let description = 'Uber from ';

  const waypoints = uber.details!.waypoints;
  const [startName, _isHome] = getShortName(waypoints[0]);
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
  const [endName, isHome] = getShortName(waypoints[waypoints.length - 1]); 
  if (endName) {
    description += (isHome ? ' back to ' : ' to ') + endName;
  } else {
    description += ' to ' + uber.location;
  }

  if (waypoints.length > 2) {
    description += ' via ' + waypoints.slice(1, waypoints.length - 1).map(x => getShortName(x)[0] ?? x).join(' and ');
  }
  return description;
}

// simple matcher by amount and ±2 days
function matchUberDataToTxns(
  uberRides: Array<UberRide>,
  uberEats: Array<UberEatsOrder>,
  txns: Array<MonarchTransaction>
): Array<MatchedRow> {
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
    const baseDesc = generateDescription(u);

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

  const out: Array<MatchedRow> = [];
  txns.forEach(t => {
    const target = t.amount;

    let warn = false;
    let bestRide: AnnotatedUberRide | null = null;
    let bestEats: AnnotatedUberEatsOrder | null = null;
    let suggestedNote = '';
    if (t.merchant.id == MERCHANT_IDS.UBER) {
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
    } else if (t.merchant.id == MERCHANT_IDS.UBER_EATS) {
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
      suggestedNote,
    });
  });
  return out;
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    if (msg.type !== 'fetch') return;
    await syncHeaders();

    // If they're still not set after syncing, we're logged out and we need to get the user to log in
    const uberEatsHeader = getUberEatsHeaders();
    const uberRidesHeader = getUberRidesHeaders();
    const monarchHeader = getMonarchHeaders();
    if (uberEatsHeader == null || uberRidesHeader == null || monarchHeader == null) {
      sendResponse({ error: 'Not logged in.', headers: {
        uberEatsHeader,
        uberRidesHeader,
        monarchHeader,
      }});
      return;
    }
    
    const lookback = 10;
    const pending = await getPendingUberTransactions({ limit: lookback });
    if (pending.length === 0) {
      sendResponse({ data: [] });
      return;
    }
    const oldestUberRide = pending.filter(x => x.merchant.id == MERCHANT_IDS.UBER).at(-1);
    const [uberRides, uberEats] = await Promise.all([
      fetchUberRides(lookback, new Date(pending[0].date).getTime() + 1000 * 60 * 60 * 24 * 5),
      oldestUberRide ? fetchUberEats(new Date(oldestUberRide.date).getTime()) : [],
    ]);
    sendResponse({ data: matchUberDataToTxns(uberRides, uberEats, pending) });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
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
    const uberEatsHeader = getUberEatsHeaders();
    const uberRidesHeader = getUberRidesHeaders();
    const monarchHeader = getMonarchHeaders();
    
    sendResponse({ data: {
      uberEats: uberEatsHeader != null,
      uberRides: uberRidesHeader != null,
      monarch: monarchHeader != null
    } });
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

// Tags
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

    await chrome.storage.sync.set({ tags: newTags })
    
    sendResponse({ data: newTags });
  })().catch(err => sendResponse({ error: String((err as Error)?.message || err) }));
  return true;
});
