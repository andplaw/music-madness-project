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

      // after assignPlaylistsToPlayers(game) has been called:
      game.currentRound = 1;

      // set maxRounds to (initial longest playlist length - 1)
      // (guard against zero-length playlists)
      const maxSongs = Math.max(...game.playlists.map(p => p.songs.length));
      game.maxRounds = Math.max(0, maxSongs - 1);

      // optionally store initialSongCount if you want to show progress
      game.initialSongCount = maxSongs;

      // finally emit the initial elimination phase (include assignedPlaylists & playlists)
      io.to(gameId).emit('gamePhaseChanged', {
        gamePhase: game.gamePhase,
        assignedPlaylists: game.assignedPlaylists,
        playlists: game.playlists,
        round: game.currentRound
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
  // submitElimination: frontend sends { gameId, alias, playlistIndex, eliminatedSongIndex, commentary }
  socket.on('submitElimination', ({ gameId, alias, playlistIndex, eliminatedSongIndex, commentary }) => {
    const game = games[gameId];
    if (!game) return;

    // Only accept eliminations during elimination rounds
    if (!game.gamePhase || !game.gamePhase.startsWith('elimination')) {
      console.log(`Rejected elimination (wrong phase) for game=${gameId}, alias=${alias}`);
      return;
    }

    // Ensure playlist index is valid
    const playlist = game.playlists?.[playlistIndex];
    if (!playlist) {
      console.log(`Invalid playlistIndex ${playlistIndex} from ${alias} in game ${gameId}`);
      return;
    }

    // Find the song instead of splicing it
      const song = playlist.songs.find(s => s.id === eliminatedSongId);
      if (!song) return;

      // Mark it eliminated
      song.eliminated = true;
      song.eliminatedRound = game.currentRound || 1;
      song.eliminatedBy = alias;
      song.comment = comment;

      // Log separately
      if (!playlist.eliminationLog) playlist.eliminationLog = [];
      playlist.eliminationLog.push({
        songTitle: song.title,
        eliminatedRound: game.currentRound || 1,
        eliminatedBy: alias,
        comment
      });

    // Mark that this player has submitted this round
    if (!game.submissionsThisRound) game.submissionsThisRound = {};
    game.submissionsThisRound[alias] = true;

    console.log(`Elimination recorded: game=${gameId}, round=${roundNum}, by=${alias}, playlist=${playlistIndex}, idx=${eliminatedSongIndex}`);

    // Broadcast updated playlists (so UIs update to show comments / removed songs)
    io.to(gameId).emit('playlistsUpdated', game.playlists);

    // If maxRounds not initialized (edge), initialize here from playlist lengths
    if (!game.maxRounds) {
      const maxSongs = Math.max(...game.playlists.map(p => (p.songs?.length ?? 0)));
      // Number of elimination rounds = initial longest playlist length - 1
      game.maxRounds = Math.max(0, maxSongs - 1);
    }

    // Ensure currentRound exists
    if (!game.currentRound) game.currentRound = 1;

    // Check if all players have submitted for this round
    const allSubmitted = game.players.every(p => !!game.submissionsThisRound[p.alias]);

    if (allSubmitted) {
      console.log(`All eliminations submitted for game ${gameId}, round ${game.currentRound}`);

      // Reset submissions for next round (we'll prepare it now)
      game.submissionsThisRound = {};

      // Decide whether to advance or go to voting
      if (game.currentRound < game.maxRounds) {
        // rotate assignments and increment round
        rotateAssignments(game, gameId);
        game.currentRound += 1;
        game.gamePhase = `elimination_round_${game.currentRound}`;
        console.log(`Advancing to ${game.gamePhase} for game ${gameId}`);

        // Broadcast new phase + assignments + playlists
        io.to(gameId).emit('gamePhaseChanged', {
          gamePhase: game.gamePhase,
          assignedPlaylists: game.assignedPlaylists,
          playlists: game.playlists,
          round: game.currentRound
        });
      } else {
        // Final round done -> voting
        game.gamePhase = 'voting';
        console.log(`All rounds complete; moving to voting for game ${gameId}`);

        io.to(gameId).emit('gamePhaseChanged', {
          gamePhase: game.gamePhase,
          playlists: game.playlists
        });
      }
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

