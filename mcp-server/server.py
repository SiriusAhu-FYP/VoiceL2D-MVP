"""Lightweight MCP server that proxies Live2D frontend utilities."""

from typing import Any, Dict, Optional

import requests
from fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from utils import execute_expression_by_emotion, get_controller

mcp = FastMCP("Voice2D MVP MCP Server")
frontend_url = "http://localhost:7788"

# Initialize controller at startup
controller = get_controller(frontend_url)


class AcceptHeaderFriendlyMiddleware(BaseHTTPMiddleware):
    """
    Provide a helpful hint when clients call /mcp without the SSE header.
    The MCP spec requires `Accept: text/event-stream`.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "GET" and request.url.path == "/mcp":
            accept = request.headers.get("accept", "")
            if "text/event-stream" not in accept.lower():
                return JSONResponse({
                    "error": "This endpoint streams MCP events.",
                    "hint": 'Call with header: Accept: text/event-stream (e.g. curl -H "Accept: text/event-stream" http://localhost:8848/mcp).',
                })
        return await call_next(request)


def _handle_response(response: requests.Response) -> Optional[Dict[str, Any]]:
    try:
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        print(f"[MCP] Request failed: {exc}")
        return None


def _get(path: str) -> Optional[Dict[str, Any]]:
    try:
        response = requests.get(f"{frontend_url}{path}", timeout=5)
        return _handle_response(response)
    except requests.RequestException as exc:
        print(f"[MCP] GET {path} error: {exc}")
        return None


def _post(path: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        response = requests.post(f"{frontend_url}{path}", json=payload, timeout=5)
        return _handle_response(response)
    except requests.RequestException as exc:
        print(f"[MCP] POST {path} error: {exc}")
        return None


# @mcp.tool
# def refresh_data():
#     """
#     Fetch the current model state summary.

#     Returns the active model name, total counts of motions/expressions/sounds,
#     and hints if the frontend server is offline.
#     """
#     payload = _get("/api/live2d/state")
#     if not payload or not payload.get("success"):
#         return (
#             "Unable to query the frontend state. Please ensure `pnpm dev` is running."
#         )

#     data = payload.get("data") or {}
#     current_model = data.get("currentModel")
#     actions = data.get("availableActions") or {}
#     return (
#         f"Current model: {current_model or 'unknown'} | "
#         f"motions={len(actions.get('motions') or [])}, "
#         f"expressions={len(actions.get('expressions') or [])}, "
#         f"sounds={len(actions.get('sounds') or [])}"
#     )


# @mcp.tool
# def play_motion(motion_index: int):
#     """
#     Ask the frontend to play a specific motion by index.

#     Frontend validation ensures the index is safe and broadcasts the action via
#     SSE so every connected client stays in sync.
#     """
#     if motion_index < 0:
#         return "Motion index must be a non-negative integer."

#     payload = _post("/api/live2d/motion/index", {"index": motion_index})
#     if not payload:
#         return "Failed to contact the frontend."
#     if not payload.get("success"):
#         return payload.get("error", "Failed to play the requested motion.")

#     motion = payload.get("data") or {}
#     return f"Playing motion: {motion.get('group') or motion.get('name')}"


# @mcp.tool
# def play_random_motion():
#     """
#     Trigger the frontend's random-motion helper.

#     The frontend guarantees the motion differs from the previous one, performs
#     validation, and broadcasts the result through SSE.
#     """
#     payload = _post("/api/live2d/random/motion", {})
#     if not payload:
#         return "Failed to contact the frontend."
#     if not payload.get("success"):
#         return payload.get("error", "Random motion failed.")

#     motion = payload.get("data") or {}
#     return f"Random motion: {motion.get('group') or motion.get('name')}"


# @mcp.tool
# def play_random_expression():
#     """
#     Trigger the frontend's random-expression helper.

#     Ensures the selected expression is valid for the current model and avoids
#     repeating the last expression.
#     """
#     payload = _post("/api/live2d/random/expression", {})
#     if not payload:
#         return "Failed to contact the frontend."
#     if not payload.get("success"):
#         return payload.get("error", "Random expression failed.")

#     expression = payload.get("data") or {}
#     return f"Random expression: {expression.get('name')}"


# @mcp.tool
# def play_random_sound():
#     """
#     Trigger the frontend's random sound helper.

#     Useful for quickly testing available TTS/audio assets.
#     """
#     payload = _post("/api/live2d/random/sound", {})
#     if not payload:
#         return "Failed to contact the frontend."
#     if not payload.get("success"):
#         return payload.get("error", "Random sound failed.")

#     data = payload.get("data") or {}
#     return f"Random sound: {data.get('sound')}"


# @mcp.tool
# def play_random_combo():
#     """
#     Trigger a random motion + expression + sound combo.

#     The frontend enforces uniqueness and returns details about the chosen
#     resources for logging or debugging.
#     """
#     payload = _post("/api/live2d/random/combo", {})
#     if not payload:
#         return "Failed to contact the frontend."
#     if not payload.get("success"):
#         return payload.get("error", "Random combo failed.")

#     data = payload.get("data") or {}
#     motion = data.get("motion") or {}
#     expression = data.get("expression") or {}
#     sound = data.get("sound")
#     return (
#         f"Random combo -> motion: {motion.get('group')}, "
#         f"expression: {expression.get('name')}, sound: {sound}"
#     )


@mcp.tool
def play_expression(emotion: str):
    """
    Play an expression based on abstract emotion category.

    This tool maps abstract emotions to model-specific expression IDs and plays them.
    If the current model is not in the mapping, falls back to random expression.

    Supported emotion categories:
    - "angry": Angry, frustrated, annoyed
    - "neutral": Calm, peaceful, default state
    - "happy": Excited, joyful, celebrating
    - "sad": Sad, regretful, comforting
    - "surprise": Surprised, shocked, unexpected
    - "speechless": Speechless, awkward, embarrassed, helpless, sarcastic

    Examples:
    - play_expression("happy") - Play a happy expression
    - play_expression("sad") - Play a sad expression
    - play_expression("speechless") - Play a speechless/awkward expression

    The system automatically:
    1. Detects the current Live2D model
    2. Maps the emotion to appropriate expression(s) for that model
    3. Randomly selects one if multiple options exist
    4. Falls back to random expression if model is not mapped

    Args:
        emotion: One of: neutral, happy, sad, surprise, speechless

    Returns:
        Status message indicating success or failure
    """
    return execute_expression_by_emotion(emotion, frontend_url)


if __name__ == "__main__":
    mcp.run(transport="http", port=8848)  # TODO: Make port configurable
