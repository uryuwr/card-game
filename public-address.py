import sys
from qrcode import make

# 如果提供了命令行参数，使用它；否则使用默认 URL
url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
make(url).save("url.png")
print(f"二维码已生成: {url}")
