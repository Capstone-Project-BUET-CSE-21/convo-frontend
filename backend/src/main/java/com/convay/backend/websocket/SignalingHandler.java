package com.convay.backend.websocket;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.convay.backend.JSON;

import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class SignalingHandler extends TextWebSocketHandler {

    // Map roomId -> set of sessions in that room
    private final Map<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();

    @Override
    public void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {

        // Expect message in JSON format
        // {
        //   "type": "join" | "offer" | "answer" | "ice",
        //   "roomId": "room1",
        //   "payload": { ... }
        // }

        String payload = message.getPayload();
        Map<String, Object> data = JSON.parse(payload);

        String type = (String) data.get("type");
        String roomId = (String) data.get("roomId");
        Object msgPayload = data.get("payload");

        switch (type) {
            case "join" -> {
                rooms.putIfAbsent(roomId, new CopyOnWriteArraySet<>());
                rooms.get(roomId).add(session);
                System.out.println("Session joined room " + roomId);
            }

            case "offer", "answer", "ice" -> {
                // Broadcast to all other peers in the room
                Set<WebSocketSession> sessions = rooms.get(roomId);
                if (sessions != null) {
                    for (WebSocketSession s : sessions) {
                        if (!s.equals(session)) {
                            s.sendMessage(new TextMessage(payload));
                        }
                    }
                }
            }

            default -> System.out.println("Unknown message type: " + type);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        // Remove from all rooms
        for (Set<WebSocketSession> set : rooms.values()) {
            set.remove(session);
        }
        System.out.println("Session disconnected: " + session.getId());
    }
}
