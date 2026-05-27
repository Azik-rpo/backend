const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"]
});

app.use(cors({
  origin: "*"
}));
app.use(bodyParser.json());

const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendToTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Telegram BOT_TOKEN or CHAT_ID is not configured');
    return;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    const resp = await axios.post(url, {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML'
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    return resp.data;
  } catch (err) {
    console.error('Telegram send error:', err.response?.data || err.message);
    throw err;
  }
}

// In-memory storage
const rooms = new Map();
const leaderboard = [];
const gameResults = [];

// API: Create room
app.post('/api/rooms', (req, res) => {
  const { quizId, hostName } = req.body;
  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    quizId,
    hostName,
    players: [],
    gameStarted: false,
    currentQuestion: 0,
    created: Date.now()
  };
  rooms.set(roomCode, room);
  res.json({ code: roomCode, room });
});

// API: Join room
app.post('/api/rooms/:code/join', (req, res) => {
  const { code } = req.params;
  const { playerName } = req.body;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const player = { id: uuidv4(), name: playerName, score: 0, answers: [] };
  room.players.push(player);
  res.json({ player, room });
});

// API: Get online leaderboard
app.get('/api/leaderboard', (req, res) => {
  const sorted = leaderboard.sort((a, b) => b.score - a.score).slice(0, 50);
  res.json(sorted);
});

// API: Save game result
app.post('/api/results', (req, res) => {
  const { playerName, score, quizTitle } = req.body;
  const result = { playerName, score, quizTitle, date: new Date().toISOString() };
  gameResults.push(result);
  leaderboard.push(result);
  res.json({ result });
});

app.post('/api/support', async (req, res) => {
  const { nickname, category, message } = req.body;

  console.log('Support request received:', req.body);

  if (!nickname || !category || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const nick = escapeHtml(nickname);
    const cat = escapeHtml(category);
    const msg = escapeHtml(message).replace(/\n/g, '<br>');

    const telegramText = `<b>🆘 Новое обращение</b>\n\n<b>👤 Ник:</b> ${nick}\n\n<b>📂 Категория:</b> ${cat}\n\n<b>💬 Сообщение:</b>\n${msg}`;

    console.log('Sending to Telegram:', { chat_id: CHAT_ID, textPreview: telegramText.slice(0,200) });
    const sendResult = await sendToTelegram(telegramText);
    console.log('Telegram send result:', sendResult);

    return res.json({ success: true, status: 'sent' });
  } catch (error) {
    console.error('Telegram error:', error.response?.data || error.message);
    return res.json({
      success: true,
      warning: 'telegram_failed_but_request_processed'
    });
  }
});

// API: Get recent games
app.get('/api/recent-games', (req, res) => {
  const recent = gameResults.slice(-10).map(r => `${r.playerName} - ${r.score} (${r.quizTitle})`);
  res.json(recent);
});

// WebSocket events
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join-room', (data) => {
    const { code, playerName } = data;
    socket.join(`room-${code}`);
    socket.emit('room-joined', { status: 'success', message: `Добро пожаловать, ${playerName}` });
    io.to(`room-${code}`).emit('player-joined', { playerName, playerId: socket.id });
  });

  socket.on('start-game', (data) => {
    const { code } = data;
    io.to(`room-${code}`).emit('game-started');
  });

  socket.on('answer-submitted', (data) => {
    const { code, questionIndex, answer, score } = data;
    io.to(`room-${code}`).emit('answer-received', { questionIndex, answer });
  });

  socket.on('game-finished', (data) => {
    const { code, playerName, score, quizTitle } = data;
    gameResults.push({ playerName, score, quizTitle, date: new Date().toISOString() });
    leaderboard.push({ playerName, score, quizTitle, date: new Date().toISOString() });
    io.to(`room-${code}`).emit('player-finished', { playerName, score });
    console.log(`Game finished: ${playerName} scored ${score}`);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

function generateRoomCode() {
  const chars = 'ABCDEFGHKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🎮 Server running on https://backend-in5k.onrender.com/");
  console.log('WebSocket ready for real-time synchronization');
});
