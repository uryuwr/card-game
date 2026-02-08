import io
from fastapi import APIRouter, File, UploadFile, HTTPException
from PIL import Image

router = APIRouter()

# EasyOCR reader 延迟初始化（模型加载较慢）
_reader = None


def get_ocr_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
    return _reader


@router.post("/recognize")
async def recognize_card(image: UploadFile = File(...)):
    """OCR 识别卡牌图片中的文字"""
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="请上传图片文件")

    try:
        contents = await image.read()
        img = Image.open(io.BytesIO(contents))

        # 转为 RGB（防止 RGBA 报错）
        if img.mode != "RGB":
            img = img.convert("RGB")

        reader = get_ocr_reader()
        results = reader.readtext(
            io.BytesIO(contents).read(),
            detail=1,
        )

        recognized = []
        for bbox, text, confidence in results:
            recognized.append({
                "text": text,
                "confidence": round(confidence, 4),
                "bbox": [[int(p[0]), int(p[1])] for p in bbox],
            })

        return {
            "success": True,
            "count": len(recognized),
            "results": recognized,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR 识别失败: {str(e)}")
