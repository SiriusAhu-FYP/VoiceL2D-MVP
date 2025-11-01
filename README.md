# VoiceL2D MVP

This repository aims to implement a simple voice-controlled Live2D application, with `Python` (`FastAPI`) as the backend, and a simple vanilla `HTML/JavaScript` page (`Cubism`) as the frontend. The LLM, ASR and TTS services are all provided by `ZhipuAI` (`BigModel`).

The goal of this project is to create a MVP to explore the feasibility of using voice commands to control a Live2D character, which can be further expanded in the future.

## Checklist

### Backend

- [ ] Basic FastAPI server setup
- [x] Integrate ZhipuAI APIs
    - [x] LLM (Large Language Model)
    - [x] ASR (Automatic Speech Recognition)
    - [x] TTS (Text-to-Speech)
- [ ] Define API endpoints
- [ ] Connect to frontend

### Frontend
- [ ] Connection to backend API
    - [ ] A simple UI layout
    - [ ] A display area for text responses received from the backend
    - [ ] Connection to play audio responses received from the backend
    - [ ] Avalidation of voice input recording and sending to backend
- [ ] `Cubism` model integration

### Advanced
- [ ] Define commands to control Live2D model
    - [ ] Basic commands
    - [ ] Make LLM understand more complex commands

...