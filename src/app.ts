import { Header, HeaderInfo } from './headers';

// Set up the buttons
const buttons: Partial<Record<Header, HTMLButtonElement>> = {};
for (const header of Object.values(Header)) {
  const button = document.createElement('button');
  button.className = 'mainButton';
  button.style.backgroundColor = HeaderInfo[header].buttonColor;
  button.textContent = `Log in to ${HeaderInfo[header].buttonName}`;
  button.addEventListener('click', async () => window.open(HeaderInfo[header].cookieURL, '_blank'));
  buttons[header] = button;
  (document.getElementById('error') as HTMLDivElement).appendChild(button);
}

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
  let newHTML = '';
  for (const header of Object.values(Header)) {
    newHTML += `${HeaderInfo[header].buttonName}: <span class="status ${data.data[header] ? 'synced' : 'unsynced'}">${data.data[header] ? 'Synced' : 'Unsynced'}</span><br />`;
  }
  document.querySelector('#credentials')!.innerHTML = newHTML;
}

(document.getElementById('credentialsSync') as HTMLButtonElement).addEventListener('click', async () => {
  document.querySelectorAll('#credentials span').forEach(s => {
    s.classList.remove('synced', 'unsynced');
    s.textContent = 'Syncing...';
  })
  await chrome.runtime.sendMessage({ type: 'updateCredentials' });
  await fetchCredentials();
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

async function render(rows: any[]) {
  grid.style.display = 'block';
  grid.innerHTML = `<div class="header">
      <div class="head c1">Monarch</div>
      <div class="head c2">Matched details</div>
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
    monCol.innerHTML = `<b>${new Date(`${r.txn.date}T00:00:00`).toLocaleDateString('en-US')}</b><br />${(-1 * r.txn.amount).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`;
    if (r.warn) monCol.innerHTML += '<br /><b style="color:red">SOFT MATCH</b>';

    let matched = true;
    const detailsCol = document.createElement('div');
    detailsCol.className = 'c2';
    if (r.ride) {
      let html = `<b>${r.ride.location}</b><br />${r.ride.date}<br />${r.ride.cost}<br /><img src="${r.ride.details.map}"><ul>`;
      r.ride.details.waypoints.forEach((w: string) => html += `<li>${w}</li>`); detailsCol.innerHTML = html + '</ul>';
    } else if (r.eats) {
      detailsCol.innerHTML = `<b>${r.eats.storeName}</b><br />${new Date(r.eats.date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).replace(',', ' •')}<br />$${(r.eats.cost / 100).toFixed(2)}<br />${r.eats.items.join(' • ')}`;
    } else if (r.bayWheels) {
      for (const ride of r.bayWheels) {
        detailsCol.innerHTML += `<b>Ride</b><br />${new Date(ride.date).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }).replace(',', ' •')}<br />${ride.cost}<br />From ${ride.details?.startAddress} to ${ride.details?.endAddress}.<br />`;
      }
    } else {
      detailsCol.textContent = '- no match -';
      matched = false;
    };

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
      if (!matched) {
        if (lastPressed === e.target) { } else { result.textContent = 'No matching transaction'; lastPressed = e.target as HTMLButtonElement; return; }
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

    wrap.appendChild(monCol); wrap.appendChild(detailsCol); wrap.appendChild(noteCol); wrap.appendChild(actions); wrap.appendChild(resultCol);
    grid.appendChild(wrap);
  });
}

async function loadAndMatch() {
  error.style.display = 'none';
  statusEl.textContent = 'Loading…';
  try {
    const port = chrome.runtime.connect({ name: 'fetch' });
    port.onMessage.addListener(async msg => {
      if (msg.progress) {
        statusEl.textContent = msg.progress;
      }
      if (msg.data !== undefined) {
        const data = msg.data;
        if (data.error) {
          statusEl.textContent = `Error: ${data.error}`;
          if (data.headers) {
            let text = 'This extension uses your logged in cookies to access Monarch and Uber APIs, but you\'re not logged in. Please navigate to each page and log in:';
            for (const header of Object.keys(data.headers)) {
              buttons[header as Header]!.style.display = !data.headers[header] ? 'inline-block' : 'none';
            }     
            error.querySelector('p')!.innerText = text;
            error.style.display = 'block';
          }
          return;
        }
        await render(data);
        statusEl.textContent = `Loaded ${data.length}`;
      }
    });
  } catch (e: any) {
    console.log(e);
    statusEl.textContent = 'Error: ' + (e?.message || String(e));
  }
}

(document.getElementById('match') as HTMLButtonElement).addEventListener('click', loadAndMatch);
