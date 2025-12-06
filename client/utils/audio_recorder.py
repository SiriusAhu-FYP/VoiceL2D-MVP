"""
Audio Recorder - Capture audio from microphone.

This module provides functionality to:
- Record audio from the system microphone
- Buffer audio data for processing
- Support continuous recording with callbacks
"""

import io
import queue
import threading
import wave
from typing import Callable, Optional

import numpy as np
import sounddevice as sd
from loguru import logger as lg


class AudioRecorder:
    """
    Microphone audio recorder with continuous capture support.

    Records audio from the default microphone and provides
    audio data through callbacks or a queue.
    """

    # Audio parameters matching GLM-ASR requirements
    SAMPLE_RATE = 16000  # GLM-ASR works well with 16kHz
    CHANNELS = 1
    DTYPE = np.int16
    BLOCK_SIZE = 480  # 30ms at 16kHz (required by webrtcvad)

    def __init__(
        self,
        sample_rate: int = SAMPLE_RATE,
        channels: int = CHANNELS,
        block_size: int = BLOCK_SIZE,
    ):
        """
        Initialize the audio recorder.

        Args:
            sample_rate: Audio sample rate in Hz
            channels: Number of audio channels
            block_size: Number of samples per block (for VAD compatibility)
        """
        self.sample_rate = sample_rate
        self.channels = channels
        self.block_size = block_size

        self._audio_queue: queue.Queue[np.ndarray] = queue.Queue()
        self._recording = False
        self._stream: Optional[sd.InputStream] = None
        self._callback: Optional[Callable[[np.ndarray], None]] = None

        lg.info(
            f"[AudioRecorder] Initialized: {sample_rate}Hz, "
            f"{channels}ch, block_size={block_size}"
        )

    def _audio_callback(
        self,
        indata: np.ndarray,
        frames: int,
        time_info: dict,
        status: sd.CallbackFlags,
    ) -> None:
        """
        Callback function for audio stream.

        Called by sounddevice for each audio block.
        """
        if status:
            lg.warning(f"[AudioRecorder] Stream status: {status}")

        # Convert to int16 if needed and copy data
        audio_data = indata.copy().flatten()
        if audio_data.dtype != np.int16:
            audio_data = (audio_data * 32767).astype(np.int16)

        # Put in queue for processing
        self._audio_queue.put(audio_data)

        # Call external callback if set
        if self._callback:
            self._callback(audio_data)

    def start(self, callback: Optional[Callable[[np.ndarray], None]] = None) -> bool:
        """
        Start recording audio from microphone.

        Args:
            callback: Optional callback function called with each audio block

        Returns:
            True if started successfully, False otherwise
        """
        if self._recording:
            lg.warning("[AudioRecorder] Already recording")
            return True

        self._callback = callback

        try:
            self._stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype=self.DTYPE,
                blocksize=self.block_size,
                callback=self._audio_callback,
            )
            self._stream.start()
            self._recording = True
            lg.info("[AudioRecorder] Recording started")
            return True
        except Exception as e:
            lg.error(f"[AudioRecorder] Failed to start recording: {e}")
            return False

    def stop(self) -> None:
        """Stop recording audio."""
        if not self._recording:
            return

        self._recording = False

        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

        self._callback = None
        lg.info("[AudioRecorder] Recording stopped")

    def get_audio_block(self, timeout: float = 1.0) -> Optional[np.ndarray]:
        """
        Get the next audio block from the queue.

        Args:
            timeout: Maximum time to wait for data in seconds

        Returns:
            Audio data as numpy array, or None if timeout
        """
        try:
            return self._audio_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def clear_queue(self) -> None:
        """Clear all buffered audio data."""
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except queue.Empty:
                break

    @property
    def is_recording(self) -> bool:
        """Check if currently recording."""
        return self._recording

    @staticmethod
    def list_devices() -> list[dict]:
        """
        List available audio input devices.

        Returns:
            List of device info dictionaries
        """
        devices = sd.query_devices()
        input_devices = []

        for i, device in enumerate(devices):
            if device["max_input_channels"] > 0:
                input_devices.append({
                    "index": i,
                    "name": device["name"],
                    "channels": device["max_input_channels"],
                    "sample_rate": device["default_samplerate"],
                })

        return input_devices

    @staticmethod
    def audio_to_wav_bytes(
        audio_data: np.ndarray,
        sample_rate: int = SAMPLE_RATE,
        channels: int = CHANNELS,
    ) -> bytes:
        """
        Convert numpy audio array to WAV bytes.

        Args:
            audio_data: Audio data as int16 numpy array
            sample_rate: Sample rate in Hz
            channels: Number of audio channels

        Returns:
            WAV file data as bytes
        """
        buffer = io.BytesIO()

        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio_data.tobytes())

        buffer.seek(0)
        return buffer.read()


class AudioBuffer:
    """
    Buffer for accumulating audio data.

    Collects audio blocks until a certain duration or
    until explicitly flushed.
    """

    def __init__(
        self,
        sample_rate: int = AudioRecorder.SAMPLE_RATE,
        max_duration: float = 60.0,
    ):
        """
        Initialize the audio buffer.

        Args:
            sample_rate: Audio sample rate in Hz
            max_duration: Maximum buffer duration in seconds
        """
        self.sample_rate = sample_rate
        self.max_duration = max_duration
        self._max_samples = int(sample_rate * max_duration)
        self._buffer: list[np.ndarray] = []
        self._total_samples = 0
        self._lock = threading.Lock()

    def add(self, audio_data: np.ndarray) -> bool:
        """
        Add audio data to the buffer.

        Args:
            audio_data: Audio data to add

        Returns:
            True if added, False if buffer is full
        """
        with self._lock:
            if self._total_samples + len(audio_data) > self._max_samples:
                return False

            self._buffer.append(audio_data)
            self._total_samples += len(audio_data)
            return True

    def get_data(self) -> np.ndarray:
        """
        Get all buffered audio data.

        Returns:
            Concatenated audio data
        """
        with self._lock:
            if not self._buffer:
                return np.array([], dtype=np.int16)
            return np.concatenate(self._buffer)

    def clear(self) -> None:
        """Clear the buffer."""
        with self._lock:
            self._buffer.clear()
            self._total_samples = 0

    @property
    def duration(self) -> float:
        """Get current buffer duration in seconds."""
        return self._total_samples / self.sample_rate

    @property
    def is_empty(self) -> bool:
        """Check if buffer is empty."""
        return self._total_samples == 0

    @property
    def sample_count(self) -> int:
        """Get total number of samples in buffer."""
        return self._total_samples

