"""
Voice Activity Detection (VAD) - Detect speech segments in audio.

This module provides functionality to:
- Detect when speech starts and stops
- Segment continuous audio into speech chunks
- Filter out silence and background noise
"""

import threading
import time
from collections import deque
from typing import Callable, Optional

import numpy as np
import webrtcvad
from loguru import logger as lg


class VADDetector:
    """
    Voice Activity Detector using WebRTC VAD.

    Analyzes audio frames to detect speech activity
    and identifies speech segments separated by silence.
    """

    # VAD aggressiveness levels (0-3)
    # 0: Least aggressive, more false positives (detects more as speech)
    # 3: Most aggressive, may miss some speech
    DEFAULT_AGGRESSIVENESS = 2

    # Frame duration must be 10, 20, or 30 ms for webrtcvad
    FRAME_DURATION_MS = 30

    # Silence duration to consider speech ended (in seconds)
    DEFAULT_SILENCE_THRESHOLD = 0.8

    # Minimum speech duration to be considered valid (in seconds)
    MIN_SPEECH_DURATION = 0.3

    def __init__(
        self,
        sample_rate: int = 16000,
        aggressiveness: int = DEFAULT_AGGRESSIVENESS,
        silence_threshold: float = DEFAULT_SILENCE_THRESHOLD,
    ):
        """
        Initialize the VAD detector.

        Args:
            sample_rate: Audio sample rate (must be 8000, 16000, 32000, or 48000)
            aggressiveness: VAD aggressiveness level (0-3)
            silence_threshold: Silence duration in seconds to end speech segment
        """
        if sample_rate not in (8000, 16000, 32000, 48000):
            raise ValueError(
                f"Sample rate must be 8000, 16000, 32000, or 48000, got {sample_rate}"
            )

        self.sample_rate = sample_rate
        self.aggressiveness = aggressiveness
        self.silence_threshold = silence_threshold

        # Calculate frame size in samples
        self.frame_size = int(sample_rate * self.FRAME_DURATION_MS / 1000)

        # Initialize VAD
        self._vad = webrtcvad.Vad(aggressiveness)

        # State tracking
        self._is_speaking = False
        self._silence_frames = 0
        self._frames_for_silence = int(
            silence_threshold * 1000 / self.FRAME_DURATION_MS
        )

        # Speech buffer
        self._speech_buffer: list[np.ndarray] = []

        # Callbacks
        self._on_speech_start: Optional[Callable[[], None]] = None
        self._on_speech_end: Optional[Callable[[np.ndarray], None]] = None

        # Pause state - when paused, VAD will not process audio
        self._paused = False

    def set_callbacks(
        self,
        on_speech_start: Optional[Callable[[], None]] = None,
        on_speech_end: Optional[Callable[[np.ndarray], None]] = None,
    ) -> None:
        """
        Set callback functions for speech events.

        Args:
            on_speech_start: Called when speech starts
            on_speech_end: Called when speech ends, with audio data
        """
        self._on_speech_start = on_speech_start
        self._on_speech_end = on_speech_end

    def pause(self) -> None:
        """Pause VAD processing. No speech will be detected while paused."""
        if not self._paused:
            self._paused = True
            # Clear any ongoing speech detection
            self._is_speaking = False
            self._silence_frames = 0
            self._speech_buffer.clear()
            lg.debug("[VADDetector] Paused")

    def resume(self) -> None:
        """Resume VAD processing."""
        if self._paused:
            self._paused = False
            lg.debug("[VADDetector] Resumed")

    @property
    def is_paused(self) -> bool:
        """Check if VAD is paused."""
        return self._paused

    def process_frame(self, audio_frame: np.ndarray) -> bool:
        """
        Process a single audio frame.

        Args:
            audio_frame: Audio data (must be correct frame size)

        Returns:
            True if frame contains speech, False otherwise
        """
        # Skip processing if paused
        if self._paused:
            return False

        # Ensure correct size
        if len(audio_frame) != self.frame_size:
            lg.warning(
                f"[VADDetector] Frame size mismatch: "
                f"expected {self.frame_size}, got {len(audio_frame)}"
            )
            return False

        # Convert to bytes for webrtcvad
        frame_bytes = audio_frame.astype(np.int16).tobytes()

        # Check if frame contains speech
        try:
            is_speech = self._vad.is_speech(frame_bytes, self.sample_rate)
        except Exception as e:
            lg.error(f"[VADDetector] VAD error: {e}")
            return False

        # State machine for speech detection
        if is_speech:
            if not self._is_speaking:
                # Speech started
                self._is_speaking = True
                self._silence_frames = 0
                self._speech_buffer.clear()
                lg.debug("[VADDetector] Speech started")
                if self._on_speech_start:
                    self._on_speech_start()

            # Add frame to buffer
            self._speech_buffer.append(audio_frame.copy())
            self._silence_frames = 0

        else:
            if self._is_speaking:
                # Still in speech segment, count silence
                self._speech_buffer.append(audio_frame.copy())
                self._silence_frames += 1

                # Check if silence threshold reached
                if self._silence_frames >= self._frames_for_silence:
                    # Speech ended
                    self._end_speech_segment()

        return is_speech

    def _end_speech_segment(self) -> None:
        """Handle end of speech segment."""
        self._is_speaking = False

        if self._speech_buffer:
            # Concatenate all buffered audio
            speech_audio = np.concatenate(self._speech_buffer)

            # Check minimum duration
            duration = len(speech_audio) / self.sample_rate
            if duration >= self.MIN_SPEECH_DURATION:
                lg.debug(f"[VADDetector] Speech ended, duration: {duration:.2f}s")
                if self._on_speech_end:
                    self._on_speech_end(speech_audio)
            else:
                lg.debug(
                    f"[VADDetector] Speech too short ({duration:.2f}s), discarding"
                )

        self._speech_buffer.clear()
        self._silence_frames = 0

    def force_end_segment(self) -> Optional[np.ndarray]:
        """
        Force end the current speech segment.

        Returns:
            Audio data if there was an active segment, None otherwise
        """
        if self._is_speaking and self._speech_buffer:
            speech_audio = np.concatenate(self._speech_buffer)
            self._is_speaking = False
            self._speech_buffer.clear()
            self._silence_frames = 0

            duration = len(speech_audio) / self.sample_rate
            if duration >= self.MIN_SPEECH_DURATION:
                lg.debug(f"[VADDetector] Forced end, duration: {duration:.2f}s")
                return speech_audio

        return None

    def reset(self) -> None:
        """Reset the VAD state."""
        self._is_speaking = False
        self._silence_frames = 0
        self._speech_buffer.clear()

    @property
    def is_speaking(self) -> bool:
        """Check if currently detecting speech."""
        return self._is_speaking

    @property
    def current_duration(self) -> float:
        """Get current speech segment duration in seconds."""
        if not self._speech_buffer:
            return 0.0
        total_samples = sum(len(frame) for frame in self._speech_buffer)
        return total_samples / self.sample_rate


