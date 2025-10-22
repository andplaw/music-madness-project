import React, { useEffect, useState } from "react";
import { socket } from "../socket";

const EliminationHistoryViewer = ({ gameCode }) => {
  const [eliminationHistory, setEliminationHistory] = useState([]);
  const [playlists, setPlaylists] = useState([]);

  useEffect(() => {
    socket.emit("requestEliminationHistory", { gameCode });

    socket.on("eliminationHistory", ({ history, playlists }) => {
      setEliminationHistory(history);
      setPlaylists(playlists);
    });

    socket.on("updateEliminationHistory", (updatedHistory) => {
      setEliminationHistory([...updatedHistory]); // triggers re-render
    });

    socket.on("updatePlaylists", (updatedPlaylists) => {
      setPlaylists([...updatedPlaylists]);
    });

    return () => {
      socket.off("eliminationHistory");
      socket.off("updateEliminationHistory");
      socket.off("updatePlaylists");
    };
  }, [gameCode]);

  return (
    <div>
      <h2>Elimination History</h2>
      {playlists.map((playlist, pIdx) => (
        <div key={pIdx} style={{ marginBottom: "1rem" }}>
          <h3>{playlist.alias}</h3>
          <ul>
            {playlist.songs.map((song, sIdx) => {
              const elimination = eliminationHistory.find(
                (entry) =>
                  entry.song === song &&
                  entry.playlistAlias === playlist.alias
              );

              return (
                <li key={sIdx}>
                  {song}
                  {elimination ? (
                    <>
                      {" "}
                      — Eliminated in Round {elimination.round}
                      {elimination.commentary && (
                        <> ({elimination.commentary})</>
                      )}
                    </>
                  ) : (
                    <> — Still in play</>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default EliminationHistoryViewer;
