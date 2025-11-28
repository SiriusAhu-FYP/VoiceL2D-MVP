"""
Live2D Controller - Business logic for Live2D frontend interaction.

This module encapsulates all the logic for:
- Loading and caching expression mappings
- Communicating with the frontend API
- Mapping abstract emotions to concrete expression IDs
- Executing expressions with fallback mechanisms
"""

import json
import random
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests


class Live2DController:
    """
    Controller for managing Live2D model expressions and interactions.
    
    This class handles:
    - Expression mapping data loading and caching
    - Frontend API communication
    - Emotion-to-expression mapping logic
    - Fallback mechanisms for missing data
    """
    
    def __init__(self, frontend_url: str = "http://localhost:7788"):
        """
        Initialize the Live2D controller.
        
        Args:
            frontend_url: Base URL of the frontend server
        """
        self.frontend_url = frontend_url
        self.expression_mapping: Dict[str, Dict[str, List[str]]] = {}
        self._load_expression_mapping()
    
    def _load_expression_mapping(self) -> None:
        """Load expression mapping from JSON file."""
        mapping_path = Path(__file__).parent.parent / "expression_mapping.json"
        try:
            with open(mapping_path, "r", encoding="utf-8") as f:
                self.expression_mapping = json.load(f)
            print(f"[Live2DController] Loaded expression mappings for {len(self.expression_mapping)} models")
        except FileNotFoundError:
            print(f"[Live2DController] Warning: expression_mapping.json not found at {mapping_path}")
            self.expression_mapping = {}
        except json.JSONDecodeError as e:
            print(f"[Live2DController] Error parsing expression_mapping.json: {e}")
            self.expression_mapping = {}
    
    def _request_get(self, path: str) -> Optional[Dict[str, Any]]:
        """
        Send GET request to frontend API.
        
        Args:
            path: API endpoint path (e.g., "/api/live2d/state")
        
        Returns:
            JSON response dict, or None if request failed
        """
        try:
            response = requests.get(f"{self.frontend_url}{path}", timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            print(f"[Live2DController] GET {path} error: {exc}")
            return None
    
    def _request_post(self, path: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Send POST request to frontend API.
        
        Args:
            path: API endpoint path
            payload: JSON data to send
        
        Returns:
            JSON response dict, or None if request failed
        """
        try:
            response = requests.post(
                f"{self.frontend_url}{path}",
                json=payload,
                timeout=5
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            print(f"[Live2DController] POST {path} error: {exc}")
            return None
    
    def get_current_model(self) -> Optional[str]:
        """
        Get the currently active Live2D model name from frontend.
        
        Returns:
            Model name string, or None if unavailable
        """
        response = self._request_get("/api/live2d/state")
        if not response or not response.get("success"):
            print("[Live2DController] Failed to get current model state")
            return None
        
        data = response.get("data") or {}
        model_name = data.get("currentModel")
        
        if not model_name:
            print("[Live2DController] No model is currently loaded")
            return None
        
        return model_name
    
    def map_emotion_to_expression(
        self,
        emotion: str,
        model_name: str
    ) -> Optional[str]:
        """
        Map an abstract emotion to a concrete expression ID for a specific model.
        
        Args:
            emotion: Abstract emotion category (e.g., "happy", "sad", "neutral")
            model_name: Name of the Live2D model
        
        Returns:
            Expression ID string, or None if mapping not found
        """
        # Check if model exists in mapping
        if model_name not in self.expression_mapping:
            print(f"[Live2DController] ⚠️  Model '{model_name}' not found in expression_mapping.json")
            return None
        
        model_expressions = self.expression_mapping[model_name]
        
        # Check if emotion exists for this model
        if emotion not in model_expressions:
            print(f"[Live2DController] ⚠️  Emotion '{emotion}' not found for model '{model_name}'")
            print(f"[Live2DController] Available emotions: {list(model_expressions.keys())}")
            return None
        
        # Get expression list
        expression_list = model_expressions[emotion]
        if not expression_list:
            print(f"[Live2DController] ⚠️  Empty expression list for '{emotion}' in model '{model_name}'")
            return None
        
        # Randomly select one expression to add variety
        selected_expression = random.choice(expression_list)
        print(f"[Live2DController] Mapped '{emotion}' → '{selected_expression}' (from {len(expression_list)} options)")
        
        return selected_expression
    
    def play_expression(self, expression_id: str) -> bool:
        """
        Play a specific expression on the frontend.
        
        Args:
            expression_id: The expression ID/name to play
        
        Returns:
            True if successful, False otherwise
        """
        response = self._request_post("/api/live2d/expression", {"expression": expression_id})
        
        if not response:
            print(f"[Live2DController] ❌ Failed to contact frontend for expression: {expression_id}")
            return False
        
        if not response.get("success"):
            error = response.get("error", "Unknown error")
            print(f"[Live2DController] ❌ Failed to play expression '{expression_id}': {error}")
            return False
        
        print(f"[Live2DController] ✅ Successfully played expression: {expression_id}")
        return True
    
    def play_random_expression_fallback(self) -> bool:
        """
        Fallback: Play a random expression using frontend's random API.
        
        Returns:
            True if successful, False otherwise
        """
        print("[Live2DController] Using fallback: playing random expression")
        response = self._request_post("/api/live2d/random/expression", {})
        
        if not response:
            print("[Live2DController] ❌ Failed to contact frontend for random expression")
            return False
        
        if not response.get("success"):
            error = response.get("error", "Unknown error")
            print(f"[Live2DController] ❌ Random expression failed: {error}")
            return False
        
        expression_data = response.get("data") or {}
        expression_name = expression_data.get("name", "unknown")
        print(f"[Live2DController] ✅ Played random expression: {expression_name}")
        return True
    
    def execute_expression_by_emotion(self, emotion: str) -> str:
        """
        Main logic: Execute an expression based on abstract emotion category.
        
        This is the core function that:
        1. Gets the current model name
        2. Maps emotion to expression ID
        3. Plays the expression
        4. Falls back to random expression if mapping fails
        
        Args:
            emotion: Abstract emotion category (e.g., "happy", "sad", "neutral",
                    "surprise", "speechless")
        
        Returns:
            Status message describing what happened
        """
        print(f"\n[Live2DController] ========================================")
        print(f"[Live2DController] Executing emotion: '{emotion}'")
        print(f"[Live2DController] ========================================")
        
        # Step 1: Get current model
        model_name = self.get_current_model()
        if not model_name:
            return (
                "❌ Unable to determine current model. "
                "Is the frontend running? Please ensure `pnpm dev` is active."
            )
        
        print(f"[Live2DController] Current model: {model_name}")
        
        # Step 2: Map emotion to expression ID
        expression_id = self.map_emotion_to_expression(emotion, model_name)
        
        # Step 3 or Fallback: Play expression or use random
        if expression_id:
            # Found mapping, play the specific expression
            success = self.play_expression(expression_id)
            if success:
                return (
                    f"✅ Played expression '{expression_id}' for emotion '{emotion}' "
                    f"(model: {model_name})"
                )
            else:
                return (
                    f"❌ Failed to play expression '{expression_id}' "
                    f"(emotion: {emotion}, model: {model_name})"
                )
        else:
            # No mapping found, use fallback
            print(f"[Live2DController] ⚠️  No mapping found for emotion '{emotion}' and model '{model_name}'")
            print(f"[Live2DController] Available models in mapping: {list(self.expression_mapping.keys())}")
            
            # Try fallback: play random expression
            fallback_success = self.play_random_expression_fallback()
            if fallback_success:
                return (
                    f"⚠️  Emotion '{emotion}' not mapped for model '{model_name}'. "
                    f"Played a random expression as fallback. "
                    f"Please add mapping to expression_mapping.json."
                )
            else:
                return (
                    f"❌ Failed to map emotion '{emotion}' for model '{model_name}', "
                    f"and fallback random expression also failed. "
                    f"Please check frontend connection and expression_mapping.json."
                )


# ========================================
# Global controller instance
# ========================================

_controller_instance: Optional[Live2DController] = None


def get_controller(frontend_url: str = "http://localhost:7788") -> Live2DController:
    """
    Get or create the global Live2DController instance.
    
    Args:
        frontend_url: Base URL of the frontend server
    
    Returns:
        The singleton Live2DController instance
    """
    global _controller_instance
    if _controller_instance is None:
        _controller_instance = Live2DController(frontend_url)
    return _controller_instance


def execute_expression_by_emotion(emotion: str, frontend_url: str = "http://localhost:7788") -> str:
    """
    Convenience function: Execute expression by emotion using global controller.
    
    Args:
        emotion: Abstract emotion category (e.g., "happy", "sad", "neutral",
                "surprise", "speechless")
        frontend_url: Base URL of the frontend server (default: http://localhost:7788)
    
    Returns:
        Status message describing what happened
    """
    controller = get_controller(frontend_url)
    return controller.execute_expression_by_emotion(emotion)

