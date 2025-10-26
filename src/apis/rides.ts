import { getHeader, Header } from '../headers';

export async function fetchUberRides(limit = 5, newestRideMs: number, oldestRideMs: number): Promise<Array<UberRide>> {
  const allRides: Array<UberRide> = [];

  let nextPageToken: string | null = null;

  // I think Uber rides default pagination size is 50, so cap like this
  let numRidesFetched = 0;
  let numRequests = 0;
  while (numRequests < Math.floor(limit / 50) + 1) {
    const body = {
      operationName: 'Activities',
      variables: {
        includePast: true,
        limit,
        nextPageToken,
        orderTypes: ['RIDES', 'TRAVEL'],
        profileType: 'PERSONAL',
        endTimeMs: newestRideMs + 1000 * 60 * 60 * 24 * 5, // 5 days older than the most recent transaction time
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
    nextPageToken = json?.data?.activities?.past?.nextPageToken;
    numRidesFetched += rides.length; 
    const ridesWithDetails = (await Promise.all(
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
    allRides.push(...ridesWithDetails);

    if (
      // I think this is what we hit when we stop paginating?
      nextPageToken === null ||
      // Or we fetched enough
      numRidesFetched >= limit || 
      // Or we fetched a ride that's older than the transactions we're looking at
      ridesWithDetails.length === 0 || 
      new Date(ridesWithDetails.at(-1)!.details?.startTime).getTime() < oldestRideMs
    ) {
      break;
    }
    numRequests += 1;
  }
  return allRides;
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
  const resp = await fetch('https://riders.uber.com/graphql', { method: 'POST', headers: getHeader(Header.UberRides)!, body: JSON.stringify(body) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return await resp.json();
}