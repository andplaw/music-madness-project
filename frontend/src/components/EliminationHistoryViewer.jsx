import React, { useState,Effect, useEffect } from "react";

/**
 * EliminationHistoryViewer
 * Props:
 *  - playlists: array of playlist objects (each: { alias, songs: [...], eliminationLog: [...] })
 *
 * This component is defensive:
 *  - tolerates missing playlists or eliminationLog
 *  - handles backend shape { songInfo: { artist, title, link }, ... }
 *  - avoids crashes when selected index is out of range
 */
export default function EliminationHistoryViewer({ playlists }) {
  const [selectedPlaylistIndex, setSelectedPlaylistIndex] = useState(0);

  // Keep the selected index valid if playlists array changes length
  useEffect(() => {
    if (!Array.isArray(playlists) || playlists.length === 0) {
      setSelectedPlaylistIndex(0);
      return;
    }
    if (selectedPlaylistIndex >= playlists.length) {
      setSelectedPlaylistIndex(0);
    }
    // no deps other than playlists length intentionally - keep index valid
  }, [playlists?.length]); // eslint-disable-line

  // Defensive checks
  if (!Array.isArray(playlists) || playlists.length === 0) {
    return <p>No playlists available yet.</p>;
  }

  const selectedPlaylist = playlists[selectedPlaylistIndex] || playlists[0];
  const eliminationLog = Array.isArray(selectedPlaylist?.eliminationLog) ? selectedPlaylist.eliminationLog : [];

  // Normalize entries to a known shape for rendering
  const normalizedLog = eliminationLog
    .filter(Boolean) // remove null/undefined
    .map(entry => {
      // backend shape: { songInfo: {artist,title,link}, eliminatedRound, eliminatedBy, comment }
      // older shapes might be { song: {...} } — support both
      const songObj = entry.songInfo ?? entry.song ?? null;
      return {
        song: songObj,
        eliminatedRound: entry.eliminatedRound ?? entry.round ?? null,
        eliminatedBy: entry.eliminatedBy ?? entry.eliminatedBy ?? null,
        comment: entry.comment ?? entry.commentText ?? ''
      };
    })
    .filter(e => e.song && (e.song.title || e.song.name)); // keep entries with a song

  return (
    <div className="elimination-history-container" style={{ marginTop: "1rem" }}>
      <h3>🎧 Elimination History</h3>

      <label style={{ display: "block", marginBottom: 8 }}>
        View playlist:
      </label>

      {/* Dropdown to select which playlist to view */}
      <select
        value={selectedPlaylistIndex}
        onChange={(e) => {
          const v = Number(e.target.value);
          setSelectedPlaylistIndex(Number.isNaN(v) ? 0 : v);
        }}
        style={{
          padding: "0.4rem",
          marginBottom: "0.8rem",
          borderRadius: "6px",
          backgroundColor: "#f9f9f9",
        }}
      >
        {playlists.map((pl, idx) => (
          <option key={idx} value={idx}>
            {pl?.alias ? `${pl.alias}'s Playlist` : `Playlist ${idx + 1}`}
          </option>
        ))}
      </select>

      {normalizedLog.length === 0 ? (
        <p style={{ fontStyle: "italic" }}>No eliminations yet for this playlist.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            maxHeight: "300px",
            overflowY: "auto",
            border: "1px solid #ddd",
            borderRadius: "6px",
            background: "#fff",
          }}
        >
          {normalizedLog.map((entry, index) => {
            const title = entry.song.title ?? entry.song.name ?? 'Untitled';
            const artist = entry.song.artist ?? '';
            return (
              <li
                key={index}
                style={{
                  borderBottom: "1px solid #eee",
                  padding: "0.5rem",
                }}
              >
                <div>
                  <strong>{title}</strong>
                  {artist ? <span> — {artist}</span> : null}
                </div>

                <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                  Eliminated by <strong>{entry.eliminatedBy ?? 'Unknown'}</strong>
                  {entry.eliminatedRound ? <> (Round {entry.eliminatedRound})</> : null}
                </div>

                <div style={{ marginTop: 6, color: "#333" }}>
                  {entry.comment ? (
                    <blockquote style={{ margin: 0, fontStyle: "italic", color: "#555" }}>
                      “{entry.comment}”
                    </blockquote>
                  ) : (
                    <div style={{ fontStyle: "italic", color: "#888" }}>No comment</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
