import React, { useState } from "react";

export default function EliminationHistoryViewer({ playlists }) {
  const [selectedPlaylistIndex, setSelectedPlaylistIndex] = useState(0);

  if (!playlists || playlists.length === 0) {
    return <p>No playlists available yet.</p>;
  }

  const selectedPlaylist = playlists[selectedPlaylistIndex];
  const eliminationLog = selectedPlaylist.eliminationLog || [];

  const safeLog = eliminationLog?.filter(e => e && e.title);
  if (!safeLog?.length) {
    return <p>No elimination history yet.</p>;
  }

  return (
    <div className="elimination-history-container" style={{ marginTop: "1rem" }}>
      <h3>🎧 Elimination History</h3>

      {/* Dropdown to select which playlist to view */}
      <select
        value={selectedPlaylistIndex}
        onChange={(e) => setSelectedPlaylistIndex(Number(e.target.value))}
        style={{
          padding: "0.4rem",
          marginBottom: "0.8rem",
          borderRadius: "6px",
          backgroundColor: "#f9f9f9",
        }}
      >
        {playlists.map((pl, idx) => (
          <option key={idx} value={idx}>
            {pl.alias}'s Playlist
          </option>
        ))}
      </select>

      {eliminationLog.length === 0 ? (
        <p style={{ fontStyle: "italic" }}>No eliminations yet for this playlist.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            maxHeight: "200px",
            overflowY: "auto",
            border: "1px solid #ddd",
            borderRadius: "6px",
            background: "#fff",
          }}
        >
          {eliminationLog
            ?.filter(Boolean) // remove null or undefined entries
            .map((entry, index) => (
            <div
              key={i}
              style={{
                borderBottom: "1px solid #eee",
                padding: "0.5rem",
              }}
            >
              <strong>{entry.song.title}</strong>
              {entry.song.artist && <span> — {entry.song.artist}</span>}
              <br />
              <small>
                Eliminated by <strong>{entry.eliminatedBy}</strong> (Round{" "}
                {entry.eliminatedRound})
              </small>
              {entry.comment && (
                <p
                  style={{
                    fontStyle: "italic",
                    margin: "0.3rem 0 0 0.5rem",
                    color: "#555",
                  }}
                >
                  “{entry.comment}”
                </p>
              ) || 'No comment'}
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}
