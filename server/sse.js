const HEARTBEAT_INTERVAL_MS = 25000;

const clients = new Set();

function send(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function addClient(res) {
  clients.add(res);
  res.on('close', () => {
    clients.delete(res);
  });
}

function broadcast(event, data) {
  clients.forEach((client) => {
    try {
      send(client, event, data);
    } catch (err) {
      clients.delete(client);
    }
  });
}

setInterval(() => {
  clients.forEach((client) => {
    try {
      client.write(':heartbeat\n\n');
    } catch (err) {
      clients.delete(client);
    }
  });
}, HEARTBEAT_INTERVAL_MS);

module.exports = {
  addClient,
  broadcast,
  send
};
