// backend/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));

app.use(express.json());

/* -----------------------
   In-memory game storage
   ----------------------- */
const games = {}; // { [gameId]: game }

/* -----------------------
   helpers / utils
   ----------------------- */
function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

/**
 * Find or re-link a player record for a game.
 * If createIfMissing === true and alias provided, a new player will be created.
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
      // re-link socket id
      player.id = socket.id;
      return player;
    }
  }

  // 3) optionally create
  if (createIfMissing && alias) {
    const newPlayer = { id: socket.id, alias, playlist: null, hasSubmittedElimination: false };
    game.players.push(newPlayer);
    return newPlayer;
  }

  return null;
}

/**
 * Assign playlists to players (ensures nobody receives their own playlist).
 * Attempts to avoid repeating prior assignments (assignmentHistory) when possible.
 * Returns mapping alias -> playlistIndex.
 */
function assignPlaylistsToPlayers(game) {
  const aliases = game.players.map(p => p.alias);
  const total = game.playlists.length;

  if (!game.assignmentHistory) {
    game.assignmentHistory = {};
    for (const alias of aliases) {
      game.assignmentHistory[alias] = [];
    }
  }

  // Keep track of which playlists are already assigned this round
  const unassigned = [...Array(total).keys()];
  const assignedPlaylists = {};

  // Shuffle aliases to randomize who picks first
  const shuffledAliases = [...aliases].sort(() => Math.random() - 0.5);

  for (const alias of shuffledAliases) {
    const history = game.assignmentHistory[alias] || [];

    // Filter available playlists: not own, not yet assigned, not in history (if possible)
    let candidates = unassigned.filter(idx => {
      const pl = game.playlists[idx];
      return pl.alias !== alias && !history.includes(idx);
    });

    // If all have been seen before, allow reassigning previously reviewed ones
    if (candidates.length === 0) {
      candidates = unassigned.filter(idx => game.playlists[idx].alias !== alias);
    }

    if (candidates.length === 0) {
      console.warn(`⚠️ No valid playlist for ${alias}. Assigning randomly (fallback).`);
      candidates = unassigned;
    }

    // Pick one randomly from the remaining candidates
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    assignedPlaylists[alias] = chosen;

    // Remove that playlist from pool so no one else gets it this round
    const removeIndex = unassigned.indexOf(chosen);
    if (removeIndex !== -1) unassigned.splice(removeIndex, 1);

    // Update history
    if (!game.assignmentHistory[alias]) game.assignmentHistory[alias] = [];
    game.assignmentHistory[alias].push(chosen);
  }

  game.assignedPlaylists = assignedPlaylists;
  console.log(`🎯 Assigned playlists (unique per round):`, assignedPlaylists);

  return assignedPlaylists;
}



/**
 * Rotate assignments for next round (simple rotate but preserve "no own playlist" rule).
 * This function will try to produce assignments where no player gets own playlist.
 */
