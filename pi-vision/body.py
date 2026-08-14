"""
ท่าทางร่างกายจาก landmark 33 จุดของ MediaPipe Pose

โมดูลนี้ **ไม่มี state และไม่รู้จัก mediapipe** รับ landmark เข้าไป คืนชื่อท่าออกมา
แบบเดียวกับที่ landmarks.py ทำกับใบหน้า จึงทดสอบได้โดยไม่ต้องมีกล้องหรือโมเดล
(ส่วนที่ต้องจำข้ามเฟรม — การโบกมือ และการกันป้ายกระพริบ — อยู่ใน `GestureHold`
ท้ายไฟล์ ซึ่งรับแค่ชื่อท่ากับเวลา ไม่ต้องรู้จัก landmark เลย)

**ขอบเขตของสิ่งที่บอกได้:** นี่คือเรขาคณิตของข้อต่อ ไม่ใช่การอ่านความหมาย
"ข้อมืออยู่เหนือไหล่" คือการยกมือ และเป็นการยืดเส้นยืดสาย การเกาหัว และจังหวะกลาง
ของการโบกมือด้วย · เวลาถือค้าง (`GestureHold`) กรองกรณีชัด ๆ ออกไปได้ แต่ไม่มีอะไร
แยกการยกมือออกจากการบิดขี้เกียจได้ · ป้ายจึงเป็นชื่อ**ท่า** ไม่ใช่ชื่อ**เจตนา**
`hand up` ไม่ใช่ `asking a question`

⚠️ ท่าที่ต้องเห็นขาถึงจะตอบได้ (ยืน/นั่ง) จะคืน None เมื่อขาถูกโต๊ะบัง —
ไม่ใช่เดาว่า "ยืน" · ส่วน "นอน" ใช้แค่ไหล่กับสะโพก จึงตอบได้แม้ไม่เห็นขา
ดู `posture()`
"""

from __future__ import annotations

import math
from collections import deque

# ── index ของ landmark ที่ใช้ (MediaPipe Pose 33 จุด) ────────
NOSE = 0
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28

# จุดที่ต้องเห็นชัดถึงจะตอบเรื่องแขนได้ — ไม่ครบ = ไม่ตอบ ไม่ใช่เดา
UPPER_BODY = (L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST)
# ลำตัวอย่างเดียวพอจะบอก "นอน" ได้ · แยกยืนกับนั่งต้องเห็นขาด้วย
TORSO = (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)
LEGS = (L_HIP, R_HIP, L_KNEE, R_KNEE)

EPSILON = 1e-6

# ชื่อท่าทั้งหมดที่โมดูลนี้คืนได้ — มีไว้ให้เทสและ HUD อ้างถึงโดยไม่ต้องพิมพ์สตริงเอง
HANDS_UP = "hands up"
HAND_UP = "hand up"
WAVING = "waving"
ARMS_CROSSED = "arms crossed"
HANDS_ON_HIPS = "hands on hips"
POINTING = "pointing"
STANDING = "standing"
SITTING = "sitting"
LYING = "lying"


def _vis(landmarks, index: int) -> float:
    """ความมั่นใจว่าเห็นจุดนี้จริง — 0 เมื่อโมเดลไม่ส่งค่ามาให้"""
    try:
        return float(getattr(landmarks[index], "visibility", 0.0) or 0.0)
    except (IndexError, TypeError):
        return 0.0


def visible(landmarks, indices, min_visibility: float) -> bool:
    """เห็นทุกจุดที่ระบุชัดพอไหม

    ต้องเช็คก่อนตอบทุกครั้ง เพราะ MediaPipe **เดาตำแหน่งจุดที่มองไม่เห็นให้เสมอ**
    ค่าที่ได้จึงหน้าตาเหมือนข้อมูลจริงทุกอย่าง ต่างกันแค่ตรง visibility เท่านั้น
    ถ้าไม่ดูค่านั้น ขาที่ถูกโต๊ะบังจะให้คำตอบว่า "ยืน" หรือ "นั่ง" ออกมาอย่างมั่นใจ
    """
    return all(_vis(landmarks, i) >= min_visibility for i in indices)


