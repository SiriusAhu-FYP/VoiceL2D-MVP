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

3. Launch the client in the third terminal:
    ```bash
    # Voice-controlled mode (microphone input + GLM-ASR)
    uv run client/client.py --voice

    # Interactive mode (keyboard input)
    uv run client/client.py --interactive

    # Simple mode (no MCP integration)
    uv run client/client.py --simple
    ```

### Client Modes
- **Voice Mode** (`--voice`): Uses microphone with VAD (Voice Activity Detection) to capture speech, transcribes with GLM-ASR, and responds with TTS.
- **Interactive Mode** (`--interactive`, default): Keyboard input in terminal, connects to MCP server for Live2D expressions.
- **Simple Mode** (`--simple`): Keyboard input without MCP integration.

## Checklist

### Backend

- [x] Basic FastMCP server setup
- [x] Integrate ZhipuAI APIs
    - [x] LLM (Large Language Model)
    - [x] ASR (Automatic Speech Recognition) with GLM-ASR
    - [x] TTS (Text-to-Speech)
- [x] Define API endpoints
- [x] Connect to frontend
- [x] Microphone recording with VAD (Voice Activity Detection)

### Frontend
- [x] Connection to backend API
    - [x] A simple UI layout
    - [x] Chat panel for displaying conversation (bubble-style messages)
    - [x] Connection to play audio responses received from the backend
    - [x] Text input box for manual message entry
- [x] `Cubism` model integration

### Advanced
- [x] Define commands to control Live2D model
    - [x] Basic commands
    - [x] Make LLM understand more complex commands

- [ ] Define more Personas
- [ ] Use `Loguru` for logging
...