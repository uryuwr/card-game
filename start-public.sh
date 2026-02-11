#!/bin/bash
# Card Game 一键公网部署脚本
# 使用 Docker 容器运行

set -e

echo "============================================"
echo "  ONE PIECE Card Game Docker 一键部署"
echo "============================================"
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "[错误] 未找到 Docker"
    echo "  请先安装 Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# 检查 Docker 是否运行
if ! docker info &> /dev/null; then
    echo "[错误] Docker 未运行"
    echo "  请启动 Docker Desktop"
    exit 1
fi

# 切换到脚本所在目录
cd "$(dirname "$0")"

echo "[1/3] 停止旧容器..."
docker compose down 2>/dev/null || true
echo "  完成"
echo ""

echo "[2/3] 构建 Docker 镜像..."
docker compose build
echo "  完成"
echo ""

echo "[3/3] 启动服务..."
echo ""
docker compose up card-game

echo ""
echo "服务已停止"