def _xy(landmarks, index: int) -> tuple[float, float]:
    p = landmarks[index]
    return p.x, p.y


def _mid(landmarks, a: int, b: int) -> tuple[float, float]:
    ax, ay = _xy(landmarks, a)
    bx, by = _xy(landmarks, b)
    return (ax + bx) / 2.0, (ay + by) / 2.0


def _dist(landmarks, a: int, b: int) -> float:
    ax, ay = _xy(landmarks, a)
    bx, by = _xy(landmarks, b)
    return math.hypot(ax - bx, ay - by)


def scale(landmarks) -> float:
    """
    ขนาดตัวคนบนภาพ — ใช้เป็นหน่วยวัดแทนพิกเซล

    ทุกเกณฑ์ในไฟล์นี้เป็น**สัดส่วนของค่านี้** ไม่ใช่ระยะดิบ ท่าเดียวกันจึงให้คำตอบ
    เดียวกันไม่ว่าคนจะยืนใกล้หรือไกลกล้อง

    ใช้ความกว้างไหล่เป็นหลัก และถอยไปใช้ความยาวลำตัวเมื่อคนหันข้าง (ไหล่ซ้อนกัน
    จนความกว้างเกือบเป็นศูนย์ ซึ่งจะทำให้ทุกอัตราส่วนระเบิด)
    """
    shoulders = _dist(landmarks, L_SHOULDER, R_SHOULDER)
    sx, sy = _mid(landmarks, L_SHOULDER, R_SHOULDER)
    hx, hy = _mid(landmarks, L_HIP, R_HIP)
    torso = math.hypot(sx - hx, sy - hy)
    # ลำตัวยาวราว 1.5 เท่าของความกว้างไหล่ในคนทั่วไป — ปรับให้เป็นหน่วยเดียวกันก่อนเทียบ
    return max(shoulders, torso / 1.5, EPSILON)


def _arm_straight(landmarks, shoulder: int, elbow: int, wrist: int, limit: float) -> bool:
    """แขนเหยียดตรงไหม — ระยะไหล่→ข้อมือ ใกล้เคียงผลรวมของสองท่อน"""
    upper = _dist(landmarks, shoulder, elbow)
    fore = _dist(landmarks, elbow, wrist)
    direct = _dist(landmarks, shoulder, wrist)
    return direct >= (upper + fore) * limit