class ContinuousVAD:
    """
    Continuous VAD processor that works with AudioRecorder.

    Processes audio stream continuously and emits speech
    segments when detected.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        aggressiveness: int = VADDetector.DEFAULT_AGGRESSIVENESS,
        silence_threshold: float = VADDetector.DEFAULT_SILENCE_THRESHOLD,
    ):
        """
        Initialize continuous VAD.

        Args:
            sample_rate: Audio sample rate
            aggressiveness: VAD aggressiveness level
            silence_threshold: Silence duration to end segment
        """
        self.sample_rate = sample_rate
        self.vad = VADDetector(sample_rate, aggressiveness, silence_threshold)

        # Frame buffer for incomplete frames
        self._frame_buffer = np.array([], dtype=np.int16)
        self._lock = threading.Lock()

        # Speech segment callback
        self._on_speech_segment: Optional[Callable[[np.ndarray], None]] = None

    def set_on_speech_segment(
        self, callback: Optional[Callable[[np.ndarray], None]]
    ) -> None:
        """
        Set callback for completed speech segments.

        Args:
            callback: Function called with speech audio data
        """
        self._on_speech_segment = callback
        self.vad.set_callbacks(on_speech_end=callback)

    def process_audio(self, audio_data: np.ndarray) -> None:
        """
        Process incoming audio data.

        Buffers incomplete frames and processes complete frames.

        Args:
            audio_data: Audio data from recorder
        """
        with self._lock:
            # Add to frame buffer
            self._frame_buffer = np.concatenate([self._frame_buffer, audio_data])

            # Process complete frames
            frame_size = self.vad.frame_size
            while len(self._frame_buffer) >= frame_size:
                frame = self._frame_buffer[:frame_size]
                self._frame_buffer = self._frame_buffer[frame_size:]
                self.vad.process_frame(frame)

    def flush(self) -> Optional[np.ndarray]:
        """
        Flush any remaining audio and force end segment.

        Returns:
            Remaining speech audio if any
        """
        with self._lock:
            # Process any remaining complete frames
            frame_size = self.vad.frame_size
            while len(self._frame_buffer) >= frame_size:
                frame = self._frame_buffer[:frame_size]
                self._frame_buffer = self._frame_buffer[frame_size:]
                self.vad.process_frame(frame)

            # Clear remaining partial frame
            self._frame_buffer = np.array([], dtype=np.int16)

            # Force end current segment
            return self.vad.force_end_segment()

    def reset(self) -> None:
        """Reset VAD state and buffers."""
        with self._lock:
            self._frame_buffer = np.array([], dtype=np.int16)
            self.vad.reset()

    def pause(self) -> None:
        """Pause VAD processing."""
        with self._lock:
            self._frame_buffer = np.array([], dtype=np.int16)
            self.vad.pause()

    def resume(self) -> None:
        """Resume VAD processing."""
        self.vad.resume()

    @property
    def is_paused(self) -> bool:
        """Check if VAD is paused."""
        return self.vad.is_paused

    @property
    def is_speaking(self) -> bool:
        """Check if currently detecting speech."""
        return self.vad.is_speaking
