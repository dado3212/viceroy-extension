// Navbar configuration
const transactions = document.getElementById('transactions-button') as HTMLDivElement;
const settings = document.getElementById('settings-button') as HTMLDivElement;

transactions.addEventListener('click', async () => {
  document.querySelectorAll('.content').forEach(x => { (x as HTMLElement).style.display = 'none'; });
  (document.querySelector('#transactions')as HTMLElement).style.display = 'block';
  transactions.className = 'selected';
  settings.className = '';
});

settings.addEventListener('click', async () => {
  document.querySelectorAll('.content').forEach(x => { (x as HTMLElement).style.display = 'none'; });
  (document.querySelector('#settings')as HTMLElement).style.display = 'block';
  transactions.className = '';
  settings.className = 'selected';

  await fetchCredentials();
  await fetchTags();
  await fetchLocations();
});

/* === Settings configuration === */
// Credentials
async function fetchCredentials() {
  const data = await chrome.runtime.sendMessage({ type: 'fetchCredentials' });
  document.querySelector('#credentials')!.innerHTML = `
    Monarch: <span class="status ${data.data.monarch ? 'synced' : 'unsynced'}">${data.data.monarch ? 'Synced' : 'Unsynced'}</span><br />
    Uber Eats: <span class="status ${data.data.uberEats ? 'synced' : 'unsynced'}">${data.data.uberEats ? 'Synced' : 'Unsynced'}</span><br />
    Uber Rides: <span class="status ${data.data.uberRides ? 'synced' : 'unsynced'}">${data.data.uberRides ? 'Synced' : 'Unsynced'}</span>
  `;
}

(document.getElementById('credentialsSync') as HTMLButtonElement).addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'updateCredentials' });
});

// Tags
async function fetchTags() {
  const tags = await chrome.runtime.sendMessage({ type: 'fetchTags' });
  renderTags(tags);
}

async function renderTags(tags: any) {
  if (tags.data) {
    let newHTML = '';
    for (const tagId of Object.keys(tags.data)) {
      newHTML += `
        <label>
          <input value="${tagId}" type="checkbox" ${tags.data[tagId].checked ? 'checked' : ''} />
          <span class="tag-indicator" style="background-color: ${tags.data[tagId].color}" ></span>
          ${tags.data[tagId].name}
        </label>`;
    }
    document.querySelector('#tags')!.innerHTML = newHTML;
    document.querySelectorAll('#tags input').forEach(input => {
      input.addEventListener('change', async () => {
        await chrome.runtime.sendMessage({ type: 'updateTags', payload: { id: (input as HTMLInputElement).value, checked: (input as HTMLInputElement).checked } });
      });
    });
  }
}

(document.getElementById('tagSync') as HTMLButtonElement).addEventListener('click', async () => {
  const tags = await chrome.runtime.sendMessage({ type: 'syncTags' });
  renderTags(tags);
});

// Locations
async function fetchLocations() {
  const data = await chrome.runtime.sendMessage({ type: 'fetchLocations' });
  if (!data.error) {
    let newHTML = '<div id="locations">';
    for (const orig of Object.keys(data.data)) {
      newHTML += `
        <div class="location">
          <input type="text" class="orig" value="${orig}">
          <input type="text" class="short" value="${data.data[orig]}">
          <button class="delete">X</button>
        </div>
      `;
    }
    newHTML += '</div>';
    const locations = document.querySelector('#locationWrapper')!;
    const b = document.createElement('button');
    b.className = 'add';
    b.textContent = '+ Add short name';
    const deleteRow = (btn: Element) => {
      btn.closest('div')!.remove();
    };
    b.onclick = () => {
      const x = document.createElement('button');
      x.textContent = 'X';
      x.className = 'delete';
      x.onclick = () => deleteRow(x);
      const newLocation = document.createElement('div');
      newLocation.className = 'location';
      newLocation.innerHTML = `
        <input type="text" class="orig" value="">
        <input type="text" class="short" value="">
      `;
      newLocation.appendChild(x);
      document.querySelector('#locations')!.appendChild(newLocation);
    };
    locations.innerHTML = newHTML;
    locations.appendChild(b);
    document.querySelectorAll('#locations button.delete').forEach(b => (b as HTMLButtonElement).addEventListener('click', () => deleteRow(b)));
  }
}

(document.getElementById('saveLocations') as HTMLButtonElement).addEventListener('click', async () => {
  const newLocations: { [key: string]: string } = {};
  document.querySelectorAll('#locations .location').forEach(l => {
    const orig = (l.querySelector('.orig') as HTMLInputElement)!.value;
    const short = (l.querySelector('.short') as HTMLInputElement)!.value;
    if (orig !== '' && short !== '') {
      newLocations[orig] = short;
    }
  });
  await chrome.runtime.sendMessage({ type: 'updateLocations', payload: { locations: newLocations } });
});

/* === Transaction configuration === */
const grid = document.getElementById('grid') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const error = document.getElementById('error') as HTMLParagraphElement;
const uberRide = error.querySelector('button.uberRide') as HTMLButtonElement;
const uberEats = error.querySelector('button.uberEats') as HTMLButtonElement;
const monarch = error.querySelector('button.monarch') as HTMLButtonElement;

async function render(rows: any[]) {
  grid.style.display = 'block';
  grid.innerHTML = `<div class="header">
      <div class="head c1">Monarch</div>
      <div class="head c2">Uber</div>
      <div class="head c3">Suggested note</div>
      <div class="head c4">Actions</div>
      <div class="head c5">Status</div>
    </div>
  `;
  const tags = await chrome.runtime.sendMessage({ type: 'fetchTags' });
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
    const mk = (name: string, tag: string | null, color: string | null) => {
      const b = document.createElement('button');
      if (color) {
        b.innerHTML = `<span class="tag-indicator" style="background-color: ${color}" ></span>${name}`;
        b.style.setProperty('--tag-color', color);
      } else {
        b.className = 'accept';
        b.innerHTML = name;
      }
      b.onclick = (e) => act(e, tag);
      return b;
    };
    actions.appendChild(mk('Accept', null, null));
    for (const tagId of Object.keys(tags.data)) {
      if (tags.data[tagId].checked) {
        actions.appendChild(mk(tags.data[tagId].name, tagId, tags.data[tagId].color));
      }
    }

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
    await render(data.data);
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