def gesture(landmarks, cfg: dict) -> str | None:
    """
    ท่าแขนที่เห็นในเฟรมนี้ — คืน None เมื่อไม่เข้าท่าไหนเลย หรือมองไม่เห็นพอจะตอบ

    เรียงจากท่าที่ "เฉพาะเจาะจงกว่า" ไปหาท่าที่กว้างกว่า เพราะยกสองมือย่อมเข้าเงื่อนไข
    ยกมือข้างเดียวด้วยเสมอ · การชี้ตรวจก่อนยกมือข้างเดียวเช่นกัน เพราะชี้ขึ้นเฉียง ๆ
    ก็ทำให้ข้อมืออยู่เหนือไหล่ได้ และ "ชี้" เป็นคำตอบที่บอกอะไรมากกว่า

    หมายเหตุ: การโบกมือแยกจากที่นี่ไม่ได้ เพราะต้องดูหลายเฟรม — `GestureHold.update()`
    เป็นตัวยกระดับ `hand up` ที่แกว่งไปมาให้กลายเป็น `waving`
    """
    if not visible(landmarks, UPPER_BODY, cfg["min_visibility"]):
        return None

    unit = scale(landmarks)
    ls_x, ls_y = _xy(landmarks, L_SHOULDER)
    rs_x, rs_y = _xy(landmarks, R_SHOULDER)
    lw_x, lw_y = _xy(landmarks, L_WRIST)
    rw_x, rw_y = _xy(landmarks, R_WRIST)

    # y เพิ่มลงล่างในพิกัดภาพ — "อยู่เหนือ" คือค่า y น้อยกว่า
    margin = cfg["wrist_above_shoulder"] * unit
    left_up = lw_y < ls_y - margin
    right_up = rw_y < rs_y - margin

    if left_up and right_up:
        return HANDS_UP

    for up, sh, el, wr in ((left_up, L_SHOULDER, L_ELBOW, L_WRIST),
                           (right_up, R_SHOULDER, R_ELBOW, R_WRIST)):
        if up and _arm_straight(landmarks, sh, el, wr, cfg["straight_ratio"]):
            return POINTING
    if left_up or right_up:
        return HAND_UP

    # ── ท่าที่มืออยู่ระดับต่ำกว่าไหล่ ──
    # ชี้ไปด้านข้าง: แขนเหยียดตรงและข้อมืออยู่นอกลำตัวชัดเจน
    body_half = max(abs(ls_x - rs_x), EPSILON) / 2.0
    cx = (ls_x + rs_x) / 2.0
    reach = cfg["point_reach"] * unit
    for sh, el, wr, wx in ((L_SHOULDER, L_ELBOW, L_WRIST, lw_x),
                           (R_SHOULDER, R_ELBOW, R_WRIST, rw_x)):
        if abs(wx - cx) > body_half + reach and _arm_straight(
            landmarks, sh, el, wr, cfg["straight_ratio"]
        ):
            return POINTING

    if not visible(landmarks, (L_HIP, R_HIP), cfg["min_visibility"]):
        return None

    lh_x, lh_y = _xy(landmarks, L_HIP)
    rh_x, rh_y = _xy(landmarks, R_HIP)
    near = cfg["hand_near_hip"] * unit
    if (math.hypot(lw_x - lh_x, lw_y - lh_y) < near
            and math.hypot(rw_x - rh_x, rw_y - rh_y) < near):
        return HANDS_ON_HIPS

    # กอดอก: ข้อมือแต่ละข้าง**ข้ามไปอยู่ฝั่งตรงข้าม**ของลำตัว และอยู่ระดับอก
    chest_top = min(ls_y, rs_y)
    chest_low = (lh_y + rh_y) / 2.0
    crossed = cfg["cross_overlap"] * unit
    left_crossed = (lw_x - cx) * (ls_x - cx) < 0 and abs(lw_x - cx) > crossed
    right_crossed = (rw_x - cx) * (rs_x - cx) < 0 and abs(rw_x - cx) > crossed
    in_chest = all(chest_top < y < chest_low for y in (lw_y, rw_y))
    if left_crossed and right_crossed and in_chest:
        return ARMS_CROSSED

    return None


def _angle_from_vertical(a, b) -> float | None:
    """
    มุมของเวกเตอร์ a→b เทียบกับแนวดิ่ง เป็นองศา (0 = ดิ่งลง · 90 = ขนานพื้น)

    รับ landmark แบบ **world** (หน่วยเมตร สามแกน) ไม่ใช่พิกัดบนภาพ · แกน y ของ
    MediaPipe ชี้ลงในระนาบภาพ จึงเป็น "แนวดิ่ง" ตราบใดที่กล้องไม่ได้ตะแคง

    ที่ต้องใช้สามแกนไม่ใช่สองแกน: แขนขาที่ชี้เข้าหาเลนส์จะ**หดสั้นบนภาพ** วัดจริงกับ
    รูปหนึ่งใบ ต้นขาที่ทำมุม 34° กับแนวดิ่ง เหลือเพียง 7° เมื่อดูจากพิกัดสองแกน
    — คลาดไป 27° และคลาดไปในทางที่ทำให้ "ท่านั่ง" หน้าตาเหมือน "ท่ายืน" พอดี
    """
    dx, dy, dz = b.x - a.x, b.y - a.y, b.z - a.z
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < EPSILON:
        return None
    return math.degrees(math.acos(min(1.0, abs(dy) / length)))


