// backend/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.use(express.json());

const games = {}; // store games by gameId

// --- utils
function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

/**
 * Find or re-link a player record for a game.
 * If createIfMissing === true and alias provided, a new player will be created.
 * Returns the player object or null.
 */
function getOrUpdatePlayer(game, socket, alias, createIfMissing = false) {
  if (!game) return null;

  // 1) find by current socket id
  let player = game.players.find(p => p.id === socket.id);
  if (player) return player;

  // 2) find by alias (reconnected client)
  if (alias) {
    player = game.players.find(p => p.alias === alias);
    if (player) {
      console.log(`🔁 Re-linking alias "${alias}" to socket ${socket.id}`);
      player.id = socket.id;
      return player;
    }
  }

  // 3) optionally create
  if (createIfMissing && alias) {
    const newPlayer = { id: socket.id, alias, playlist: null };
    game.players.push(newPlayer);
    console.log(`🆕 Created new player for alias "${alias}" with socket ${socket.id}`);
    return newPlayer;
  }

  return null;
}

/**
 * Assign playlists to players (no player should receive their own).
 * Returns an object mapping alias -> playlistIndex.
 */
function assignPlaylistsToPlayers(game) {
  const assigned = {};
  const total = game.playlists.length;
  const aliases = game.players.map(p => p.alias);

  // initialize assignment history
  if (!game.assignmentHistory) {
    game.assignmentHistory = {};
    for (const a of aliases) game.assignmentHistory[a] = [];
  }

  // pool of indices
  const unassigned = [...Array(total).keys()];

  for (const alias of aliases) {
    const history = game.assignmentHistory[alias] || [];

    // candidates: not their own playlist and not in history
    const candidates = unassigned.filter(idx => {
      const pl = game.playlists[idx];
      return pl && pl.alias !== alias && !history.includes(idx);
    });

    let chosen;
    if (candidates.length === 0) {
      // fallback: take any unassigned not their own
      const fallback = unassigned.find(idx => game.playlists[idx].alias !== alias);
      chosen = fallback !== undefined ? fallback : unassigned[0];
    } else {
      chosen = candidates[Math.floor(Math.random() * candidates.length)];
    }

    assigned[alias] = chosen;
    const removeAt = unassigned.indexOf(chosen);
    if (removeAt !== -1) unassigned.splice(removeAt, 1);

    // update history
    game.assignmentHistory[alias] = game.assignmentHistory[alias] || [];
    game.assignmentHistory[alias].push(chosen);
  }

  game.assignedPlaylists = assigned;
  return assigned;
}

/**
 * Rotate assignments for next round (simple rotate/round-robin)
 */
function rotateAssignments(game, gameId) {
  const aliases = game.players.map(p => p.alias);
  const total = game.playlists.length;
  const newAssignments = {};

  // If no previous assignment, do a simple assignment (index -> index)
  if (!game.assignedPlaylists) {
    for (let i = 0; i < aliases.length; i++) {
      newAssignments[aliases[i]] = i % total;
      game.assignmentHistory = game.assignmentHistory || {};
      game.assignmentHistory[aliases[i]] = game.assignmentHistory[aliases[i]] || [];
      game.assignmentHistory[aliases[i]].push(newAssignments[aliases[i]]);
    }
  } else {
    // shift previous assignment by +1 (mod total)
    for (const alias of aliases) {
      const prev = game.assignedPlaylists[alias];
      const next = (typeof prev === 'number') ? (prev + 1) % total : 0;
      newAssignments[alias] = next;
      game.assignmentHistory = game.assignmentHistory || {};
      game.assignmentHistory[alias] = game.assignmentHistory[alias] || [];
      game.assignmentHistory[alias].push(next);
    }
  }

  game.assignedPlaylists = newAssignments;
  io.to(gameId).emit('assignmentsUpdated', game.assignedPlaylists);
  console.log(`rotateAssignments: game ${gameId} =>`, game.assignedPlaylists);
}

/**
 * Advance to next round or finish game
 */
function advanceGamePhase(game, gameId) {
  const totalPlayers = game.players.length;
  // if maxRounds not calculated, compute as longest playlist length - 1
  if (!game.maxRounds) {
    const maxSongs = Math.max(...game.playlists.map(p => p.songs?.length || 0));
    game.maxRounds = Math.max(0, maxSongs - 1);
  }
  if (!game.currentRound) game.currentRound = 1;

  if (game.currentRound < game.maxRounds) {
    game.currentRound++;
    game.gamePhase = `elimination_round_${game.currentRound}`;
    rotateAssignments(game, gameId);
    io.to(gameId).emit('gamePhaseChanged', {
      gamePhase: game.gamePhase,
      assignedPlaylists: game.assignedPlaylists,
      playlists: game.playlists,
      round: game.currentRound
    });
    console.log(`Advanced to ${game.gamePhase} for game ${gameId}`);
  } else {
    // finish -> voting or final_results
    game.gamePhase = 'final_results';
    io.to(gameId).emit('gamePhaseChanged', {
      gamePhase: game.gamePhase,
      playlists: game.playlists
    });
    console.log(`Game ${gameId} complete -> ${game.gamePhase}`);
  }
}

