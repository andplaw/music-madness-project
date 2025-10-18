import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const socket = io('https://music-madness-project-backend.onrender.com', {
  transports: ['websocket'],
  reconnection: true,
});

export default function App() {
  const [gameId, setGameId] = useState('');
  const [password, setPassword] = useState('');
  const [alias, setAlias] = useState('');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [gamePhase, setGamePhase] = useState('home');
  const [view, setView] = useState('home');
  const [playlist, setPlaylist] = useState(
    Array(5).fill({ artist: '', title: '', link: '' })
  );
  const [playlists, setPlaylists] = useState([]);
  const [assignedPlaylistIndex, setAssignedPlaylistIndex] = useState(null);
  const [eliminatedSongIndex, setEliminatedSongIndex] = useState(null);
  const [commentary, setCommentary] = useState('');
  const [playlistSubmitted, setPlaylistSubmitted] = useState(false);
  const [round, setRound] = useState(1);
  const [waitingMessage, setWaitingMessage] = useState('');
  const [finalMix, setFinalMix] = useState([]);
  const [votedSongId, setVotedSongId] = useState('');

  // Persist alias + game info so refresh can reconnect
  useEffect(() => {
    const saved = localStorage.getItem('session');
    if (saved) {
      const { alias, gameId, password } = JSON.parse(saved);
      setAlias(alias);
      setGameId(gameId);
      setPassword(password);
      socket.emit('rejoinGame', { alias, gameId, password });
    }
  }, []);

  // Listen for backend events
  useEffect(() => {
    socket.on('gameCreated', ({ gameId, players, gamePhase }) => {
      setJoined(true);
      setPlayers(players);
      setGamePhase(gamePhase);
      setView('lobby');
      localStorage.setItem('session', JSON.stringify({ alias, gameId, password }));
    });

    socket.on('playerJoined', ({ gamePhase, players }) => {
      setJoined(true);
      setPlayers(players);
      setGamePhase(gamePhase);
      setView('lobby');
    });

    socket.on('gamePhaseChanged', (payload) => {
      console.log('Phase changed →', payload);
      const { gamePhase, assignedPlaylists, playlists, round, finalMix } = payload;
      setGamePhase(gamePhase);
      setRound(round || 1);
      if (playlists) setPlaylists(playlists);

      if (finalMix) setFinalMix(finalMix);

      if (gamePhase === 'submission') setView('submit');
      else if (gamePhase.startsWith('elimination')) {
        let assigned = assignedPlaylists?.[alias];
        if (assigned === undefined && assignedPlaylists) {
          const found = Object.entries(assignedPlaylists).find(
            ([k]) => k.toLowerCase() === alias.toLowerCase()
          );
          if (found) assigned = found[1];
        }
        if (assigned !== undefined) setAssignedPlaylistIndex(assigned);
        setView('eliminate');
      } else if (gamePhase === 'waiting') setView('waiting');
      else if (gamePhase === 'voting') setView('voting');
      else if (gamePhase === 'final_results') setView('results');
    });

    socket.on('playlistsUpdated', (updated) => {
      setPlaylists(updated);
    });

    socket.on('playlistSubmitted', ({ alias: who }) => {
      if (who === alias) {
        setPlaylistSubmitted(true);
        setView('waiting');
      }
    });

    socket.on('waitingForOthers', ({ phase }) => {
      setWaitingMessage(`✅ Your ${phase} was submitted. Waiting for other players...`);
      setView('waiting');
    });

    socket.on('gameResumed', ({ gamePhase, playlists, assignedPlaylists, round }) => {
      console.log('Resumed game:', gamePhase);
      setGamePhase(gamePhase);
      setPlaylists(playlists);
      setRound(round || 1);
      if (assignedPlaylists && gamePhase.startsWith('elimination')) {
        setView('eliminate');
        let assigned = assignedPlaylists[alias];
        if (assigned === undefined) {
          const found = Object.entries(assignedPlaylists).find(
            ([k]) => k.toLowerCase() === alias.toLowerCase()
          );
          if (found) assigned = found[1];
        }
        setAssignedPlaylistIndex(assigned);
      } else setView(gamePhase);
    });

    socket.on('finalMixReady', ({ finalMix }) => {
      setFinalMix(finalMix);
      setView('voting');
    });

    return () => {
      socket.off('gameCreated');
      socket.off('playerJoined');
      socket.off('gamePhaseChanged');
      socket.off('playlistsUpdated');
      socket.off('playlistSubmitted');
      socket.off('waitingForOthers');
      socket.off('gameResumed');
      socket.off('finalMixReady');
    };
  }, [alias]);

  const handleCreateGame = () => {
    socket.emit('createGame', { gameId, password, alias });
  };

  const handleJoinGame = () => {
    socket.emit('joinGame', { gameId, password, alias });
    localStorage.setItem('session', JSON.stringify({ alias, gameId, password }));
  };

  const handleSubmitPlaylist = () => {
    const invalid = playlist.some(s => !s.title.trim() || !s.artist.trim());
    if (invalid) {
      alert('Each song must include artist and title.');
      return;
    }
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
    setWaitingMessage('✅ Elimination submitted. Waiting for other players...');
    setView('waiting');
  };

  const handleVote = () => {
    if (!votedSongId) return;
    socket.emit('submitVote', { gameId, alias, songId: votedSongId });
    setWaitingMessage('🎵 Vote submitted! Waiting for results...');
    setView('waiting');
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Playlist Elimination Game</h1>

      {view === 'home' && (
        <div className="space-y-2">
          <input placeholder="Game ID" value={gameId} onChange={e => setGameId(e.target.value)} />
          <input placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} type="password" />
          <input placeholder="Alias" value={alias} onChange={e => setAlias(e.target.value)} />
          <button onClick={handleCreateGame}>Create Game</button>
          <button onClick={handleJoinGame}>Join Game</button>
        </div>
      )}

      {view === 'lobby' && (
        <div>
          <h2 className="text-lg font-semibold">Lobby — Game: {gameId}</h2>
          <ul className="list-disc list-inside">
            {players.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          {alias === players[0] && (
            <button onClick={() => socket.emit('startGame', { gameId })}>Start Game</button>
          )}
        </div>
      )}

      {view === 'submit' && !playlistSubmitted && (
        <div>
          <h2 className="font-semibold mb-2">Submit Your Playlist</h2>
          {playlist.map((s, i) => (
            <div key={i} className="border p-2 mb-2 rounded">
              <input
                placeholder="Artist"
                value={s.artist}
                onChange={e => {
                  const updated = [...playlist];
                  updated[i].artist = e.target.value;
                  setPlaylist(updated);
                }}
              />
              <input
                placeholder="Title"
                value={s.title}
                onChange={e => {
                  const updated = [...playlist];
                  updated[i].title = e.target.value;
                  setPlaylist(updated);
                }}
              />
              <input
                placeholder="Link (optional)"
                value={s.link}
                onChange={e => {
                  const updated = [...playlist];
                  updated[i].link = e.target.value;
                  setPlaylist(updated);
                }}
              />
            </div>
          ))}
          <button onClick={handleSubmitPlaylist}>Submit Playlist</button>
        </div>
      )}

      {view === 'waiting' && (
        <p className="text-green-700 font-medium mt-4">{waitingMessage || 'Waiting for other players...'}</p>
      )}

      {view === 'eliminate' && assignedPlaylistIndex !== null && (
        <div>
          <h2 className="font-semibold mb-2">Round {round}: Eliminate a Song</h2>
          <h3 className="mb-2">
            Reviewing Playlist of {playlists[assignedPlaylistIndex]?.alias}
          </h3>
          <ul>
            {playlists[assignedPlaylistIndex]?.songs.map((song, idx) => (
              <li key={idx}>
                <label>
                  <input
                    type="radio"
                    name="elim"
                    checked={eliminatedSongIndex === idx}
                    disabled={song.eliminated}
                    onChange={() => setEliminatedSongIndex(idx)}
                  />
                  <span className={song.eliminated ? 'line-through text-gray-500' : ''}>
                    {song.title} — {song.artist}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <textarea
            placeholder="Commentary..."
            value={commentary}
            onChange={e => setCommentary(e.target.value)}
            className="block w-full border mt-2"
          />
          <button className="mt-2" onClick={handleSubmitElimination}>Submit Elimination</button>

          <div className="mt-4">
            <h3 className="font-semibold">Elimination History (All Playlists)</h3>
            {playlists.map((p, i) => (
              <div key={i} className="border p-2 mt-2 rounded bg-gray-50">
                <h4>{p.alias}'s Playlist</h4>
                {(p.eliminationLog || []).map((log, j) => (
                  <div key={j} className="text-sm">
                    ❌ Round {log.eliminatedRound}: "{log.song.title}" by {log.song.artist} — {log.eliminatedBy}
                    <br />
                    <em>"{log.comment}"</em>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'voting' && (
        <div>
          <h2 className="font-semibold mb-2">🎵 Final Mix — Vote for Your Favorite</h2>
          <ul>
            {finalMix.map((song, idx) => (
              <li key={idx}>
                <label>
                  <input
                    type="radio"
                    name="vote"
                    value={song.id}
                    checked={votedSongId === song.id}
                    onChange={() => setVotedSongId(song.id)}
                  />
                  "{song.title}" — {song.artist} ({song.alias})
                </label>
              </li>
            ))}
          </ul>
          <button onClick={handleVote} disabled={!votedSongId} className="mt-2">
            Submit Vote
          </button>
        </div>
      )}

      {view === 'results' && (
        <div>
          <h2 className="text-xl font-bold">🏆 Final Results</h2>
          {playlists.map((p, i) => (
            <div key={i} className="border p-2 mt-2 rounded">
              <h3>{p.alias}'s Playlist</h3>
              <ul>
                {p.songs.map((s, j) => (
                  <li key={j}>
                    {s.title} — {s.artist} {s.winner && '🥇'}
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