def _world_mid(world, a: int, b: int):
    """จุดกึ่งกลางของ landmark world สองจุด — คืน object ที่มี .x .y .z เหมือนกัน"""
    from types import SimpleNamespace

    return SimpleNamespace(
        x=(world[a].x + world[b].x) / 2.0,
        y=(world[a].y + world[b].y) / 2.0,
        z=(world[a].z + world[b].z) / 2.0,
    )


def posture(landmarks, cfg: dict, previous: str | None = None, world=None) -> tuple[str, bool]:
    """
    ยืน · นั่ง · นอน — **ตอบเสมอ** คืน `(ท่า, มั่นใจไหม)`

    คนเราต้องอยู่ในท่าใดท่าหนึ่งเสมอ การตอบว่า "ไม่รู้" จึงไม่ใช่คำตอบที่ใช้ได้จริง
    แต่ความมั่นใจในคำตอบไม่เท่ากันในแต่ละสถานการณ์ — จึงคืนมาด้วยเป็นค่าที่สอง
    ให้หน้าจอเติม `?` ต่อท้ายท่าที่ยังเดาอยู่ได้ (แนวคิดเดียวกับชื่อจากแกลเลอรีใน faces.py)

    **ต้องดูค่าความมั่นใจเสมอเวลาเอาไปใช้** ท่าที่ไม่มั่นใจคือการเดาจากหลักฐานอ้อม ๆ
    ไม่ใช่การวัด · เอาไปนับสถิติรวมกับท่าที่วัดได้จริงจะได้ตัวเลขที่ดูดีแต่เชื่อไม่ได้

    ลำดับของหลักฐาน จากแน่ที่สุดไปเดาที่สุด:

      1. ลำตัวขนานพื้น + ขานอนตาม     → นอน            (มั่นใจ)
      2. เห็นขา วัดมุมต้นขาได้         → ยืน / นั่ง      (มั่นใจ)
      3. เห็นขา แต่มุมอยู่กลาง ๆ        → ข้างที่ใกล้กว่า  (เดา — กำลังลุกหรือกำลังนั่งลง)
      4. **ไม่เห็นขา ทั้งที่ลำตัวอยู่กลางเฟรม** → นั่ง    (เดา — มีอะไรบังอยู่ระดับสะโพก
         คนยืนที่เห็นเต็มตัวย่อมเห็นขา · การที่ขาหายไปทั้งที่ตัวไม่ได้ถูกขอบเฟรมตัด
         แปลว่ามีโต๊ะหรือของบังอยู่ตรงนั้น ซึ่งคนที่นั่งอยู่หลังโต๊ะเป็นคำอธิบายที่ตรงที่สุด)
      5. ลำตัวถูกขอบเฟรมตัด / มองไม่เห็นตัว → ท่าเดิม   (เดา — ไม่มีหลักฐานใหม่เลย
         คนที่เพิ่งยืนอยู่เมื่อครู่ยังน่าจะยืนอยู่ มากกว่าจะเป็นค่าตั้งต้นอะไรก็ไม่รู้)

    วัดจาก **landmark แบบ world** (หน่วยเมตร สามแกน) ที่โมเดลคืนมาพร้อมกับพิกัดบนภาพ
    อยู่แล้ว ไม่ใช่พิกัดสองแกนบนภาพ · เกณฑ์จึงเป็น**มุมจริง**ที่อธิบายได้ ไม่ใช่อัตราส่วน
    ที่ปรับจนพอใช้ได้ · `landmarks` (พิกัดบนภาพ) ยังใช้อยู่สองอย่าง: ดูว่ามองเห็นข้อไหนบ้าง
    และดูว่าสะโพกอยู่ชิดขอบล่างของเฟรมไหม ซึ่งเป็นคำถามเกี่ยวกับ**เฟรม** ไม่ใช่เกี่ยวกับตัวคน

    ไม่มี world landmark = วัดขาไม่ได้ ตกไปใช้หลักฐานอ้อมข้อ 4/5 ตามปกติ
    """
    fallback = previous or STANDING
    if not visible(landmarks, TORSO, cfg["min_visibility"]):
        return fallback, False

    _hx, hy = _mid(landmarks, L_HIP, R_HIP)
    legs_seen = visible(landmarks, LEGS, cfg["min_visibility"])

    if world:
        hip = _world_mid(world, L_HIP, R_HIP)
        torso_angle = _angle_from_vertical(_world_mid(world, L_SHOULDER, R_SHOULDER), hip)
        thigh_angle = (_angle_from_vertical(hip, _world_mid(world, L_KNEE, R_KNEE))
                       if legs_seen else None)

        # นอน = **ลำตัวขนานพื้น** · ในสามแกนไม่ต้องมีเงื่อนไข "ลำตัวต้องยาวพอ" อีกแล้ว
        # คนนอนหันหัวเข้ากล้องเคยเป็นกรณีที่ตอบไม่ได้ เพราะลำตัวหดจนสั้นบนภาพ
        # ในสามแกนลำตัวนั้นชี้ไปตามแกน z ซึ่งวัดได้ปกติ
        if torso_angle is not None and torso_angle >= cfg["lying_angle"]:
            # ก้มตัวเก็บของก็ทำให้ลำตัวขนานพื้นได้ — ต่างกันที่ขา
            # คนก้มขายังตั้งอยู่ · คนนอนขานอนไปด้วยกับลำตัว
            if thigh_angle is not None and thigh_angle < cfg["lying_angle"]:
                return STANDING, False       # ก้มตัวอยู่ = ยังยืน แต่ไม่ใช่ท่ายืนปกติ
            return LYING, True

        if thigh_angle is not None:
            if thigh_angle <= cfg["stand_angle"]:
                return STANDING, True        # ต้นขาห้อยดิ่งลง
            if thigh_angle >= cfg["sit_angle"]:
                return SITTING, True         # ต้นขาพับไปข้างหน้าเกือบขนานพื้น
            # อยู่ระหว่างสองท่า (กำลังลุก/กำลังนั่งลง) — ตอบข้างที่ใกล้กว่า แต่ไม่มั่นใจ
            middle = (cfg["stand_angle"] + cfg["sit_angle"]) / 2.0
            return (STANDING if thigh_angle <= middle else SITTING), False

    # ── วัดขาไม่ได้ (ถูกบัง อยู่นอกเฟรม หรือไม่มี world landmark) ──
    # แยกสองสาเหตุออกจากกัน เพราะให้คำตอบคนละอย่าง:
    #   สะโพกอยู่ชิดขอบล่างของเฟรม = ตัวถูกเฟรมตัด อาจยืนอยู่ก็ได้ → คงท่าเดิมไว้
    #   สะโพกอยู่กลางเฟรมแต่ขาหายไป = มีของบังอยู่ระดับสะโพก → นั่งอยู่หลังโต๊ะ
    if hy >= cfg["frame_edge"]:
        return fallback, False
    return SITTING, False


