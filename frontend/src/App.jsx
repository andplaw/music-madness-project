import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001');

export default function App() {
  const [alias, setAlias] = useState('');
  const [gameId, setGameId] = useState('');
  const [phase, setPhase] = useState('lobby');
  const [playlists, setPlaylists] = useState([]);
  const [assignedPlaylist, setAssignedPlaylist] = useState(null);
  const [eliminationHistory, setEliminationHistory] = useState([]);
  const [selectedSong, setSelectedSong] = useState('');
  const [comment, setComment] = useState('');
  const [hasSubmittedElimination, setHasSubmittedElimination] = useState(false);
  const [finalMix, setFinalMix] = useState([]);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [selectedVote, setSelectedVote] = useState('');
  const [winningSong, setWinningSong] = useState(null);
  const [myPlaylist, setMyPlaylist] = useState([]);
  const [newSong, setNewSong] = useState({ artist: '', title: '', link: '' });
  const [submittedPlaylist, setSubmittedPlaylist] = useState(false);

  // ----- Rejoin if page refreshed -----
  useEffect(() => {
    const storedAlias = localStorage.getItem('alias');
    const storedGame = localStorage.getItem('gameId');
    if (storedAlias && storedGame) {
      socket.emit('rejoinGame', { gameId: storedGame, alias: storedAlias });
    }

    socket.on('gameStateRestored', (gameData) => {
      setPhase(gameData.phase);
      setPlaylists(gameData.playlists);
      setAssignedPlaylist(gameData.assignedPlaylist);
      setEliminationHistory(gameData.eliminationHistory || []);
      setFinalMix(gameData.finalMix || []);
    });

    return () => {
      socket.off('gameStateRestored');
    };
  }, []);

  // ----- Socket Event Listeners -----
  useEffect(() => {
    socket.on('phaseChange', (newPhase) => setPhase(newPhase));

    socket.on('gameData', (data) => {
      setPlaylists(data.playlists);
      setAssignedPlaylist(data.assignedPlaylist || null);
      setEliminationHistory(data.eliminationHistory || []);
    });

    socket.on('finalMixReady', (mix) => {
      setFinalMix(mix);
      setPhase('final_mix');
    });

    socket.on('voteResults', (results) => {
      setPhase('final_results');
      setWinningSong(results.winner);
      setEliminationHistory(results.eliminationHistory || []);
    });

    return () => {
      socket.off('phaseChange');
      socket.off('gameData');
      socket.off('finalMixReady');
      socket.off('voteResults');
    };
  }, []);

  // ----- Join Game -----
  const handleJoin = () => {
    if (!alias || !gameId) return;
    socket.emit('joinGame', { gameId, alias });
    localStorage.setItem('alias', alias);
    localStorage.setItem('gameId', gameId);
  };

  // ----- Submit Playlist -----
  const addSong = () => {
    if (!newSong.title.trim()) return;
    setMyPlaylist([...myPlaylist, { ...newSong, id: crypto.randomUUID() }]);
    setNewSong({ artist: '', title: '', link: '' });
  };

  const submitPlaylist = () => {
    socket.emit('submitPlaylist', { gameId, alias, playlist: myPlaylist });
    setSubmittedPlaylist(true);
  };

  // ----- Submit Elimination -----
  const submitElimination = () => {
    if (!selectedSong) return;
    socket.emit('submitElimination', { gameId, alias, songId: selectedSong, comment });
    setHasSubmittedElimination(true);
  };

  // ----- Submit Final Vote -----
  const submitVote = () => {
    if (!selectedVote) return;
    socket.emit('submitVote', { gameId, alias, songId: selectedVote });
    setVoteSubmitted(true);
  };

  // ========== PHASE DISPLAYS ==========

  // Lobby Phase
  if (phase === 'lobby') {
    return (
      <div className="p-6 text-center">
        <h1>🎶 Playlist Elimination Game</h1>
        <input
          placeholder="Alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <input
          placeholder="Game ID"
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
        />
        <button onClick={handleJoin}>Join Game</button>
      </div>
    );
  }

  // Playlist Submission Phase
  if (phase === 'submission') {
    if (submittedPlaylist) {
      return (
        <div className="p-6 text-center">
          <h2>🎵 Playlist submitted!</h2>
          <p>Waiting for others to submit...</p>
        </div>
      );
    }

    return (
      <div className="p-6">
        <h2>Submit Your Playlist</h2>
        <div>
          <input
            placeholder="Artist"
            value={newSong.artist}
            onChange={(e) => setNewSong({ ...newSong, artist: e.target.value })}
          />
          <input
            placeholder="Title"
            value={newSong.title}
            onChange={(e) => setNewSong({ ...newSong, title: e.target.value })}
          />
          <input
            placeholder="Link (optional)"
            value={newSong.link}
            onChange={(e) => setNewSong({ ...newSong, link: e.target.value })}
          />
          <button onClick={addSong}>Add Song</button>
        </div>

        <h3>My Playlist</h3>
        <ul>
          {myPlaylist.map((s) => (
            <li key={s.id}>
              {s.artist} - {s.title} {s.link && <a href={s.link}>🔗</a>}
            </li>
          ))}
        </ul>

        <button onClick={submitPlaylist}>Submit Playlist</button>
      </div>
    );
  }

  // Elimination Phase
  if (phase.startsWith('elimination_round_')) {
    if (hasSubmittedElimination) {
      return (
        <div className="p-6 text-center">
          <h2>🎯 Elimination Submitted!</h2>
          <p>Waiting for other players...</p>
          <h3>Elimination History</h3>
          {eliminationHistory.length === 0 && <p>No eliminations yet.</p>}
          {eliminationHistory.map((entry, idx) => (
            <div key={idx}>
              <strong>{entry.eliminator}</strong> eliminated "
              {entry.songTitle}" from {entry.playlistAlias}'s playlist (Round{' '}
              {entry.round}) — {entry.comment}
            </div>
          ))}
        </div>
      );
    }

    const target = playlists.find(
      (p) => p.alias === assignedPlaylist && p.alias !== alias
    );

    if (!target) {
      return <div className="p-6 text-center">Waiting for playlist assignment...</div>;
    }

    return (
      <div className="p-6">
        <h2>Eliminate one song from {target.alias}'s playlist</h2>
        {target.songs
          .filter((s) => !s.eliminated)
          .map((s) => (
            <div key={s.id}>
              <input
                type="radio"
                name="elimination"
                value={s.id}
                onChange={() => setSelectedSong(s.id)}
              />
              {s.artist} - {s.title}{' '}
              {s.link && (
                <a href={s.link} target="_blank" rel="noreferrer">
                  🔗
                </a>
              )}
            </div>
          ))}

        <textarea
          placeholder="Leave a comment..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <button onClick={submitElimination}>Submit Elimination</button>

        <h3>Elimination History</h3>
        {eliminationHistory.map((entry, idx) => (
          <div key={idx}>
            <strong>{entry.eliminator}</strong> eliminated "
            {entry.songTitle}" from {entry.playlistAlias}'s playlist — Round{' '}
            {entry.round} — {entry.comment}
          </div>
        ))}
      </div>
    );
  }

  // Final Mix Phase
  if (phase === 'final_mix') {
    if (voteSubmitted) {
      return (
        <div className="p-6 text-center">
          <h2>✅ Vote Submitted!</h2>
          <p>Waiting for others to finish voting...</p>
        </div>
      );
    }

    return (
      <div className="p-6">
        <h2>🎧 Final Mix — Vote for Your Favorite Song!</h2>
        {finalMix.map((song) => (
          <div key={song.id}>
            <input
              type="radio"
              name="finalVote"
              value={song.id}
              onChange={() => setSelectedVote(song.id)}
            />
            {song.artist} - {song.title}{' '}
            {song.link && (
              <a href={song.link} target="_blank" rel="noreferrer">
                🔗
              </a>
            )}
          </div>
        ))}
        <button onClick={submitVote}>Submit Vote</button>

        <h3>Full Elimination History</h3>
        {eliminationHistory.map((entry, idx) => (
          <div key={idx}>
            <strong>{entry.eliminator}</strong> eliminated "
            {entry.songTitle}" from {entry.playlistAlias}'s playlist — Round{' '}
            {entry.round} — {entry.comment}
          </div>
        ))}
      </div>
    );
  }

  // Final Results Phase
  if (phase === 'final_results') {
    return (
      <div className="p-6 text-center">
        <h2>🏆 The Winner Is...</h2>
        {winningSong ? (
          <h3>
            {winningSong.artist} - {winningSong.title}
          </h3>
        ) : (
          <p>Calculating winner...</p>
        )}
        <h4>🎉 Congratulations!</h4>
        <h3>Full Elimination History</h3>
        {eliminationHistory.map((entry, idx) => (
          <div key={idx}>
            <strong>{entry.eliminator}</strong> eliminated "
            {entry.songTitle}" from {entry.playlistAlias}'s playlist — Round{' '}
            {entry.round} — {entry.comment}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 text-center">
      <h2>🎶 Playlist Elimination Game</h2>
      <p>Waiting for next phase...</p>
    </div>
  );
}
