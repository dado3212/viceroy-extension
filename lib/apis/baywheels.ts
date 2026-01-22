
import { getHeader, Header } from '../headers';

export async function fetchBayWheels(oldestUnixTime: number): Promise<Array<BayWheelsRide>> {
  let body = {
    operationName: 'GetCurrentUserRides',
    variables: {startTimeMs: `${new Date().getTime()}`},
    query: `query GetCurrentUserRides($startTimeMs: String, $memberId: String) {\n  config {\n    rideHistory {\n      enabled\n      __typename\n    }\n    comembers {\n      enabled\n      __typename\n    }\n    __typename\n  }\n  member(id: $memberId) {\n    id\n    rideHistory(startTimeMs: $startTimeMs) {\n      limit\n      hasMore\n      rideHistoryList {\n        rideId\n        startTimeMs\n        endTimeMs\n        price {\n          formatted\n          __typename\n        }\n        duration\n        rideablePhotoUrl\n        rideableName\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}`,
  };

  const allRides: Array<BayWheelsRide> = [];
  let numRequests = 0;
  while (numRequests < 20) {
    const json = await bayWheelsQuery(body);
    const rides: Array<any> = Object.values(json.data.member.rideHistory.rideHistoryList);
    // 3e4 matches BayWheels website behavior
    body.variables.startTimeMs = `${parseInt(rides.at(-1).startTimeMs) - 3e4}`;
    const ridesWithDetails = (await Promise.all(
      rides
        .map((r: any) => ({ cost: r.price.formatted, date: new Date(parseInt(r.startTimeMs)).toISOString(), id: r.rideId, }))
        .map(async (r: {cost: string, date: string, id: string })  => {
          try {
            return { ...r, details: await fetchTripDetails(r.id) };
          } catch (e: any) {
            return { ...r, details: null, error: String(e?.message || e) };
          }
        })
    ));
    allRides.push(...ridesWithDetails);

    if (
      // We've fetched a ride that is older than the requested time, we can stop paginating
      new Date(parseInt(rides.at(-1).startTimeMs)).getTime() < oldestUnixTime ||
      !json.data.member.rideHistory.hasMore
    ) {
      break;
    }
    numRequests += 1;
  }
  return allRides;
}

async function fetchTripDetails(rideId: string): Promise<{
  startAddress: string,
  endAddress: string,
}> {
  const body = {
    operationName: 'GetCurrentUserRideDetails',
    variables: {rideId},
    query: `query GetCurrentUserRideDetails($rideId: String!) {\n  me {\n    id\n    rideDetails(rideId: $rideId) {\n      rideId\n      startTimeMs\n      endTimeMs\n      price {\n        formatted\n        __typename\n      }\n      startAddressStr\n      endAddressStr\n      paymentBreakdownMap {\n        lineItems {\n          title\n          amount {\n            formatted\n            __typename\n          }\n          __typename\n        }\n        chargeAccount {\n          cardType\n          lastFour\n          clientPaymentMethod\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}`,
  };

  const json = await bayWheelsQuery(body);
  return {
    startAddress: json?.data?.me?.rideDetails?.startAddressStr,
    endAddress: json?.data?.me?.rideDetails?.endAddressStr,
  };
}

async function bayWheelsQuery(body: unknown): Promise<any> {
  const resp = await fetch('https://account.baywheels.com/bikesharefe-gql', { method: 'POST', mode: 'cors', credentials: 'include', headers: getHeader(Header.BayWheels)!, body: JSON.stringify(body) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return await resp.json();
}