// --- Socket handlers
io.on('connection', socket => {
  console.log('A user connected:', socket.id);

  // Create game
  socket.on('createGame', ({ gameId, password, alias }) => {
    if (!gameId) {
      socket.emit('error', { message: 'Missing gameId' });
      return;
    }
    if (games[gameId]) {
      socket.emit('error', { message: 'Game already exists' });
      return;
    }

    // create game + initial player
    const player = { id: socket.id, alias, playlist: null };
    games[gameId] = {
      players: [player],
      playlists: [],
      password: password || '',
      gamePhase: 'lobby',
      assignmentHistory: {}
    };

    // link socket
    socket.join(gameId);
    socket.gameId = gameId;

    console.log(`Game ${gameId} created by ${alias} (socket ${socket.id})`);

    io.to(gameId).emit('gameCreated', {
      gameId,
      players: games[gameId].players.map(p => p.alias),
      gamePhase: games[gameId].gamePhase
    });
  });

  // Join game
  socket.on('joinGame', ({ gameId, alias, password }) => {
    if (!gameId) {
      socket.emit('error', { message: 'Missing gameId' });
      return;
    }
    const game = games[gameId];
    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      console.error(`Game ${gameId} not found for join attempt`);
      return;
    }
    // password check
    if (game.password && game.password !== password) {
      socket.emit('error', { message: 'Invalid password' });
      return;
    }

    // re-link or add player
    socket.join(gameId);
    socket.gameId = gameId;
    const player = getOrUpdatePlayer(game, socket, alias, true);

    // if alias conflict (another player already using alias), reject
    const aliasConflict = game.players.some(p => p.alias === alias && p.id !== socket.id);
    if (aliasConflict) {
      socket.emit('error', { message: 'Alias already taken in this game' });
      return;
    }

    console.log(`Player joined game ${gameId}: ${player.alias} (socket ${socket.id})`);

    io.to(gameId).emit('playerJoined', {
      alias: player.alias,
      players: game.players.map(p => p.alias),
      gamePhase: game.gamePhase
    });
  });

  // Start game
  socket.on('startGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    if (game.gamePhase !== 'lobby') {
      socket.emit('error', { message: 'Game already started' });
      return;
    }

    game.gamePhase = 'submission';
    console.log(`Game ${gameId} started. Accepting playlists.`);
    io.to(gameId).emit('gamePhaseChanged', { gamePhase: 'submission' });
  });

  // Submit playlist
  socket.on('submitPlaylist', ({ gameId, alias, playlist }) => {
    console.log('submitPlaylist triggered:', alias, playlist && playlist.length);
    const game = games[gameId];
    if (!game || game.gamePhase !== 'submission') {
      console.log(`Invalid playlist submission: game=${gameId}, alias=${alias}, phase=${game?.gamePhase}`);
      socket.emit('error', { message: 'Invalid phase or game' });
      return;
    }

    // ensure socket is linked
    socket.gameId = gameId;

    // find or create player record
    const player = getOrUpdatePlayer(game, socket, alias, true);
    if (!player) {
      console.error('No player found/created for', alias);
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    // Prevent duplicates by alias
    if (game.playlists?.some(p => p.alias === alias)) {
      console.log(`Duplicate playlist from ${alias} ignored.`);
      socket.emit('error', { message: 'Duplicate playlist' });
      return;
    }

    // Normalize incoming playlist items into song objects
    const normalizedSongs = (playlist || []).map(item => {
      if (!item || typeof item === 'string') {
        return {
          id: makeId(),
          artist: '',
          title: (item || '').toString(),
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

    // store player playlist and append to game.playlists
    player.playlist = normalizedSongs;
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

    // If everyone submitted, assign & advance
    if (game.playlists.length === game.players.length) {
      console.log(`🎉 All playlists submitted for game ${gameId}`);

      // ensure assignment history exists
      if (!game.assignmentHistory) game.assignmentHistory = {};

      // Build assignments for round 1
      game.assignedPlaylists = assignPlaylistsToPlayers(game);
      game.currentRound = 1;

      const maxSongs = Math.max(...game.playlists.map(p => p.songs?.length || 0));
      game.maxRounds = Math.max(0, maxSongs - 1);

      game.gamePhase = 'elimination_round_1';
      console.log('Assignments for round 1:', game.assignedPlaylists);
      console.log(`Game ${gameId} moving to ${game.gamePhase} (maxRounds=${game.maxRounds})`);

      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: game.gamePhase,
        assignedPlaylists: game.assignedPlaylists,
        playlists: game.playlists,
        round: game.currentRound
      });
    }
  });

  // submitElimination: frontend sends { gameId, alias, playlistIndex, eliminatedSongIndex, comment }
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
      advanceGamePhase(game, gameId);
    }
  });

  // finalVote
  socket.on('finalVote', ({ gameId, alias, topTwo }) => {
    const game = games[gameId];
    if (!game.votes) game.votes = [];
    game.votes.push({ alias, topTwo });
    io.to(gameId).emit('voteSubmitted', { alias });
  });

  // Clean disconnect handling (optional but recommended)
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    // we do not remove players from games here to avoid losing game state on accidental reload
  });
}); // end io.on('connection')

// helper exported / used earlier
function gamePhaseIsElimination(game) {
  return game.gamePhase && game.gamePhase.startsWith('elimination');
}
