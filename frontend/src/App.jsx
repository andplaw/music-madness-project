import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
const socket = io('https://music-madness-project-backend.onrender.com');

export default function App() {
  const [gameId, setGameId] = useState('');
  const [password, setPassword] = useState('');
  const [alias, setAlias] = useState('');
  const [playlist, setPlaylist] = useState(['', '', '', '', '']);

  const handleCreateGame = () => {
    socket.emit('createGame', { gameId, password });
  };

  const handleJoinGame = () => {
    socket.emit('joinGame', { gameId, alias, password });
  };

  const handleSubmitPlaylist = () => {
    socket.emit('submitPlaylist', { gameId, alias, playlist });
  };

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Playlist Elimination Game</h1>
      <input value={gameId} onChange={e => setGameId(e.target.value)} placeholder="Game ID" className="input" />
      <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="input" type="password" />
      <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Your Alias" className="input" />
      <button onClick={handleCreateGame} className="btn">Create Game</button>
      <button onClick={handleJoinGame} className="btn">Join Game</button>

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
    </div>
  );
}
