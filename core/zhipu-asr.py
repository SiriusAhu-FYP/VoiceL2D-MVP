import os
import pathlib

import requests
from dotenv import load_dotenv

load_dotenv()
key = os.getenv("API_KEY_ZHIPU")

url = "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions"

# Change current directory to here
script_dir = pathlib.Path(__file__).parent.resolve()
os.chdir(script_dir)

test_file = r"../asset/test_audio.wav"
files = {"file": open(test_file, "rb")}
payload = {"model": "glm-asr", "temperature": "0.95", "stream": "false"}
headers = {"Authorization": f"Bearer {key}"}

response = requests.post(url, data=payload, files=files, headers=headers)

print(response.json())

with open("zhipu-asr_result.txt", "w", encoding="utf-8") as f:
    f.write(response.json().get("text", ""))
