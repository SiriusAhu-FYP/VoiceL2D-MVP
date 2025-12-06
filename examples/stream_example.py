import time

import pyaudio
import requests
from loguru import logger as lg

# 1. 配置参数
# 注意：GPT-SoVITS 默认采样率通常是 32000，如果不对应，声音会变快或变慢（像花栗鼠或巨人）
SAMPLE_RATE = 32000
CHANNELS = 1

text = "今天我很荣幸作为一个青藏高原的孩子能来到联合国讲我和动物朋友们的故事。我的村庄叫然日卡，小小的，但是格聂山和横断山脉很大。这个世界不但属于我，也属于我的动物朋友们，我家乡的附近有水鹿，藏语叫哈瓦，麝藏语叫拉瓦，岩羊藏语叫日啊，我骑马放牧时曾经遇到过狼，藏语叫香克，藏狐藏语叫瓦。夜里有雪豹踩着冰雪出现，天空中有鹰，草上有小虫。我们藏族人说，一滴水中都有十万生命。我最近一直在努力学习，在书本中学习，也在自然里学习。"

# 你的 TTS API 地址
# 关键点：必须加上 streaming_mode=true
# 关键点：media_type=wav (或者 raw)，这样 PyAudio 可以直接处理 PCM 数据
base_url = "http://192.168.31.64:9880/tts"
params = {
    "text": text,
    "text_lang": "zh",
    "ref_audio_path": "/home/ahu/GPT-SoVITS-Inference/派蒙/平静-好耶！《特尔克西的奇幻历险》出发咯！.wav",  # 请替换为你服务器上存在的参考音频
    "prompt_text": "好耶！《特尔克西的奇幻历险》出发咯！",
    "prompt_lang": "zh",
    "streaming_mode": "true",  # 【核心】开启流式
    "media_type": "wav",  # 【核心】wav格式包含pcm数据，适合pyaudio
}


def play_stream():
    # 初始化 PyAudio
    p = pyaudio.PyAudio()

    # 打开音频流
    # format=pyaudio.paInt16 代表 16位 PCM，这是 GPT-SoVITS 的默认输出格式
    stream = p.open(
        format=pyaudio.paInt16, channels=CHANNELS, rate=SAMPLE_RATE, output=True
    )

    lg.info(f"🚀 [1] 发起请求... (时间: {time.time()})")

    # stream=True 是 requests 库的关键，不立即下载整个响应体
    with requests.get(base_url, params=params, stream=True) as response:
        response.raise_for_status()
        lg.info(f"✅ [2] 连接建立! 开始接收数据流... (时间: {time.time()})")

        first_chunk = True

        # iter_content 会不断从网络流中读取数据
        # chunk_size=1024 意味着每次只要收到 1KB 数据就立刻处理
        for chunk in response.iter_content(chunk_size=1024):
            if chunk:
                if first_chunk:
                    lg.info(
                        f"🔊 [3] 第一块音频到达! 开始播放... (延迟: {(time.time() - start_time) * 1000:.2f}ms)"
                    )
                    first_chunk = False

                # 直接将原始字节写入声卡缓冲区
                stream.write(chunk)

    lg.info("\n🏁 播放结束")

    # 清理资源
    stream.stop_stream()
    stream.close()
    p.terminate()


if __name__ == "__main__":
    start_time = time.time()
    try:
        play_stream()
    except KeyboardInterrupt:
        lg.info("停止播放")
    except Exception as e:
        lg.error(f"发生错误: {e}")
