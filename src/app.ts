import { TAGS } from './constants';

const grid = document.getElementById('grid') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const error = document.getElementById('error') as HTMLParagraphElement;
const uberRide = error.querySelector('button.uberRide') as HTMLButtonElement;
const uberEats = error.querySelector('button.uberEats') as HTMLButtonElement;
const monarch = error.querySelector('button.monarch') as HTMLButtonElement;

function render(rows: any[]) {
  grid.style.display = 'block';
  grid.innerHTML = `<div class="header">
      <div class="head c1">Monarch</div>
      <div class="head c2">Uber</div>
      <div class="head c3">Suggested note</div>
      <div class="head c4">Actions</div>
      <div class="head c5">Status</div>
    </div>
  `;
  rows.forEach((r) => {
    const wrap = document.createElement('div'); wrap.className = 'row';

    const monCol = document.createElement('div');
    monCol.className = 'c1';
    monCol.innerHTML = `<b>${new Date(r.txn.date).toLocaleDateString('en-US')}</b><br />${(-1 * r.txn.amount).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`;
    if (r.warn) monCol.innerHTML += '<br /><b style="color:red">SOFT MATCH</b>';

    const uberCol = document.createElement('div');
    uberCol.className = 'c2';
    if (r.ride) {
      let html = `<b>${r.ride.location}</b><br />${r.ride.date}<br />${r.ride.cost}<br /><img src="${r.ride.details.map}"><ul>`;
      r.ride.details.waypoints.forEach((w: string) => html += `<li>${w}</li>`); uberCol.innerHTML = html + '</ul>';
    } else if (r.eats) {
      uberCol.innerHTML = `<b>${r.eats.storeName}</b><br />${new Date(r.eats.date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).replace(',', ' •')}<br />$${(r.eats.cost / 100).toFixed(2)}<br />${r.eats.items.join(' • ')}`;
    } else uberCol.textContent = '- no match -';

    const noteCol = document.createElement('div');
    noteCol.className = 'c3';
    const note = document.createElement('textarea'); note.value = r.suggestedNote || '';
    noteCol.appendChild(note);

    const resultCol = document.createElement('div');
    resultCol.className = 'c5';
    const result = document.createElement('span');
    result.className = 'status';
    result.textContent = 'Unmatched';
    resultCol.appendChild(result);
    let lastPressed: HTMLButtonElement | null = null;
    const act = async (e: MouseEvent, tag: string | null) => {
      if (!r.ride && !r.eats) {
        if (lastPressed === e.target) { } else { result.textContent = 'No matching Uber transaction'; lastPressed = e.target as HTMLButtonElement; return; }
      }
      result.textContent = '…';
      result.classList.remove('saved', 'error');
      try {
        await chrome.runtime.sendMessage({ type: 'applyDecision', payload: { transactionId: r.txn.id, note: note.value, tag } });
        result.textContent = 'Saved';
        result.classList.add('saved');
        lastPressed = null;
        // Find the next one, and auto scroll to it for ease of clicking
        const text = (e.target as HTMLButtonElement).textContent.trim();
        const target = Array.from((e.target as HTMLButtonElement).closest('.row')!.nextElementSibling?.querySelectorAll('button') ?? [])
          .find(b => b.textContent.trim() === text);
        if (target) {
          const distance = target.getBoundingClientRect().top - (e.target as HTMLButtonElement).getBoundingClientRect().top;
          window.scrollBy({ top: distance, behavior: 'smooth' });
        }
      } catch (err: any) {
        result.textContent = String(err?.message || err);
        result.classList.add('error');
      }
    };
    const actions = document.createElement('div');
    actions.className = 'c4';
    const mk = (t: string, tag: string | null, color: string | null) => {
      const b = document.createElement('button');
      if (color) {
        b.dataset.color = 'true';
        b.style.setProperty('--tag-color', color);
      } else {
        b.className = 'accept';
      }
      b.textContent = t;
      b.onclick = (e) => act(e, tag);
      return b;
    };
    actions.appendChild(mk('Accept', null, null));
    TAGS.forEach(data => {
      const [tagId, name, color] = data;
      actions.appendChild(mk(name, tagId, color));
    });

    wrap.appendChild(monCol); wrap.appendChild(uberCol); wrap.appendChild(noteCol); wrap.appendChild(actions); wrap.appendChild(resultCol);
    grid.appendChild(wrap);
  });
}

async function loadAndMatch() {
  error.style.display = 'none';
  statusEl.textContent = 'Loading…';
  try {
    const data = await chrome.runtime.sendMessage({ type: 'fetch' });
    if (data.error) {
      statusEl.textContent = `Error: ${data.error}`;
      if (data.headers) {
        let text = 'This extension uses your logged in cookies to access Monarch and Uber APIs, but you\'re not logged in. Please navigate to each page and log in:';
        uberRide.style.display = !data.headers.uberRidesHeader ? 'inline-block' : 'none';
        uberEats.style.display = !data.headers.uberEatsHeader ? 'inline-block' : 'none';
        monarch.style.display = !data.headers.monarchHeader ? 'inline-block' : 'none';        
        error.querySelector('p')!.innerText = text;
        error.style.display = 'block';
      }
      return;
    }
    render(data.data);
    statusEl.textContent = `Loaded ${data.data.length}`;
  } catch (e: any) {
    console.log(e);
    statusEl.textContent = 'Error: ' + (e?.message || String(e));
  }
}

(document.getElementById('match') as HTMLButtonElement).addEventListener('click', loadAndMatch);

uberRide.addEventListener('click', async () => window.open('https://riders.uber.com/trips', '_blank'));
uberEats.addEventListener('click', async () => window.open('https://www.ubereats.com/orders', '_blank'));
monarch.addEventListener('click', async () => window.open('https://app.monarch.com', '_blank'));
