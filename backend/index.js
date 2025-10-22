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

  // Initialize assignment history if needed
  if (!game.assignmentHistory) {
    game.assignmentHistory = {};
    for (const alias of aliases) {
      game.assignmentHistory[alias] = [];
    }
  }

  const newAssignments = {};
  const unassigned = [...Array(total).keys()];
  const shuffledAliases = [...aliases].sort(() => Math.random() - 0.5);

  for (const alias of shuffledAliases) {
    const history = game.assignmentHistory[alias] || [];

    // 🧩 Step 1 — Filter candidates: not own playlist & not previously assigned
    let candidates = unassigned.filter(idx => {
      const pl = game.playlists[idx];
      return pl.alias !== alias && !history.includes(idx);
    });

    // 🧩 Step 2 — If no completely new options left, allow repeats (still not own)
    if (candidates.length === 0) {
      candidates = unassigned.filter(idx => game.playlists[idx].alias !== alias);
    }

    // 🧩 Step 3 — If still none left (should be extremely rare), assign any remaining
    if (candidates.length === 0) {
      candidates = [...unassigned];
      console.warn(`⚠️ No ideal playlist available for ${alias}; assigning fallback.`);
    }

    // 🧩 Step 4 — Randomly pick one from candidates
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    // 🧩 Step 5 — Assign and update tracking
    newAssignments[alias] = chosen;
    const removeIndex = unassigned.indexOf(chosen);
    if (removeIndex !== -1) unassigned.splice(removeIndex, 1);

    if (!game.assignmentHistory[alias]) game.assignmentHistory[alias] = [];
    game.assignmentHistory[alias].push(chosen);
  }

  game.assignedPlaylists = newAssignments;

  io.to(gameId).emit('assignmentsUpdated', newAssignments);
  console.log(`🔄 Rotated assignments (no self-review, minimal repeats):`, newAssignments);
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