function rotateAssignments(game, gameId) {
  const aliases = game.players.map(p => p.alias);
  const total = game.playlists.length;

  if (!game.assignmentHistory) {
    game.assignmentHistory = {};
    for (const alias of aliases) {
      game.assignmentHistory[alias] = [];
    }
  }

  const unassigned = [...Array(total).keys()];
  const newAssignments = {};

  const shuffledAliases = [...aliases].sort(() => Math.random() - 0.5);

  for (const alias of shuffledAliases) {
    const history = game.assignmentHistory[alias] || [];

    let candidates = unassigned.filter(idx => {
      const pl = game.playlists[idx];
      return pl.alias !== alias && !history.includes(idx);
    });

    if (candidates.length === 0) {
      candidates = unassigned.filter(idx => game.playlists[idx].alias !== alias);
    }

    if (candidates.length === 0) {
      candidates = unassigned;
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    newAssignments[alias] = chosen;
    const removeIndex = unassigned.indexOf(chosen);
    if (removeIndex !== -1) unassigned.splice(removeIndex, 1);

    if (!game.assignmentHistory[alias]) game.assignmentHistory[alias] = [];
    game.assignmentHistory[alias].push(chosen);
  }

  game.assignedPlaylists = newAssignments;

  io.to(gameId).emit('assignmentsUpdated', newAssignments);
  console.log(`🔄 Rotated assignments (unique per round):`, newAssignments);
}



/* -----------------------
   Core game lifecycle helpers
   ----------------------- */
function computeMaxRounds(game) {
  // default initial playlists length based on longest playlist
  const maxSongs = Math.max(...game.playlists.map(p => (p.songs?.length || 0)));
  // Number of elimination rounds before 1 remains = initial length - 1
  return Math.max(0, maxSongs - 1);
}

function allPlaylistsHaveOneRemaining(game) {
  return game.playlists.every(pl => (pl.songs.filter(s => !s.eliminated).length === 1));
}

/**
 * Advance the game after a round completes.
 * If final condition reached -> produce final mix and go to final_mix
 * Else rotate assignments and move to next elimination round.
 */
function advanceAfterRound(game, gameId) {
  // Reset per-round hasSubmittedElimination flags
  game.players.forEach(p => p.hasSubmittedElimination = false);
  // If final condition (each playlist now has 1 active song) -> final mix & voting
  if (allPlaylistsHaveOneRemaining(game) || (game.currentRound && game.currentRound >= (game.maxRounds || computeMaxRounds(game)))) {
    // Build final mix: collect the single remaining song from each playlist
    const finalMix = game.playlists.map((pl, idx) => {
      const remaining = pl.songs.find(s => !s.eliminated);
      return {
        playlistIndex: idx,
        originAlias: pl.alias,
        song: remaining || null
      };
    }).filter(x => x.song !== null);

    game.finalMix = finalMix;
    game.gamePhase = 'final_mix';
    io.to(gameId).emit('gamePhaseChanged', {
      gamePhase: game.gamePhase,
      playlists: game.playlists,
      finalMix: game.finalMix
    });
    console.log(`Game ${gameId} moved to final_mix with ${finalMix.length} songs.`);
    return;
  }

  // Otherwise advance to next elimination round
  game.currentRound = (game.currentRound || 1) + 1;
  game.gamePhase = `elimination_round_${game.currentRound}`;
  rotateAssignments(game); // will set game.assignedPlaylists
  io.to(gameId).emit('gamePhaseChanged', {
    gamePhase: game.gamePhase,
    assignedPlaylists: game.assignedPlaylists,
    playlists: game.playlists,
    round: game.currentRound
  });
  console.log(`Advanced ${gameId} to ${game.gamePhase}`);
}

/* -----------------------
   Socket.IO handlers
   ----------------------- */
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

    const player = { id: socket.id, alias, playlist: null, hasSubmittedElimination: false };
    games[gameId] = {
      players: [player],
      playlists: [], // will store { alias, songs: [{...}], eliminationLog: [] }
      password: password || '',
      gamePhase: 'lobby',
      assignedPlaylists: {},
      assignmentHistory: {},
      currentRound: 0,
      maxRounds: 0,
      finalMix: null,
      votes: {}
    };

    socket.join(gameId);
    socket.gameId = gameId;

    console.log(`Game ${gameId} created by ${alias} (socket ${socket.id})`);

    io.to(gameId).emit('gameCreated', {
      gameId,
      players: games[gameId].players.map(p => p.alias),
      gamePhase: games[gameId].gamePhase
    });
  });

  // Rejoin (client should emit on page load if it has saved gameId + alias)
  socket.on('rejoinGame', ({ gameId, alias }) => {
    const game = games[gameId];
    if (!game) {
      socket.emit('rejoinResult', { success: false, message: 'Game not found' });
      return;
    }

    socket.join(gameId);
    socket.gameId = gameId;
    const player = getOrUpdatePlayer(game, socket, alias, true);

    // send back current phase, assignments if any, playlists, round and finalMix
    const payload = {
      success: true,
      gamePhase: game.gamePhase,
      assignedPlaylists: game.assignedPlaylists,
      playlists: game.playlists,
      round: game.currentRound,
      finalMix: game.finalMix
    };

    socket.emit('rejoinResult', payload);
    console.log(`Player ${alias} rejoined game ${gameId} (socket ${socket.id})`);
  });

  // Join game (new player)
  socket.on('joinGame', ({ gameId, alias, password }) => {
    if (!gameId) {
      socket.emit('error', { message: 'Missing gameId' });
      return;
    }
    const game = games[gameId];
    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    // check password
    if (game.password && game.password !== password) {
      socket.emit('error', { message: 'Invalid password' });
      return;
    }

    socket.join(gameId);
    socket.gameId = gameId;

    // ✅ Create player record
    const player = { id: socket.id, alias, playlist: null };
    game.players.push(player);
    socket.join(gameId);
    socket.gameCode = gameId;
    
    // alias conflict check (someone else using alias)
    const conflict = game.players.some(p => p.alias === alias && p.id !== socket.id);
    if (conflict) {
      socket.emit('error', { message: 'Alias already taken' });
      return;
    }

    io.to(gameId).emit('playerJoined', {
      alias: player.alias,
      players: game.players.map(p => p.alias),
      gamePhase: game.gamePhase
    });

    console.log(`✅ Player joined game ${gameId}: ${alias}`);
    console.log(`Current players: ${game.players.map(p => p.alias).join(', ')}`);

  });

  // Start game (host / first player triggers)
  socket.on('startGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game) { socket.emit('error', { message: 'Game not found' }); return; }
    if (game.gamePhase !== 'lobby') { socket.emit('error', { message: 'Game already started' }); return; }

    game.gamePhase = 'submission';
    io.to(gameId).emit('gamePhaseChanged', { gamePhase: 'submission' });
    console.log(`Game ${gameId} started (submission phase)`);
  });

  // Submit playlist
  socket.on('submitPlaylist', ({ gameId, alias, playlist }) => {
    const game = games[gameId];
    if (!game || game.gamePhase !== 'submission') {
      socket.emit('error', { message: 'Invalid game or phase' });
      return;
    }

    socket.gameId = gameId;
    const player = getOrUpdatePlayer(game, socket, alias, true);
    if (!player) { socket.emit('error', { message: 'Player not found' }); return; }

    // Avoid duplicate playlist submissions by alias
    if (game.playlists.some(p => p.alias === alias)) {
      socket.emit('error', { message: 'Playlist already submitted' });
      return;
    }

    // Normalize songs -> ensure each item is an object with id, artist, title, link
    const normalizedSongs = (playlist || []).map(item => {
      if (!item || typeof item === 'string') {
        return { id: makeId(), artist: '', title: (item || '').toString(), link: '', eliminated: false, eliminatedRound: null, eliminatedBy: null, comment: null };
      }
      return { id: item.id || makeId(), artist: item.artist || '', title: item.title || '', link: item.link || '', eliminated: false, eliminatedRound: null, eliminatedBy: null, comment: null };
    });

    player.playlist = normalizedSongs;
    game.playlists.push({ alias, songs: normalizedSongs, eliminationLog: [] });

    io.to(gameId).emit('playlistSubmitted', { alias });
    io.to(gameId).emit('playlistsUpdated', game.playlists);

    console.log(`${alias} submitted a playlist (${normalizedSongs.length} songs). ${game.playlists.length}/${game.players.length} submitted.`);

    // If everyone submitted -> build assignments and start elimination_round_1
    if (game.playlists.length === game.players.length) {
      game.assignedPlaylists = assignPlaylistsToPlayers(game);
      game.currentRound = 1;
      game.maxRounds = computeMaxRounds(game);
      game.gamePhase = `elimination_round_${game.currentRound}`;

      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: game.gamePhase,
        assignedPlaylists: game.assignedPlaylists,
        playlists: game.playlists,
        round: game.currentRound
      });

      console.log(`All playlists in. ${gameId} -> ${game.gamePhase}`);
    }
  });

  // Submit elimination: player eliminates one song from an assigned playlist
  socket.on('submitElimination', ({ gameId, alias, playlistIndex, eliminatedSongIndex, comment }) => {
    const game = games[gameId];
    if (!game) { socket.emit('error', { message: 'Game not found' }); return; }
    if (!game.gamePhase || !game.gamePhase.startsWith('elimination')) {
      socket.emit('error', { message: 'Not in elimination phase' }); return;
    }

    // validate player
    const player = getOrUpdatePlayer(game, socket, alias, false);
    if (!player) { socket.emit('error', { message: 'Player not recognized' }); return; }

    // ensure player is assigned to that playlist
    const assignedIndex = game.assignedPlaylists?.[alias];
    if (assignedIndex === undefined || assignedIndex !== playlistIndex) {
      socket.emit('error', { message: 'You are not assigned to that playlist' }); return;
    }

    const playlist = game.playlists[playlistIndex];
    if (!playlist) { socket.emit('error', { message: 'Playlist not found' }); return; }

    // Protect: player should never be allowed to eliminate from their own playlist (server-side check)
    if (playlist.alias === alias) {
      socket.emit('error', { message: 'Cannot eliminate from your own playlist' }); return;
    }

    // validate song index
    if (!Number.isInteger(eliminatedSongIndex) || eliminatedSongIndex < 0 || eliminatedSongIndex >= playlist.songs.length) {
      socket.emit('error', { message: 'Invalid song index' }); return;
    }

    const song = playlist.songs[eliminatedSongIndex];
    if (!song) { socket.emit('error', { message: 'Song not found' }); return; }
    if (song.eliminated) {
      socket.emit('error', { message: 'Song already eliminated' }); return;
    }

    // mark eliminated on song object (do NOT remove from array)
    song.eliminated = true;
    song.eliminatedRound = game.currentRound || 1;
    song.eliminatedBy = alias;
    song.comment = comment || '';

    // add to playlist's eliminationLog for stable history
    playlist.eliminationLog = playlist.eliminationLog || [];
    playlist.eliminationLog.push({
      songInfo: { artist: song.artist, title: song.title, link: song.link },
      eliminatedRound: song.eliminatedRound,
      eliminatedBy: alias,
      comment: song.comment
    });

    // mark that player submitted this round
    player.hasSubmittedElimination = true;

    // broadcast updated playlists and note per-player submit status
    io.to(gameId).emit('playlistsUpdated', game.playlists);

    // broadcast the fact that this player has submitted elimination (so client can show waiting message)
    io.to(gameId).emit('playerEliminationSubmitted', { alias });

    // check if all players (in game.players) have submitted this round
    const allSubmitted = game.players.every(p => !!p.hasSubmittedElimination);
    console.log(`Round ${game.currentRound}: submission status: ${game.players.map(p => `${p.alias}:${p.hasSubmittedElimination}`).join(', ')}`);

    if (allSubmitted) {
      console.log(`All players submitted eliminations for round ${game.currentRound} in game ${gameId}`);
      // advance to next round OR final mix
      advanceAfterRound(game, gameId);
    }
  });

  // Votes in final_mix: payload { gameId, alias, chosenPlaylistIndex } or chosenSongId
  socket.on('submitVote', ({ gameId, alias, chosen }) => {
    const game = games[gameId];
    if (!game || game.gamePhase !== 'final_mix') { socket.emit('error', { message: 'Not in final mix' }); return; }

    const player = getOrUpdatePlayer(game, socket, alias, false);
    if (!player) { socket.emit('error', { message: 'Player not found' }); return; }

    // record vote (chosen must uniquely identify an entry in game.finalMix)
    game.votes = game.votes || {};
    game.votes[alias] = chosen;

    io.to(gameId).emit('voteSubmitted', { alias });

    // when all players voted -> tally
    const voteCount = Object.keys(game.votes).length;
    if (voteCount === game.players.length) {
      // tally: chosen may be {playlistIndex, songId} or just a song id; allow flexible shape
      const tally = {}; // key->count
      for (const v of Object.values(game.votes)) {
        const key = (typeof v === 'object' && v.playlistIndex !== undefined) ? `pl-${v.playlistIndex}` : String(v);
        tally[key] = (tally[key] || 0) + 1;
      }

      // find winner keys with max votes
      const maxVotes = Math.max(...Object.values(tally));
      const winners = Object.entries(tally).filter(([k, c]) => c === maxVotes).map(([k]) => k);

      // Build a human-friendly result: map winners to song info
      const results = winners.map(w => {
        if (w.startsWith('pl-')) {
          const idx = parseInt(w.slice(3), 10);
          const fm = game.finalMix.find(f => f.playlistIndex === idx);
          return { playlistIndex: idx, originAlias: fm?.originAlias, song: fm?.song, votes: tally[w] };
        } else {
          // if key is song id (fallback)
          const fm = game.finalMix.find(f => f.song && f.song.id === w);
          return { playlistIndex: fm?.playlistIndex, originAlias: fm?.originAlias, song: fm?.song, votes: tally[w] };
        }
      });

      // finalize
      io.to(gameId).emit('finalResults', { results, tally });
      console.log(`Final results for game ${gameId}:`, results);

      // optionally set game state to finished
      game.gamePhase = 'finished';
    }
  });

  // Disconnect: do not remove player records so they can rejoin
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    // (no removal of players; rejoin supported)
  });
});

/* -----------------------
   End of file
   ----------------------- */
