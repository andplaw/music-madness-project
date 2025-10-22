import React, { useState, useEffect } from "react";

/**
 * EliminationHistoryViewer
 * 
 * Props:
 *  - playlists: array of playlist objects (each: { alias, songs: [...], eliminationLog: [...] })
 *  - finalResults: optional array of winning song objects (to mark non-winners as "Eliminated in Final Vote")
 */
export default function EliminationHistoryViewer({ playlists, finalResults = [] }) {
  const [selectedPlaylistIndex, setSelectedPlaylistIndex] = useState(0);

  useEffect(() => {
    if (!Array.isArray(playlists) || playlists.length === 0) {
      setSelectedPlaylistIndex(0);
      return;
    }
    if (selectedPlaylistIndex >= playlists.length) {
      setSelectedPlaylistIndex(0);
    }
  }, [playlists?.length]); // eslint-disable-line

  if (!Array.isArray(playlists) || playlists.length === 0) {
    return <p>No playlists available yet.</p>;
  }

  const selectedPlaylist = playlists[selectedPlaylistIndex] || playlists[0];
  const eliminationLog = Array.isArray(selectedPlaylist?.eliminationLog)
    ? selectedPlaylist.eliminationLog
    : [];

  // Normalize elimination log into a map keyed by song title (for quick lookup)
  const eliminationMap = {};
  eliminationLog.forEach(entry => {
    const songObj = entry.songInfo ?? entry.song ?? {};
    const key = (songObj.title ?? songObj.name ?? "").trim().toLowerCase();
    if (!key) return;

    eliminationMap[key] = {
      eliminatedRound: entry.eliminatedRound ?? entry.round ?? null,
      eliminatedBy: entry.eliminatedBy ?? null,
      comment: entry.comment ?? entry.commentText ?? "",
    };
  });

  // Build normalized list of songs for the selected playlist
  const songs = Array.isArray(selectedPlaylist.songs)
    ? selectedPlaylist.songs
    : [];

  // Track which songs won final vote (if finalResults provided)
  if (!(finalResults === null)) {
    const winningSongTitles = new Set(
      finalResults
        ?.map(r => r.song?.title?.toLowerCase())
        .filter(Boolean)
    );
  }

  return (
    <div className="elimination-history-container" style={{ marginTop: "1rem" }}>
      <h3>🎧 Elimination History</h3>

      <label style={{ display: "block", marginBottom: 8 }}>
        View playlist:
      </label>

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

      {songs.length === 0 ? (
        <p style={{ fontStyle: "italic" }}>No songs in this playlist.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            maxHeight: "350px",
            overflowY: "auto",
            border: "1px solid #ddd",
            borderRadius: "6px",
            background: "#fff",
          }}
        >
          {songs.map((song, index) => {
            const title = song.title ?? song.name ?? "Untitled";
            const artist = song.artist ?? "";
            const link = song.link ?? "";

            const key = title.trim().toLowerCase();
            const elimInfo = eliminationMap[key];

            // Determine elimination status
            let eliminated = false;
            let eliminationLabel = "";
            let comment = "";

            if (elimInfo) {
              eliminated = true;
              eliminationLabel = `Eliminated by ${elimInfo.eliminatedBy ?? "Unknown"} (Round ${elimInfo.eliminatedRound ?? "?"})`;
              comment = elimInfo.comment ?? "";
            } else if (
              finalResults.length > 0 &&
              !winningSongTitles.has(title.toLowerCase())
            ) {
              eliminated = true;
              eliminationLabel = "Eliminated in Final Vote";
            }

            return (
              <li
                key={index}
                style={{
                  borderBottom: "1px solid #eee",
                  padding: "0.5rem",
                  backgroundColor: eliminated ? "#fff3f3" : "#f9fff9",
                }}
              >
                <div>
                  <strong>{title}</strong>
                  {artist ? <span> — {artist}</span> : null}
                  {link && (
                    <>
                      {" "}
                      <a href={link} target="_blank" rel="noopener noreferrer">
                        Listen
                      </a>
                    </>
                  )}
                </div>

                {eliminated ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#a00",
                      marginTop: 6,
                      fontWeight: 500,
                    }}
                  >
                    {eliminationLabel}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#060",
                      marginTop: 6,
                      fontWeight: 500,
                    }}
                  >
                    Still in play
                  </div>
                )}

                {eliminated && comment && (
                  <div style={{ marginTop: 6, color: "#333" }}>
                    <blockquote
                      style={{
                        margin: 0,
                        fontStyle: "italic",
                        color: "#555",
                      }}
                    >
                      “{comment}”
                    </blockquote>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