function advanceAfterRound(game, gameId) {

  console.log(`=== advanceAfterRound triggered for game ${gameId} ===`);
  console.log(`Current round before advance: ${game.currentRound}`);
  console.log(`Game phase before advance: ${game.gamePhase}`);
  console.log(`Players in game: ${game.players.map(p => p.alias).join(', ')}`);
  console.log(`Playlists count: ${game.playlists?.length || 0}`);

  // ✅ Unlock the next round before doing anything else
  game._roundLocked = false;
  game.players.forEach(p => (p.hasSubmittedElimination = false));



  if (!game) {
    console.error(`advanceAfterRound called with missing game ${gameId}`);
    return;
  }

  // 🔒 Prevent overlapping transitions
  if (game._advancing) {
    console.warn(`advanceAfterRound called while game ${gameId} is already advancing.`);
    return;
  }
  game._advancing = true;

  // Reset per-round submission flags safely
  game.players.forEach(p => p.hasSubmittedElimination = false);

  // 🔍 Determine if we're entering the final mix
  const isFinalPhase =
    allPlaylistsHaveOneRemaining(game) ||
    (game.currentRound && game.currentRound >= (game.maxRounds || computeMaxRounds(game)));

  if (isFinalPhase) {
    // ✅ Build final mix: collect the last remaining song from each playlist
    const finalMix = game.playlists.map((pl, idx) => {
      const remaining = pl.songs.find(s => !s.eliminated) || pl.songs[pl.songs.length - 1];

      // Defensive guards
      const safeSong = remaining ? {
        id: remaining.id || `song_${idx}`,
        artist: remaining.artist || 'Unknown Artist',
        title: remaining.title || 'Untitled Song',
        link: remaining.link || '',
        eliminated: !!remaining.eliminated,
        eliminatedRound: remaining.eliminatedRound ?? null,
        eliminatedBy: remaining.eliminatedBy ?? null,
        comment: remaining.comment ?? ''
      } : null;

      return {
        playlistIndex: idx,
        originAlias: pl.alias || `Player_${idx + 1}`, // 🧩 FIX: keep alias, not number
        song: safeSong
      };
    }).filter(entry => entry.song);

    game.finalMix = finalMix;
    game.gamePhase = 'final_mix';

    // Normalize elimination logs for all playlists
    game.playlists.forEach(pl => {
      if (!Array.isArray(pl.eliminationLog)) pl.eliminationLog = [];
      pl.eliminationLog = pl.eliminationLog
        .map(e => {
          if (!e) return null;
          if (e.songInfo) return e;
          if (e.song && typeof e.song === 'object')
            return {
              songInfo: e.song,
              eliminatedRound: e.eliminatedRound,
              eliminatedBy: e.eliminatedBy,
              comment: e.comment
            };
          return null;
        })
        .filter(Boolean);
    });

    // Defensive: ensure finalMix exists and is valid before emitting
    if (!Array.isArray(game.finalMix) || game.finalMix.length === 0) {
      console.warn(`⚠️ Game ${gameId}: finalMix is empty or invalid — rebuilding before emit.`);
      game.finalMix = game.playlists.map((pl, idx) => {
        const remaining = pl.songs.find(s => !s.eliminated)
                      || pl.songs[pl.songs.length - 1];

        if (!remaining) return null;

        return {
          playlistIndex: idx,
          originAlias: String(pl.alias),
          song: {
            id: remaining.id || `song_${idx}`,
            artist: remaining.artist || 'Unknown Artist',
            title: remaining.title || 'Untitled Song',
            link: remaining.link || '',
            eliminated: !!remaining.eliminated,
            eliminatedRound: remaining.eliminatedRound || null,
            eliminatedBy: remaining.eliminatedBy || null,
            comment: remaining.comment || ''
          }
        };
      }).filter(Boolean);
    }

    // 🕐 Slight delay to ensure clients handle last elimination renders before final phase
    setTimeout(() => {
      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: game.gamePhase,
        playlists: game.playlists,
        finalMix: game.finalMix
      });
      console.log(`✅ Game ${gameId} moved to final_mix with ${finalMix.length} songs.`);
      game._advancing = false;
    }, 500);

    return;
  }

  // 🔁 Otherwise, move to next elimination round
  game.currentRound = (game.currentRound || 1) + 1;
  game.gamePhase = `elimination_round_${game.currentRound}`;

  // Recompute playlist assignments safely
  rotateAssignments(game);
  if (!game.assignedPlaylists || Object.keys(game.assignedPlaylists).length !== game.players.length) {
    console.error(`🚨 rotateAssignments failed or incomplete for game ${gameId}`);
    console.error('assignedPlaylists:', game.assignedPlaylists);
  }

  game.playlists.forEach(pl => {
    if (!Array.isArray(pl.eliminationLog)) pl.eliminationLog = [];
    pl.eliminationLog = pl.eliminationLog
      .map(e => {
        if (!e) return null;
        if (e.songInfo) return e;
        if (e.song && typeof e.song === 'object')
          return {
            songInfo: e.song,
            eliminatedRound: e.eliminatedRound,
            eliminatedBy: e.eliminatedBy,
            comment: e.comment
          };
        return null;
      })
      .filter(Boolean);
  });

  io.to(gameCode).emit("updateEliminationHistory", game.eliminationHistory);

  // Slight buffer to prevent phase-race conditions
  setTimeout(() => {
    io.to(gameId).emit('gamePhaseChanged', {
      gamePhase: game.gamePhase,
      assignedPlaylists: game.assignedPlaylists,
      playlists: game.playlists,
      round: game.currentRound
    });
    console.log(`➡️ Advanced ${gameId} to ${game.gamePhase}`);
    game._advancing = false;
  }, 300);

  console.log(`=== advanceAfterRound END ===`);
  console.log(`New game phase: ${game.gamePhase}`);
  console.log(`New round: ${game.currentRound}`);

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

  // // Submit elimination: player eliminates one song from an assigned playlist
  // socket.on('submitElimination', ({ gameId, alias, playlistIndex, eliminatedSongIndex, comment }) => {
  //   const game = games[gameId];
  //   if (!game) { socket.emit('error', { message: 'Game not found' }); return; }
  //   if (!game.gamePhase || !game.gamePhase.startsWith('elimination')) {
  //     socket.emit('error', { message: 'Not in elimination phase' }); return;
  //   }

  //   // validate player
  //   const player = getOrUpdatePlayer(game, socket, alias, false);
  //   if (!player) { socket.emit('error', { message: 'Player not recognized' }); return; }

  //   // ensure player is assigned to that playlist
  //   const assignedIndex = game.assignedPlaylists?.[alias];
  //   if (assignedIndex === undefined || assignedIndex !== playlistIndex) {
  //     socket.emit('error', { message: 'You are not assigned to that playlist' }); return;
  //   }

  //   const playlist = game.playlists[playlistIndex];
  //   if (!playlist) { socket.emit('error', { message: 'Playlist not found' }); return; }

  //   // Protect: player should never be allowed to eliminate from their own playlist (server-side check)
  //   if (playlist.alias === alias) {
  //     socket.emit('error', { message: 'Cannot eliminate from your own playlist' }); return;
  //   }

  //   // validate song index
  //   if (!Number.isInteger(eliminatedSongIndex) || eliminatedSongIndex < 0 || eliminatedSongIndex >= playlist.songs.length) {
  //     socket.emit('error', { message: 'Invalid song index' }); return;
  //   }

  //   const song = playlist.songs[eliminatedSongIndex];
  //   if (!song) { socket.emit('error', { message: 'Song not found' }); return; }
  //   if (song.eliminated) {
  //     socket.emit('error', { message: 'Song already eliminated' }); return;
  //   }

  //   // mark eliminated on song object (do NOT remove from array)
  //   song.eliminated = true;
  //   song.eliminatedRound = game.currentRound || 1;
  //   song.eliminatedBy = alias;
  //   song.comment = comment || '';

  //   // add to playlist's eliminationLog for stable history
  //   playlist.eliminationLog = playlist.eliminationLog || [];
  //   playlist.eliminationLog.push({
  //     songInfo: { artist: song.artist, title: song.title, link: song.link },
  //     eliminatedRound: song.eliminatedRound,
  //     eliminatedBy: alias,
  //     comment: song.comment
  //   });

  //   // mark that player submitted this round
  //   player.hasSubmittedElimination = true;
  //   console.log(`Elimination received from ${alias} (socket=${socket.id})`);

  //   // broadcast updated playlists and note per-player submit status
  //   io.to(gameId).emit('playlistsUpdated', game.playlists);
  //   io.to(gameId).emit('playerEliminationSubmitted', { alias });
  //   console.log(`${alias} marked as submitted`);
  //   console.log('Submitted eliminations so far:', game.players.map(p => `${p.alias}:${p.hasSubmittedElimination}`));

  //   // 🧩 Recompute submission map defensively
  //   const aliases = game.players.map(p => p.alias);
  //   const submissionStatus = aliases.map(a => ({
  //     alias: a,
  //     submitted: !!game.players.find(p => p.alias === a)?.hasSubmittedElimination
  //   }));
  //   console.log(`Round ${game.currentRound}: submission status:`, submissionStatus);

  //   // 🧩 Safely check if everyone submitted
  //   const allSubmitted = submissionStatus.every(s => s.submitted === true);

  //   if (allSubmitted) {
  //     console.log(`✅ All players submitted eliminations for round ${game.currentRound} in game ${gameId}`);

  //     // 🔒 Lock phase to prevent duplicate advances
  //     if (game._roundLocked) {
  //       console.warn(`Round ${game.currentRound} already locked for game ${gameId}, skipping duplicate advance.`);
  //       return;
  //     }
  //     game._roundLocked = true;

  //     // 🕐 Small delay gives final player's client time to render their "submission success" state
  //     setTimeout(() => {
  //       try {
  //         // Ensure game still exists and hasn't advanced already
  //         const stillSameGame = games[gameId] && games[gameId].currentRound === game.currentRound;
  //         if (stillSameGame) {
  //           // 🧩 Better diagnostic payload for next phase emission
  //           console.log('Emitting gamePhaseChanged with payload:', {
  //             phase: game.gamePhase,
  //             round: game.currentRound,
  //             assignedPlaylists: game.assignedPlaylists,
  //             playlistCount: game.playlists?.length,
  //             nextAdvancePlanned: game.currentRound + 1
  //           });

  //           advanceAfterRound(game, gameId);

  //         } else {
  //           console.warn(`Skipping advanceAfterRound for ${gameId} — game state already advanced.`);
  //         }
  //       } catch (err) {
  //         console.error(`🚨 Error during advanceAfterRound for ${gameId}:`, err);
  //       }
  //     }, 500); // 0.5s delay — tweak if needed
  //   }
  // });

  socket.on('submitElimination', (payload) => {
    try {
      const { gameId, alias, playlistIndex, eliminatedSongIndex, comment } = payload || {};
      console.log(`🟢 Received elimination payload from ${alias}:`, payload);

      const game = games[gameId];
      if (!game) throw new Error(`Game ${gameId} not found`);
      if (!game.gamePhase?.startsWith('elimination')) throw new Error('Not in elimination phase');

      const player = getOrUpdatePlayer(game, socket, alias, false);
      if (!player) throw new Error(`Player ${alias} not recognized`);

      const assignedIndex = game.assignedPlaylists?.[alias];
      if (assignedIndex !== playlistIndex)
        throw new Error(`Player ${alias} not assigned to playlist ${playlistIndex}`);

      const playlist = game.playlists?.[playlistIndex];
      if (!playlist) throw new Error(`Playlist ${playlistIndex} missing`);
      if (playlist.alias === alias) throw new Error('Player eliminating own playlist');
      if (eliminatedSongIndex < 0 || eliminatedSongIndex >= playlist.songs.length)
        throw new Error('Invalid song index');

      const song = playlist.songs[eliminatedSongIndex];
      if (!song) throw new Error('Song not found');
      if (song.eliminated) throw new Error('Song already eliminated');

      // 🔧 Apply elimination
      song.eliminated = true;
      song.eliminatedRound = game.currentRound ?? 1;
      song.eliminatedBy = alias;
      song.comment = comment || '';

      playlist.eliminationLog = playlist.eliminationLog || [];
      playlist.eliminationLog.push({
        songInfo: { artist: song.artist, title: song.title, link: song.link },
        eliminatedRound: song.eliminatedRound,
        eliminatedBy: alias,
        comment: song.comment,
      });

      player.hasSubmittedElimination = true;
      console.log(`✅ ${alias} marked as submitted`);

      io.to(gameId).emit('playlistsUpdated', game.playlists);
      io.to(gameId).emit('playerEliminationSubmitted', { alias });

      const allSubmitted = game.players.every(p => !!p.hasSubmittedElimination);
      console.log(`📊 Round ${game.currentRound} submission map:`,
        game.players.map(p => `${p.alias}:${p.hasSubmittedElimination}`).join(', '));

      if (allSubmitted) {
        console.log(`🎯 All players submitted eliminations for round ${game.currentRound}`);

        if (game._roundLocked) {
          console.warn('Duplicate round lock—skipping advance');
          return;
        }
        game._roundLocked = true;

        setTimeout(() => {
          try {
            const stillSame = games[gameId]?.currentRound === game.currentRound;
            if (!stillSame) return console.warn('Skipping advance—game already moved on');

            console.log('➡️ Calling advanceAfterRound...');
            advanceAfterRound(game, gameId);
          } catch (err) {
            console.error('💥 advanceAfterRound crash:', err);
          }
        }, 500);
      }
    } catch (err) {
      console.error(`💥 submitElimination error for ${payload?.alias}:`, err);
      socket.emit('error', { message: err.message });
    }
  });

  socket.on("requestEliminationHistory", ({ gameCode }) => {
    const game = games[gameCode];
    if (!game) return;

    socket.emit("eliminationHistory", {
      history: game.eliminationHistory,
      playlists: game.playlists,
    });
  });


  // Votes in final_mix: payload { gameId, alias, chosenPlaylistIndex } or chosenSongId
  socket.on('finalVote', ({ gameId, alias, chosen }) => {
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
    console.log(`Vote from ${alias}: chosen=${chosen}. Total votes: ${voteCount}/${game.players.length}`);

    if (voteCount === game.players.length) {
      // tally: chosen may be {playlistIndex, songId} or just a song id; allow flexible shape
      const tally = {}; // key->count
      for (const v of Object.values(game.votes)) {
        const key = (typeof v === 'object' && v.playlistIndex !== undefined) ? v.playlistIndex : v;
        tally[key] = (tally[key] || 0) + 1;
      }
      console.log('Tally:', tally);

      // find winner keys with max votes
      const maxVotes = Math.max(...Object.values(tally));
      const winners = Object.entries(tally).filter(([k, c]) => c === maxVotes).map(([k]) => k);
      console.log('Winners:', winners);

      console.log('finalMix snapshot:', JSON.stringify(game.finalMix, null, 2));
      console.log('Winner keys being looked up:', winners);


      // Build a human-friendly result: map winners to song info
      const results = winners.map(w => {
          const fm = game.finalMix.find(f => f.playlistIndex === parseInt(w));
          return { 
            playlistIndex: parseInt(w), 
            originAlias: fm?.originAlias, 
            song: fm?.song, 
            votes: tally[w] 
          };
        } 
      );

      console.log('Tally:', tally);
      console.log('Results computed:', results);


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
