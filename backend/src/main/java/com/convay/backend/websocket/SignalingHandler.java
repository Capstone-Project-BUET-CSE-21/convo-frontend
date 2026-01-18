package com.convay.backend.websocket;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.convay.backend.JSON;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.Map;
import java.util.Set;

@Component
public class SignalingHandler extends TextWebSocketHandler {

    // Map roomId -> set of sessions in that room
    private final Map<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();
    // Map session -> roomId for tracking which room each session belongs to
    private final Map<WebSocketSession, String> sessionToRoom = new ConcurrentHashMap<>();



    @Override
    public void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        Map<String, Object> data = JSON.parse(payload);

        String type = (String) data.get("type");
        String roomId = (String) data.get("roomId");
        // Object msgPayload = data.get("payload");

        String senderId = session.getId();

        switch (type) {
            case "start" -> {
                if (rooms.containsKey(roomId)) {
                    Map<String, Object> errorMsg = Map.of(
                        "type", "room-already-exists"
                    );
                    session.sendMessage(new TextMessage(JSON.stringify(errorMsg)));
                } else {
                    rooms.put(roomId, new CopyOnWriteArraySet<>());
                    rooms.get(roomId).add(session);
                    // Store peerId mapping
                    sessionToRoom.put(session, roomId);
                    System.out.println("Room " + roomId + " created by peer " + senderId);
                }
            }

            case "join" -> {
                if (!rooms.containsKey(roomId)) {
                    Map<String, Object> errorMsg = Map.of(
                        "type", "room-not-found"
                    );
                    session.sendMessage(new TextMessage(JSON.stringify(errorMsg)));
                } else {
                    Set<WebSocketSession> roomSessions = rooms.get(roomId);
                    roomSessions.add(session);
                    // Store peerId mapping
                    sessionToRoom.put(session, roomId);
                    
                    // Send all existing peers to the newly joined peer
                    Map<String, Object> existingPeersMsg = Map.of(
                        "type", "existing-peers",
                        "peers", roomSessions.stream()
                                .filter(s -> !s.equals(session))
                                .map(s -> s.getId())
                                .toList()
                    );
                    session.sendMessage(new TextMessage(JSON.stringify(existingPeersMsg)));
                    
                    // Notify all existing peers about the new peer joining
                    Map<String, Object> newPeerMsg = Map.of(
                        "type", "peer-joined",
                        "peerId", senderId
                    );
                    for (WebSocketSession s : roomSessions) {
                        if (!s.equals(session)) {
                            try {
                                s.sendMessage(new TextMessage(JSON.stringify(newPeerMsg)));
                            } catch (Exception e) {
                                System.err.println("Error notifying peer about new join: " + e.getMessage());
                            }
                        }
                    }
                    System.out.println("Peer " + senderId + " joined room " + roomId + 
                                    " (Total peers in room: " + roomSessions.size() + ")");
                }
            }

            case "offer", "answer", "ice" -> {
                String recipientId = (String) data.get("to");
                Set<WebSocketSession> sessions = rooms.get(roomId);

                if (sessions != null) {
                    if (recipientId != null) {
                        // Send to specific peer
                        for (WebSocketSession s : sessions) {
                            String sId = s.getId();
                            if (sId.equals(recipientId) && !s.equals(session)) {
                                Object msgPayload = data.get("payload");
                                Map<String, Object> routedMsg = Map.of(
                                    "type", type,
                                    "from", senderId,
                                    "payload", msgPayload
                                );
                                try {
                                    s.sendMessage(new TextMessage(JSON.stringify(routedMsg)));
                                    System.out.println("Routed " + type + " from " + senderId + " to " + recipientId);
                                } catch (Exception e) {
                                    System.err.println("Error routing message: " + e.getMessage());
                                }
                                break;
                            }
                        }
                    } else {
                        // Broadcast to all other peers
                        for (WebSocketSession s : sessions) {
                            if (!s.equals(session)) {
                                Object msgPayload = data.get("payload");
                                Map<String, Object> broadcastMsg = Map.of(
                                    "type", type,
                                    "from", senderId,
                                    "payload", msgPayload
                                );
                                try {
                                    s.sendMessage(new TextMessage(JSON.stringify(broadcastMsg)));
                                } catch (Exception e) {
                                    System.err.println("Error broadcasting message: " + e.getMessage());
                                }
                            }
                        }
                    }
                }
            }


            default -> System.out.println("Unknown message type: " + type);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        // Get peerId BEFORE removing from map
        String peerId = session.getId();
        String roomId = sessionToRoom.get(session);
        
        System.out.println("Peer " + peerId + " attempting to disconnect from room " + roomId);
        
        // Remove session from room and notify others
        if (roomId != null) {
            Set<WebSocketSession> roomSessions = rooms.get(roomId);
            if (roomSessions != null && roomSessions.contains(session)) {
                roomSessions.remove(session);
                
                // Notify remaining peers that this peer left
                Map<String, Object> peerLeftMsg = Map.of(
                    "type", "peer-left",
                    "peerId", peerId
                );
                
                for (WebSocketSession remainingSession : roomSessions) {
                    try {
                        remainingSession.sendMessage(new TextMessage(JSON.stringify(peerLeftMsg)));
                        System.out.println("Notified peer about " + peerId + " leaving");
                    } catch (Exception e) {
                        System.err.println("Error notifying peer about disconnect: " + e.getMessage());
                    }
                }
                
                // Clean up empty rooms
                if (roomSessions.isEmpty()) {
                    rooms.remove(roomId);
                    System.out.println("Room " + roomId + " is now empty and has been removed");
                } else {
                    System.out.println("Peer " + peerId + " left room " + roomId + 
                                     " (Remaining peers: " + roomSessions.size() + ")");
                }
            }
        }
        
        // Clean up mappings
        sessionToRoom.remove(session);
        
        System.out.println("Session " + session.getId() + " fully disconnected");
    }
}
