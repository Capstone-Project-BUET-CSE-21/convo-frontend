package com.convay.backend;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

public class JSON {

    private static final ObjectMapper mapper = new ObjectMapper();

    // Convert JSON string to Map
    public static Map<String, Object> parse(String json) throws Exception {
        return mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
    }

    // Convert Map/Object to JSON string
    public static String stringify(Map<String, Object> obj) throws Exception {
        return mapper.writeValueAsString(obj);
    }
}
