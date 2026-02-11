#!/bin/bash
set -e

echo "============================================"
echo "  Card Game Docker 启动脚本"
echo "============================================"
echo ""

# 清理旧日志
rm -f /app/logs/tunnel_*.log

# 确定前端启动模式
if [ "$DEV_MODE" = "true" ]; then
    MODE_DESC="开发模式 (热更新)"
else
    MODE_DESC="生产模式 (访问快)"
fi
echo "  前端启动模式: $MODE_DESC"
echo ""

# 如果启用隧道模式
if [ "$ENABLE_TUNNEL" = "true" ]; then
    # 1. API Server
    echo "[1/7] 启动 API Server..."
    cd /app/api-server
    uvicorn app.main:app --host 0.0.0.0 --port 8000 > /app/logs/api.log 2>&1 &
    API_PID=$!
    sleep 2
    
    echo "[2/7] 启动 API 隧道..."
    cloudflared tunnel --url http://localhost:8000 > /app/logs/tunnel_api.log 2>&1 &
    
    # 2. Game Server
    echo "[3/7] 启动 Game Server..."
    cd /app/game-server
    npm start > /app/logs/game.log 2>&1 &
    GAME_PID=$!
    sleep 2
    
    echo "[4/7] 启动 Game Server 隧道..."
    cloudflared tunnel --url http://localhost:3001 > /app/logs/tunnel_game.log 2>&1 &

    # 等待并获取 API 和 Game URL
    echo "[5/7] 获取公网地址..."
    MAX_ATTEMPTS=60
    ATTEMPT=0
    API_URL=""
    GAME_URL=""

    # 循环检查日志获取 URL
    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        ATTEMPT=$((ATTEMPT + 1))
        
        if [ -z "$API_URL" ] && [ -f /app/logs/tunnel_api.log ]; then
            API_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /app/logs/tunnel_api.log | head -1)
        fi
        
        if [ -z "$GAME_URL" ] && [ -f /app/logs/tunnel_game.log ]; then
            GAME_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /app/logs/tunnel_game.log | head -1)
        fi
        
        if [ -n "$API_URL" ] && [ -n "$GAME_URL" ]; then
            break
        fi
        
        echo "  等待隧道创建... ($ATTEMPT/$MAX_ATTEMPTS)"
        sleep 1
    done
    
    if [ -z "$API_URL" ] || [ -z "$GAME_URL" ]; then
         echo "[错误] 获取后端地址超时"
         exit 1
    fi

    echo "  API 地址: $API_URL"
    echo "  Game 地址: $GAME_URL"
    echo ""

    # 3. Client
    echo "[6/7] 配置并启动客户端..."
    
    # 写入环境变量
    # 只需要写到 .env.local 或者 .env 中，Vite 会读取
    echo "VITE_API_SERVER_URL=$API_URL" > /app/client/.env
    echo "VITE_GAME_SERVER_URL=$GAME_URL" >> /app/client/.env
    
    cd /app/client
    
    if [ "$DEV_MODE" = "true" ]; then
        echo "  使用开发模式启动..."
        npm run dev -- --host 0.0.0.0 &
        CLIENT_PID=$!
    else
        echo "  构建生产版本..."
        npm run build
        echo "  启动预览服务..."
        npm run preview -- --host 0.0.0.0 --port 5173 &
        CLIENT_PID=$!
    fi

    echo "[7/7] 启动客户端隧道..."
    cloudflared tunnel --url http://localhost:5173 > /app/logs/tunnel_client.log 2>&1 &

    # 获取 Client URL
    ATTEMPT=0
    WEB_URL=""
    while [ $ATTEMPT -lt 30 ]; do
        ATTEMPT=$((ATTEMPT + 1))
        if [ -f /app/logs/tunnel_client.log ]; then
            WEB_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /app/logs/tunnel_client.log | head -1)
        fi
        if [ -n "$WEB_URL" ]; then break; fi
        sleep 1
    done
    
    if [ -z "$WEB_URL" ]; then WEB_URL="http://localhost:5173"; fi
    
    echo ""
    echo "============================================"
    echo "  部署完成！"
    echo "============================================"
    echo ""
    echo "  公网访问: $WEB_URL"
    echo ""
    
    # 生成二维码
    if [ -f /app/public-address.py ]; then
        cd /app
        python3 public-address.py "$WEB_URL" 2>/dev/null || true
    fi

    echo ""
    echo "  按 Ctrl+C 停止..."
    wait $CLIENT_PID

else
    # 非隧道模式 (Supervisord)
    echo "  隧道模式已禁用，使用 Supervisord..."
    
    # 设置默认本地地址
    echo "VITE_API_SERVER_URL=http://localhost:8000" > /app/client/.env
    echo "VITE_GAME_SERVER_URL=http://localhost:3001" >> /app/client/.env
    
    if [ "$DEV_MODE" = "true" ]; then
        echo "  使用开发模式 (Supervisord)..."
        # 直接修改 supervisord 配置中的 command
        sed -i 's/npm run preview -- --host 0.0.0.0 --port 5173/npm run dev -- --host 0.0.0.0/g' /etc/supervisord.conf
        exec /usr/bin/supervisord -c /etc/supervisord.conf
    else
        echo "  构建生产版本..."
        cd /app/client
        npm run build
        
        # 生产模式 Supervisord (Client use preview)
        # 这里复用 supervisord.conf, 因为它已经配好了 npm run preview command?
        # 只是需要修改 command? 
        # supervisord.conf 里面的 client command 是 `npm run preview`.
        # 如果是 dev mode, 我应该改为 `npm run dev`?
        # 我原来的 supervisord.conf 里面 client 是 `npm run preview`.
        # 让我检查 supervisord.conf 的内容。
        # 我之前写的： command=npm run preview -- --host 0.0.0.0 --port 5173
        
        # 所以如果 DEV_MODE=true，我需要一个新的 config 或者 sed 修改它。
        # 或者在 supervisord.conf 里通过环境变量控制? supervisor 不支持 bash 变量 expansion nicely.
        
        # 简单起见，如果 DEV_MODE=true, 我临时生成一个 dev conf.
        # 但 myblog 是反过来的， production是临时生成的。
        
        # 我这里的逻辑：
        # 如果是 Prod (default in supervisord.conf), 直接运行。
        # 如果是 Dev, 修改为 npm run dev.
        
        exec /usr/bin/supervisord -c /etc/supervisord.conf
    fi
fi
