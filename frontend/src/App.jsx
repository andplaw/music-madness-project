import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const socket = io('https://music-madness-project-backend.onrender.com', {
  transports: ['websocket'],
});

export default function App() {
  const [gameId, setGameId] = useState('');
  const [password, setPassword] = useState('');
  const [alias, setAlias] = useState('');
  const [playlist, setPlaylist] = useState(['', '', '', '', '']);
  const [joined, setJoined] = useState(false);
  const [players, setPlayerList] = useState([]);
  const [gamePhase, setGamePhase] = useState('lobby'); // 'joining', 'submitting', 'waiting'
  const [view, setView] = useState('home'); //can be 'home', 'lobby', 'submit'
  const [playlistSubmitted, setPlaylistSubmitted] = useState(false);
  const [assignedPlaylistIndex, setAssignedPlaylistIndex] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [eliminatedSongIndex, setEliminatedSongIndex] = useState(null);
  const [commentary, setCommentary] = useState('');
  const [round, setRound] = useState(1);


  // Listen for backend events
  useEffect(() => {
    // game created / joined
    socket.on('gameCreated', ({ gameId, players, gamePhase }) => {
      console.log('Game created:', gameId);
      setJoined(true);
      setPlayerList(players);
      setGamePhase(gamePhase);
      setGameId(gameId);
      setView('lobby');
    });

    socket.on('playerJoined', ({ gamePhase, alias: joinedAlias, players }) => {
      console.log('Player joined:', joinedAlias);
      setJoined(true);
      setPlayerList(players);
      setGamePhase(gamePhase);
      setView('lobby');
    });

    // Main phase change handler
    socket.on('gamePhaseChanged', ({ gamePhase, assignedPlaylists, playlists: newPlaylists, round: newRound }) => {
      console.log('Game phase changed to:', gamePhase);
      setGamePhase(gamePhase);

      if (Array.isArray(newPlaylists)) {
        setPlaylists(newPlaylists);
      }

      if (typeof newRound === 'number') {
        setRound(newRound);
      }

      if (gamePhase === 'submission') {
        setView('submit');
      } else if (typeof gamePhase === 'string' && gamePhase.startsWith('elimination')) {
        // assignedPlaylists is expected to be an object mapping alias -> playlistIndex
        console.log('Assigned playlists payload:', assignedPlaylists);
        // Find current player's assignment robustly (case-insensitive fallback)
        if (assignedPlaylists) {
          // Direct key match
          let assigned = assignedPlaylists[alias];
          if (assigned === undefined) {
            // Try case-insensitive match
            const found = Object.entries(assignedPlaylists).find(([key]) => key.toLowerCase() === alias.toLowerCase());
            if (found) assigned = found[1];
          }
          if (assigned !== undefined) {
            setAssignedPlaylistIndex(assigned);
            setView('eliminate');
          } else {
            console.warn('No assignment found for alias:', alias);
          }
        }
      } else if (gamePhase === 'voting') {
        setView('voting');
      }
    });

    // When playlists are updated (after eliminations), update frontend state
    socket.on('playlistsUpdated', updated => {
      console.log('playlistsUpdated received', updated);
      if (Array.isArray(updated)) setPlaylists(updated);
    });

    // assignmentsUpdated is an alternate event; update assignment map if received
    socket.on('assignmentsUpdated', assigned => {
      console.log('assignmentsUpdated received', assigned);
      // If this contains the current player's assignment, update assignedPlaylistIndex
      if (assigned) {
        let assignedForMe = assigned[alias];
        if (assignedForMe === undefined) {
          const found = Object.entries(assigned).find(([k]) => k.toLowerCase() === alias.toLowerCase());
          if (found) assignedForMe = found[1];
        }
        if (assignedForMe !== undefined) setAssignedPlaylistIndex(assignedForMe);
      }
    });

    // playlistSubmitted feedback
    socket.on('playlistSubmitted', ({ alias: who }) => {
      console.log(`Playlist submitted by ${who}`);
      setPlaylistSubmitted(true);
      setGamePhase('waiting');
    });

    // Clean up on unmount
    return () => {
      socket.off('gameCreated');
      socket.off('playerJoined');
      socket.off('gamePhaseChanged');
      socket.off('playlistsUpdated');
      socket.off('assignmentsUpdated');
      socket.off('playlistSubmitted');
    };
  }, [alias]); // keep alias in deps so handlers see the latest alias




  const handleCreateGame = () => {
    if (!gameId || !password) return;
    socket.emit('createGame', { gameId, password, alias });
    console.log('Creating game with:', gameId, password, alias);
  };

  const handleJoinGame = () => {
    if (!gameId || !password || !alias) return;
    socket.emit('joinGame', { gameId, alias, password });
  };

  const handleSubmitPlaylist = () => {
    if (playlist.some(song => song.trim() === '')) {
      alert('All 5 songs must be filled in!');
      return;
    }
    console.log('Playlist submitted with:', gameId, alias, playlist);
    console.log('Socket connected:', socket?.connected);
    socket.emit('submitPlaylist', { gameId, alias, playlist });
    setPlaylistSubmitted(true);
  };

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Playlist Elimination Game</h1>

      {view === 'home' && (
        <>
          <input value={gameId} onChange={e => setGameId(e.target.value)} placeholder="Game ID" className="input" />
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="input" type="password" />
          <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Your Alias" className="input" />
          <button onClick={handleCreateGame} className="btn">Create Game</button>
          <button onClick={handleJoinGame} className="btn">Join Game</button>
          <p>Phase: {gamePhase} | View: {view}</p>
        </>
      )}

      {view === 'lobby' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Waiting in Lobby (Game ID: {gameId})</h2>
          <ul className="list-disc list-inside">
            {players.map((player, idx) => <li key={idx}>{player || <em>(unnamed)</em>}</li>)}
          </ul>
          {alias === players[0] && (
            <button
              className="btn mt-2"
              onClick={() => {
                console.log('Start Game clicked');
                socket.emit('startGame', { gameId });
              }}
            >
              Start Game
            </button>
          )}
          <p>Phase: {gamePhase} | View: {view}</p>
        </div>
      )}

      {view === 'submit' && 
      (!playlistSubmitted ? (
        <div>
          <h2 className="font-semibold">Your Playlist</h2>
          <p>Phase: {gamePhase} | View: {view}</p>
          {playlist.map((song, idx) => (
            <input
              key={idx}
              value={song}
              onChange={e => {
                const updated = [...playlist];
                updated[idx] = e.target.value;
                setPlaylist(updated);
              }}
              placeholder={`Song ${idx + 1}`}
              className="input"
            />
          ))}
          <button onClick={handleSubmitPlaylist} className="btn mt-2">Submit Playlist</button>
        </div>
      ) : (
        <p className="text-green-700">🎶 Playlist submitted! Waiting for others...</p>
      ))}

      {view === 'eliminate' && assignedPlaylistIndex !== null && playlists[assignedPlaylistIndex] && (
        <div>
          <h2 className="font-semibold">Round {round}: Eliminate a Song</h2>
          <p>Phase: {gamePhase} | View: {view}</p>
          <p>You've been assigned a playlist. Choose one song to eliminate based on taste + theme and add a comment:</p>

          <ul>
            {/*
              songs may be objects {id,title,...} OR legacy strings.
              We normalize each song to an object representation for rendering.
            */}
            {playlists[assignedPlaylistIndex].songs.map((rawSong, idx) => {
              const song = (typeof rawSong === 'string')
                ? { id: `idx-${idx}`, title: rawSong, eliminated: false }
                : rawSong;

              // Only show active songs as selectable
              const selectable = !song.eliminated;
              const songId = String(song.id); // always string for radio values

              return (
                <li key={songId} className="mb-2">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {selectable ? (
                      <input
                        type="radio"
                        name="eliminatedSong"
                        value={songId}
                        checked={String(eliminatedSongIndex) === songId}
                        onChange={() => setEliminatedSongIndex(songId)}
                      />
                    ) : (
                      // keep layout aligned for eliminated items
                      <span style={{ width: 18, display: 'inline-block' }} />
                    )}
                    <span style={{ textDecoration: song.eliminated ? 'line-through' : 'none' }}>
                      {song.title}
                    </span>
                  </label>

                  {song.eliminated && (
                    <p className="text-sm text-red-600 ml-6">
                      ❌ Eliminated in Round {song.eliminatedRound} by {song.eliminatedBy}
                      <br />
                      <em>{song.comment}</em>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Elimination history section (separate) */}
          <div className="mt-4">
            <h3 className="font-semibold">Elimination History</h3>
            <ul className="list-disc list-inside text-sm">
              {(playlists[assignedPlaylistIndex].eliminationLog || []).map((log, idx) => (
                <li key={idx} className="mb-2">
                  Round {log.eliminatedRound}: "{log.songTitle}" was eliminated by {log.eliminatedBy}
                  <br />
                  <em>{log.comment}</em>
                </li>
              ))}
            </ul>
          </div>

          <textarea
            placeholder="Add your commentary..."
            value={commentary}
            onChange={(e) => setCommentary(e.target.value)}
            className="input w-full mt-2"
          />

          <button
            className="btn mt-2"
            disabled={!eliminatedSongIndex || commentary.trim() === ''}
            onClick={() => {
              // emit the song id and comment exactly as backend expects
              socket.emit('submitElimination', {
                gameId,
                alias,
                playlistIndex: assignedPlaylistIndex,
                eliminatedSongId: eliminatedSongIndex, // this should be the song.id (string)
                comment: commentary,
              });

              // clear UI selection and show waiting state
              setEliminatedSongIndex(null);
              setCommentary('');
              setView('waiting');
            }}
          >
            Submit Elimination
          </button>
        </div>
      )}



    </div>
  );
}
