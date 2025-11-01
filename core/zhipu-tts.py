import os

import requests
import simpleaudio as sa
from dotenv import load_dotenv

load_dotenv()

key = os.getenv("API_KEY_ZHIPU")

url = "https://open.bigmodel.cn/api/paas/v4/audio/speech"

voice = (
    "kazi"  # Available options: tongtong, chuichui, xiaochen, jam, kazi, douji, luodo
)

text = "一小时工资九元的购买力能有多强，今天我们来到一家大型连锁平价超市永辉超市我们来一起看看一小时工资九元能买到些什么"

payload = {
    "model": "cogtts",
    "input": text,
    "voice": voice,
    "response_format": "wav",
}
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Make the API request
response = requests.post(url, json=payload, headers=headers)


# Ensure the directory exists
os.makedirs("zhipu-tts_result", exist_ok=True)

# Save the audio content to a file
with open(f"./core/zhipu-tts_result/{voice}_tts.wav", "wb") as f:
    f.write(response.content)

# Play the audio
wave_obj = sa.WaveObject.from_wave_file(f"./core/zhipu-tts_result/{voice}_tts.wav")
play_obj = wave_obj.play()
play_obj.wait_done()
else:
print(f"Failed to get audio. Status code: {response.status_code}")
print(response.text)
