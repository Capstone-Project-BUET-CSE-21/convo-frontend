import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";

const Homepage = ({ localStream, command, setCommand }) => {
    const [isEnteringMeetingId, setIsEnteringMeetingId] = useState(false);
    const [meetingId, setMeetingId] = useState("");

    const localVideoRef = useRef(null);

    const navigate = useNavigate();

    const startWritingMeetId = (cmd) => {
        setIsEnteringMeetingId(true);
        setCommand(cmd);
    }

    useEffect(() => {
        if (!localStream) return;
        localVideoRef.current.srcObject = localStream;
    }, [localVideoRef, localStream]);

    return (
        <>
            <video ref={localVideoRef} autoPlay muted style={{ width: '400px', transform: "scaleX(-1)" }} ></video>
            <br/><br/>

            {!isEnteringMeetingId ? <div className="card">
                <button onClick={() => startWritingMeetId("Start")}>Start a meeting</button>
                <span style={{margin: "15px"}}></span>
                <button onClick={() => startWritingMeetId("Join")}>Join a meeting</button>
            </div> :
            <div>
                <input type="text" placeholder="Enter Meeting ID" value={meetingId} onChange={(e) => setMeetingId(e.target.value)} />
                <span style={{margin: "10px"}}></span>
                <button onClick={() => navigate(`room/${meetingId}`)}>{command}</button>
            </div>}
        </>
    );
}

Homepage.propTypes = {
    localStream: PropTypes.object.isRequired,
    command: PropTypes.string.isRequired,
    setCommand: PropTypes.func.isRequired
};


export default Homepage;