def head_level(landmarks, aspect: float, min_visibility: float) -> float | None:
    """ศีรษะอยู่สูงกว่าแนวกึ่งกลางภาพ **กี่เท่าของความกว้างไหล่** — None ถ้าวัดไม่ได้

    ทำไมค่านี้ถึงบอกท่านั่ง/ยืนได้ทั้งที่มองไม่เห็นขาเลย:

    กล้องรูเข็มที่ความสูง `h_cam` มองคนที่ระยะ `d` จะได้ระยะบนภาพจากกึ่งกลางเฟรม
    เท่ากับ `f·(h_หัว − h_cam)/d` ส่วนความกว้างไหล่บนภาพเท่ากับ `f·W_ไหล่/d`
    หารกันแล้ว **`f` กับ `d` ตัดทิ้งหมด** เหลือ `(h_หัว − h_cam)/W_ไหล่` ซึ่งเป็น
    สัดส่วนของร่างกายจริง ไม่ใช่ค่าที่ขึ้นกับว่าคนยืนใกล้หรือไกลกล้อง

    ผู้ใหญ่ลุกจากเก้าอี้แล้วตาสูงขึ้นราว 40 ซม. (ตานั่ง ~123 ซม. · ตายืน ~163 ซม.)
    ส่วนความกว้างไหล่ราว 36–40 ซม. → **ลุกยืน = ศีรษะขึ้นราวหนึ่งเท่าของความกว้างไหล่**
    ซึ่งเป็นการขยับก้อนใหญ่มากเทียบกับการเอนตัวหรือขยับหัวไปมาตามปกติ

    ⚠️ ต้องรู้อัตราส่วนภาพ เพราะ MediaPipe หาร x ด้วยความกว้างเฟรมแต่หาร y ด้วย
    ความสูง หนึ่งหน่วยในแนวตั้งกับแนวนอนจึงยาวไม่เท่ากันบนภาพจริง · ที่นี่คิดทุก
    อย่างเป็นหน่วย "ส่วนของความสูงเฟรม" ก่อนเทียบ ไม่งั้นค่าจะเพี้ยนไปตาม
    ความละเอียดที่ผู้ใช้เลือก (864×480 กับ 640×480 ให้คนละคำตอบทั้งที่คนอยู่ท่าเดิม)
    """
    if not visible(landmarks, (NOSE, L_SHOULDER, R_SHOULDER), min_visibility):
        return None
    lx, ly = _xy(landmarks, L_SHOULDER)
    rx, ry = _xy(landmarks, R_SHOULDER)
    span = math.hypot((lx - rx) * aspect, ly - ry)
    if span < EPSILON:
        return None                       # หันข้างจนไหล่ซ้อนกัน — หน่วยวัดใช้ไม่ได้
    _nx, ny = _xy(landmarks, NOSE)
    return (0.5 - ny) / span


