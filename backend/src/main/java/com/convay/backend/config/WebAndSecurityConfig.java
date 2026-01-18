package com.convay.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.convay.backend.Credentials;



@Configuration
public class WebAndSecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // disable CSRF (needed for POST requests from Postman / JS clients)
            .csrf(csrf -> csrf.disable())

            // allow all requests without authentication
            .authorizeHttpRequests(auth -> auth
                .anyRequest().permitAll()
            );

        return http.build();
    }

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/**") // all endpoints
                        .allowedOrigins(
                            Credentials.MONA_FRONTEND_URL,
                            Credentials.FARIHA_FRONTEND_URL,
                            Credentials.DEBO_FRONTEND_URL, 
                            Credentials.TABA_FRONTEND_URL,
                            "http://localhost:5173"
                        ) // allow this origin
                        .allowedMethods("GET","POST","PUT","DELETE","OPTIONS")
                        .allowedHeaders("*");
            }
        };
    }
}
