const state = {
  auction: null,
  highestBid: null,
  highestBidder: null,
  bidCount: 0,
  bids: [],
  adminBids: [],
  adminPass: null,
  sse: null,
  endTicker: null,
  placingBid: false
};

const els = {
  auctionSection: document.getElementById('auction-section'),
  auctionActive: document.getElementById('auction-active'),
  auctionEmpty: document.getElementById('auction-empty'),
  auctionTitle: document.getElementById('auction-title'),
  auctionStatus: document.getElementById('auction-status'),
  auctionDescription: document.getElementById('auction-description'),
  auctionPhoto: document.getElementById('auction-photo'),
  auctionEndtime: document.getElementById('auction-endtime'),
  currentPrice: document.getElementById('current-price'),
  highestBidder: document.getElementById('highest-bidder'),
  bidCount: document.getElementById('bid-count'),
  bidHistory: document.getElementById('bid-history'),
  bidControls: document.getElementById('bid-controls'),
  quickBidButtons: Array.from(document.querySelectorAll('.quick-bid')),
  customBidForm: document.getElementById('custom-bid-form'),
  customBidInput: document.getElementById('custom-bid-input'),
  placeBidBtn: document.getElementById('place-bid-btn'),
  bidFeedback: document.getElementById('bid-feedback'),
  nameCapture: document.getElementById('name-capture'),
  nameInput: document.getElementById('bidder-name-input'),
  saveNameBtn: document.getElementById('save-name-btn'),
  nameDisplay: document.getElementById('bidder-name-display'),
  nameText: document.getElementById('bidder-name-text'),
  changeNameBtn: document.getElementById('change-name-btn'),
  adminUnlockForm: document.getElementById('admin-unlock-form'),
  adminPassInput: document.getElementById('admin-pass-input'),
  adminFeedback: document.getElementById('admin-feedback'),
  adminControls: document.getElementById('admin-controls'),
  auctionForm: document.getElementById('auction-form'),
  formTitle: document.getElementById('form-title'),
  formDescription: document.getElementById('form-description'),
  formPhoto: document.getElementById('form-photo'),
  formStartPrice: document.getElementById('form-start-price'),
  formEndTime: document.getElementById('form-end-time'),
  createUpdateBtn: document.getElementById('create-update-btn'),
  resetFormBtn: document.getElementById('reset-form-btn'),
  endAuctionBtn: document.getElementById('end-auction-btn'),
  refreshBidsBtn: document.getElementById('refresh-bids-btn'),
  adminBidLog: document.getElementById('admin-bid-log')
};

const STORAGE_KEYS = {
  bidderName: 'sweetAuctionDisplayName'
};

function centsToDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}

function toCents(value) {
  const number = Number.parseFloat(value);
  if (Number.isNaN(number) || !Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

function ensureIncrement(cents) {
  const increment = 25;
  return Math.ceil(cents / increment) * increment;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  });
}

