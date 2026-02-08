#!/bin/bash
# 一键启动所有服务
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🚀 启动卡牌游戏开发环境..."

# 先杀掉可能存在的旧进程
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null
sleep 1

# 启动 Python API 服务器
echo "📡 启动 API 服务器 (端口 8000)..."
(cd "$SCRIPT_DIR/api-server" && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload) &
API_PID=$!

# 启动游戏服务器
echo "🎮 启动游戏服务器 (端口 3001)..."
(cd "$SCRIPT_DIR/game-server" && node --watch src/index.js) &
GAME_PID=$!

# 启动客户端
echo "🖥️  启动客户端 (端口 5173)..."
(cd "$SCRIPT_DIR/client" && npm run dev -- --host 0.0.0.0) &
CLIENT_PID=$!

echo ""
echo "✅ 所有服务已启动:"
echo "   🖥️  客户端:     http://localhost:5173 (LAN: http://<your-ip>:5173)"
echo "   📡 API 服务器:  http://localhost:8000 (LAN: http://<your-ip>:8000)"
echo "   🎮 游戏服务器:  http://localhost:3001 (LAN: http://<your-ip>:3001)"
echo "   📖 API 文档:    http://localhost:8000/docs"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 捕获退出信号
trap "kill $API_PID $GAME_PID $CLIENT_PID 2>/dev/null; exit" SIGINT SIGTERM

# 等待
wait
