"""
มีใครกำลังใช้โทรศัพท์อยู่ไหม — จากกรอบวัตถุ + ตำแหน่งข้อมือ/ใบหน้า

โมดูลนี้ **ไม่รู้จัก mediapipe และไม่มี state ระดับเฟรม** แบบเดียวกับ body.py และ
detect.py — รับกรอบที่ตรวจได้เข้ามา คืนคำตอบว่ากรอบนั้นเป็นของใคร จึงทดสอบได้
โดยไม่ต้องมีกล้อง โมเดล หรือแม้แต่ไฟล์ .tflite (ส่วนที่ต้องจำข้ามเฟรมคือ `PhoneHold`
ท้ายไฟล์ ซึ่งรับแค่ผลของเฟรมกับเวลา)

──────────────────────────────────────────────────────────────────────────────
นโยบาย: **โทรศัพท์ทุกเครื่องที่เห็นมีเจ้าของ คือคนที่อยู่ใกล้ที่สุด**

ตัวตรวจตอบได้แค่ "มีโทรศัพท์อยู่ตรงนี้" ไม่ได้ตอบว่าเป็นของใคร โมดูลนี้เติมส่วนนั้น
ด้วยการวัดระยะจากโทรศัพท์ถึงทุกคนในเฟรมแล้วยกให้คนที่ใกล้ที่สุด · หนึ่งเครื่อง
มีเจ้าของคนเดียวเสมอ ไม่งั้นห้องที่นั่งชิดกันจะกลายเป็น "ทุกคนเล่นโทรศัพท์"
จากเครื่องเดียวที่วางกลางโต๊ะ

หลักฐานที่ใช้จับคู่มีสามชั้น เรียงตามความน่าเชื่อ (ดู `assign`):

  1. `HELD`    — อยู่ในระยะมือของข้อมือที่**มองเห็นจริง** → `confident=True`
  2. `COLUMN`  — อยู่ในช่องใต้ใบหน้า (ท่าที่คนถือโทรศัพท์อยู่) แต่ไม่เห็นข้อมือยืนยัน
  3. `NEAREST` — แค่ใกล้ที่สุดในเฟรม ไม่มีหลักฐานอื่นเลย

⚠️ **ราคาที่ต้องรู้**: ชั้น 3 แปลว่าโทรศัพท์ที่วางอยู่บนโต๊ะเฉย ๆ ก็ถูกนับว่ามีคน
ใช้อยู่ด้วย — คนที่นั่งใกล้มันที่สุด · วัดกับรูปจริงใน faces/ แล้ว: ของสี่เหลี่ยม
มืดบนโต๊ะที่มุมภาพได้คะแนน 0.40 และอยู่ห่างจากคนในภาพ ~1.3 เท่าของความกว้าง
ใบหน้า ซึ่งใต้นโยบายนี้ = เธอกำลังใช้โทรศัพท์

สิ่งที่ยังแยกให้คือ **`confident`** ซึ่งเป็นจริงเฉพาะชั้น 1 · ปลายทางที่ต้องการเฉพาะ
ที่วัดได้จริงให้กรองด้วยคอลัมน์ `phone_confident` และตั้ง `PHONE_NEAREST_ALWAYS=false`
เพื่อกลับไปเป็นแบบเข้ม (ไม่มีหลักฐานก็ไม่นับให้ใคร) ได้ทุกเมื่อ
— เหตุผลของการมีธงนี้เหมือน `posture_confident` ใน body.py ทุกประการ

ป้ายที่ได้จึงเป็นชื่อ**สถานการณ์ที่เห็น** ไม่ใช่ชื่อ**เจตนา**: `on phone` รวมทั้ง
การเล่นโทรศัพท์ การเปิดดูสไลด์ที่ครูสั่ง และการยกขึ้นมาดูเวลา — เหมือนที่ `hand up`
รวมการยืดเส้นยืดสายไว้ด้วย (ดูหัวไฟล์ body.py)
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import body as bd

# ป้ายที่แสดงบนจอและเก็บลงฐานข้อมูล — ให้ที่อื่นอ้างถึงโดยไม่ต้องพิมพ์สตริงเอง
ON_PHONE = "on phone"

# ชื่อคลาสในโมเดล COCO ที่หมายถึงโทรศัพท์ (labels.txt ของ efficientdet_lite* มี 90 ชื่อ)
# แยกออกมาเป็นค่าคงที่เพราะต้องส่งให้ `category_allowlist` ของ ObjectDetector ด้วย
# — พิมพ์ผิดที่นั่นไม่มี error ให้เห็น มันแค่ตรวจไม่เจออะไรเลยตลอดกาล
PHONE_LABEL = "cell phone"


@dataclass
class Seen:
    """โทรศัพท์หนึ่งเครื่องที่ตัวตรวจเห็น — พิกัด normalized เหมือนที่เหลือทั้งระบบ"""

    box: tuple[float, float, float, float]
    score: float = 0.0


@dataclass
class Person:
    """คนหนึ่งคนเท่าที่การจับคู่ต้องรู้

    `points` เป็น pose landmark 33 จุด (None = เฟรมนี้ไม่มีท่าทางของคนนี้)
    `face_box` เป็นกรอบใบหน้าจากไปป์ไลน์ใบหน้า ซึ่ง**มีเสมอ** เพราะทุก track
    เกิดจากใบหน้า — ชั้นเดาจึงยังทำงานได้เมื่อโมเดลท่าทางไม่เห็นคนนี้
    """

    key: object
    face_box: tuple[float, float, float, float]
    points: object = None


@dataclass
class Held:
    """ผลการจับคู่ของคนหนึ่งคน — `distance` เป็นหน่วยของหลักฐานที่ใช้จับคู่"""

    distance: float
    confident: bool
    score: float = 0.0


def to_boxes(detections, frame_w: int, frame_h: int, min_score: float = 0.0) -> list[Seen]:
    """
    แปลงผลจาก mediapipe ObjectDetector เป็นกรอบ normalized

    ตัวตรวจคืนพิกัด**พิกเซล** (origin_x/y + width/height) เหมือน FaceDetector
    ส่วนที่เหลือของระบบใช้ normalized ทั้งหมด — แปลงที่นี่ที่เดียว
    (เหตุผลเดียวกับ `detect.to_boxes` และโค้ดก็หน้าตาเหมือนกันโดยตั้งใจ)
    """
    out = []
    for det in detections or []:
        bb = det.bounding_box
        cats = getattr(det, "categories", None) or []
        score = float(getattr(cats[0], "score", 0.0)) if cats else 0.0
        if score < min_score:
            continue
        x1 = max(0.0, bb.origin_x / frame_w)
        y1 = max(0.0, bb.origin_y / frame_h)
        x2 = min(1.0, (bb.origin_x + bb.width) / frame_w)
        y2 = min(1.0, (bb.origin_y + bb.height) / frame_h)
        if x2 <= x1 or y2 <= y1:
            continue
        out.append(Seen(box=(x1, y1, x2, y2), score=score))
    return out


def _gap(box, px: float, py: float, aspect: float) -> float:
    """
    ระยะจากจุดหนึ่งถึง**ขอบที่ใกล้ที่สุด**ของกรอบ (0 = จุดอยู่ในกรอบ)

    วัดถึงขอบ ไม่ใช่ถึงจุดกึ่งกลาง เพราะโทรศัพท์ที่ถือแนวตั้งกับแนวนอนมีจุดกึ่งกลาง
    ห่างจากมือไม่เท่ากันทั้งที่ถืออยู่เหมือนกัน — ระยะถึงขอบไม่สนใจว่ากรอบยาวไปทางไหน

    คูณแกน x ด้วย aspect ก่อนเสมอ: mediapipe หาร x ด้วยความกว้างภาพแต่หาร y ด้วย
    ความสูง ระยะในพิกัด normalized จึงไม่ใช่ระยะจริงจนกว่าจะแก้สัดส่วนก่อน
    """
    x1, y1, x2, y2 = box
    dx = max(x1 - px, 0.0, px - x2) * aspect
    dy = max(y1 - py, 0.0, py - y2)
    return math.hypot(dx, dy)


def _wrist_gap(box, points, cfg: dict, aspect: float) -> float | None:
    """
    ระยะจากกรอบถึงข้อมือที่ใกล้ที่สุด **เป็นหน่วยความกว้างไหล่** · None = ไม่เห็นข้อมือ

    หน่วยเป็นสัดส่วนของขนาดตัว ไม่ใช่พิกเซล ด้วยเหตุผลเดียวกับทุกเกณฑ์ใน body.py
    — คนที่นั่งไกลกล้องถือโทรศัพท์ห่างมือเท่ากับคนที่นั่งใกล้ แต่ระยะบนภาพต่างกันหลายเท่า
    """
    if points is None:
        return None
    unit = bd.scale(points)
    best = None
    for wrist in (bd.L_WRIST, bd.R_WRIST):
        if not bd.visible(points, (wrist,), cfg["min_visibility"]):
            continue
        try:
            p = points[wrist]
        except (IndexError, TypeError):
            continue
        d = _gap(box, p.x, p.y, aspect) / max(unit, bd.EPSILON)
        if best is None or d < best:
            best = d
    return best


def _face_dist(box, face_box, aspect: float) -> float:
    """
    ระยะจากกรอบถึงใบหน้า **เป็นหน่วยความกว้างใบหน้า** — คืนค่าเสมอ ไม่มีเงื่อนไข

    ใช้ตัดสินว่า "ใกล้ใครที่สุด" จึงต้องเทียบกันได้ทุกคนในเฟรม ไม่ใช่คัดใครออกก่อน
    หน่วยเป็นสัดส่วนของขนาดคน ไม่ใช่พิกเซล คนที่นั่งไกลกล้องจึงไม่ได้เสียเปรียบ
    คนที่นั่งใกล้เพียงเพราะบนภาพทุกอย่างของเขาเล็กกว่า

    ⚠️ ความกว้างใบหน้าถูกคูณ `aspect` ก่อนใช้เป็นหน่วย เพราะ mediapipe หาร x ด้วย
    ความกว้างภาพแต่หาร y ด้วยความสูง — ตัวหารกับตัวตั้งจะอยู่คนละแกนถ้าไม่แปลงก่อน
    (วัดจริง: ภาพแนวตั้ง 3:4 คลาดไป 25% · กล้อง 16:9 คลาดไป 80%)
    """
    fx1, fy1, fx2, fy2 = face_box
    unit = max((fx2 - fx1) * aspect, bd.EPSILON)
    cx = (fx1 + fx2) / 2.0
    cy = (fy1 + fy2) / 2.0
    return _gap(box, cx, cy, aspect) / unit


def _in_column(box, face_box, cfg: dict, aspect: float) -> bool:
    """
    โทรศัพท์อยู่ใน "ช่องใต้ใบหน้า" ของคนนี้ไหม — ท่าที่คนถือโทรศัพท์อยู่จริง

    ไม่ได้ใช้คัดใครออกจากการจับคู่แล้ว (ดู `assign`) แต่ใช้**จัดลำดับความน่าเชื่อ**:
    คนที่โทรศัพท์อยู่ใต้หน้าพอดีมาก่อนคนที่บังเอิญนั่งใกล้กว่าแต่โทรศัพท์อยู่เฉียงออกไป

    วัดสองแกนแยกกัน ไม่ใช่รัศมีอันเดียว เพราะมือของคนอยู่ใน**แนวดิ่งใต้หัว** ไม่ใช่
    เฉียง 45° — ยอมให้ห่างลงล่างได้ไกล (`face_below`) แต่ห่างออกข้างได้น้อย (`face_side`)
    """
    fx1, fy1, fx2, fy2 = face_box
    unit = max((fx2 - fx1) * aspect, bd.EPSILON)
    cx = (fx1 + fx2) / 2.0
    cy = (fy1 + fy2) / 2.0
    px1, _py1, px2, py2 = box
    # ขอบล่างของโทรศัพท์ต้องต่ำกว่ากึ่งกลางใบหน้า — ยังยอมให้ยกขึ้นมาระดับหน้าได้
    if py2 < cy:
        return False
    side = max(px1 - cx, 0.0, cx - px2) * aspect / unit
    below = (py2 - cy) / unit
    return side <= cfg["face_side"] and below <= cfg["face_below"]


# ลำดับความน่าเชื่อของหลักฐาน — สูงกว่าชนะเสมอ ไม่ว่าตัวเลขระยะจะเป็นเท่าไร
# (สามชั้นนี้วัดคนละหน่วยกัน ความกว้างไหล่ กับ ความกว้างใบหน้า เทียบตรง ๆ ไม่ได้)
HELD = 2        # อยู่ในระยะมือของข้อมือที่**มองเห็นจริง** — วัดได้
COLUMN = 1      # อยู่ในช่องใต้ใบหน้า — ท่าที่คนถือโทรศัพท์อยู่ แต่ไม่เห็นมือยืนยัน
NEAREST = 0     # แค่ใกล้คนนี้ที่สุดในเฟรม — ไม่มีหลักฐานอื่นเลย


def assign(phones, people, cfg: dict, aspect: float = 1.0) -> dict:
    """
    จับคู่โทรศัพท์ทุกเครื่องกับ **คนที่อยู่ใกล้ที่สุด** — คืน `{key: Held}`

    ──────────────────────────────────────────────────────────────────────────
    นโยบาย: โทรศัพท์ที่ตัวตรวจเห็น **ต้องมีเจ้าของเสมอ** คือคนที่อยู่ใกล้ที่สุด
    ในเฟรมนั้น · ไม่มีกรณี "เห็นแล้วแต่ไม่นับให้ใคร" อีกต่อไป

    ⚠️ **ราคาของนโยบายนี้ที่ต้องรู้**: โทรศัพท์ที่วางอยู่บนโต๊ะเฉย ๆ ก็มีเจ้าของ
    ด้วยเหมือนกัน — คนที่นั่งใกล้มันที่สุดจะถูกนับว่ากำลังใช้อยู่ · วัดกับรูปจริงใน
    faces/ แล้ว: ของสี่เหลี่ยมมืดบนโต๊ะที่มุมภาพ (คะแนน 0.40) ห่างจากคนในภาพ
    ~1.3 เท่าของความกว้างใบหน้า ซึ่งใต้นโยบายนี้ = เธอกำลังใช้โทรศัพท์

    สิ่งที่ยังกันไว้ให้คือ **`confident`** — เป็น True เฉพาะชั้น `HELD` ที่เห็นข้อมือ
    อยู่ในระยะจริงเท่านั้น ส่วนอีกสองชั้นเป็น False และไปโผล่เป็น `?` บนจอกับ
    `phone_confident=false` ในฐานข้อมูล · ใครที่อยากได้เฉพาะที่วัดได้จริง กรองที่
    คอลัมน์นั้น และตั้ง `PHONE_NEAREST_ALWAYS=false` เพื่อกลับไปเป็นแบบเข้มได้
    ──────────────────────────────────────────────────────────────────────────

    **หนึ่งเครื่องเป็นของคนเดียว** เสมอ เพราะถ้าปล่อยให้เครื่องเดียวนับให้ทุกคนที่
    อยู่ใกล้ ห้องที่คนนั่งชิดกันจะกลายเป็น "ทุกคนเล่นโทรศัพท์" จากเครื่องเดียวกลางโต๊ะ

    ชั้นที่สูงกว่าชนะเสมอแม้ตัวเลขระยะจะมากกว่า — หลักฐานคนละชนิดเทียบกันด้วย
    ตัวเลขตรง ๆ ไม่ได้ · เท่ากันแล้วค่อยตัดสินด้วยระยะ
    """
    held: dict = {}
    for phone in phones or ():
        best = None          # (ชั้นหลักฐาน, ระยะ, key)
        for person in people or ():
            gap = _wrist_gap(phone.box, person.points, cfg, aspect)
            if gap is not None and gap <= cfg["hand_reach"]:
                cand = (HELD, gap, person.key)
            else:
                near = _face_dist(phone.box, person.face_box, aspect)
                if _in_column(phone.box, person.face_box, cfg, aspect):
                    cand = (COLUMN, near, person.key)
                elif cfg.get("nearest_always", True):
                    cand = (NEAREST, near, person.key)
                else:
                    continue          # โหมดเข้ม: ไม่มีหลักฐานก็ไม่นับให้ใคร
            # เรียงลำดับ: ชั้นหลักฐานมาก่อน แล้วค่อยดูระยะ (ใกล้กว่าชนะ)
            if best is None or (cand[0], -cand[1]) > (best[0], -best[1]):
                best = cand
        if best is None:
            continue          # เกิดได้เฉพาะโหมดเข้ม หรือไม่มีคนในเฟรมเลย
        tier, gap, key = best
        # ⚠️ เก็บเป็น **บูลีน** ไม่ใช่หมายเลขชั้น — ค่านี้ไหลตรงไปเป็นคอลัมน์
        # phone_confident (boolean) ในฐานข้อมูล และไปเป็น `?` บนจอ · ปล่อยเลขชั้น
        # ผ่านไปเมื่อไร ทุกชั้นที่ไม่ใช่ 0 จะ truthy หมด = ทุกอย่างกลายเป็น "วัดได้"
        sure = tier == HELD
        prev = held.get(key)
        # คนหนึ่งถืออยู่หลายเครื่องได้ — เก็บหลักฐานที่ดีที่สุดของคนนั้นไว้
        if prev is None or (sure, -gap) > (prev.confident, -prev.distance):
            held[key] = Held(distance=gap, confident=sure, score=phone.score)
    return held


class PhoneHold:
    """
    กันป้าย `on phone` กระพริบ — ต้องเห็นค้างก่อนจะประกาศ และต้องหายไปนานพอจะเลิก

    จำเป็นกว่ากรณีท่าทางเสียอีก เพราะตัวตรวจวัตถุ**หลุดเป็นเฟรม ๆ** เป็นเรื่องปกติ:
    มือขยับนิดเดียว โทรศัพท์เอียงจนสะท้อนแสง หรือถูกนิ้วบังครึ่งเครื่อง คะแนนก็ตกใต้
    เกณฑ์แล้ว · ถ้าไม่มีตัวนี้ ป้ายจะกระพริบทุกครั้งที่คนขยับมือ และค่าที่ส่งขึ้น
    ฐานข้อมูลจะขึ้น ๆ ลง ๆ ตามความสั่นของตัวตรวจ ไม่ใช่ตามพฤติกรรมของคน

    `release_seconds` ยาวกว่า `hold_seconds` ด้วยเหตุผลนี้ — เข้าสู่สถานะ "ใช้อยู่"
    ต้องมีหลักฐานพอ แต่ออกจากสถานะนั้นต้องรอให้แน่ใจว่าวางจริง ไม่ใช่แค่ตรวจไม่เจอ
    """

    def __init__(self, cfg: dict):
        self.hold_seconds = cfg["hold_seconds"]
        self.release_seconds = cfg["release_seconds"]
        self.using = False
        self.confident = False
        self._seen_since: float | None = None
        self._gone_since: float | None = None

    def update(self, held: Held | None, now: float) -> tuple[bool, bool]:
        """ป้อนผลของเฟรมนี้ คืน `(กำลังใช้อยู่ไหม, มั่นใจไหม)`"""
        if held is not None:
            self._gone_since = None
            if self._seen_since is None:
                self._seen_since = now
            if self.using:
                # ยังใช้อยู่และเพิ่งเห็นข้อมือชัด — ยกระดับความมั่นใจได้ทันที
                # (ลดระดับไม่ได้: การที่เฟรมนี้มองไม่เห็นข้อมือไม่ได้ลบล้างเฟรมที่เห็น)
                self.confident = self.confident or held.confident
            elif now - self._seen_since >= self.hold_seconds:
                self.using = True
                self.confident = held.confident
        else:
            self._seen_since = None
            if self.using:
                if self._gone_since is None:
                    self._gone_since = now
                elif now - self._gone_since >= self.release_seconds:
                    self.using = False
                    self.confident = False
                    self._gone_since = None
        return self.using, self.confident
