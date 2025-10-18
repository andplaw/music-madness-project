

import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const socket = io('https://music-madness-project-backend.onrender.com', {
  transports: ['websocket'],
  withCredentials: true,
});

export default function App() {
  const [gameId, setGameId] = useState(localStorage.getItem('gameId') || '');
  const [alias, setAlias] = useState(localStorage.getItem('alias') || '');
  const [password, setPassword] = useState(localStorage.getItem('password') || '');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [gamePhase, setGamePhase] = useState('lobby');
  const [view, setView] = useState('home');
  const [playlist, setPlaylist] = useState(Array(5).fill({ artist: '', title: '', link: '' }));
  const [playlistSubmitted, setPlaylistSubmitted] = useState(false);
  const [assignedPlaylistIndex, setAssignedPlaylistIndex] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [eliminatedSongIndex, setEliminatedSongIndex] = useState(null);
  const [commentary, setCommentary] = useState('');
  const [round, setRound] = useState(1);
  const [votingOptions, setVotingOptions] = useState([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [waitingMessage, setWaitingMessage] = useState('');

  // Rejoin if data exists in localStorage
  useEffect(() => {
    if (gameId && alias && password && !joined) {
      socket.emit('rejoinGame', { gameId, alias, password });
    }
  }, [gameId, alias, password, joined]);

  // Socket listeners
  useEffect(() => {
    socket.on('gameCreated', ({ gameId, players, gamePhase }) => {
      setJoined(true);
      setPlayers(players);
      setGamePhase(gamePhase);
      setView('lobby');
      localStorage.setItem('gameId', gameId);
      localStorage.setItem('alias', alias);
      localStorage.setItem('password', password);
    });

    socket.on('playerJoined', ({ players }) => {
      setPlayers(players);
    });

    socket.on('gamePhaseChanged', ({ gamePhase, assignedPlaylists, playlists, round }) => {
      setGamePhase(gamePhase);
      setRound(round || 1);
      if (Array.isArray(playlists)) setPlaylists(playlists);

      if (gamePhase === 'submission') setView('submit');
      else if (gamePhase.startsWith('elimination')) {
        setAssignedPlaylistIndex(assignedPlaylists?.[alias] ?? null);
        setView('eliminate');
      } else if (gamePhase === 'final_mix') {
        setVotingOptions(playlists.flatMap(p => p.songs.filter(s => !s.eliminated)));
        setView('voting');
      } else if (gamePhase === 'final_results') {
        setView('results');
      }
    });

    socket.on('playlistsUpdated', updated => {
      if (Array.isArray(updated)) setPlaylists(updated);
    });

    socket.on('waitingForOthers', ({ phase, completed, total }) => {
      setWaitingMessage(`You’ve submitted your ${phase}! Waiting for ${total - completed} other players...`);
    });

    socket.on('rejoinSuccess', ({ gamePhase, playlists, assignedPlaylists, round }) => {
      setJoined(true);
      setGamePhase(gamePhase);
      setPlaylists(playlists);
      setRound(round);
      if (gamePhase.startsWith('elimination')) {
        setAssignedPlaylistIndex(assignedPlaylists?.[alias] ?? null);
        setView('eliminate');
      } else if (gamePhase === 'final_mix') {
        setVotingOptions(playlists.flatMap(p => p.songs.filter(s => !s.eliminated)));
        setView('voting');
      }
    });

    return () => {
      socket.off('gameCreated');
      socket.off('playerJoined');
      socket.off('gamePhaseChanged');
      socket.off('playlistsUpdated');
      socket.off('waitingForOthers');
      socket.off('rejoinSuccess');
    };
  }, [alias]);

  // Game creation and joining
  const handleCreateGame = () => {
    if (!gameId || !password || !alias) return;
    socket.emit('createGame', { gameId, password, alias });
  };

  const handleJoinGame = () => {
    if (!gameId || !password || !alias) return;
    socket.emit('joinGame', { gameId, alias, password });
    localStorage.setItem('gameId', gameId);
    localStorage.setItem('alias', alias);
    localStorage.setItem('password', password);
  };

  const handleSubmitPlaylist = () => {
    const invalid = playlist.some(s => !s.title || !s.artist);
    if (invalid) return alert('Each song must have artist and title');
    socket.emit('submitPlaylist', { gameId, alias, playlist });
    setPlaylistSubmitted(true);
  };

  const handleSubmitElimination = () => {
    if (eliminatedSongIndex === null || !commentary.trim()) return;
    socket.emit('submitElimination', {
      gameId,
      alias,
      playlistIndex: assignedPlaylistIndex,
      eliminatedSongIndex,
      comment: commentary,
    });
    setEliminatedSongIndex(null);
    setCommentary('');
    setView('waiting');
  };

  const handleVote = (songId) => {
    socket.emit('submitVote', { gameId, alias, songId });
    setHasVoted(true);
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">🎵 Playlist Elimination Game</h1>

      {view === 'home' && (
        <div>
          <input value={gameId} onChange={e => setGameId(e.target.value)} placeholder="Game ID" className="input" />
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" className="input" />
          <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Alias" className="input" />
          <button onClick={handleCreateGame} className="btn">Create Game</button>
          <button onClick={handleJoinGame} className="btn">Join Game</button>
        </div>
      )}

      {view === 'lobby' && (
        <div>
          <h2>Lobby (Game ID: {gameId})</h2>
          <ul>{players.map((p, i) => <li key={i}>{p}</li>)}</ul>
          {alias === players[0] && <button onClick={() => socket.emit('startGame', { gameId })}>Start Game</button>}
        </div>
      )}

      {view === 'submit' && (
        <div>
          <h2>Submit Your Playlist</h2>
          {!playlistSubmitted ? (
            <>
              {playlist.map((s, i) => (
                <div key={i}>
                  <input value={s.artist} placeholder="Artist" onChange={e => {
                    const updated = [...playlist];
                    updated[i].artist = e.target.value;
                    setPlaylist(updated);
                  }} className="input" />
                  <input value={s.title} placeholder="Title" onChange={e => {
                    const updated = [...playlist];
                    updated[i].title = e.target.value;
                    setPlaylist(updated);
                  }} className="input" />
                  <input value={s.link} placeholder="Link" onChange={e => {
                    const updated = [...playlist];
                    updated[i].link = e.target.value;
                    setPlaylist(updated);
                  }} className="input" />
                </div>
              ))}
              <button onClick={handleSubmitPlaylist} className="btn">Submit Playlist</button>
            </>
          ) : (
            <p>🎶 Playlist submitted! Waiting for others...</p>
          )}
        </div>
      )}

      {view === 'eliminate' && playlists[assignedPlaylistIndex] && (
        <div>
          <h2>Round {round}: Eliminate a Song</h2>
          <h3>Reviewing: {playlists[assignedPlaylistIndex].alias}'s Playlist</h3>
          <ul>
            {playlists[assignedPlaylistIndex].songs.map((s, i) => (
              <li key={s.id}>
                <label>
                  <input type="radio" name="elim" disabled={s.eliminated} checked={eliminatedSongIndex === i} onChange={() => setEliminatedSongIndex(i)} />
                  {s.title} — {s.artist}
                </label>
              </li>
            ))}
          </ul>
          <textarea value={commentary} onChange={e => setCommentary(e.target.value)} placeholder="Add commentary..." className="input" />
          <button onClick={handleSubmitElimination} className="btn">Submit Elimination</button>

          <h3 className="mt-4 font-semibold">Elimination History</h3>
          {playlists.map((p, pi) => (
            <div key={pi} className="bg-gray-100 p-2 rounded mb-2">
              <h4>{p.alias}'s Playlist</h4>
              {(p.eliminationLog || []).map((log, i) => (
                <p key={i}>Round {log.eliminatedRound}: "{log.song.title}" by {log.song.artist} — {log.eliminatedBy} said “{log.comment}”</p>
              ))}
            </div>
          ))}
        </div>
      )}

      {view === 'waiting' && <p>{waitingMessage || '✅ Elimination submitted! Waiting for others...'}</p>}

      {view === 'voting' && (
        <div>
          <h2>🎧 Final Mix Voting</h2>
          {!hasVoted ? (
            votingOptions.map((s, i) => (
              <div key={i} className="border p-2 mb-2 rounded">
                <p>"{s.title}" by {s.artist}</p>
                <button onClick={() => handleVote(s.id)} className="btn">Vote for This</button>
              </div>
            ))
          ) : (
            <p>✅ Vote submitted! Waiting for others...</p>
          )}
        </div>
      )}

      {view === 'results' && (
        <div>
          <h2>🏆 Final Results</h2>
          {playlists.map((p, i) => (
            <div key={i} className="border p-2 mb-2 rounded">
              <h3>{p.alias}'s Playlist</h3>
              <ul>
                {p.songs.map((s, j) => (
                  <li key={j}>
                    "{s.title}" — {s.artist}
                    {s.winner && <span className="text-green-600 font-bold"> 🏆 Winner!</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
