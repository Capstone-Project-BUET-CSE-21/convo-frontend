import PropTypes from "prop-types";
import { ParticipantAvatar, MutedIndicator, RemoteParticipantTile } from "../../components/MeetingRoomHelperComponents";

// How many tiles go in each row, for a given total participant count.
// 1–3: everyone in a single row (solo gets a locked aspect ratio there, 2–3
// stretch edge to edge — see MeetingRoom.css). 4+: split into rows of
// roughly sqrt(count) tiles each, smaller rows first — e.g. 4 -> [2, 2],
// 5 -> [2, 3], 7 -> [2, 2, 3], 9 -> [3, 3, 3] — so tiles stay a consistent,
// sensible size instead of one long strip.
const getRowSizes = (count) => {
  if (count <= 3) return [count];

  const maxPerRow = Math.ceil(Math.sqrt(count));
  const rowCount = Math.ceil(count / maxPerRow);
  const base = Math.floor(count / rowCount);
  const remainder = count % rowCount;

  return Array.from({ length: rowCount }, (_, i) => base + (i >= rowCount - remainder ? 1 : 0));
};

// Splits a flat list of tile elements into rows per getRowSizes.
const chunkIntoRows = (tiles) => {
  const rowSizes = getRowSizes(tiles.length);
  const rows = [];
  let cursor = 0;
  for (const size of rowSizes) {
    rows.push(tiles.slice(cursor, cursor + size));
    cursor += size;
  }
  return rows;
};

const MeetingRoomScene = ({
  authUser,
  peers,
  peerNames,
  peerVideoStates,
  peerAudioStates,
  peerConnectionStates,
  isAudioEnabled,
  isVideoEnabled,
  localVideoRef,
  remoteVideosRef,
}) => {
  const totalParticipants = peers.length + 1;
  // Video renders as soon as the camera track is on — it's no longer gated on
  // the audio watermark pipeline (that only gates the in-app recorder now).
  const isLocalVideoVisible = isVideoEnabled;

  const tiles = [
    <div className="participant-card participant-card--self" key="self">
      <video
        ref={localVideoRef}
        className={`participant-video ${!isLocalVideoVisible ? "participant-video--hidden" : ""}`}
        autoPlay
        playsInline
        muted
      />

      {!isLocalVideoVisible && (
        <ParticipantAvatar name={authUser.displayName} size="large" />
      )}

      {!isAudioEnabled && <MutedIndicator />}

      <span className="participant-label">
        {authUser.displayName} (You)
      </span>
    </div>,
    ...peers.map((peerId) => (
      <RemoteParticipantTile
        key={peerId}
        peerId={peerId}
        peerName={peerNames.get(peerId) || "Guest"}
        remoteVideosRef={remoteVideosRef}
        isVideoEnabled={peerVideoStates.get(peerId) !== false}
        isAudioEnabled={peerAudioStates.get(peerId) !== false}
        connectionState={peerConnectionStates.get(peerId)}
      />
    )),
  ];

  const rows = chunkIntoRows(tiles);

  return (
    <main className="meeting-stage">
      <section
        className="participants-grid"
        data-tile-count={totalParticipants}
        style={{ "--tile-rows": rows.length }}
      >
        {rows.map((rowTiles, rowIndex) => (
          <div
            className="participants-row"
            key={rowIndex}
            style={{ "--row-size": rowTiles.length }}
          >
            {rowTiles}
          </div>
        ))}

        {peers.length === 0 && (
          <div className="participants-grid__waiting">
            <p className="participants-grid__waiting-text">Waiting for others to join…</p>
          </div>
        )}
      </section>
    </main>
  );
};

MeetingRoomScene.propTypes = {
  authUser: PropTypes.shape({
    displayName: PropTypes.string.isRequired,
  }).isRequired,
  peers: PropTypes.arrayOf(PropTypes.string).isRequired,
  peerNames: PropTypes.instanceOf(Map).isRequired,
  peerVideoStates: PropTypes.instanceOf(Map).isRequired,
  peerAudioStates: PropTypes.instanceOf(Map).isRequired,
  peerConnectionStates: PropTypes.instanceOf(Map).isRequired,
  isAudioEnabled: PropTypes.bool.isRequired,
  isVideoEnabled: PropTypes.bool.isRequired,
  localVideoRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  remoteVideosRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
};

export default MeetingRoomScene;
