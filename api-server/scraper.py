"""
One Piece TCG 卡牌爬虫
从 https://www.onepiece-cardgame.cn/cardlist 爬取卡牌数据

用法:
    # 爬取指定卡牌编号
    python scraper.py EB04-001 EB04-002 EB04-003

    # 爬取整个卡包 (用卡包代码前缀)
    python scraper.py --set EB04

    # 爬取所有卡牌
    python scraper.py --all

    # 查看可用卡包列表
    python scraper.py --list-sets
"""

import argparse
import asyncio
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set
from urllib.parse import quote, unquote

import httpx
from sqlalchemy import select

# 添加项目根目录到 path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import async_session, init_db
from app.models import Card

# ============ 配置 ============

BASE_API = "https://onepieceserve.windoent.com"
ORIGIN = "https://www.onepiece-cardgame.cn"
CARDS_DIR = Path(__file__).parent.parent / "client" / "public" / "cards"
PAGE_SIZE = 20
REQUEST_DELAY = 0.3  # 请求间隔(秒)，避免过快被封

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Origin": ORIGIN,
    "Referer": f"{ORIGIN}/",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/144.0.0.0 Safari/537.36"
    ),
}

# ============ API 封装 ============


async def fetch_card_list(
    client: httpx.AsyncClient,
    page: int = 1,
    card_offer_type: str = "",
    card_color: str = "",
    card_type: str = "",
    card_name: str = "",
) -> Dict:
    """获取卡牌列表（每页返回 cardImg 和 id）
    
    card_name: 可用于按卡号搜索，如 'P-006', 'OP01-001'
    """
    params = {
        "cardName": card_name,
        "cardOfferType": card_offer_type,
        "cardColor": card_color,
        "cardType": card_type,
        "cardCartograph": "",
        "subscript": "",
        "limit": PAGE_SIZE,
        "page": page,
    }
    resp = await client.get(
        f"{BASE_API}/cardList/cardlist/weblist", params=params, headers=HEADERS
    )
    resp.raise_for_status()
    return resp.json()


