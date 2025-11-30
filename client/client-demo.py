import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastmcp import Client
from openai import OpenAI

# region ==== Config ====
MCP_SERVER_URL = "http://localhost:8848/mcp"

load_dotenv()
API_KEY = os.getenv("ZHIPU_API_KEY")
BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"
MODEL_NAME = "glm-4-flash"
# endregion


# region ==== Helper Functions ====
class UniversalBlindTester:
    def __init__(self):
        self.llm = OpenAI(api_key=API_KEY, base_url=BASE_URL)
        # Initialize FastMCP Client
        # 它会自动处理 HTTP 连接和协议握手
        self.client = Client(MCP_SERVER_URL)
        # Load system prompt
        self.system_prompt = self._load_system_prompt()

    def _load_system_prompt(self) -> str:
        """Load system prompt from system_prompt.md file."""
        system_prompt_path = Path(__file__).parent / "system_prompt.md"
        try:
            with open(system_prompt_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
                print(f"✅ Loaded system prompt from {system_prompt_path}")
                return content
        except FileNotFoundError:
            print(f"⚠️ Warning: system_prompt.md not found at {system_prompt_path}")
            return ""
        except Exception as e:
            print(f"⚠️ Warning: Failed to load system prompt: {e}")
            return ""

    def _adapt_tools(self, tools):
        """
        Adapter: Convert FastMCP tool objects to OpenAI format
        TODO: Check if necessary today
        """
        openai_tools = []
        for tool in tools:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.inputSchema,
                },
            })
        return openai_tools

    async def run(self):
        print(f"🔌 Connecting to: {MCP_SERVER_URL}")

        # Use async context manager to keep HTTP connection
        async with self.client:
            available_tools = await self.client.list_tools()

            print(f"✅ Connection successful! Detected {len(available_tools)} tools:")
            for t in available_tools:
                print(f"   - {t.name}: {t.description}")

            llm_tools_config = self._adapt_tools(available_tools)

            print("\n" + "=" * 60)
            print("Please enter your command below. Type 'q' to exit.")
            print("=" * 60)

            while True:
                user_query = input("\n🗣️ Command: ")
                if user_query.lower() in ["q", "quit"]:
                    break

                # Build messages with system prompt if available
                messages = []
                if self.system_prompt:
                    messages.append({"role": "system", "content": self.system_prompt})
                messages.append({"role": "user", "content": user_query})

                # === Step 1: LLM thinking ===
                response = self.llm.chat.completions.create(
                    model=MODEL_NAME,
                    messages=messages,
                    tools=llm_tools_config,
                    tool_choice="auto",
                )

                ai_msg = response.choices[0].message

                # === Step 2: Check if the command hits the secret tools ===
                if ai_msg.tool_calls:
                    messages.append(ai_msg)

                    for tool_call in ai_msg.tool_calls:
                        t_name = tool_call.function.name
                        t_args = json.loads(tool_call.function.arguments)

                        print(f"🚀 [FastMCP] Calling server tool: {t_name}")
                        print(f"   Arguments: {t_args}")

                        try:
                            # Call FastMCP client with tool name and arguments
                            result = await self.client.call_tool(
                                t_name, arguments=t_args
                            )

                            # Result: FastMCP returns a result usually containing a list of content
                            output_text = ""
                            if hasattr(result, "content") and isinstance(
                                result.content, list
                            ):
                                for item in result.content:
                                    if hasattr(item, "text"):
                                        output_text += item.text
                                    else:
                                        output_text += str(item)
                            else:
                                output_text = str(result)

                            print(f"✅ [Server returned] {output_text}")

                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": output_text,
                            })

                        except Exception as e:
                            print(f"❌ Call exception: {e}")
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": f"Error: {str(e)}",
                            })

                    # === Step 3: LLM summary ===
                    # messages already contains system prompt from Step 1, so use it directly
                    final_res = self.llm.chat.completions.create(
                        model=MODEL_NAME, messages=messages, tools=llm_tools_config
                    )
                    print(f"🎉 Final answer:\n{final_res.choices[0].message.content}")

                else:
                    print(
                        f"ℹ⚠️ AI did not call tools, directly replied:\n{ai_msg.content}"
                    )


if __name__ == "__main__":
    tester = UniversalBlindTester()
    try:
        asyncio.run(tester.run())
    except KeyboardInterrupt:
        print("\nTerminated by user")
