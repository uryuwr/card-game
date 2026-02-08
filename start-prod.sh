#!/bin/bash
# 一键启动所有服务（生产模式，无热更新）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🚀 启动卡牌游戏生产环境..."

# 先杀掉可能存在的旧进程
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null
sleep 1

cleanup() {
	if [ -n "${API_PID:-}" ]; then kill "$API_PID" 2>/dev/null; fi
	if [ -n "${GAME_PID:-}" ]; then kill "$GAME_PID" 2>/dev/null; fi
	if [ -n "${CLIENT_PID:-}" ]; then kill "$CLIENT_PID" 2>/dev/null; fi
}

# 捕获退出信号
trap "cleanup" EXIT
trap "cleanup; exit" SIGINT SIGTERM

# 启动 Python API 服务器
echo "📡 启动 API 服务器 (端口 8000)..."
(cd "$SCRIPT_DIR/api-server" && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000) &
API_PID=$!

# 等待 API 就绪
echo "⏳ 等待 API 启动..."
API_READY=false
for i in {1..40}; do
	if curl -fs "http://127.0.0.1:8000/api/health" >/dev/null 2>&1 || curl -fs "http://127.0.0.1:8000/api/cards" >/dev/null 2>&1; then
		API_READY=true
		break
	fi
	sleep 0.5
done
if [ "$API_READY" != "true" ]; then
	echo "❌ API 未能启动，退出。"
	kill "$API_PID" 2>/dev/null
	exit 1
fi

# 启动游戏服务器
echo "🎮 启动游戏服务器 (端口 3001)..."
(cd "$SCRIPT_DIR/game-server" && node src/index.js) &
GAME_PID=$!

# 构建并启动客户端（生产预览）
echo "🧱 构建客户端..."
(cd "$SCRIPT_DIR/client" && npm run build)

echo "🖥️  启动客户端 (端口 5173)..."
(cd "$SCRIPT_DIR/client" && npm run preview -- --host 0.0.0.0 --port 5173) &
CLIENT_PID=$!

echo ""
echo "✅ 所有服务已启动:"
echo "   🖥️  客户端:     http://localhost:5173 (LAN: http://<your-ip>:5173)"
echo "   📡 API 服务器:  http://localhost:8000 (LAN: http://<your-ip>:8000)"
echo "   🎮 游戏服务器:  http://localhost:3001 (LAN: http://<your-ip>:3001)"
echo "   📖 API 文档:    http://localhost:8000/docs"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待
wait