async def fetch_card_detail(client: httpx.AsyncClient, card_id: int) -> Optional[dict]:
    """获取卡牌详情"""
    resp = await client.get(
        f"{BASE_API}/cardList/cardlist/webInfo/{card_id}", headers=HEADERS
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") == 0 and data.get("info"):
        return data["info"]
    return None


async def fetch_sets(client: httpx.AsyncClient) -> List[dict]:
    """获取所有卡包列表"""
    resp = await client.get(
        f"{BASE_API}/cardType/cardofferingtype/cachelist", headers=HEADERS
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("list", [])


async def download_image(client: httpx.AsyncClient, url: str, save_path: Path) -> bool:
    """下载卡牌图片"""
    try:
        resp = await client.get(url, follow_redirects=True, timeout=30)
        resp.raise_for_status()
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  ⚠ 下载图片失败: {url} -> {e}")
        return False


# ============ 数据映射 ============


def extract_set_code(card_number: str) -> str:
    """从卡牌编号提取卡包代码，如 'EB04-001' -> 'EB04'"""
    if "-" in card_number:
        return card_number.rsplit("-", 1)[0]
    return card_number


def extract_card_number_from_img(img_url: str) -> Optional[str]:
    """从图片 URL 提取卡牌编号

    URL 示例: 
    - https://source.windoent.com/OnePiecePc/Picture/1769764571457EB04-001.png
    - https://source.windoent.com/OnePiecePc/Picture/1674893285473P-006(1).jpg
    """
    filename = img_url.rsplit("/", 1)[-1] if "/" in img_url else img_url
    filename = unquote(filename)  # 解码 URL 编码
    # 匹配常见格式: XX00-000, XXXX-000, P-006 等
    match = re.search(r"([A-Z]{1,5}\d*-\d{2,3}(?:_\d+)?)", filename)
    if match:
        return match.group(1)
    return None


def parse_int_safe(val) -> Optional[int]:
    """安全解析整数，处理 '-' 等非数字值"""
    if val is None or val == "-" or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def map_card_detail(info: dict) -> dict:
    """将 API 返回的卡牌信息映射为数据库字段"""
    card_number = info.get("cardNumber", "")
    attribute_list = info.get("cardAttribute", [])
    attribute = "/".join(attribute_list) if isinstance(attribute_list, list) else str(attribute_list or "")
    
    card_type = info.get("cardType", "")
    card_life = parse_int_safe(info.get("cardLife"))
    
    # cardLife 字段的含义取决于卡片类型:
    # - 领袖卡: cardLife 是生命值 (life)
    # - 角色/事件卡: cardLife 是费用 (cost)
    if card_type == "领袖":
        cost = None
        life = card_life
    else:
        cost = card_life
        life = None

    return {
        "card_number": card_number,
        "name": info.get("cardName", ""),
        "name_cn": info.get("cardName", ""),
        "card_type": card_type,
        "color": info.get("cardColor", ""),
        "cost": cost,
        "power": parse_int_safe(info.get("cardPower")),
        "counter": parse_int_safe(info.get("cardAttack")),
        "life": life,
        "attribute": attribute,
        "effect": info.get("cardTextDesc", ""),
        "trigger": info.get("cardTrigger", ""),
        "trait": info.get("cardFeatures", ""),
        "rarity": info.get("cardRarity", ""),
        "set_code": extract_set_code(card_number),
        "image_url": info.get("cardImg", ""),
    }


# ============ 数据库操作 ============


async def save_card_to_db(card_data: dict, image_local: Optional[str] = None) -> bool:
    """保存或更新卡牌到数据库"""
    async with async_session() as session:
        stmt = select(Card).where(Card.card_number == card_data["card_number"])
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # 更新已有
            for key, val in card_data.items():
                if val is not None:
                    setattr(existing, key, val)
            if image_local:
                existing.image_local = image_local
            await session.commit()
            return False  # 更新
        else:
            # 新增
            card = Card(**card_data)
            if image_local:
                card.image_local = image_local
            session.add(card)
            await session.commit()
            return True  # 新建


# ============ 核心逻辑 ============


def find_set_name(sets: List[dict], set_code: str) -> Optional[str]:
    """通过卡包代码匹配卡包全名

    例: 'EB04' -> '特别补充包【EBC-04】艾格赫德危机'
    或  'OPC-01' -> '补充包 冒险的黎明【OPC-01】'
    """
    code_upper = set_code.upper()
    for s in sets:
        name = s.get("name", "")
        # 检查卡包名称中是否包含匹配的代码
        # 名称格式举例: "补充包 冒险的黎明【OPC-01】" 或 "基本卡组 草帽一伙【STC-01】"
        match = re.search(r"【([^】]+)】", name)
        if match:
            inner_code = match.group(1)
            # 处理可能的格式差异: EBC-04 vs EB04, OPC-01 vs OP01
            inner_clean = inner_code.replace("-", "").replace("C", "")
            code_clean = code_upper.replace("-", "").replace("C", "")
            if inner_clean == code_clean or inner_code.upper() == code_upper:
                return name
            # 也试试去掉中间的 C: OPC-01 对应 OP01
            if inner_code.replace("C", "").replace("-", "") == code_upper.replace("-", ""):
                return name
    return None


async def scrape_by_card_numbers(card_numbers: List[str]):
    """根据指定的卡牌编号爬取 - 直接用 cardName 搜索"""
    await init_db()
    CARDS_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        found_count = 0
        total = len(card_numbers)
        not_found = []

        print(f"\n{'='*60}")
        print(f"开始搜索 {total} 张卡牌")
        print(f"{'='*60}")

        for card_no in card_numbers:
            card_no = card_no.upper().strip()
            print(f"\n🔍 搜索: {card_no}")
            
            # 直接用 cardName 参数搜索卡号
            data = await fetch_card_list(client, page=1, card_name=card_no)
            page_data = data.get("page", {})
            card_list = page_data.get("list", [])
            
            if not card_list:
                print(f"  ⚠ 未找到")
                not_found.append(card_no)
                continue
            
            # 从搜索结果中找到精确匹配的卡
            found = False
            for item in card_list:
                img_url = item.get("cardImg", "")
                card_id = item.get("id")
                img_number = extract_card_number_from_img(img_url)
                base_number = img_number.split("_")[0] if img_number else None
                
                if base_number and base_number == card_no:
                    found = True
                    await asyncio.sleep(REQUEST_DELAY)
                    
                    detail = await fetch_card_detail(client, card_id)
                    if detail:
                        card_data = map_card_detail(detail)
                        # 下载图片
                        ext = img_url.rsplit(".", 1)[-1] if "." in img_url else "png"
                        img_filename = f"{card_data['card_number']}.{ext}"
                        img_path = CARDS_DIR / img_filename
                        downloaded = await download_image(client, img_url, img_path)
                        image_local = f"cards/{img_filename}" if downloaded else None

                        is_new = await save_card_to_db(card_data, image_local)
                        status = "✅ 新增" if is_new else "🔄 更新"
                        print(f"  {status} {card_data['card_number']} - {card_data['name_cn']}")
                        print(f"     类型: {card_data['card_type']} | 颜色: {card_data['color']} | 稀有度: {card_data['rarity']}")
                        if card_data['power']:
                            print(f"     力量: {card_data['power']}")
                        found_count += 1
                    else:
                        print(f"  ⚠ 获取详情失败: id={card_id}")
                    break
            
            if not found:
                print(f"  ⚠ 搜索结果中无精确匹配")
                not_found.append(card_no)
            
            await asyncio.sleep(REQUEST_DELAY)

        print(f"\n{'='*60}")
        print(f"完成！共找到 {found_count}/{total} 张卡牌")
        if not_found:
            print(f"未找到: {', '.join(not_found)}")
        print(f"图片保存在: {CARDS_DIR}")
        print(f"{'='*60}")


async def scrape_by_set(set_code: str):
    """爬取整个卡包的所有卡牌"""
    await init_db()
    CARDS_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        sets = await fetch_sets(client)
        set_name = find_set_name(sets, set_code)

        if not set_name:
            print(f"❌ 未找到卡包代码 '{set_code}' 对应的卡包")
            print("可用卡包：")
            for s in sets:
                match = re.search(r"【([^】]+)】", s["name"])
                if match:
                    print(f"  {match.group(1):>8}  {s['name']}")
            return

        print(f"\n{'='*60}")
        print(f"爬取卡包: {set_name}")
        print(f"{'='*60}")

        page = 1
        count = 0
        seen_ids = set()

        while True:
            data = await fetch_card_list(client, page=page, card_offer_type=set_name)
            page_data = data.get("page", {})
            card_list = page_data.get("list", [])
            total_pages = page_data.get("totalPage", 0)
            total_count = page_data.get("totalCount", 0)

            if not card_list:
                break

            print(f"\n--- 第 {page}/{total_pages} 页 (共 {total_count} 张) ---")

            for item in card_list:
                card_id = item.get("id")
                if card_id in seen_ids:
                    continue
                seen_ids.add(card_id)

                img_url = item.get("cardImg", "")
                await asyncio.sleep(REQUEST_DELAY)

                detail = await fetch_card_detail(client, card_id)
                if detail:
                    card_data = map_card_detail(detail)
                    ext = img_url.rsplit(".", 1)[-1] if "." in img_url else "png"
                    img_filename = f"{card_data['card_number']}.{ext}"
                    img_path = CARDS_DIR / img_filename

                    # 跳过已有的变体图（如 _01 异画版）
                    img_number = extract_card_number_from_img(img_url)
                    if img_number and "_" in img_number:
                        # 异画版，用不同文件名
                        img_filename = f"{img_number}.{ext}"
                        img_path = CARDS_DIR / img_filename

                    downloaded = await download_image(client, img_url, img_path)
                    image_local = f"cards/{img_filename}" if downloaded else None

                    is_new = await save_card_to_db(card_data, image_local)
                    status = "✅" if is_new else "🔄"
                    print(f"  {status} {card_data['card_number']:>10} {card_data['name_cn']:<12} "
                          f"{card_data['card_type']:<4} {card_data['color']:<6} {card_data['rarity']}")
                    count += 1

            if page >= total_pages:
                break
            page += 1

        print(f"\n{'='*60}")
        print(f"完成！共处理 {count} 张卡牌")
        print(f"图片保存在: {CARDS_DIR}")
        print(f"{'='*60}")


async def scrape_all():
    """爬取所有卡牌"""
    await init_db()
    CARDS_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        page = 1
        count = 0
        seen_ids = set()

        # 先获取总数
        data = await fetch_card_list(client, page=1)
        total_count = data.get("page", {}).get("totalCount", 0)
        total_pages = data.get("page", {}).get("totalPage", 0)
        print(f"\n共 {total_count} 张卡牌，{total_pages} 页")
        print(f"预计需要 {total_count * REQUEST_DELAY / 60:.1f} 分钟\n")

        while True:
            data = await fetch_card_list(client, page=page)
            page_data = data.get("page", {})
            card_list = page_data.get("list", [])

            if not card_list:
                break

            print(f"--- 第 {page}/{total_pages} 页 ---")

            for item in card_list:
                card_id = item.get("id")
                if card_id in seen_ids:
                    continue
                seen_ids.add(card_id)

                img_url = item.get("cardImg", "")
                await asyncio.sleep(REQUEST_DELAY)

                detail = await fetch_card_detail(client, card_id)
                if detail:
                    card_data = map_card_detail(detail)
                    ext = img_url.rsplit(".", 1)[-1] if "." in img_url else "png"

                    img_number = extract_card_number_from_img(img_url)
                    if img_number and "_" in img_number:
                        img_filename = f"{img_number}.{ext}"
                    else:
                        img_filename = f"{card_data['card_number']}.{ext}"

                    img_path = CARDS_DIR / img_filename
                    downloaded = await download_image(client, img_url, img_path)
                    image_local = f"cards/{img_filename}" if downloaded else None

                    is_new = await save_card_to_db(card_data, image_local)
                    status = "✅" if is_new else "🔄"
                    print(f"  {status} {card_data['card_number']:>10} {card_data['name_cn']}")
                    count += 1

            if page >= total_pages:
                break
            page += 1

        print(f"\n完成！共处理 {count} 张卡牌")


async def list_sets():
    """列出所有可用卡包"""
    async with httpx.AsyncClient(timeout=30) as client:
        sets = await fetch_sets(client)
        print(f"\n{'='*60}")
        print(f"{'卡包代码':>12}  {'卡包名称'}")
        print(f"{'='*60}")
        for s in sets:
            name = s.get("name", "")
            match = re.search(r"【([^】]+)】", name)
            code = match.group(1) if match else "---"
            print(f"  {code:>12}  {name}")
        print(f"{'='*60}")


# ============ 入口 ============


def main():
    parser = argparse.ArgumentParser(
        description="One Piece TCG 卡牌爬虫 - 从官方卡表网站爬取卡牌数据",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scraper.py EB04-001 EB04-002     爬取指定卡牌
  python scraper.py --set EB04            爬取整个卡包
  python scraper.py --set OPC-01          爬取补充包 OPC-01
  python scraper.py --all                 爬取所有卡牌
  python scraper.py --list-sets           列出所有卡包
        """,
    )
    parser.add_argument("card_numbers", nargs="*", help="卡牌编号，如 EB04-001 ST01-002")
    parser.add_argument("--set", dest="set_code", help="按卡包代码爬取整个卡包")
    parser.add_argument("--all", action="store_true", help="爬取所有卡牌")
    parser.add_argument("--list-sets", action="store_true", help="列出所有可用卡包")

    args = parser.parse_args()

    if args.list_sets:
        asyncio.run(list_sets())
    elif args.all:
        confirm = input("确认爬取所有卡牌？这可能需要较长时间 (y/N): ")
        if confirm.lower() == "y":
            asyncio.run(scrape_all())
    elif args.set_code:
        asyncio.run(scrape_by_set(args.set_code))
    elif args.card_numbers:
        asyncio.run(scrape_by_card_numbers(args.card_numbers))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
