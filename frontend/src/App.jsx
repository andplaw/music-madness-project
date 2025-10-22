

import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import EliminationHistoryViewer from "./components/EliminationHistoryViewer";

const socket = io('https://music-madness-project-backend.onrender.com', {
  transports: ['websocket'],
});

export default function App() {
  const [gameId, setGameId] = useState('');
  const [password, setPassword] = useState('');
  const [alias, setAlias] = useState('');
  const [playlist, setPlaylist] = useState([
    { artist: '', title: '', link: '' },
    { artist: '', title: '', link: '' },
    { artist: '', title: '', link: '' },
    { artist: '', title: '', link: '' },
    { artist: '', title: '', link: '' },
  ]);
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
  const [assignedPlaylist, setAssignedPlaylist] = useState(null); // For rejoin + backend sync
  const [eliminationHistory, setEliminationHistory] = useState([]); // Shared elimination log
  const [eliminationSubmitted, setEliminationSubmitted] = useState(false); // For waiting state
  const [finalMix, setFinalMix] = useState([]); // Songs in final mix
  const [selectedVote, setSelectedVote] = useState(null); // Chosen song in final mix
  const [voteSubmitted, setVoteSubmitted] = useState(false); // Whether final vote is done
  const [winningSong, setWinningSong] = useState(null); // Final results winner

  // Listen for backend events
  useEffect(() => {

    const storedAlias = localStorage.getItem('alias');
    const storedGame = localStorage.getItem('gameId');
    if (storedAlias && storedGame) {
      socket.emit('rejoinGame', { gameId: storedGame, alias: storedAlias });
    }

    socket.on('gameStateRestored', (gameData) => {
      setGamePhase(gameData.phase);
      setPlaylists(gameData.playlists);
      setAssignedPlaylist(gameData.assignedPlaylist);
      setEliminationHistory(gameData.eliminationHistory || []);
    });


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
    socket.on('gamePhaseChanged', ({ gamePhase, assignedPlaylists, playlists: newPlaylists, round: newRound, finalMix }) => {

      console.group(`🎮 Phase Transition -> ${gamePhase}`);

      console.log('Game phase changed to:', gamePhase);
      setGamePhase(gamePhase);

      // Always sync playlists if provided
      if (Array.isArray(newPlaylists)) {
        setPlaylists(newPlaylists);
      }

      // Update finalMix if present
      if (Array.isArray(finalMix)) {
        console.log('Received final mix:', finalMix);
        setFinalMix(finalMix);
      }

      // Update round number if sent
      if (typeof newRound === 'number') {
        setRound(newRound);
      }

      // 🔄 Phase-specific view logic
      if (gamePhase === 'submission') {
        setView('submit');

      } else if (typeof gamePhase === 'string' && gamePhase.startsWith('elimination')) {
        console.log('Assigned playlists payload:', assignedPlaylists);
        setEliminationSubmitted(false); // ✅ reset before each round
        
        if (assignedPlaylists) {
          let assigned = assignedPlaylists[alias];
          if (assigned === undefined) {
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

      } else if (gamePhase === 'final_mix') {
        // 🆕 Handle the Final Mix phase explicitly
        console.log('Transitioning to Final Mix phase');
        setView('final_mix');
        if (finalMix && finalMix.length > 0) {
          setFinalMix(finalMix);
        } else {
          console.warn('Final mix phase entered but no songs found.');
        }
        setVoteSubmitted(false);
        setSelectedVote(null);
      }
      console.groupEnd();
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
    socket.on('playlistSubmitted', ({ alias: submittedAlias }) => {
      console.log(`Playlist submitted by ${submittedAlias}`);
      
      // Only set *this* player to waiting if it was them who submitted
      if (submittedAlias === alias) {
        setGamePhase('waiting');
        setPlaylistSubmitted(true);
      }
    });

    socket.on('eliminationSubmitted', ({ alias: eliminatorAlias }) => {
      if (eliminatorAlias === alias) {
        setGamePhase('waiting');
        setEliminationSubmitted(true);
      }
    });

    socket.on('finalMixReady', (mix) => {
      setFinalMix(mix);
      setGamePhase('final_mix');
    });
    
    socket.on('finalResults', ({results, tally}) => {
      setGamePhase('final_results');
      setEliminationHistory(results.eliminationHistory || []);
      setWinningSong(results[0]?.song || null);
      console.log('finalResults payload:', {results, tally});
    });

    socket.on('voteSubmitted', ({ alias: voterAlias }) => {
      if (voterAlias === alias) {
        setVoteSubmitted(true);
      }
    });


    // Clean up on unmount
    return () => {
      socket.off('gameStateRestored');
      socket.off('gameCreated');
      socket.off('playerJoined');
      socket.off('gamePhaseChanged');
      socket.off('playlistsUpdated');
      socket.off('assignmentsUpdated');
      socket.off('playlistSubmitted');
      socket.off('finalMixReady');
      socket.off('voteResults');
      socket.off('voteSubmitted');
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
    localStorage.setItem('alias', alias);
    localStorage.setItem('gameId', gameId);
  };

  const handleSubmitPlaylist = () => {
    const invalid = playlist.some(song =>
      !song || !song.title || !song.artist || song.title.trim() === '' || song.artist.trim() === ''
    );
    if (invalid) {
      alert('Each song must include an artist and title (link optional).');
      return;
    }

    // send as-is; backend will normalize ids and shape
    console.log('Submitting playlist', { gameId, alias, playlist });
    socket.emit('submitPlaylist', { gameId, alias, playlist });
    setPlaylistSubmitted(true);
  };

  const handleSubmitElimination = () => {
    socket.emit('submitElimination', {
                gameId,
                alias,
                playlistIndex: assignedPlaylistIndex,
                eliminatedSongIndex,
                comment: commentary,
              });

    setEliminatedSongIndex(null);
    setCommentary('');
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
            <div key={idx} className="border p-2 mb-2 rounded">
              <input
                value={song.artist}
                onChange={e => {
                  const updated = [...playlist];
                  updated[idx].artist = e.target.value;
                  setPlaylist(updated);
                }}
                placeholder="Artist"
                className="input mb-1"
              />
              <input
                value={song.title}
                onChange={e => {
                  const updated = [...playlist];
                  updated[idx].title = e.target.value;
                  setPlaylist(updated);
                }}
                placeholder="Song Title"
                className="input mb-1"
              />
              <input
                value={song.link}
                onChange={e => {
                  const updated = [...playlist];
                  updated[idx].link = e.target.value;
                  setPlaylist(updated);
                }}
                placeholder="Link (YouTube, Spotify, etc.)"
                className="input"
              />
            </div>
          ))}
          <button onClick={handleSubmitPlaylist} className="btn mt-2">Submit Playlist</button>
        </div>
      ) : (
        <p className="text-green-700">🎶 Playlist submitted! Waiting for others...</p>
      ))}

      {view === 'eliminate' && assignedPlaylistIndex !== null && playlists[assignedPlaylistIndex] && 
      (!eliminationSubmitted ? (
        <div>
          <h2 className="font-semibold">Round {round}: Eliminate a Song</h2>

          <h3 className="mt-4 font-semibold">Assigned Playlist ({playlists[assignedPlaylistIndex].alias})</h3>
          <ul>
            {playlists[assignedPlaylistIndex].songs.map((song, index) => (
              <li key={song.id || index} className="mb-2 border-b pb-1">
                <label style={{display:'flex', alignItems:'center', gap:8}}>
                  <input
                    type="radio"
                    name="eliminatedSong"
                    value={index}
                    checked={eliminatedSongIndex === index}
                    disabled={!!song.eliminated}
                    onChange={() => setEliminatedSongIndex(index)}
                  />
                  <span style={{ textDecoration: song.eliminated ? 'line-through' : 'none' }}>
                    "{song.title}" by {song.artist} - <a href={song.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Listen</a>
                  </span>
                </label>

                {/* {song.link && (
                  <div className="ml-6">
                    
                  </div>
                )} */}

              </li>
            ))}
          </ul>

          {<textarea
            placeholder="Add your snarky commentary to accompany your elimination..."
            value={commentary}
            onChange={(e) => setCommentary(e.target.value)}
            className="input w-full mt-2"
          />}

          {<button
            className="btn mt-2"
            disabled={eliminatedSongIndex === null || commentary.trim() === ''}
            onClick={handleSubmitElimination}
          >
            Submit Elimination
          </button>}

          <h3 className="mt-4 font-semibold">Elimination History</h3>
          <EliminationHistoryViewer playlists={playlists} />

        </div>
      ) : (
        <div>
          <p className="text-green-700">🎶 Elimination submitted! Waiting for others...</p>
          <h3 className="mt-4 font-semibold">Elimination History</h3>
          <EliminationHistoryViewer playlists={playlists} />
        </div>
      )
      )}


      {gamePhase === 'final_mix' && (
        !voteSubmitted ? (
        <div>
          <h2>🎧 Final Mix — Vote for Your Favorite Song!</h2>
          {finalMix.map((entry, i) => (
            <div key={i}>
              <input
                type="radio"
                name="finalVote"
                value={i}
                onChange={() => setSelectedVote(i)}
              />
              <p><strong> From {entry.originAlias}'s playlist</strong>: {entry.song.title} by {entry.song.artist}</p>
              {entry.song.link && <a href={entry.song.link} target="_blank" rel="noopener noreferrer">Listen</a>}
            </div>
          ))}
          {voteSubmitted ? (
            <p>✅ Your vote has been submitted! Waiting for others...</p>
          ) : (
            <button onClick={() => {
              if (selectedVote === null || selectedVote === undefined) return alert("Please select a song before voting!");
              socket.emit('finalVote', { gameId, alias, chosen: selectedVote });
              setVoteSubmitted(true);
            }}
            >
              Submit Vote
            </button>
          )}
          <h3>Full Elimination History</h3>
          <EliminationHistoryViewer playlists={playlists} />
        </div>
        ) : (
          <div>
            <p>✅ Your vote has been submitted! Waiting for others...</p>
            <h3>Full Elimination History</h3>
            <EliminationHistoryViewer playlists={playlists} />
          </div>
        )
      )}

      {gamePhase === 'final_results' && (
        <div className="text-center">
          <h2>🏆 The Winner Is...</h2>
          <h3>{winningSong?.artist} - {winningSong?.title}</h3>
          <h4>🎉 Congratulations!</h4>
          <h3>Full Elimination History</h3>
          <EliminationHistoryViewer playlists={playlists} />
        </div>
      )}

    </div>
  );
}
