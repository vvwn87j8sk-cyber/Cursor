require('dotenv').config();

const express = require('express');
const path = require('path');

const {
  AuctionError,
  createAuction,
  updateAuction,
  endAuction,
  getLatestAuction,
  getAuctionState,
  listRecentBids,
  getAllBids,
  placeBid
} = require('./db');
const { addClient, broadcast, send } = require('./sse');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || '';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

function formatAuction(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    photoUrl: row.photo_url,
    startPriceCents: row.start_price_cents,
    incrementCents: row.increment_cents,
    status: row.status,
    endTimeUtc: row.end_time_utc,
    createdAt: row.created_at
  };
}

function formatBid(row) {
  return {
    id: row.id,
    auctionId: row.auction_id,
    bidderName: row.bidder_name,
    amountCents: row.amount_cents,
    createdAt: row.created_at
  };
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASS) {
    return res.status(500).json({ error: 'Server admin pass not configured.' });
  }
  const header = req.header('x-admin-pass');
  let token = header;

  const auth = req.header('authorization');
  if (!token && auth && auth.toLowerCase().startsWith('bearer ')) {
    token = auth.slice('bearer '.length);
  }

  if (!token || token !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function broadcastState() {
  const state = getAuctionState();
  broadcast('state', {
    auction: formatAuction(state.auction),
    highestBid: state.highestBid,
    highestBidder: state.highestBidder,
    bidCount: state.bidCount
  });
}

app.get('/api/auction', (req, res) => {
  const state = getAuctionState();
  res.json({
    auction: formatAuction(state.auction),
    highestBid: state.highestBid,
    highestBidder: state.highestBidder,
    bidCount: state.bidCount
  });
});

app.get('/api/bids', (req, res) => {
  const limitParam = parseInt(req.query.limit, 10);
  const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;
  const latestAuction = getLatestAuction();
  if (!latestAuction) {
    return res.json({ bids: [] });
  }
  const rows = listRecentBids(latestAuction.id, limit);
  res.json({
    bids: rows.map(formatBid)
  });
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  addClient(res);

  const state = getAuctionState();
  send(res, 'state', {
    auction: formatAuction(state.auction),
    highestBid: state.highestBid,
    highestBidder: state.highestBidder,
    bidCount: state.bidCount
  });
});

app.post('/api/bid', (req, res) => {
  const { bidderName, amountCents } = req.body || {};

  if (typeof bidderName !== 'string' || !bidderName.trim()) {
    return res.status(400).json({ error: 'Bidder name is required' });
  }

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: 'amountCents must be a positive integer' });
  }

  try {
    const result = placeBid({
      bidderName: bidderName.trim().slice(0, 80),
      amountCents
    });

    const payload = {
      bid: formatBid(result.bid),
      highestBid: result.bid.amount_cents,
      highestBidder: result.bid.bidder_name,
      bidCount: result.bidCount
    };

    broadcast('bid', payload);

    res.status(201).json(payload);
  } catch (error) {
    if (error instanceof AuctionError) {
      return res.status(error.status).json({ error: error.message });
    }
    // eslint-disable-next-line no-console
    console.error(error);
    res.status(500).json({ error: 'Failed to place bid' });
  }
});

app.post('/api/admin/auction', requireAdmin, (req, res) => {
  const { title, description, photoUrl, startPriceCents, endTimeUtc } = req.body || {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }
  if (!Number.isInteger(startPriceCents) || startPriceCents < 0) {
    return res.status(400).json({ error: 'startPriceCents must be a non-negative integer' });
  }

  let cleanedEndTime = null;
  if (endTimeUtc) {
    const end = new Date(endTimeUtc);
    if (Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid endTimeUtc' });
    }
    cleanedEndTime = end.toISOString();
  }

  try {
    const auction = createAuction({
      title: title.trim(),
      description: description.trim(),
      photo_url: photoUrl ? photoUrl.trim() : null,
      start_price_cents: startPriceCents,
      increment_cents: 25,
      end_time_utc: cleanedEndTime
    });

    broadcastState();

    res.status(201).json({ auction: formatAuction(auction) });
  } catch (error) {
    if (error instanceof AuctionError) {
      return res.status(error.status).json({ error: error.message });
    }
    // eslint-disable-next-line no-console
    console.error(error);
    res.status(500).json({ error: 'Failed to create auction' });
  }
});

app.patch('/api/admin/auction', requireAdmin, (req, res) => {
  const { title, description, photoUrl, startPriceCents, endTimeUtc, status } = req.body || {};

  const payload = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Title must be a non-empty string' });
    }
    payload.title = title.trim();
  }

  if (description !== undefined) {
    if (typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'Description must be a non-empty string' });
    }
    payload.description = description.trim();
  }

  if (photoUrl !== undefined) {
    if (photoUrl && typeof photoUrl !== 'string') {
      return res.status(400).json({ error: 'photoUrl must be a string' });
    }
    payload.photoUrl = photoUrl ? photoUrl.trim() : null;
  }

  if (startPriceCents !== undefined) {
    if (!Number.isInteger(startPriceCents) || startPriceCents < 0) {
      return res.status(400).json({ error: 'startPriceCents must be a non-negative integer' });
    }
    payload.startPriceCents = startPriceCents;
  }

  if (endTimeUtc !== undefined) {
    if (endTimeUtc === null || endTimeUtc === '') {
      payload.endTimeUtc = null;
    } else {
      const end = new Date(endTimeUtc);
      if (Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid endTimeUtc' });
      }
      payload.endTimeUtc = end.toISOString();
    }
  }

  if (status !== undefined) {
    if (!['active', 'ended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    payload.status = status;
  }

  try {
    const auction = updateAuction(payload);
    broadcastState();
    res.json({ auction: formatAuction(auction) });
  } catch (error) {
    if (error instanceof AuctionError) {
      return res.status(error.status).json({ error: error.message });
    }
    // eslint-disable-next-line no-console
    console.error(error);
    res.status(500).json({ error: 'Failed to update auction' });
  }
});

app.post('/api/admin/end', requireAdmin, (req, res) => {
  try {
    const auction = endAuction();
    const latest = getAuctionState();
    broadcast('end', { auctionId: auction.id });
    broadcast('state', {
      auction: formatAuction(latest.auction),
      highestBid: latest.highestBid,
      highestBidder: latest.highestBidder,
      bidCount: latest.bidCount
    });
    res.json({ auction: formatAuction(auction) });
  } catch (error) {
    if (error instanceof AuctionError) {
      return res.status(error.status).json({ error: error.message });
    }
    // eslint-disable-next-line no-console
    console.error(error);
    res.status(500).json({ error: 'Failed to end auction' });
  }
});

app.get('/api/admin/bids', requireAdmin, (req, res) => {
  const latest = getLatestAuction();
  if (!latest) {
    return res.json({ bids: [] });
  }
  const bids = getAllBids(latest.id).map(formatBid);
  res.json({ bids });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Auction server listening on http://localhost:${PORT}`);
});
