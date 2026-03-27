# Convo Frontend 
Frontend for the CSE 450 Capstone Project
Convo,a full-stack web application, built with **React and Vite**.

Backend Repository:
https://github.com/Capstone-Project-BUET-CSE-21/convo-backend

---

# Table of Contents

* Project Overview
* Project Structure
* Notable & Important Components
* Prerequisites
* How to Run the Frontend Locally
* Architecture
* Technologies Used
* Troubleshooting

---

# Project Overview

The Convay frontend provides the **user interface and client-side functionality** for the application.

Features include:

* React component-based architecture
* Client-side routing
* Real-time communication with backend via WebSockets
* Interactive collaborative room interface

The frontend communicates with the backend using:

* HTTP REST API requests
* WebSocket connections

---

# Project Structure

```
frontend/
├── package.json
├── vite.config.js
├── eslint.config.js
├── index.html
├── public/
│   └── assets
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── App.css
    ├── index.css
    ├── Homepage.jsx
    ├── MeetingRoom.jsx
    └── other components
.gitignore
README.md
```

---

# Notable & Important Components

## main.jsx

Entry point of the React application.

Responsibilities:

* Mounts the React app to the DOM
* Renders the root component

---

## App.jsx

Root React component.

Responsibilities:

* Main layout structure
* Application routing
* Parent component for other UI components

---

## Homepage.jsx

Landing page component.

Responsibilities:

* Initial user interface
* Entry point to create or join rooms

---

## MeetingRoom.jsx

Core collaborative page.

Responsibilities:

* Handles WebSocket connections
* Manages real-time room communication
* Displays collaborative interface

---

# Prerequisites

Ensure the following tools are installed.

### Node.js

Version **16 or higher**

Check installation:

```
node -v
```

---

### npm

Version **8+**

Check installation:

```
npm -v
```

---

### Optional

* Git
* VS Code

---

# How to Run the Frontend Locally

### Step 1 — Clone the repository

```
git clone https://github.com/Capstone-Project-BUET-CSE-21/convay-frontend
cd convay-frontend
```

---

### Step 2 — Install dependencies

```
npm install
```

---

### Step 3 — Start development server

```
npm run dev
```

---

### Step 4 — Open the application

The development server runs at:

```
http://localhost:5173
```

---

# Available Scripts

| Command         | Description              |
| --------------- | ------------------------ |
| npm run dev     | Start development server |
| npm run build   | Build production bundle  |
| npm run preview | Preview production build |
| npm run lint    | Run ESLint               |

---

# Architecture

The frontend interacts with the backend using:

### REST API

HTTP requests to backend endpoints.

Example flow:

1. User action
2. HTTP request sent to backend
3. Backend returns JSON response

---

### WebSocket Communication

Real-time updates occur through WebSocket signalling.

Flow:

1. Client opens WebSocket connection
2. Backend signalling server relays messages
3. UI updates instantly

---

# Technologies Used

| Component        | Technology   | Version |
| ---------------- | ------------ | ------- |
| Frontend Library | React        | 19.2.0  |
| Router           | React Router | 7.12.0  |
| Build Tool       | Vite         | 7.2.4   |
| Package Manager  | npm          | 8+      |
| Code Linter      | ESLint       | 9.39.1  |

---

# Troubleshooting

## Frontend Won't Start

Delete dependencies and reinstall:

```
rm -rf node_modules
npm install
```

---

## Port Already in Use

If port **5173** is busy Vite will automatically assign another port.

Check terminal output for the new URL.

---

## WebSocket Connection Issues

Ensure:

* Backend server is running on `http://localhost:8080`
* Frontend is connecting to correct WebSocket endpoint