class HeadPosture:
    """ตอบว่ายืนหรือนั่งจาก**ความสูงของศีรษะ** สำหรับตอนที่มองไม่เห็นขา

    เกิดจากช่องโหว่ที่ชัดที่สุดของ `posture()`: กล้องบนโต๊ะแทบไม่เคยเห็นขาเลย
    ท่าที่ได้จึงเป็นการเดาจากหลักฐานอ้อม ("ขาหายไป แปลว่าน่าจะมีโต๊ะบัง") ทุกครั้ง

    วิธีนี้ไม่เดา แต่**จำ**: เฟรมไหนที่วัดขาได้จริงและมั่นใจ จะจดความสูงศีรษะของ
    ท่านั้นไว้ พอขาหายไปก็เอาความสูงปัจจุบันมาเทียบกับที่จดไว้ · ความรู้ที่ใช้ตอบ
    จึงมาจากการวัดจริงของคนคนนั้นเอง ไม่ใช่ค่ากลางที่ตั้งมาจากที่ไหน

    รู้ทั้งสองท่าแล้วและห่างกันมากพอ = ตอบแบบมั่นใจได้ · รู้ท่าเดียวยังตอบได้แต่
    ไม่มั่นใจ (ใช้ระยะยกตัวมาตรฐานเป็นตัวแบ่ง) · ยังไม่รู้อะไรเลยก็ไม่ตอบ ปล่อยให้
    หลักฐานอ้อมแบบเดิมทำงานไป
    """

    def __init__(self, cfg: dict):
        self.rise = cfg["head_rise"]
        self.min_gap = cfg["head_min_gap"]
        self.smoothing = cfg["head_smoothing"]
        self.known: dict[str, float] = {}

    def learn(self, posture_label: str, level: float) -> None:
        """จดความสูงศีรษะของท่าที่ **วัดได้จริง** — ห้ามเรียกด้วยท่าที่ยังเดาอยู่"""
        if posture_label not in (SITTING, STANDING) or level is None:
            return
        old = self.known.get(posture_label)
        self.known[posture_label] = (
            level if old is None else self.smoothing * old + (1 - self.smoothing) * level
        )

    def guess(self, level: float | None) -> tuple[str, bool] | None:
        """คืน `(ท่า, มั่นใจไหม)` หรือ None ถ้ายังไม่มีอะไรให้เทียบ"""
        if level is None:
            return None
        sit, stand = self.known.get(SITTING), self.known.get(STANDING)
        if sit is not None and stand is not None and stand - sit >= self.min_gap:
            # เห็นมาแล้วทั้งสองท่าของคนคนนี้ — แบ่งครึ่งระหว่างสองค่าที่วัดเอง
            return (STANDING if level >= (sit + stand) / 2.0 else SITTING), True
        # รู้ท่าเดียว — ใช้ระยะยกตัวมาตรฐานครึ่งหนึ่งเป็นเส้นแบ่ง ยังไม่มั่นใจพอ
        half = self.rise / 2.0
        if sit is not None:
            return (STANDING if level >= sit + half else SITTING), False
        if stand is not None:
            return (SITTING if level <= stand - half else STANDING), False
        return None


