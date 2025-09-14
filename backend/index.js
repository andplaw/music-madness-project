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

  // =======================
  // submitElimination handler
  // =======================
  socket.on("submitElimination", ({ gameId, alias, eliminatedSongId, comment }) => {
    const game = games[gameId];
    if (!game) return;

    const playlistIdx = game.assignedPlaylists[alias];
    const playlist = game.playlists[playlistIdx];
    if (!playlist) return;

    // 1. Remove the eliminated song
    playlist.songs = playlist.songs.filter(s => s.id !== eliminatedSongId);

    // 2. Attach comment to playlist
    if (!playlist.comments) playlist.comments = [];
    playlist.comments.push({ alias, eliminatedSongId, comment });

    // 3. Track that this player submitted
    if (!game.submissionsThisRound) game.submissionsThisRound = {};
    game.submissionsThisRound[alias] = true;

    // 4. Notify all clients of updated playlists + comments
    io.to(gameId).emit("playlistsUpdated", game.playlists);

    // 5. Check if all players have submitted
    const allSubmitted = game.players.every(p => game.submissionsThisRound[p.alias]);
    if (allSubmitted) {
      game.currentRound = (game.currentRound || 1);

      if (game.currentRound < game.maxRounds) {
        // Advance to next round
        rotateAssignments(game);
        game.currentRound++;
        game.submissionsThisRound = {}; // reset for next round
        game.phase = `elimination_round_${game.currentRound}`;
        io.to(gameId).emit("phaseChange", { phase: game.phase, round: game.currentRound });
      } else {
        // End game
        game.phase = "voting";
        io.to(gameId).emit("phaseChange", { phase: "voting" });
      }
    }
  });


  // =======================
  // rotateAssignments helper
  // =======================
  function rotateAssignments(game) {
    const assignedPlaylists = {};
    const unassignedPlaylists = [...game.playlists.keys()];
    const aliases = game.players.map(p => p.alias);

    for (const alias of aliases) {
      const history = game.assignmentHistory[alias] || [];
      const available = unassignedPlaylists.filter(idx => {
        const pl = game.playlists[idx];
        return pl.alias !== alias && !history.includes(idx);
      });

      let choice;
      if (available.length === 0) {
        // Fallback: allow repeats
        console.warn(`No valid playlist for ${alias} in round ${game.currentRound}. Using fallback.`);
        choice = unassignedPlaylists[Math.floor(Math.random() * unassignedPlaylists.length)];
      } else {
        choice = available[Math.floor(Math.random() * available.length)];
      }

      assignedPlaylists[alias] = choice;
      unassignedPlaylists.splice(unassignedPlaylists.indexOf(choice), 1);

      // Update history
      if (!game.assignmentHistory[alias]) game.assignmentHistory[alias] = [];
      game.assignmentHistory[alias].push(choice);
    }

    game.assignedPlaylists = assignedPlaylists;

    // Broadcast new assignments
    io.to(game.gameId).emit("assignmentsUpdated", assignedPlaylists);
  }




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

