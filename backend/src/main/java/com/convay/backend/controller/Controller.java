package com.convay.backend.controller;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.convay.backend.JSON;

@RestController
public class Controller {
    private int counter = 0;

    @GetMapping("/process")
    public String process() throws Exception {
        Map<String, Object> data = Map.of("message", "" + ++counter);
        // Logic to process data goes here
        System.out.println("Processing data");

        return JSON.stringify(data);
    }
    

    @PostMapping("/process")
    public String processData(@RequestBody String body) throws Exception {
        Map<String, Object> data = JSON.parse(body);
        // Logic to process data goes here
        System.out.println("Processing data: " + data.get("message"));

        return "Data processed successfully";
    }
}
