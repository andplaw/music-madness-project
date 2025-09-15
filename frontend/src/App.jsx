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
    socket.on('gameCreated', ({ gameId, players, gamePhase }) => {
      console.log('Game created:', gameId);
      setJoined(true);
      setPlayerList(players);
      setGamePhase(gamePhase);
      setGameId(gameId);
      setView('lobby'); // go to lobby after game is created
    });

    socket.on('playerJoined', ({ gamePhase, alias, players }) => {
      console.log('Player joined:', alias);
      setJoined(true);
      setPlayerList(players)
      setGamePhase(gamePhase); 
      setView('lobby'); // go to lobby after joining
    });

    socket.on('gamePhaseChanged', ({ gamePhase, assignedPlaylists, playlists, round }) => {
      console.log('Game phase changed to:', gamePhase);
      setGamePhase(gamePhase);

      if (playlists) {
        setPlaylists(playlists); // ✅ update state
      }

      if (round) {
        setRound(round);
      }

      // Update the view
      if (gamePhase === 'submission') {
        setView('submit');
      } else if (gamePhase.startsWith('elimination')) {
        console.log('Alias:', alias);
        console.log('Assigned playlists:', assignedPlaylists);

        if (assignedPlaylists && assignedPlaylists[alias] !== undefined) {
          setAssignedPlaylistIndex(assignedPlaylists[alias]); // New state
          setView('eliminate');
        }
      }

      // Cleanup listeners on unmount
      return () => {
        socket.off("phaseChange");
        socket.off("playlistsUpdated");
        socket.off("assignmentsUpdated");
      };

      // Handle other phases similarly...
    });

    socket.on('playlistSubmitted', ({ alias }) => {
      console.log(`Playlist submitted by ${alias}`);
      setGamePhase('waiting');
    });

    return () => {
      socket.off('gameCreated');
      socket.off('playerJoined');
      socket.off('gamePhaseChanged')
      socket.off('playlistSubmitted');
    };
  }, [socket, players, alias]);

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

      {view === 'eliminate' && assignedPlaylistIndex !== null && (
        <div>
          <h2 className="font-semibold">Round {round}: Eliminate a Song</h2>
          <p>Phase: {gamePhase} | View: {view}</p>
          <p>You've been assigned a playlist. Choose one song to eliminate based on taste + theme and add a comment:</p>

          <ul>
            {playlists[assignedPlaylistIndex]?.songs.map((song, index) => {
              const isEliminated = song.eliminated;

              return (
                <li key={song.id || index} className="mb-2">
                  <label>
                    {!isEliminated && (
                      <input
                        type="radio"
                        name="eliminatedSong"
                        value={song.id}
                        checked={eliminatedSongIndex === song.id}
                        onChange={() => setEliminatedSongIndex(song.id)}
                      />
                    )}
                    {song.title}
                  </label>

                  {isEliminated && (
                    <p className="text-sm text-red-600">
                      ❌ Eliminated in Round {song.eliminatedRound} by {song.eliminatedBy}
                      <br />
                      <em>{song.comment}</em>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4">
            <h3 className="font-semibold">Elimination History</h3>
            <ul className="list-disc list-inside text-sm">
              {playlists[assignedPlaylistIndex]?.eliminationLog?.map((log, idx) => (
                <li key={idx}>
                  Round {log.eliminatedRound}: "{log.songTitle}" was eliminated by {log.eliminatedBy}
                  <br />
                  <em>{log.comment}</em>
                </li>
              ))}
            </ul>
          </div>

          <button
            className="btn mt-2"
            disabled={eliminatedSongIndex === null || commentary.trim() === ''}
            onClick={() => {
              socket.emit('submitElimination', {
                gameId,
                alias,
                eliminatedSongId: eliminatedSongIndex, // ✅ now passing the song.id
                comment: commentary,
              });

              setEliminatedSongIndex(null);
              setCommentary('');
              setView('waiting');
            }}
          >
            Submit Elimination
          </button>


          <textarea
            placeholder="Add your commentary..."
            value={commentary}
            onChange={(e) => setCommentary(e.target.value)}
            className="input w-full mt-2"
          />

        </div>
      )}


    </div>
  );
}
