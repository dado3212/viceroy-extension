
import { getHeader, Header } from '../headers';

export async function fetchUberEats(oldestUnixTime: number): Promise<Array<UberEatsOrder>> {
  const url = "https://www.ubereats.com/_p/api/getPastOrdersV1";

  let body = {
    lastWorkflowUUID: "",
  };

  const allOrders: Array<UberEatsOrder> = [];
  let numRequests = 0;
  while (numRequests < 100) {
    const resp = await fetch(url, { method: 'POST', headers: getHeader(Header.UberEats)!, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    body.lastWorkflowUUID = json.data.orderUuids.at(-1);
    const orders: Array<any> = Object.values(json.data.ordersMap);
    for (const order of orders) {
      allOrders.push({
        storeName: order.storeInfo.title,
        cost: Math.round(order.fareInfo.totalPrice),
        tip: order.fareInfo.checkoutInfo.filter((x: any) => x.label == 'Tip')[0]?.rawValue,
        date: order.baseEaterOrder.completedAt,
        items: order.baseEaterOrder.shoppingCart.items.map((i: any) => {
          if (i.quantity == 1) {
            return i.title;
          } else {
            return `${i.title} (x${i.quantity})`;
          }
        }),
      });
    }
    if (
      // We've fetched an order that is older than the requested time, we can stop paginating
      new Date(orders.at(-1).baseEaterOrder.completedAt).getTime() < oldestUnixTime ||
      !json.data.meta.hasMore
    ) {
      break;
    }
    numRequests += 1;
  }
  return allOrders;
}