function formatRelativeTime(iso) {
  const now = Date.now();
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';
  const diff = target - now;
  if (diff <= 0) {
    return 'Auction ended';
  }
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `Ends in ${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `Ends in ${mins}m`;
  }
  const seconds = Math.max(1, Math.floor(diff / 1000));
  return `Ends in ${seconds}s`;
}

function loadDisplayName() {
  const saved = window.localStorage.getItem(STORAGE_KEYS.bidderName);
  if (saved) {
    els.nameText.textContent = saved;
    els.nameDisplay.hidden = false;
    els.nameCapture.hidden = true;
  } else {
    els.nameDisplay.hidden = true;
    els.nameCapture.hidden = false;
  }
}

function saveDisplayName(name) {
  window.localStorage.setItem(STORAGE_KEYS.bidderName, name);
  loadDisplayName();
}

function clearDisplayName() {
  window.localStorage.removeItem(STORAGE_KEYS.bidderName);
  loadDisplayName();
}

function setBidFeedback(message, isError = false) {
  els.bidFeedback.textContent = message || '';
  els.bidFeedback.classList.toggle('error', Boolean(isError));
}

function setBidDisabled(disabled) {
  els.placeBidBtn.disabled = disabled;
  els.customBidInput.disabled = disabled;
  els.quickBidButtons.forEach((btn) => {
    btn.disabled = disabled;
  });
}

function renderAuction() {
  const { auction } = state;
  if (!auction) {
    els.auctionActive.hidden = true;
    els.auctionEmpty.hidden = false;
    setBidDisabled(true);
    els.auctionSection.classList.add('is-empty');
    return;
  }

  els.auctionActive.hidden = false;
  els.auctionEmpty.hidden = true;
  els.auctionSection.classList.remove('is-empty');

  els.auctionTitle.textContent = auction.title;
  els.auctionDescription.textContent = auction.description;
  els.auctionStatus.textContent = auction.status === 'active' ? 'Live auction' : 'Auction ended';
  els.auctionStatus.classList.toggle('ended', auction.status !== 'active');

  if (auction.photoUrl) {
    els.auctionPhoto.src = auction.photoUrl;
    els.auctionPhoto.alt = auction.title;
    els.auctionPhoto.parentElement.hidden = false;
  } else {
    els.auctionPhoto.removeAttribute('src');
    els.auctionPhoto.alt = '';
    els.auctionPhoto.parentElement.hidden = true;
  }

  els.currentPrice.textContent = centsToDollars(state.highestBid ?? auction.startPriceCents);
  els.currentPrice.dataset.value = String(state.highestBid ?? auction.startPriceCents);

  if (state.highestBidder) {
    els.highestBidder.textContent = `Highest bidder: ${state.highestBidder}`;
  } else {
    els.highestBidder.textContent = 'No bids yet';
  }

  if (auction.status !== 'active') {
    els.auctionEndtime.textContent = auction.endTimeUtc
      ? `Auction ended at ${formatTime(auction.endTimeUtc)}`
      : 'Auction ended';
    clearInterval(state.endTicker);
    state.endTicker = null;
    setBidDisabled(true);
  } else if (auction.endTimeUtc) {
    els.auctionEndtime.textContent = `${formatRelativeTime(auction.endTimeUtc)} (ends ${formatTime(
      auction.endTimeUtc
    )})`;
    clearInterval(state.endTicker);
    state.endTicker = setInterval(() => {
      if (!state.auction || state.auction.status !== 'active' || !state.auction.endTimeUtc) {
        clearInterval(state.endTicker);
        state.endTicker = null;
        return;
      }
      els.auctionEndtime.textContent = `${formatRelativeTime(
        state.auction.endTimeUtc
      )} (ends ${formatTime(state.auction.endTimeUtc)})`;
    }, 15000);
    setBidDisabled(false);
  } else {
    els.auctionEndtime.textContent = 'No end time set';
    clearInterval(state.endTicker);
    state.endTicker = null;
    setBidDisabled(false);
  }

  updateBidCount();
}

function renderBidHistory() {
  els.bidHistory.innerHTML = '';
  state.bids.forEach((bid, index) => {
    const li = document.createElement('li');
    li.className = 'bid-row';
    if (index === 0) {
      li.classList.add('latest');
    }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'bidder';
    nameSpan.textContent = bid.bidderName;

    const amountSpan = document.createElement('span');
    amountSpan.className = 'amount';
    amountSpan.textContent = centsToDollars(bid.amountCents);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = formatTime(bid.createdAt);

    li.append(amountSpan, nameSpan, timeSpan);
    els.bidHistory.appendChild(li);
  });

  if (!state.bids.length) {
    const empty = document.createElement('li');
    empty.className = 'bid-row empty';
    empty.textContent = 'No bids yet.';
    els.bidHistory.appendChild(empty);
  }
}

function updateBidCount() {
  if (!state.auction) {
    els.bidCount.textContent = '';
    return;
  }
  const count = state.bidCount || state.bids.length;
  els.bidCount.textContent = count === 1 ? '1 bid' : `${count} bids`;
}

function renderAdminBidLog() {
  els.adminBidLog.innerHTML = '';
  if (!state.adminBids.length) {
    const empty = document.createElement('li');
    empty.className = 'bid-row empty';
    empty.textContent = 'No bids recorded yet.';
    els.adminBidLog.appendChild(empty);
    return;
  }

  state.adminBids.forEach((bid) => {
    const li = document.createElement('li');
    li.className = 'bid-row';
    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = centsToDollars(bid.amountCents);
    const name = document.createElement('span');
    name.className = 'bidder';
    name.textContent = bid.bidderName;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(bid.createdAt);
    li.append(amount, name, time);
    els.adminBidLog.appendChild(li);
  });
}

async function fetchInitialData() {
  try {
    const [auctionRes, bidsRes] = await Promise.all([fetch('/api/auction'), fetch('/api/bids')]);
    const auctionData = await auctionRes.json();
    const bidsData = await bidsRes.json();
    applyState(auctionData);
    state.bids = (bidsData.bids || []).map((bid) => ({
      id: bid.id,
      amountCents: bid.amountCents,
      bidderName: bid.bidderName,
      createdAt: bid.createdAt
    }));
    renderAuction();
    renderBidHistory();
  } catch (error) {
    console.error('Failed to load initial data', error);
    setBidFeedback('Could not load auction data. Try refreshing.', true);
  }
}

function applyState(data) {
  state.auction = data.auction || null;
  state.highestBid = data.highestBid ?? (state.auction ? state.auction.startPriceCents : null);
  state.highestBidder = data.highestBidder || null;
  state.bidCount = data.bidCount || 0;
  renderAuction();
}

function ensureNameSelected() {
  const saved = window.localStorage.getItem(STORAGE_KEYS.bidderName);
  if (saved) return saved;
  els.nameInput.focus();
  setBidFeedback('Please save a display name before bidding.', true);
  return null;
}

async function submitBid(amountCents) {
  if (state.placingBid) return;
  const name = ensureNameSelected();
  if (!name) return;
  if (!state.auction || state.auction.status !== 'active') {
    setBidFeedback('This auction is not accepting bids.', true);
    return;
  }

  const current = state.highestBid ?? state.auction.startPriceCents;
  const minimum = current + 25;
  if (amountCents < minimum) {
    setBidFeedback(
      `Bid must be at least ${centsToDollars(minimum)} (current bid plus $0.25).`,
      true
    );
    return;
  }

  if ((amountCents - state.auction.startPriceCents) % 25 !== 0) {
    setBidFeedback('Bids must be in $0.25 increments.', true);
    return;
  }

  state.placingBid = true;
  setBidDisabled(true);
  setBidFeedback('Submitting bid…');

  try {
    const res = await fetch('/api/bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bidderName: name,
        amountCents
      })
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Bid rejected');
    }

    setBidFeedback('Bid placed! Waiting for confirmation…');
    els.customBidInput.value = '';
  } catch (error) {
    console.error('Bid failed', error);
    setBidFeedback(error.message || 'Bid failed.', true);
  } finally {
    state.placingBid = false;
    if (state.auction && state.auction.status === 'active') {
      setBidDisabled(false);
    }
  }
}

function handleQuickBid(incrementCents) {
  if (!state.auction) return;
  const base = state.highestBid ?? state.auction.startPriceCents;
  const amount = base + incrementCents;
  submitBid(amount);
}

function setupEventListeners() {
  els.saveNameBtn.addEventListener('click', () => {
    const name = els.nameInput.value.trim();
    if (!name) {
      setBidFeedback('Display name is required.', true);
      els.nameInput.focus();
      return;
    }
    saveDisplayName(name);
    setBidFeedback('');
  });

  els.changeNameBtn.addEventListener('click', () => {
    clearDisplayName();
    els.nameInput.focus();
  });

  els.quickBidButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const add = Number.parseInt(btn.dataset.add, 10);
      handleQuickBid(add);
    });
  });

  els.customBidForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.auction) return;
    const centsRaw = toCents(els.customBidInput.value);
    if (centsRaw == null || Number.isNaN(centsRaw) || centsRaw <= 0) {
      setBidFeedback('Enter a valid amount.', true);
      return;
    }
    const normalized = ensureIncrement(centsRaw);
    submitBid(normalized);
  });

  els.adminUnlockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pass = els.adminPassInput.value;
    if (!pass) {
      els.adminFeedback.textContent = 'Passcode is required.';
      return;
    }
    await unlockAdmin(pass);
  });

  els.auctionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.adminPass) return;

    const title = els.formTitle.value.trim();
    const description = els.formDescription.value.trim();
    const photoUrl = els.formPhoto.value.trim();
    const startPriceRaw = toCents(els.formStartPrice.value);
    const endValue = els.formEndTime.value;
    const endTimeUtc = endValue ? new Date(endValue).toISOString() : null;

    if (
      !title ||
      !description ||
      startPriceRaw == null ||
      Number.isNaN(startPriceRaw) ||
      startPriceRaw < 0
    ) {
      els.adminFeedback.textContent = 'Please fill in required fields.';
      return;
    }

    const startPriceCents = ensureIncrement(startPriceRaw);

    const isEditing = !!state.auction && state.auction.status === 'active';
    const method = isEditing ? 'PATCH' : 'POST';
    const body = isEditing
      ? {
          title,
          description,
          photoUrl: photoUrl || null,
          startPriceCents,
          endTimeUtc
        }
      : {
          title,
          description,
          photoUrl: photoUrl || null,
          startPriceCents,
          endTimeUtc
        };

    try {
      els.createUpdateBtn.disabled = true;
      els.adminFeedback.textContent = 'Saving…';
      const res = await fetch('/api/admin/auction', {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pass': state.adminPass
        },
        body: JSON.stringify(body)
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Request failed');
      }
      els.adminFeedback.textContent = 'Saved!';
      if (payload.auction) {
        applyState({
          auction: payload.auction,
          highestBid: payload.auction.startPriceCents,
          highestBidder: null,
          bidCount: 0
        });
        updateAdminForm();
        await loadAdminBidLog();
      }
    } catch (error) {
      console.error('Admin save failed', error);
      els.adminFeedback.textContent = error.message || 'Failed to save auction';
    } finally {
      els.createUpdateBtn.disabled = false;
    }
  });

  els.resetFormBtn.addEventListener('click', () => {
    updateAdminForm();
    els.adminFeedback.textContent = '';
  });

  els.endAuctionBtn.addEventListener('click', async () => {
    if (!state.adminPass) return;
    try {
      els.endAuctionBtn.disabled = true;
      const res = await fetch('/api/admin/end', {
        method: 'POST',
        headers: { 'x-admin-pass': state.adminPass }
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Failed to end auction');
      }
      els.adminFeedback.textContent = 'Auction ended.';
    } catch (error) {
      console.error('End auction failed', error);
      els.adminFeedback.textContent = error.message || 'Failed to end auction';
    } finally {
      els.endAuctionBtn.disabled = false;
    }
  });

  els.refreshBidsBtn.addEventListener('click', loadAdminBidLog);
}

function updateAdminForm() {
  const { auction } = state;
  if (!auction) {
    els.formTitle.value = '';
    els.formDescription.value = '';
    els.formPhoto.value = '';
    els.formStartPrice.value = '';
    els.formEndTime.value = '';
    els.createUpdateBtn.textContent = 'Create Auction';
    els.endAuctionBtn.disabled = true;
    return;
  }

  els.formTitle.value = auction.title || '';
  els.formDescription.value = auction.description || '';
  els.formPhoto.value = auction.photoUrl || '';
  els.formStartPrice.value = ((auction.startPriceCents || 0) / 100).toFixed(2);
  if (auction.endTimeUtc) {
    const date = new Date(auction.endTimeUtc);
    const pad = (num) => String(num).padStart(2, '0');
    const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
    els.formEndTime.value = local;
  } else {
    els.formEndTime.value = '';
  }

  if (auction.status === 'active') {
    els.createUpdateBtn.textContent = 'Update Auction';
    els.endAuctionBtn.disabled = false;
  } else {
    els.createUpdateBtn.textContent = 'Create New Auction';
    els.endAuctionBtn.disabled = true;
  }
}

async function unlockAdmin(pass) {
  try {
    els.adminFeedback.textContent = 'Checking…';
    const res = await fetch('/api/admin/bids', {
      headers: { 'x-admin-pass': pass }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.error) || 'Invalid passcode');
    }
    state.adminPass = pass;
    els.adminFeedback.textContent = 'Controls unlocked.';
    els.adminControls.hidden = false;
    els.adminUnlockForm.hidden = true;
    state.adminBids = ((data && data.bids) || []).map((bid) => ({
      id: bid.id,
      amountCents: bid.amountCents,
      bidderName: bid.bidderName,
      createdAt: bid.createdAt
    }));
    renderAdminBidLog();
    updateAdminForm();
  } catch (error) {
    console.error('Admin unlock failed', error);
    els.adminFeedback.textContent = error.message || 'Unable to unlock controls';
  }
}

async function loadAdminBidLog() {
  if (!state.adminPass) return;
  try {
    els.refreshBidsBtn.disabled = true;
    const res = await fetch('/api/admin/bids', {
      headers: { 'x-admin-pass': state.adminPass }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load bid log');
    }
    state.adminBids = (data.bids || []).map((bid) => ({
      id: bid.id,
      amountCents: bid.amountCents,
      bidderName: bid.bidderName,
      createdAt: bid.createdAt
    }));
    renderAdminBidLog();
  } catch (error) {
    console.error('Failed to load admin bid log', error);
    els.adminFeedback.textContent = error.message || 'Failed to load bid log';
  } finally {
    els.refreshBidsBtn.disabled = false;
  }
}

function initSSE() {
  if (state.sse) {
    state.sse.close();
  }
  const es = new EventSource('/api/stream');
  state.sse = es;

  es.addEventListener('state', (event) => {
    const data = JSON.parse(event.data);
    applyState(data);
  });

  es.addEventListener('bid', (event) => {
    const data = JSON.parse(event.data);
    state.highestBid = data.highestBid;
    state.highestBidder = data.highestBidder;
    state.bidCount = data.bidCount;
    if (data.bid) {
      const already = state.bids.find((bid) => bid.id === data.bid.id);
      if (!already) {
        state.bids.unshift({
          id: data.bid.id,
          amountCents: data.bid.amountCents,
          bidderName: data.bid.bidderName,
          createdAt: data.bid.createdAt
        });
        state.bids = state.bids.slice(0, 20);
      }
      if (state.adminPass) {
        const existingAdmin = state.adminBids.find((bid) => bid.id === data.bid.id);
        if (!existingAdmin) {
          state.adminBids.push({
            id: data.bid.id,
            amountCents: data.bid.amountCents,
            bidderName: data.bid.bidderName,
            createdAt: data.bid.createdAt
          });
          state.adminBids.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          renderAdminBidLog();
        }
      }
    }
    renderAuction();
    renderBidHistory();
    updateBidCount();
    setBidDisabled(false);
    setBidFeedback('');
  });

  es.addEventListener('end', (event) => {
    const data = JSON.parse(event.data);
    if (state.auction && data.auctionId === state.auction.id) {
      state.auction.status = 'ended';
      renderAuction();
      setBidFeedback('Auction ended.', true);
    }
  });

  es.onerror = () => {
    setBidFeedback('Connection lost. Retrying…', true);
    setTimeout(initSSE, 5000);
  };
}

function init() {
  loadDisplayName();
  setupEventListeners();
  fetchInitialData();
  initSSE();
}

init();
