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

    socket.on('playlistSubmitted', ({ alias }) => {
      console.log(`Playlist submitted by ${alias}`);
      setGamePhase('waiting');
    });

    return () => {
      socket.off('gameCreated');
      socket.off('playerJoined');
      socket.off('playlistSubmitted');
    };
  }, []);

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
    socket.emit('submitPlaylist', { gameId, alias, playlist });
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
        </>
      )}

      {view === 'lobby' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Waiting in Lobby (Game ID: {gameId})</h2>
          <ul className="list-disc list-inside">
            {playerList.map((player, idx) => <li key={idx}>{player || <em>(unnamed)</em>}</li>)}
          </ul>
          {/* Optional: Add a Start Game button for the host here */}
        </div>
      )}

      {view === 'submit' && (
        <div>
          <h2 className="font-semibold">Your Playlist</h2>
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
          <button onClick={handleSubmitPlaylist} className="btn">Submit Playlist</button>
        </div>
      )}
    </div>
  );
}
