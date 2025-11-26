# VoiceL2D MVP

This repository aims to implement a simple voice-controlled Live2D application, with `Python` (`FastMCP`) as the backend, and a simple vanilla `HTML/JavaScript` page (`Cubism`) as the frontend. The LLM, ASR and TTS services are all provided by `ZhipuAI` (`BigModel`).

The goal of this project is to create a MVP to explore the feasibility of using voice commands to control a Live2D character, which can be further expanded in the future.

## How to use
Do the following things in order, we need **3 terminals**:
1. Launch the frontend in the first terminal:
    ```bash
    cd frontend
    pnpm dev
    ```
If first time using, make sure to install dependencies first:
    ```bash
    pnpm install
    ```

2. Launch the MCP server in the second terminal:
    ```bash
    uv run mcp-server/server.py
    ```

3. Launch the MCP client in the third terminal, which is the terminal to interact with:
    ```bash
    uv run mcp-client/client-demo.py
    ```

## Checklist

### Backend

- [x] Basic FastMCP server setup
- [x] Integrate ZhipuAI APIs
    - [x] LLM (Large Language Model)
    - [x] ASR (Automatic Speech Recognition)
    - [x] TTS (Text-to-Speech)
- [x] Define API endpoints
- [x] Connect to frontend

### Frontend
- [ ] Connection to backend API
    - [x] A simple UI layout
    - [ ] A display area for text responses received from the backend
    - [ ] Connection to play audio responses received from the backend
    - [ ] Avalidation of voice input recording and sending to backend
- [x] `Cubism` model integration

### Advanced
- [ ] Define commands to control Live2D model
    - [ ] Basic commands
    - [ ] Make LLM understand more complex commands

...