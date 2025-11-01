import os

import requests
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("BASE_URL_ZHIPU")
key = os.getenv("API_KEY_ZHIPU")

payload = {
    "model": "glm-4.5-flash",
    "messages": [
        {"role": "system", "content": "你是一个有用的AI助手。"},
        {"role": "user", "content": "1+1=?"},
    ],
    "temperature": 1,
    "max_tokens": 1024,
    "stream": False,
}
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
