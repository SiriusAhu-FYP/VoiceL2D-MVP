import requests

gpt_weights_path = "/home/ahu/GPT-SoVITS-Inference/派蒙/派蒙-e10.ckpt"
sovits_weights_path = "/home/ahu/GPT-SoVITS-Inference/派蒙/派蒙_e10_s19390.pth"

text2gen = "你好，很高兴认识你！"
text_lang = "zh"

ref_audio_path = (
    "/home/ahu/GPT-SoVITS-Inference/派蒙/平静-好耶！《特尔克西的奇幻历险》出发咯！.wav"
)
prompt_text = "好耶！《特尔克西的奇幻历险》出发咯！"
prompt_lang = "zh"

# === 1. 加载两个权重 ===
gpt_weights_url = f"http://192.168.31.64:9880/set_gpt_weights"
get_weights_payload = {"weights_path": gpt_weights_path}
gpt_weights_response = requests.post(gpt_weights_url, params=get_weights_payload)
print(
    "GPT weights set successfully"
) if gpt_weights_response.status_code == 200 else print(
    f"GPT weights set failed: {gpt_weights_response.text}"
)

sovits_weights_url = f"http://192.168.31.64:9880/set_sovits_weights"
get_weights_payload = {"weights_path": sovits_weights_path}
sovits_weights_response = requests.post(sovits_weights_url, params=get_weights_payload)
print(
    "SoVITS weights set successfully"
) if sovits_weights_response.status_code == 200 else print(
    f"SoVITS weights set failed: {sovits_weights_response.text}"
)

# === 2. 生成音频 ===

url = f"http://192.168.31.64:9880/tts?text={text2gen}&text_lang={text_lang}&ref_audio_path={ref_audio_path}&prompt_text={prompt_text}&prompt_lang={prompt_lang}"

print("Requesting TTS...")
response = requests.get(url)

# 判断是否成功
if response.status_code == 200:
    with open(r"voice_output/output.wav", "wb") as f:
        f.write(response.content)
    print("Saved as output.wav")
else:
    print("Request failed:", response.status_code, response.text)
