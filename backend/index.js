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
        gamePhase: 'lobby'
      };
      socket.join(gameId);
      console.log(`Game ${gameId} created by ${alias}`);

      io.to(gameId).emit('gameCreated', { 
        gameId,
        players: games[gameId].players.map((p) => p.alias),
        gamePhase: games[gameId].gamePhase 
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

  socket.on('startGame', ({ gameId }) => {
    const game = games[gameId];
    if (game && game.gamePhase === 'lobby') {
      game.gamePhase = 'submission';
      console.log(`Game ${gameId} started. Now accepting playlists.`);

      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: 'submission'
      });
    } else {
      console.log(`Invalid start attempt for game: ${gameId}`);
    }
  });

  socket.on('submitPlaylist', ({ gameId, alias, playlist }) => {
    console.log('submitPlaylist triggered:', alias);
    const game = games[gameId];
    if (!game || game.gamePhase !== 'submission') {
      console.log(`Invalid playlist submission: game=${gameId}, alias=${alias}`);
      return;
    }

    // Prevent duplicates
    const alreadySubmitted = game.playlists?.some(p => p.alias === alias);
    if (alreadySubmitted) {
      console.log(`Duplicate playlist from ${alias} ignored.`);
      return;
    }

    // Store the playlist
    game.playlists = game.playlists || [];
    game.playlists.push({ 
      alias, 
      songs: playlist, 
      eliminations: [] 
    });

    console.log(`${alias} submitted playlist:`, playlist);
    console.log(`Total submitted: ${game.playlists.length}/${game.players.length}`);


    io.to(gameId).emit('playlistSubmitted', { alias });

    console.log('Debug: playlist count =', game.playlists.length);
    console.log('Debug: player count   =', game.players.length);
    console.log('Playlists so far:', game.playlists.map(p => p.alias));
    console.log('Players in game:', game.players.map(p => p.alias));


    // Check if all players have submitted
    if (game.playlists.length === game.players.length) {
      console.log(`All playlists submitted for game ${gameId}`);

      // Assign playlists to each player for elimination
      game.eliminations = [];
      game.assignedPlaylists = assignPlaylistsToPlayers(game);
      console.log('Assignments for round 1:', game.assignedPlaylists);

      // Move to elimination phase
      game.gamePhase = 'elimination_round_1';
      console.log(`Game phase changed to: ${game.gamePhase}`);

      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: game.gamePhase,
        assignedPlaylists: game.assignedPlaylists,
        playlists: game.playlists, // ✅ include playlists
      });

      // Start assigning playlists here
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

  socket.on('submitElimination', ({ gameId, alias, playlistIndex, eliminatedIndex, comment }) => {
    const game = games[gameId];
    if (!game || !game.assignedPlaylists || !game.playlists) return;

    const assignedIndex = game.assignedPlaylists[alias];
    const playlist = game.playlists[assignedIndex];

    playlist.eliminations.push({
      eliminatedIndex,
      comment,
      by: alias
    });

    game.eliminationSubmissions = game.eliminationSubmissions || new Set();
    game.eliminationSubmissions.add(alias);

    console.log(`${alias} eliminated song ${eliminatedIndex} from playlist ${assignedIndex}`);

    // Once all players have submitted
    if (game.eliminationSubmissions.size === game.players.length) {
      // Rotate
      game.eliminationSubmissions.clear();
      rotateAssignments(game);

      // Advance round
      const currentRound = parseInt(game.gamePhase.split('_').pop());
      game.gamePhase = `elimination_round_${currentRound + 1}`;

      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: game.gamePhase,
        assignedPlaylists: game.assignedPlaylists,
        playlists: game.playlists,
      });
    }
  });



  socket.on('finalVote', ({ gameId, alias, topTwo }) => {
    const game = games[gameId];
    if (!game.votes) game.votes = [];
    game.votes.push({ alias, topTwo });
    io.to(gameId).emit('voteSubmitted', { alias });
  });
});

function gamePhaseIsElimination(game) {
  return game.gamePhase && game.gamePhase.startsWith('elimination');
}


function assignPlaylistsToPlayers(game) {
  const assignedPlaylists = {};
  const unassignedPlaylists = [...game.playlists.keys()];
  const aliases = game.players.map(p => p.alias);

  // Initialize history if first round
  if (!game.assignmentHistory) {
    game.assignmentHistory = {};
    for (const alias of aliases) {
      game.assignmentHistory[alias] = [];
    }
  }

  for (const alias of aliases) {
    const history = game.assignmentHistory[alias];
    const available = unassignedPlaylists.filter(idx => {
      const pl = game.playlists[idx];
      return pl.alias !== alias && !history.includes(idx);
    });

    if (available.length === 0) {
      console.warn(`No valid playlist for ${alias}. Assigning randomly (fallback)`);
      assignedPlaylists[alias] = unassignedPlaylists.pop(); // fallback
    } else {
      const choice = available[Math.floor(Math.random() * available.length)];
      assignedPlaylists[alias] = choice;
      unassignedPlaylists.splice(unassignedPlaylists.indexOf(choice), 1);
    }

    // Track assignment
    game.assignmentHistory[alias].push(assignedPlaylists[alias]);
  }

  game.assignedPlaylists = assignedPlaylists;

  return assignedPlaylists
};

function rotateAssignments(game) {
  const total = game.playlists.length;
  const newAssignments = {};

  for (const alias of Object.keys(game.assignedPlaylists)) {
    const prev = game.assignedPlaylists[alias];
    newAssignments[alias] = (prev + 1) % total;
    game.assignmentHistory[alias].push(newAssignments[alias]);
  }

  game.assignedPlaylists = newAssignments;
}