def head_center(landmarks) -> tuple[float, float] | None:
    """
    จุดกึ่งกลางศีรษะจาก pose — ใช้จับคู่ pose นี้กับ track ใบหน้าอันไหน

    landmark 0–10 ของ pose เป็นจุดบนใบหน้าอยู่แล้ว (จมูก ตา หู ปาก) จึงไม่ต้องมี
    โมเดลหรือการคำนวณเพิ่มเพื่อรู้ว่าหัวของร่างนี้อยู่ตรงไหน
    """
    try:
        return _xy(landmarks, NOSE)
    except (IndexError, TypeError):
        return None


class PostureHold:
    """
    กันท่าทาง (ยืน/นั่ง/นอน) กระพริบไปมา — ต้องเห็นท่าใหม่ค้างก่อนถึงจะเปลี่ยน

    ต่างจาก `GestureHold` ตรงที่ท่าทางร่างกาย**มีค่าเสมอ** ไม่มีสถานะ "ไม่มีท่า"
    จึงไม่ต้องมีเวลาปล่อย มีแต่เวลาที่ต้องเห็นค้างก่อนสลับ

    ⚠️ ท่าที่ **ไม่มั่นใจ** ต้องใช้เวลานานกว่าถึงจะเปลี่ยนได้ (`unsure_multiplier`)
    เพราะหลักฐานอ้อม ๆ (เช่นเดาว่านั่งเพราะมองไม่เห็นขา) แกว่งง่ายกว่าการวัดจริงมาก
    ถ้าให้เวลาเท่ากัน คนที่นั่งอยู่จริงจะถูกสลับเป็น "ยืน" ทุกครั้งที่ขาโผล่มาให้เห็นแวบหนึ่ง
    """

    def __init__(self, cfg: dict):
        self.hold_seconds = cfg["posture_hold_seconds"]
        self.unsure_multiplier = cfg["posture_unsure_multiplier"]
        self.current: str | None = None
        self.confident = False
        self._pending: str | None = None
        self._pending_since = 0.0

    def update(self, label: str, sure: bool, now: float) -> tuple[str | None, bool]:
        """ป้อนท่าดิบของเฟรมนี้ คืน `(ท่าที่ควรแสดง, มั่นใจไหม)`"""
        if self.current is None:
            self.current, self.confident = label, sure
            return self.current, self.confident

        if label == self.current:
            # ท่าเดิมแต่เพิ่งวัดได้ชัดขึ้น — ยกระดับความมั่นใจได้ทันที ไม่ต้องรอ
            self.confident = self.confident or sure
            self._pending = None
            return self.current, self.confident

        need = self.hold_seconds * (1.0 if sure else self.unsure_multiplier)
        if label != self._pending:
            self._pending, self._pending_since = label, now
        elif now - self._pending_since >= need:
            self.current, self.confident = label, sure
            self._pending = None
        return self.current, self.confident


