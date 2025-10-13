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

// utils: small helper to make unique IDs (simple but effective)
function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

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
    console.log('submitPlaylist triggered:', alias, playlist && playlist.length);

    const game = games[gameId];
    if (!game || game.gamePhase !== 'submission') {
      console.log(`Invalid playlist submission: game=${gameId}, alias=${alias}, phase=${game?.gamePhase}`);
      return;
    }

    // Ensure socket has game reference
    socket.gameCode = gameId;

    const player = game.players.find(p => p.id === socket.id);
    if (!player) return console.error('No player found for socket', socket.id);

    // Prevent duplicate submission by alias
    if (game.playlists?.some(p => p.alias === alias)) {
      console.log(`Duplicate playlist from ${alias} ignored.`);
      return;
    }

    // Normalize playlist items
    const normalizedSongs = (playlist || []).map(item => {
      if (!item || typeof item === 'string') {
        const title = (item || '').toString();
        return {
          id: makeId(),
          artist: '',
          title,
          link: '',
          eliminated: false,
          eliminatedRound: null,
          eliminatedBy: null,
          comment: null
        };
      } else {
        return {
          id: item.id || makeId(),
          artist: item.artist || '',
          title: item.title || '',
          link: item.link || '',
          eliminated: false,
          eliminatedRound: null,
          eliminatedBy: null,
          comment: null
        };
      }
    });

    // Store player's playlist
    player.playlist = normalizedSongs;

    // Append to game playlists
    game.playlists = game.playlists || [];
    game.playlists.push({
      alias,
      songs: normalizedSongs,
      eliminationLog: []
    });

    console.log(`${alias} submitted playlist: ${normalizedSongs.length} songs`);
    io.to(gameId).emit('playlistSubmitted', { alias });

    console.log(`Progress: ${game.playlists.length}/${game.players.length}`);
    console.log('Players:', game.players.map(p => p.alias));
    console.log('Playlists so far:', game.playlists.map(p => p.alias));

    // ✅ If everyone submitted, assign & advance
    if (game.playlists.length === game.players.length) {
      console.log(`🎉 All playlists submitted for game ${gameId}`);

      if (!game.assignmentHistory) game.assignmentHistory = {};

      // Build assignments for round 1
      game.assignedPlaylists = assignPlaylistsToPlayers(game);
      game.currentRound = 1;

      const maxSongs = Math.max(...game.playlists.map(p => p.songs?.length || 0));
      game.maxRounds = Math.max(0, maxSongs - 1);

      game.gamePhase = 'elimination_round_1';
      console.log(`Assignments for round 1:`, game.assignedPlaylists);
      console.log(`Game ${gameId} moving to ${game.gamePhase} (maxRounds=${game.maxRounds})`);

      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: game.gamePhase,
        assignedPlaylists: game.assignedPlaylists,
        playlists: game.playlists,
        round: game.currentRound
      });

      console.log('✅ Advanced to elimination_round_1');
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
  // submitElimination: frontend sends { gameId, alias, playlistIndex, eliminatedSongIndex, commentary }
  socket.on('submitElimination', ({ gameId, alias, playlistIndex, eliminatedSongIndex, comment }) => {
    const game = games[gameId];
    if (!game) return;

    if (!game.gamePhase || !game.gamePhase.startsWith('elimination')) {
      console.log(`Rejected elimination (wrong phase) for game=${gameId}, alias=${alias}`);
      return;
    }

    const playlist = game.playlists?.[playlistIndex];
    if (!playlist) {
      console.log(`Invalid playlistIndex ${playlistIndex} from ${alias}`);
      return;
    }

    // Guard index
    if (!Number.isInteger(eliminatedSongIndex) || eliminatedSongIndex < 0 || eliminatedSongIndex >= playlist.songs.length) {
      console.log(`Invalid eliminatedSongIndex ${eliminatedSongIndex} for playlist ${playlistIndex}`);
      return;
    }

    // Mark song as eliminated (do not remove from array)
    const song = playlist.songs[eliminatedSongIndex];
    song.eliminated = true;
    song.eliminatedRound = game.currentRound || 1;
    song.eliminatedBy = alias;
    song.comment = comment || '';

    // Ensure playlist has an eliminationLog array
    playlist.eliminationLog = playlist.eliminationLog || [];
    playlist.eliminationLog.push({
      song: { artist: song.artist, title: song.title, link: song.link },
      eliminatedRound: song.eliminatedRound,
      eliminatedBy: alias,
      comment: comment || ''
    });

    console.log(`Elimination recorded: ${song.title} by ${song.artist}, playlist ${playlistIndex}, round ${song.eliminatedRound}`);

    // Track round submissions
    if (!game.roundSubmissions) game.roundSubmissions = {};
    const roundKey = `r${game.currentRound || 1}`;
    game.roundSubmissions[roundKey] = game.roundSubmissions[roundKey] || new Set();
    game.roundSubmissions[roundKey].add(alias);

    // Broadcast the updated playlists so everyone sees the results
    io.to(gameId).emit('playlistsUpdated', game.playlists);

    // Check if everyone submitted for this round
    const submittedCount = game.roundSubmissions[roundKey].size;
    const totalPlayers = game.players.length;

    console.log(`Round ${game.currentRound}: ${submittedCount}/${totalPlayers} eliminations submitted`);

    if (submittedCount === totalPlayers) {
      console.log(`All eliminations received for round ${game.currentRound}`);
      advanceGamePhase(game, io, gameId);
    }
  });




  // =======================
  // rotateAssignments helper
  // =======================
  function rotateAssignments(game, gameId) {
    // Build indices for playlists
    const total = game.playlists.length;
    const aliases = game.players.map(p => p.alias);

    // Initialize assignmentHistory if necessary
    if (!game.assignmentHistory) {
      game.assignmentHistory = {};
      for (const a of aliases) game.assignmentHistory[a] = [];
    }

    // We'll create a pool of available playlist indices
    const unassigned = [...Array(total).keys()];

    const newAssignments = {};

    // Shuffle aliases order for fairness (optional)
    const aliasOrder = [...aliases];

    // For each alias, pick an available playlist index that:
    // - is not their own playlist (game.playlists[idx].alias !== alias)
    // - and not in their assignmentHistory (if possible)
    for (const alias of aliasOrder) {
      const history = game.assignmentHistory[alias] || [];

      // Filter candidate indices
      const candidates = unassigned.filter(idx => {
        const pl = game.playlists[idx];
        return pl && pl.alias !== alias && !history.includes(idx);
      });

      let chosen;
      if (candidates.length === 0) {
        // fallback: pick any unassigned that isn't their own if possible
        const fallback = unassigned.find(idx => game.playlists[idx].alias !== alias);
        if (fallback !== undefined) chosen = fallback;
        else {
          // desperate fallback: pick any unassigned
          chosen = unassigned[0];
        }
      } else {
        // pick randomly from candidates
        chosen = candidates[Math.floor(Math.random() * candidates.length)];
      }

      // Assign and remove from pool
      newAssignments[alias] = chosen;
      const removeIndex = unassigned.indexOf(chosen);
      if (removeIndex !== -1) unassigned.splice(removeIndex, 1);

      // update history
      if (!game.assignmentHistory[alias]) game.assignmentHistory[alias] = [];
      game.assignmentHistory[alias].push(chosen);
    }

    game.assignedPlaylists = newAssignments;

    // Broadcast new assignments to that game's room
    io.to(gameId).emit('assignmentsUpdated', game.assignedPlaylists);

    console.log(`rotateAssignments: game ${gameId} assignedPlaylists =`, game.assignedPlaylists);
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

function advanceGamePhase(game, io, gameId) {
  const totalPlayers = game.players.length;
  const maxRounds = game.maxRounds || totalPlayers - 1;

  if (!game.currentRound) game.currentRound = 1;

  if (game.currentRound < maxRounds) {
    game.currentRound++;
    game.gamePhase = `elimination_round_${game.currentRound}`;
    rotateAssignments(game, gameId);
    io.to(gameId).emit('gamePhaseChanged', {
      gamePhase: game.gamePhase,
      assignedPlaylists: game.assignedPlaylists,
      playlists: game.playlists,
      round: game.currentRound
    });
    console.log(`Advanced to ${game.gamePhase}`);
  } else {
    game.gamePhase = 'voting';
    io.to(gameId).emit('gamePhaseChanged', {
      gamePhase: 'voting',
      playlists: game.playlists
    });
    console.log(`All elimination rounds complete — moving to voting phase`);
  }
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

