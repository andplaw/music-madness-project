// This is a simplified MVP (Minimum Viable Product) for your playlist elimination game
// Technologies used: React (frontend), Node.js + Express (backend), and Socket.IO (for real-time updates)

// File: backend/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // Or your actual frontend domain
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.use(express.json());

const games = {}; // Store games by gameId

io.on('connection', socket => {
  socket.on('createGame', ({ gameId, password, alias }) => {
    if (!games[gameId]) {
      const player = { alias, socketId: socket.id };
      games[gameId] = { 
        players: [player], 
        playlists: [], 
        password, 
        state: 'waiting'
      };
      socket.join(gameId);
      console.log('Game ${gameId} created by ${alias}');

      io.to(gameId).emit('gameCreated', { 
        gameId,
        players: games[gameId].players.map((p) => p.alias),
        gamePhase: games[gameId].state 
      });
    } else {
      socket.emit('error', {message: 'Game ID already exists.'});
    }
  });

  socket.on('joinGame', ({ gameId, alias, password }) => {
    const game = games[gameId];
    if (game && game.password === password && !game.players.some(p => p.alias === alias)) {
      const player = { alias, socketId: socket.id };
      game.players.push(player);
      socket.join(gameId);

      console.log(`Player joined game ${gameId}: ${alias}`);

      io.to(gameId).emit('playerJoined', { 
        alias,
        players: game.players.map(p => p.alias),
        gamePhase: game.gamePhase 
      });
    }
  });

  socket.on('submitPlaylist', ({ gameId, alias, playlist }) => {
    const game = games[gameId];
    if (game) {
      game.playlists.push({ alias, songs: playlist, eliminations: [] });
      io.to(gameId).emit('playlistSubmitted', { alias });
    }
  });

  socket.on('eliminateSong', ({ gameId, alias, playlistIndex, songIndex, commentary }) => {
    const game = games[gameId];
    if (game && game.playlists[playlistIndex]) {
      game.playlists[playlistIndex].eliminations.push({ songIndex, alias, commentary });
      game.playlists[playlistIndex].songs.splice(songIndex, 1);
      io.to(gameId).emit('songEliminated', { playlistIndex });
    }
  });

  socket.on('finalVote', ({ gameId, alias, topTwo }) => {
    const game = games[gameId];
    if (!game.votes) game.votes = [];
    game.votes.push({ alias, topTwo });
    io.to(gameId).emit('voteSubmitted', { alias });
  });
});
