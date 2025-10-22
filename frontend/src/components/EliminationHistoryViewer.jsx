// EliminationHistoryViewer.jsx
import React from 'react';

export default function EliminationHistoryViewer({ playlists, eliminationHistory = [], gamePhase, winningSong }) {
  if (!playlists || playlists.length === 0) {
    return <p>No playlists available.</p>;
  }

  // Build a quick lookup: { [playlistAlias]: { [songId or index]: { round, comment } } }
  const eliminationMap = {};
  eliminationHistory.forEach((entry) => {
    const { round, eliminatedSongIndex, playlistIndex, comment } = entry;
    const pl = playlists[playlistIndex];
    if (!pl) return;
    const alias = pl.alias;
    if (!eliminationMap[alias]) eliminationMap[alias] = {};
    eliminationMap[alias][eliminatedSongIndex] = { round, comment };
  });

  // Identify winner ID if present
  const winnerId = winningSong?.id || winningSong?.song?.id;

  return (
    <div className="elimination-history">
      <h3>Elimination History</h3>
      {playlists.map((pl, pIndex) => (
        <div key={pIndex} className="playlist-history">
          <h4>Playlist by {pl.alias}</h4>
          <ul>
            {pl.songs.map((song, sIndex) => {
              const elimInfo = eliminationMap[pl.alias]?.[sIndex];
              const isEliminated = !!elimInfo;
              const isWinner =
                gamePhase === 'final_results' &&
                (song.id === winnerId ||
                 song.title === winningSong?.song?.title);

              let statusLabel = 'Active';
              let statusDetail = '';

              if (isWinner) {
                statusLabel = '🏆 Winner!';
              } else if (isEliminated) {
                statusLabel = `❌ Eliminated (Round ${elimInfo.round})`;
                statusDetail = elimInfo.comment ? ` — “${elimInfo.comment}”` : '';
              } else if (gamePhase === 'final_results' && !isWinner) {
                statusLabel = '🗳️ Eliminated in Final Vote';
              }

              return (
                <li key={sIndex} style={{ marginBottom: '0.3em' }}>
                  <strong>{song.title}</strong> by {song.artist} {song.link && <a href={song.link} target="_blank" rel="noopener noreferrer">Listen</a>}
                  <div style={{ marginLeft: '1em', fontSize: '0.9em' }}>
                    {statusLabel}
                    {statusDetail && <span>{statusDetail}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
