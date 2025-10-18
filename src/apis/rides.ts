import { getUberRidesHeaders } from '../headers';

export async function fetchUberRides(limit = 5, endTimeMs: number): Promise<Array<UberRide>> {
  const body = {
    operationName: 'Activities',
    variables: {
      includePast: true,
      limit,
      orderTypes: ['RIDES', 'TRAVEL'],
      profileType: 'PERSONAL',
      endTimeMs,
    },
    query: `query Activities($cityID: Int, $endTimeMs: Float, $includePast: Boolean = true, $limit: Int = 5, $nextPageToken: String, $orderTypes: [RVWebCommonActivityOrderType!] = [RIDES, TRAVEL], $profileType: RVWebCommonActivityProfileType = PERSONAL, $startTimeMs: Float) {
      activities(cityID: $cityID) {
        cityID
        past(endTimeMs: $endTimeMs, limit: $limit, nextPageToken: $nextPageToken, orderTypes: $orderTypes, profileType: $profileType, startTimeMs: $startTimeMs) @include(if: $includePast) {
          activities {
            description
            subtitle
            title
            uuid
            __typename
          }
          nextPageToken
          __typename
        }
        __typename
      }
    }`,
  };

  const json = await uberQuery(body);

  const rides = json?.data?.activities?.past?.activities || [];
  return (await Promise.all(
    rides
      .map((r: any) => ({ location: r.title, date: r.subtitle, cost: r.description, uuid: r.uuid }))
      .map(async (r: {location: string, date: string, cost: string, uuid: string})  => {
        try {
          return { ...r, details: await fetchTripDetails(r.uuid) };
        } catch (e: any) {
          return { ...r, details: null, error: String(e?.message || e) };
        }
      })
  )).filter((r: UberRide) => !(r.cost.startsWith('$0.00') && !r.details?.fare));
};

async function fetchTripDetails(uuid: string): Promise<UberRideDetails> {
  const body = {
    operationName: 'GetTrip',
    variables: {
      tripUUID: uuid,
    },
    query: `query GetTrip($tripUUID: String!) {
      getTrip(tripUUID: $tripUUID) {
        trip {
          beginTripTime
          dropoffTime
          waypoints
          fare
        }
        mapURL
      }
    }`,
  };

  const json = await uberQuery(body);
  return {
    map: json?.data?.getTrip?.mapURL,
    startTime: json?.data?.getTrip?.trip?.beginTripTime,
    endTime: json?.data?.getTrip?.trip?.dropoffTime,
    waypoints: json?.data?.getTrip?.trip?.waypoints,
    fare: json?.data?.getTrip?.trip?.fare,
  };
}

// ===== GraphQL helpers =====
async function uberQuery(body: unknown): Promise<any> {
  const resp = await fetch('https://riders.uber.com/graphql', { method: 'POST', headers: getUberRidesHeaders()!, body: JSON.stringify(body) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return await resp.json();
}