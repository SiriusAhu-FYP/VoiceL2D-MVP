# VoiceL2D MVP

This repository aims to implement a simple voice-controlled Live2D application, with `Python` (`FastMCP`) as the backend, and a simple vanilla `HTML/JavaScript` page (`Cubism`) as the frontend. The LLM, ASR and TTS services can use cloud APIs or local models.

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
    uv run client/client.py
    ```

### Client Behavior

The client runs as a **background service** with no interactive terminal input. All control is done via the frontend:

- **Voice Input Toggle**: Use the microphone button in the chat panel to enable/disable voice input
- **Text Input**: Type messages directly in the chat panel input box
- **TTS Voice Selection**: Click the voice selector dropdown to choose different TTS voices

The client logs important events to the terminal for debugging:
- WebSocket connections
- MCP server connection and available tools
- Voice input state changes
- ASR transcription results
- LLM responses
- TTS generation

### LLM Configuration

The LLM uses ZhipuAI's GLM-4-Flash model. Configure in `.env`:

```ini
ZHIPU_API_KEY=your_zhipu_api_key_here
```

### ASR (Speech-to-Text) Configuration

ASR supports two modes, controlled via the `ASR_MODE` environment variable in `.env`:

#### API Mode (Default)
Uses SiliconCloud's SenseVoice API. Requires network access and API key.

```ini
ASR_MODE=api
SILICONCLOUD_API_KEY=your_siliconcloud_api_key_here
```

Install dependencies (default):
```bash
uv sync
```

#### Local Mode
Uses Faster-Whisper for local speech recognition. Supports GPU acceleration (CUDA 11.8).

```ini
ASR_MODE=local
WHISPER_MODEL=base  # Options: tiny, base, small, medium, large-v3
WHISPER_LANGUAGE=zh  # Language code or empty for auto-detect
```

Install dependencies with local ASR support:
```bash
uv sync --extra local-asr
```

**Note**: Local mode requires PyTorch with CUDA support. The `pyproject.toml` is configured to install PyTorch from the CUDA 11.8 index automatically.

### TTS Voice Configuration

TTS voices are configured in `client/utils/config.toml`. Each voice profile includes:
- GPT model weights path
- SoVITS model weights path  
- Reference audio path
- Prompt text and language

To add a new voice, add a new section to `config.toml`:
```toml
[NewVoice]
gpt_weights_path = "/path/to/voice-e10.ckpt"
sovits_weights_path = "/path/to/voice_e10_s1000.pth"
ref_audio_path = "/path/to/reference_audio.wav"
prompt_text = "Reference audio transcription"
prompt_lang = "zh"
```

## Checklist

### Backend

- [x] Basic FastMCP server setup
- [x] Integrate ZhipuAI APIs
    - [x] LLM (Large Language Model)
    - [x] ASR (Automatic Speech Recognition)
        - [x] GLM-ASR API mode
        - [x] Faster-Whisper local mode (GPU accelerated)
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
    - [x] Voice input toggle button
    - [x] TTS voice selector dropdown
- [x] `Cubism` model integration

### Advanced
- [x] Define commands to control Live2D model
    - [x] Basic commands
    - [x] Make LLM understand more complex commands

- [x] Define more Personas
- [x] Use `Loguru` for logging

...

# Current Status

✅ The basic function is working well, so this repository is considered as a completed MVP and its core functionalities development is considered to be stopped, except some low-level modifications like prompt improvement and voice selection.

⚠️ It's not abnormal if you can't reproduce the result, because some services like GPT-Sovits are hosted on my own server which I don't provide a public access to.

# Future Plans

No future plans! It's time to focus on another MVP!