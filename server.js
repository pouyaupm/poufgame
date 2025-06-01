const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const rooms = {};

function serveStatic(req, res) {
  const filePath = path.join(__dirname, req.url === '/' ? '/public/index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const type = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css'
    }[ext] || 'text/plain';
    res.writeHead(200, {'Content-Type': type});
    res.end(data);
  });
}

function createRoom(code) {
  if (!rooms[code]) {
    rooms[code] = {
      players: {},
      started: false,
      host: null,
      spy: null,
      watchers: {}
    };
  }
}

function sendJson(res, obj) {
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(obj));
}

function sendTokenUpdate(room, id) {
  const p = room.players[id];
  if (p && p.res) {
    const payload = `event: token-update\ndata: ${JSON.stringify({id, tokens: p.tokens})}\n\n`;
    p.res.write(payload);
  }
}

function handlePost(req, res, body) {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/create-room') {
    const {nickname} = JSON.parse(body);
    let code;
    do {
      code = Math.floor(10000 + Math.random()*90000).toString();
    } while (rooms[code]);
    createRoom(code);
    const room = rooms[code];
    const playerId = Date.now().toString() + Math.random();
    room.players[playerId] = {id: playerId, nickname, tokens: 5, res: null};
    room.host = playerId;
    sendJson(res, {playerId, code});
  } else if (parsed.pathname === '/join-room') {
    const {code, nickname} = JSON.parse(body);
    const room = rooms[code];
    if (!room) return sendJson(res, {error: 'Room not found'});
    const playerId = Date.now().toString() + Math.random();
    room.players[playerId] = {id: playerId, nickname, tokens: 5, res: null};
    broadcast(room, 'player-joined', {id: playerId, nickname});
    sendJson(res, {playerId});
  } else if (parsed.pathname === '/start-game') {
    const {code, playerId} = JSON.parse(body);
    const room = rooms[code];
    if (!room || room.host !== playerId) return sendJson(res, {error: 'Not host'});
    if (room.started) return sendJson(res, {error: 'Already started'});
    const ids = Object.keys(room.players);
    const spy = ids[Math.floor(Math.random() * ids.length)];
    room.spy = spy;
    room.started = true;
    broadcast(room, 'game-start', {spy});
    ids.forEach(id => sendTokenUpdate(room, id));
    sendJson(res, {ok: true});
  } else if (parsed.pathname === '/send-message') {
    const {code, playerId, target, text} = JSON.parse(body);
    const room = rooms[code];
    if (!room) return sendJson(res, {error: 'Room not found'});
    const player = room.players[playerId];
    if (!player) return sendJson(res, {error: 'Bad player'});
    const msg = {from: playerId, text, to: target};
    if (target) {
      const watchers = (room.watchers[playerId] || []).filter(w => w.expire > Date.now());
      room.watchers[playerId] = watchers;
      const ids = [target, playerId, room.spy, ...watchers.map(w=>w.id)];
      const msgWithFlag = watchers.length ? {...msg, intercept:true} : msg;
      broadcast(room, 'private-message', msgWithFlag, ids);
    } else {
      broadcast(room, 'chat-message', msg);
    }
    sendJson(res, {ok: true});
  } else if (parsed.pathname === '/trade') {
    const {code, playerId, target, amount} = JSON.parse(body);
    const room = rooms[code];
    if (!room) return sendJson(res, {error: 'Room not found'});
    const player = room.players[playerId];
    const tgt = room.players[target];
    if (!player || !tgt) return sendJson(res, {error: 'Bad player'});
    if (player.tokens < amount) return sendJson(res, {error: 'Not enough tokens'});
    const trade = {from: playerId, to: target, amount};
    broadcast(room, 'trade-request', trade, [target]);
    sendJson(res, {ok: true});
  } else if (parsed.pathname === '/trade-response') {
    const {code, playerId, from, accept} = JSON.parse(body);
    const room = rooms[code];
    const giver = room.players[from];
    const receiver = room.players[playerId];
    if (!room || !giver || !receiver) return sendJson(res, {error: 'Bad player'});
    if (accept) {
      if (giver.tokens > 0) {
        giver.tokens -= 1;
        receiver.tokens += 1;
      }
    }
    broadcast(room, 'trade-result', {from, to: playerId, accept});
    sendTokenUpdate(room, from);
    sendTokenUpdate(room, playerId);
    sendJson(res, {ok: true});
  } else if (parsed.pathname === '/spy') {
    const {code, playerId, target} = JSON.parse(body);
    const room = rooms[code];
    const player = room && room.players[playerId];
    if (!room || !player || !room.players[target]) return sendJson(res, {error:'Bad player'});
    if (player.tokens <=0) return sendJson(res,{error:'No tokens'});
    player.tokens -=1;
    room.watchers[target] = room.watchers[target] || [];
    room.watchers[target].push({id: playerId, expire: Date.now()+30000});
    sendTokenUpdate(room, playerId);
    sendJson(res,{ok:true});
  } else {
    res.writeHead(404); res.end();
  }
}

function broadcast(room, event, data, targets) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const ids = Array.from(new Set(targets || Object.keys(room.players)));
  ids.forEach(id => {
    const p = room.players[id];
    if (p && p.res) {
      p.res.write(payload);
    }
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  if (req.method === 'GET' && (parsed.pathname === '/' || parsed.pathname.startsWith('/public'))) {
    serveStatic(req, res);
  } else if (req.method === 'GET' && parsed.pathname === '/players') {
    const { code } = parsed.query;
    const room = rooms[code];
    if (!room) { res.writeHead(404); return res.end(); }
    const list = Object.values(room.players).map(p => ({id:p.id, nickname:p.nickname}));
    return sendJson(res, {players: list});
  } else if (req.method === 'GET' && parsed.pathname === '/events') {
    const {code, playerId} = parsed.query;
    const room = rooms[code];
    if (!room || !room.players[playerId]) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection':'keep-alive'});
    room.players[playerId].res = res;
    res.write('\n');
    sendTokenUpdate(room, playerId);
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => handlePost(req, res, body));
  } else {
    res.writeHead(404); res.end();
  }
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
