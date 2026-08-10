"""
อ่านอารมณ์จาก blendshapes ของ MediaPipe — คำนวณล้วน ๆ ไม่มี state ไม่ขึ้นกับเวลา

**ทำไมไม่ใช้โมเดลอารมณ์แยก:** ไพป์ไลน์นี้เปิด blendshapes อยู่แล้วเพื่อตรวจการหลับตา
(landmarks.blink_from_blendshapes) ซึ่งให้คะแนนกล้ามเนื้อใบหน้า 52 ค่าตามมาตรฐาน ARKit
มาฟรีในการรันรอบเดียวกัน การเพิ่มโมเดล FER แยกหมายถึงโมเดลที่ต้องดาวน์โหลดอีกก้อน
บวกการ inference อีกรอบต่อเฟรมบน Pi เพื่อข้อมูลที่ blendshapes บอกได้อยู่แล้ว

**ขอบเขตของสิ่งที่บอกได้:** นี่คือการอ่าน**การแสดงออกบนใบหน้า** ไม่ใช่ความรู้สึกข้างใน
คนยิ้มขณะเครียดก็ได้ค่า happy · การตีความว่าเป็น "อารมณ์" เป็นการอนุมานของผู้อ่านข้อมูล
ไม่ใช่สิ่งที่กล้องวัดได้ ชุดที่รายงานจึงจำกัดไว้เท่าที่ blendshapes รองรับตรง ๆ
และคืน "neutral" เมื่อไม่มีอะไรเด่นพอ แทนที่จะเดาให้ครบทุกเฟรม
"""

from __future__ import annotations

# ชื่อ blendshape ที่ประกอบกันเป็นแต่ละการแสดงออก (ชื่อ ARKit, ตัดขีดล่างและพิมพ์เล็ก)
#
# แต่ละอันคิดจาก**ค่าเฉลี่ยของกล้ามเนื้อที่ต้องขยับร่วมกัน** ไม่ใช่ตัวเดียวโดด ๆ
# เพราะตัวเดียวเกิดขึ้นเองได้จากการพูดหรือการหันหน้า แต่การขยับพร้อมกันทั้งชุดไม่ใช่
EXPRESSION_BLENDSHAPES: dict[str, tuple[str, ...]] = {
    "happy": ("mouthsmileleft", "mouthsmileright"),
    "sad": ("mouthfrownleft", "mouthfrownright"),
    # ตาเบิกกับคิ้วยกอย่างเดียวเกิดจากแสงจ้าได้ จึงรวมการอ้าปากเข้าไปด้วย
    "surprised": ("browinnerup", "eyewideleft", "eyewideright", "jawopen"),
    "angry": ("browdownleft", "browdownright", "mouthpressleft", "mouthpressright"),
}

EXPRESSIONS = tuple(EXPRESSION_BLENDSHAPES)
NEUTRAL = "neutral"


def blendshape_scores(categories) -> dict[str, float]:
    """
    แปลง categories ของ MediaPipe เป็น dict {ชื่อปกติ: คะแนน}

    ปกติชื่อด้วยการตัดขีดล่างและพิมพ์เล็ก แบบเดียวกับ blink_from_blendshapes
    เพื่อไม่ให้พังถ้า MediaPipe เปลี่ยนรูปแบบการตั้งชื่อ
    """
    if not categories:
        return {}
    out: dict[str, float] = {}
    for cat in categories:
        name = (getattr(cat, "category_name", "") or "").replace("_", "").lower()
        if name:
            out[name] = float(getattr(cat, "score", 0.0) or 0.0)
    return out


def expression_scores(categories) -> dict[str, float]:
    """คะแนนของทุกการแสดงออก (0–1) — ค่าเฉลี่ยของ blendshape ที่ประกอบกัน"""
    scores = blendshape_scores(categories)
    if not scores:
        return {}
    out: dict[str, float] = {}
    for label, keys in EXPRESSION_BLENDSHAPES.items():
        present = [scores[k] for k in keys if k in scores]
        if present:
            out[label] = sum(present) / len(present)
    return out


def classify(categories, threshold: float, margin: float = 0.0) -> tuple[str, float] | None:
    """
    การแสดงออกที่เด่นที่สุด คืน (label, score) หรือ None ถ้าไม่มี blendshapes มาเลย

    - ต่ำกว่า `threshold` ทุกตัว → ("neutral", คะแนนสูงสุด) เพราะ "หน้านิ่ง" เป็นคำตอบ
      ที่ถูก ไม่ใช่การไม่มีคำตอบ
    - ตัวที่หนึ่งชนะตัวที่สองไม่ถึง `margin` → neutral ด้วย · ยิ้มปนตกใจแยกไม่ออก
      การเดาข้างใดข้างหนึ่งจะให้ค่าที่แกว่งไปมาระหว่างสองอารมณ์ทั้งที่หน้าไม่ได้เปลี่ยน
    """
    scores = expression_scores(categories)
    if not scores:
        return None

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_label, best = ranked[0]
    if best < threshold:
        return NEUTRAL, best
    if margin > 0 and len(ranked) > 1 and best - ranked[1][1] < margin:
        return NEUTRAL, best
    return best_label, best


class EmotionState:
    """
    การแสดงออกที่ "นิ่งแล้ว" ของคนหนึ่งคน — เก็บใน Track.state จึงหายไปพร้อม id

    เฟรมเดียวเชื่อไม่ได้: การพูดทำให้ jawOpen กระโดด การกะพริบตาทำให้ eyeWide แกว่ง
    จึงรายงานเฉพาะการแสดงออกที่**ครองเสียงข้างมากในหน้าต่างล่าสุด** และต้องถือมา
    อย่างน้อย `hold` เฟรมก่อนจะเปลี่ยนค่าที่รายงาน
    """

    def __init__(self, window: int, hold: int):
        self.window = max(1, window)
        self.hold = max(1, hold)
        self._recent: list[str] = []
        self.label: str = NEUTRAL
        self.score: float = 0.0

    def update(self, categories, threshold: float, margin: float) -> str:
        result = classify(categories, threshold, margin)
        if result is None:
            return self.label          # ไม่มี blendshapes — คงค่าเดิมไว้ ไม่รีเซ็ตเป็น neutral

        label, score = result
        self._recent.append(label)
        if len(self._recent) > self.window:
            self._recent.pop(0)

        # เสียงข้างมากในหน้าต่าง แต่ต้องมากพอตามเกณฑ์ hold ด้วย
        counts: dict[str, int] = {}
        for item in self._recent:
            counts[item] = counts.get(item, 0) + 1
        winner, votes = max(counts.items(), key=lambda kv: kv[1])
        if winner != self.label and votes >= self.hold:
            self.label = winner
        self.score = score
        return self.label
