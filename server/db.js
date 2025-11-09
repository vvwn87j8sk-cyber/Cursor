const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'auction.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS auctions (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    photo_url TEXT,
    start_price_cents INTEGER NOT NULL,
    increment_cents INTEGER NOT NULL DEFAULT 25,
    status TEXT NOT NULL CHECK(status IN ('active','ended')),
    end_time_utc TEXT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY,
    auction_id INTEGER NOT NULL REFERENCES auctions(id),
    bidder_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bids_auction_created_at ON bids (auction_id, created_at DESC);
`);

class AuctionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuctionError';
    this.status = status;
  }
}

function getActiveAuction() {
  return db
    .prepare(
      `SELECT * FROM auctions
       WHERE status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get();
}

function getAuctionById(id) {
  return db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);
}

function getHighestBid(auctionId) {
  return db
    .prepare(
      `SELECT id, bidder_name, amount_cents, created_at
       FROM bids
       WHERE auction_id = ?
       ORDER BY amount_cents DESC, created_at ASC
       LIMIT 1`
    )
    .get(auctionId);
}

function getBidCount(auctionId) {
  const row = db
    .prepare('SELECT COUNT(*) as count FROM bids WHERE auction_id = ?')
    .get(auctionId);
  return row ? row.count : 0;
}

function listRecentBids(auctionId, limit = 20) {
  return db
    .prepare(
      `SELECT id, auction_id, bidder_name, amount_cents, created_at
       FROM bids
       WHERE auction_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(auctionId, limit);
}

const createAuctionTx = db.transaction((auction) => {
  db.prepare(`UPDATE auctions SET status = 'ended' WHERE status = 'active'`).run();

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO auctions
      (title, description, photo_url, start_price_cents, increment_cents, status, end_time_utc, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  );

  const info = insert.run(
    auction.title,
    auction.description,
    auction.photo_url,
    auction.start_price_cents,
    auction.increment_cents || 25,
    auction.end_time_utc,
    now
  );

  return getAuctionById(info.lastInsertRowid);
});

function createAuction(payload) {
  return createAuctionTx(payload);
}

function updateAuction(fields) {
  const active = getActiveAuction();
  if (!active) {
    throw new AuctionError('No active auction to update', 404);
  }

  const columns = [];
  const values = [];

  const allowed = {
    title: 'title',
    description: 'description',
    photoUrl: 'photo_url',
    startPriceCents: 'start_price_cents',
    endTimeUtc: 'end_time_utc',
    status: 'status'
  };

  Object.entries(fields).forEach(([key, value]) => {
    const column = allowed[key];
    if (column !== undefined && value !== undefined) {
      columns.push(`${column} = ?`);
      values.push(value);
    }
  });

  if (!columns.length) {
    return active;
  }

  values.push(active.id);

  db.prepare(`UPDATE auctions SET ${columns.join(', ')} WHERE id = ?`).run(values);

  return getAuctionById(active.id);
}

function endAuction() {
  const active = getActiveAuction();
  if (!active) {
    throw new AuctionError('No active auction to end', 404);
  }
  db.prepare(`UPDATE auctions SET status = 'ended' WHERE id = ?`).run(active.id);
  return getAuctionById(active.id);
}

const placeBidTx = db.transaction(({ bidderName, amountCents }) => {
  const auction = getActiveAuction();
  if (!auction) {
    throw new AuctionError('No active auction', 409);
  }

  if (auction.status !== 'active') {
    throw new AuctionError('Auction is not active', 409);
  }

  const now = new Date();

  if (auction.end_time_utc) {
    const scheduledEnd = new Date(auction.end_time_utc);
    if (scheduledEnd <= now) {
      db.prepare(`UPDATE auctions SET status = 'ended' WHERE id = ?`).run(auction.id);
      throw new AuctionError('Auction has ended', 409);
    }
  }

  const highest = getHighestBid(auction.id);
  const current = highest ? highest.amount_cents : auction.start_price_cents;
  const increment = auction.increment_cents || 25;

  if (amountCents < current + increment) {
    throw new AuctionError('Bid must be at least current price plus increment', 409);
  }

  if ((amountCents - auction.start_price_cents) % increment !== 0) {
    throw new AuctionError('Bid must be in valid increments', 409);
  }

  const insert = db.prepare(
    `INSERT INTO bids (auction_id, bidder_name, amount_cents, created_at)
     VALUES (?, ?, ?, ?)`
  );

  const createdAt = now.toISOString();
  const info = insert.run(auction.id, bidderName, amountCents, createdAt);

  const bid = {
    id: info.lastInsertRowid,
    auction_id: auction.id,
    bidder_name: bidderName,
    amount_cents: amountCents,
    created_at: createdAt
  };

  const bidCount = getBidCount(auction.id);

  return { auction, bid, bidCount };
});

function placeBid(payload) {
  return placeBidTx(payload);
}

function getLatestAuction() {
  return db
    .prepare(
      `SELECT * FROM auctions
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get();
}

function getAuctionState() {
  const auction = getLatestAuction();
  if (!auction) {
    return { auction: null, highestBid: null, highestBidder: null, bidCount: 0 };
  }

  const highest = getHighestBid(auction.id);
  const bidCount = getBidCount(auction.id);

  return {
    auction,
    highestBid: highest ? highest.amount_cents : auction.start_price_cents,
    highestBidder: highest ? highest.bidder_name : null,
    bidCount
  };
}

function getAllBids(auctionId) {
  return db
    .prepare(
      `SELECT id, auction_id, bidder_name, amount_cents, created_at
       FROM bids
       WHERE auction_id = ?
       ORDER BY created_at ASC`
    )
    .all(auctionId);
}

module.exports = {
  AuctionError,
  createAuction,
  updateAuction,
  endAuction,
  getActiveAuction,
  getLatestAuction,
  getAuctionState,
  listRecentBids,
  getAllBids,
  placeBid
};