class GestureHold:
    """
    เปลี่ยนท่าที่อ่านได้รายเฟรมให้เป็นป้ายที่นิ่งพอจะอ่านออก

    ทำสองอย่างที่ฟังก์ชันด้านบนทำไม่ได้เพราะต้องจำข้ามเฟรม:

      1. **ถือค้าง** — ต้องเห็นท่าเดิมติดต่อกันอย่างน้อย `hold_seconds` ถึงจะประกาศ
         และเมื่อประกาศแล้วต้องหายไปครบ `release_seconds` ถึงจะเลิก · กันป้ายกระพริบ
         ตอน landmark สั่น ใช้แนวคิดเดียวกับ hysteresis ของการหันหน้าใน analyzer
      2. **โบกมือ** — `hand up` ที่ข้อมือแกว่งซ้าย-ขวากลับทิศหลายครั้งในหน้าต่างเวลา
         สั้น ๆ คือการโบก · ต้องดูหลายเฟรมถึงจะเห็น จึงอยู่ที่นี่ไม่ใช่ใน gesture()
    """

    def __init__(self, cfg: dict):
        self.hold_seconds = cfg["hold_seconds"]
        self.release_seconds = cfg["release_seconds"]
        self.wave_seconds = cfg["wave_seconds"]
        self.wave_reversals = cfg["wave_reversals"]
        self.wave_min_swing = cfg["wave_min_swing"]

        self.current: str | None = None       # ป้ายที่ประกาศออกไปแล้ว
        self._pending: str | None = None
        self._pending_since = 0.0
        self._gone_since: float | None = None
        self._wrist: deque = deque()          # (เวลา, x ของข้อมือที่ยกอยู่, หน่วยขนาดตัว)

    def _wave(self, now: float) -> bool:
        """ข้อมือกลับทิศกี่ครั้งในหน้าต่างล่าสุด — ถึงเกณฑ์คือกำลังโบก"""
        while self._wrist and now - self._wrist[0][0] > self.wave_seconds:
            self._wrist.popleft()
        if len(self._wrist) < 3:
            return False

        unit = self._wrist[-1][2]
        xs = [x for _t, x, _u in self._wrist]
        if (max(xs) - min(xs)) < self.wave_min_swing * unit:
            return False                      # ยกค้างเฉย ๆ ไม่ได้แกว่ง

        reversals, direction = 0, 0
        for a, b in zip(xs, xs[1:]):
            step = b - a
            if abs(step) < self.wave_min_swing * unit * 0.25:
                continue                      # ขยับนิดเดียว = สัญญาณรบกวน ไม่ใช่การกลับทิศ
            sign = 1 if step > 0 else -1
            if direction and sign != direction:
                reversals += 1
            direction = sign
        return reversals >= self.wave_reversals

    def update(self, raw: str | None, now: float, wrist_x=None, unit=1.0) -> str | None:
        """
        ป้อนท่าดิบของเฟรมนี้ คืนป้ายที่ควรแสดง (หรือ None)

        `wrist_x` คือตำแหน่งแนวนอนของข้อมือที่ยกอยู่ — ส่งมาเฉพาะตอนท่าเป็น hand up
        เพื่อให้ตรวจการโบกได้ · ไม่ส่งก็ทำงานได้ แค่ไม่มี waving
        """
        if raw == HAND_UP and wrist_x is not None:
            self._wrist.append((now, wrist_x, unit))
            if self._wave(now):
                raw = WAVING
        elif raw != WAVING:
            self._wrist.clear()

        if raw is None:
            # หายไปชั่วขณะยังไม่ถือว่าเลิกทำท่า — landmark หลุดเป็นเฟรม ๆ เป็นเรื่องปกติ
            if self.current is not None:
                if self._gone_since is None:
                    self._gone_since = now
                elif now - self._gone_since >= self.release_seconds:
                    self.current = None
                    self._gone_since = None
            self._pending = None
            return self.current

        self._gone_since = None
        if raw == self.current:
            return self.current

        if raw != self._pending:
            self._pending, self._pending_since = raw, now
        elif now - self._pending_since >= self.hold_seconds:
            self.current = raw
            self._pending = None
        return self.current
