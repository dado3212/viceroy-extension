type BayWheelsRide = {
  details: {
    startAddress: string,
    endAddress: string,
  } | null,
  error?: string,
  cost: string,
  date: string,
  id: string,
};

type UberEatsOrder = {
  storeName: string,
  cost: number, // cents - 3142
  tip: number | null, // raw value 3.14
  date: string,
  items: Array<string>,
};

type UberRide = {
  location: string,
  date: string,
  cost: string,
  uuid: string,
  details: UberRideDetails | null,
  error?: string,
};

type UberRideDetails = {
  map: string,
  startTime: string,
  endTime: string,
  waypoints: Array<string>,
  fare: string,
};

type AnnotatedUberRide = UberRide & {
  _norm: {
    amount: string,
    date: string,
    description: string,
    isTip?: boolean,
  }
};

type MonarchTransaction = {
  amount: number, /* -3.4 */
  date: string,
  id: string,
  account?: {
    displayName: string,
  },
  dataProviderDescription: string,
  merchant: {
    id: string,
    name: string,
  },
};

type MonarchTag = {
  id: string,
  name: string,
  color: string,
};

type MatchedRow = {
  txn: {
    id: string,
    amount: number,
    date: string,
    accountName: string,
  },
  warn: boolean,
  ride: AnnotatedUberRide | null,
  eats: UberEatsOrder | null,
  bayWheels: Array<BayWheelsRide>,
  suggestedNote: string,
};