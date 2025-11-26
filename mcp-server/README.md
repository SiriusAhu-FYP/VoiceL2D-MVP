# MCP Server for Voice2D MVP

This MCP (Model Context Protocol) server provides an interface for AI assistants to control Live2D character animations through a proxy to the frontend API server.

## Architecture

```
MCP Client (AI/LLM) 
    ↓ (HTTP MCP Protocol)
MCP Server (server.py)
    ↓ (HTTP REST API calls)
Frontend Vite Dev Server (localhost:7788)
    ↓ (Server-Sent Events)
Live2D Component (Browser)
```

## Features

The MCP server exposes 6 tools that AI assistants can call:

### 1. `refresh_data()`
Fetches current model state including:
- Active model name
- Count of available motions, expressions, and sounds

### 2. `play_motion(motion_index: int)`
Plays a specific motion by its index in the current model's motion list.

### 3. `play_random_motion()`
Triggers a random motion (guaranteed different from the previous one).

### 4. `play_random_expression()`
Triggers a random expression (guaranteed different from the previous one).

### 5. `play_random_sound()`
Plays a random sound file from the current model.

### 6. `play_random_combo()`
Triggers a coordinated motion + expression + sound combo.

## Setup

### Prerequisites

1. **Frontend Dev Server** must be running:
   ```bash
   cd frontend
   pnpm dev
   ```
   This starts the Vite server on `http://localhost:7788` with the Live2D API endpoints.

2. **Python environment** with dependencies:
   ```bash
   uv sync
   ```

### Running the MCP Server

```bash
uv run .\mcp-server\server.py
```

The server will start on `http://127.0.0.1:8848/mcp`

### Connecting with a Client

```bash
uv run .\mcp-server\client-demo.py
```

The client will:
1. Connect to the MCP server
2. Discover available tools automatically
3. Allow you to interact with the Live2D character through natural language

## Testing

### Test Frontend API Directly

```bash
uv run python mcp-server/test_backend_api.py
```

This verifies that all frontend API endpoints are responding correctly.

### Test MCP Tools

```bash
Set-Location .\mcp-server
uv run python test_mcp_tools.py
```

This tests each MCP tool function to ensure proper integration with the frontend.

### Manual API Tests

```bash
# Get current state
curl http://localhost:7788/api/live2d/state

# Play motion by index
curl -X POST http://localhost:7788/api/live2d/motion/index -H "Content-Type: application/json" -d '{"index": 0}'

# Random motion
curl -X POST http://localhost:7788/api/live2d/random/motion

# Random expression
curl -X POST http://localhost:7788/api/live2d/random/expression
```

## How It Works

### Request Flow

1. **AI/LLM Client** sends a natural language request
2. **LLM** decides which tool to call and with what parameters
3. **MCP Client** sends tool invocation to MCP Server
4. **MCP Server** translates tool call to HTTP REST API call
5. **Frontend Vite Server** receives request and:
   - Validates parameters
   - Broadcasts SSE event to all connected clients
   - Returns success response
6. **Live2D Component** (in browser) listens to SSE and:
   - Plays the motion/expression/sound
   - Updates the visual display

### State Management

- The frontend maintains the current model state
- The MCP server is stateless and queries frontend on demand
- Each random selection avoids repeating the last choice

## API Endpoints (Frontend)

The MCP server calls these endpoints on `http://localhost:7788`:

- `GET /api/live2d/state` - Get current model and available actions
- `POST /api/live2d/motion/index` - Play motion by index
- `POST /api/live2d/random/motion` - Random motion
- `POST /api/live2d/random/expression` - Random expression  
- `POST /api/live2d/random/sound` - Random sound
- `POST /api/live2d/random/combo` - Random combo

## Troubleshooting

### "Unable to query the frontend state"
- Ensure `pnpm dev` is running in the `frontend` directory
- Check that port 7788 is not blocked

### "Failed to contact the frontend"
- Verify the frontend URL in `server.py` matches your setup (default: `http://localhost:7788`)
- Check network connectivity

### "Invalid request parameters"
- This was caused by middleware interference - fixed by removing `AcceptHeaderFriendlyMiddleware`
- If you see this, ensure you're using the latest version of `server.py`

## Development

### Adding New Tools

1. Define function in `server.py`:
```python
@mcp.tool
def my_new_tool(param: str):
    """Tool description for the AI."""
    # Call frontend API
    result = _post("/api/live2d/new-endpoint", {"param": param})
    return f"Result: {result}"
```

2. Add corresponding endpoint in `frontend/vite.config.ts`

3. Test the tool:
```python
# In test_mcp_tools.py
func = get_tool_func("my_new_tool")
result = func("test_value")
```

## Files

- `server.py` - Main MCP server implementation
- `client-demo.py` - Example client with LLM integration
- `test_backend_api.py` - Frontend API test suite
- `test_mcp_tools.py` - MCP tool test suite
- `tmp/test-server.py` - Simple test server for debugging

## License

Part of the Voice2D MVP project.


