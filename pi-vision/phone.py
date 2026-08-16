"""
มีใครกำลังใช้โทรศัพท์อยู่ไหม — จากกรอบวัตถุ + ตำแหน่งข้อมือ/ใบหน้า

โมดูลนี้ **ไม่รู้จัก mediapipe และไม่มี state ระดับเฟรม** แบบเดียวกับ body.py และ
detect.py — รับกรอบที่ตรวจได้เข้ามา คืนคำตอบว่ากรอบนั้นเป็นของใคร จึงทดสอบได้
โดยไม่ต้องมีกล้อง โมเดล หรือแม้แต่ไฟล์ .tflite (ส่วนที่ต้องจำข้ามเฟรมคือ `PhoneHold`
ท้ายไฟล์ ซึ่งรับแค่ผลของเฟรมกับเวลา)

──────────────────────────────────────────────────────────────────────────────
⚠️ **"เจอโทรศัพท์ในเฟรม" ไม่ใช่ "มีคนกำลังใช้โทรศัพท์"** และนี่คือเหตุผลทั้งหมด
ที่โมดูลนี้มีอยู่ ไม่ใช่เรียกตัวตรวจวัตถุตรง ๆ จบ

โทรศัพท์ที่วางคว่ำอยู่บนโต๊ะ วางชาร์จอยู่ข้างผนัง หรืออยู่ในมือคนที่เดินผ่านหลังห้อง
ล้วนถูกตัวตรวจเห็นเหมือนกันหมด · ถ้ารายงานทุกกรอบที่เจอ ตัวเลข "เวลาที่ใช้โทรศัพท์"
จะกลายเป็น "เวลาที่มีโทรศัพท์อยู่ในห้อง" ซึ่งเป็นคนละเรื่องและมักไม่เปลี่ยนทั้งวัน

โมดูลนี้จึงตอบเฉพาะเมื่อ**จับคู่โทรศัพท์กับคนได้** ด้วยหลักฐานสองชั้น:

  1. **ใกล้ข้อมือที่มองเห็นจริง** (`confident=True`) — วัดได้ ไม่ใช่เดา
  2. **อยู่ใต้ใบหน้าคนนั้นในระยะที่มือเอื้อมถึง** (`confident=False`) — ใช้เมื่อ
     มองไม่เห็นข้อมือ ซึ่งกล้องตั้งโต๊ะเจอเป็นปกติ (เห็นแค่หัวกับไหล่)
     ถ้าไม่มีชั้นนี้ ฟีเจอร์จะไม่เคยทำงานเลยบนมุมกล้องที่ใช้จริง แต่ถ้ามีชั้นนี้
     โดยไม่บอกว่าเป็นการเดา ตัวเลขที่ได้จะดูน่าเชื่อกว่าความเป็นจริง
     — เหตุผลเดียวกับ `posture_confident` ใน body.py ทุกประการ

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


def _face_gap(box, face_box, cfg: dict, aspect: float) -> float | None:
    """
    ชั้นเดา: โทรศัพท์อยู่ใน "ช่องใต้หน้า" ของคนนี้ไหม — คืนระยะไว้จัดอันดับ
    · None = ไม่อยู่ในช่อง จึงไม่ใช่ของคนนี้

    ⚠️ **วัดสองแกนแยกกัน ไม่ใช่ระยะรัศมีอันเดียว** และข้อนี้มาจากการวัดของจริง:
    ทดสอบกับรูปในโฟลเดอร์ faces/ ตัวตรวจเห็นของสี่เหลี่ยมมืด ๆ บนโต๊ะที่มุมขวาล่าง
    ของภาพ ซึ่งอยู่ห่างจากหน้าคนในภาพเพียง ~1.3 เท่าของความกว้างใบหน้า — รัศมีเดียว
    ที่กว้างพอจะครอบโทรศัพท์ที่ถืออยู่ระดับตัก ย่อมครอบของบนโต๊ะข้าง ๆ ไปด้วยเสมอ

    มือของคนอยู่ใน**แนวดิ่งใต้หัว**ของคนคนนั้น ไม่ใช่เฉียงออกไป 45° — จึงยอมให้
    ห่างลงล่างได้ไกล (`face_below`) แต่ห่างออกข้างได้น้อย (`face_side`)
    ส่วนคนที่เหยียดแขนถือโทรศัพท์ออกข้างจริง ๆ แขนที่เหยียดนั้นมักเห็นข้อมือชัด
    จึงไปเข้าทางที่ **วัดได้** แทน ไม่ต้องพึ่งชั้นเดานี้

    หน่วยเป็น "ความกว้างใบหน้า" ที่แปลงเป็นสัดส่วนของความสูงภาพแล้ว (`* aspect`)
    ไม่งั้นตัวหารกับตัวตั้งอยู่คนละแกน และเกณฑ์เดียวกันจะหมายถึงคนละระยะทันทีที่
    เปลี่ยนอัตราส่วนภาพ (วัดจริง: ภาพแนวตั้ง 3:4 คลาดไป 25% · กล้อง 16:9 คลาดไป 80%)
    """
    fx1, fy1, fx2, fy2 = face_box
    unit = max((fx2 - fx1) * aspect, bd.EPSILON)
    cx = (fx1 + fx2) / 2.0
    cy = (fy1 + fy2) / 2.0
    px1, _py1, px2, py2 = box
    # ขอบล่างของโทรศัพท์ต้องต่ำกว่ากึ่งกลางใบหน้า — ยังยอมให้ยกขึ้นมาระดับหน้าได้
    if py2 < cy:
        return None
    side = max(px1 - cx, 0.0, cx - px2) * aspect / unit
    below = (py2 - cy) / unit
    if side > cfg["face_side"] or below > cfg["face_below"]:
        return None
    return math.hypot(side, below)


def assign(phones, people, cfg: dict, aspect: float = 1.0) -> dict:
    """
    จับคู่โทรศัพท์ทุกเครื่องในเฟรมกับคนที่ถืออยู่ — คืน `{key: Held}`

    **หนึ่งเครื่องเป็นของคนเดียว** เสมอ (คนที่ใกล้ที่สุด) เพราะถ้าปล่อยให้เครื่องเดียว
    นับให้ทุกคนที่อยู่ใกล้ ห้องที่คนนั่งชิดกันจะกลายเป็น "ทุกคนเล่นโทรศัพท์" จาก
    โทรศัพท์เครื่องเดียวที่วางอยู่กลางโต๊ะ

    หลักฐานจากข้อมือชนะหลักฐานจากใบหน้าเสมอ แม้ตัวเลขระยะจะมากกว่า — สองอย่างนี้
    คนละหน่วย (ความกว้างไหล่ กับ ความกว้างใบหน้า) เทียบกันตรง ๆ ไม่ได้ และอย่างแรก
    คือการวัด ส่วนอย่างหลังคือการเดา
    """
    held: dict = {}
    for phone in phones or ():
        best = None          # (มั่นใจไหม, ระยะ, key)
        for person in people or ():
            gap = _wrist_gap(phone.box, person.points, cfg, aspect)
            if gap is not None and gap <= cfg["hand_reach"]:
                cand = (True, gap, person.key)
            else:
                face = _face_gap(phone.box, person.face_box, cfg, aspect)
                if face is None:
                    continue
                cand = (False, face, person.key)
            # เรียงลำดับ: มั่นใจมาก่อน แล้วค่อยดูระยะ
            if best is None or (cand[0], -cand[1]) > (best[0], -best[1]):
                best = cand
        if best is None:
            continue          # ไม่มีใครเอื้อมถึง = วางอยู่เฉย ๆ ไม่ใช่กำลังใช้
        sure, gap, key = best
        prev = held.get(key)
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
