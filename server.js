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
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(bodyParser.json());

const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

async function sendToTelegram(text) {
  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text
    }
  );
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

  if (!nickname || !category || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await sendToTelegram(
`🆘 Новое обращение\n\n👤 Ник: ${nickname}\n\n📂 Категория: ${category}\n\n💬 Сообщение:\n${message}`
    );

    res.json({ success: true });

  } catch (error) {
    console.error(
      'Telegram error:',
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false
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
  console.log(`🎮 Amusing Quiz Time Server running on https://backend-1-c25q.onrender.com/`);
  console.log(`WebSocket ready for real-time synchronization`);
});
