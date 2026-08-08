"""
เรขาคณิตของใบหน้า — index ของ landmark และสูตรคำนวณล้วน ๆ

โมดูลนี้ **ไม่มี state และไม่ขึ้นกับเวลา** รับ landmark เข้าไป คืนตัวเลขออกมา
ทำให้ทดสอบได้ง่ายโดยไม่ต้องมีกล้อง

index อ้างอิงจาก face mesh 468 จุดของ MediaPipe (canonical face model)
"""

from __future__ import annotations

import math
from typing import Sequence

# ── index ของ landmark ที่ใช้ ────────────────────────────────
# ตาซ้าย (ซ้ายของผู้ถูกถ่าย)
LEFT_EYE = {
    "outer": 33,
    "inner": 133,
    "upper": (160, 158),
    "lower": (144, 153),
}
# ตาขวา
RIGHT_EYE = {
    "outer": 263,
    "inner": 362,
    "upper": (385, 387),
    "lower": (380, 373),
}

NOSE_TIP = 1
FOREHEAD = 10
CHIN = 152
# ขอบนอกของใบหน้าซ้าย-ขวา ใช้วัดความกว้าง
FACE_LEFT = 234
FACE_RIGHT = 454
# มุมปากซ้าย-ขวา — ใช้ในลายเซ็นโครงหน้า
MOUTH_LEFT = 61
MOUTH_RIGHT = 291

# จุดที่ใช้วาดกรอบตา (เรียงเป็นวงรอบตา)
LEFT_EYE_RING = (33, 160, 158, 133, 153, 144)
RIGHT_EYE_RING = (362, 385, 387, 263, 373, 380)

# ค่าเล็กสุดที่ใช้กันหารด้วยศูนย์
EPSILON = 1e-6


def _xy(landmarks: Sequence, index: int) -> tuple[float, float]:
    """คืนพิกัด normalized (0–1) ของ landmark หนึ่งจุด"""
    p = landmarks[index]
    return p.x, p.y


def _dist(landmarks: Sequence, a: int, b: int) -> float:
    ax, ay = _xy(landmarks, a)
    bx, by = _xy(landmarks, b)
    return math.hypot(ax - bx, ay - by)


def eye_aspect_ratio(landmarks: Sequence, eye: dict) -> float:
    """
    EAR = (ระยะแนวตั้งคู่บน + ระยะแนวตั้งคู่ล่าง) / (2 × ระยะแนวนอน)

    ตาเปิดปกติ ~0.25–0.35 · ตาปิด ~0.05–0.12
    เป็นสัดส่วน จึงไม่ขึ้นกับระยะห่างจากกล้องหรือขนาดภาพ
    """
    v1 = _dist(landmarks, eye["upper"][0], eye["lower"][0])
    v2 = _dist(landmarks, eye["upper"][1], eye["lower"][1])
    h = _dist(landmarks, eye["outer"], eye["inner"])
    return (v1 + v2) / (2.0 * max(h, EPSILON))


def average_ear(landmarks: Sequence) -> float:
    """ค่าเฉลี่ย EAR ของสองตา"""
    return (
        eye_aspect_ratio(landmarks, LEFT_EYE) + eye_aspect_ratio(landmarks, RIGHT_EYE)
    ) / 2.0


def head_pose(landmarks: Sequence) -> tuple[float, float]:
    """
    ประมาณการหันหน้าแบบเรขาคณิต คืน (yaw, pitch) เป็นสัดส่วนไร้หน่วย

    วิธีคิด: เทียบตำแหน่งปลายจมูกกับจุดกึ่งกลางระหว่างหางตาสองข้าง
    แล้วหารด้วยขนาดใบหน้า เพื่อให้ค่าไม่ขึ้นกับระยะห่างจากกล้อง

      yaw   > 0  → หันไปทางขวาของภาพ
      pitch > 0  → ก้มลง

    หมายเหตุ: ค่านี้ **ไม่ใช่องศา** และมี bias ประจำตัวแต่ละคน
    (โครงหน้าไม่สมมาตร · ตำแหน่งกล้องไม่อยู่ระดับตาพอดี)
    จึงต้องหักค่าท่านิ่งออกก่อนใช้ — ดู analyzer.HeadPoseState ที่ทำ auto-calibrate ให้
    """
    nose_x, nose_y = _xy(landmarks, NOSE_TIP)
    lx, ly = _xy(landmarks, LEFT_EYE["outer"])
    rx, ry = _xy(landmarks, RIGHT_EYE["outer"])

    eye_mid_x = (lx + rx) / 2.0
    eye_mid_y = (ly + ry) / 2.0

    face_w = max(_dist(landmarks, FACE_LEFT, FACE_RIGHT), EPSILON)
    face_h = max(_dist(landmarks, FOREHEAD, CHIN), EPSILON)

    yaw = (nose_x - eye_mid_x) / face_w
    pitch = (nose_y - eye_mid_y) / face_h
    return yaw, pitch


def bounding_box(landmarks: Sequence) -> tuple[float, float, float, float]:
    """กรอบสี่เหลี่ยมหุ้มใบหน้าเป็นพิกัด normalized (x1, y1, x2, y2)"""
    xs = [p.x for p in landmarks]
    ys = [p.y for p in landmarks]
    return min(xs), min(ys), max(xs), max(ys)


def centroid(landmarks: Sequence) -> tuple[float, float]:
    """จุดกึ่งกลางของกรอบใบหน้า — ใช้ติดตามว่าเป็นคนเดิมหรือไม่"""
    x1, y1, x2, y2 = bounding_box(landmarks)
    return (x1 + x2) / 2.0, (y1 + y2) / 2.0


def interocular_px(landmarks: Sequence, frame_width: int) -> float:
    """
    ระยะระหว่างหางตาสองข้างเป็นพิกเซล — ตัวชี้วัดว่าใบหน้าใหญ่พอจะวัด EAR ได้ไหม

    EAR คำนวณจากระยะแนวตั้งของเปลือกตาซึ่งเล็กมาก (ราว 8% ของระยะนี้)
    ถ้าใบหน้าเล็กเกินไป ระยะนั้นจะเหลือไม่กี่พิกเซลจนสัญญาณรบกวนกลบข้อมูลจริง
    """
    return _dist(landmarks, LEFT_EYE["outer"], RIGHT_EYE["outer"]) * frame_width


# ── blendshape (MediaPipe Tasks API) ─────────────────────────
# ชื่อตามมาตรฐาน ARKit — ค่า 0.0 = ตาเปิดสนิท · 1.0 = ตาปิดสนิท
BLENDSHAPE_BLINK = ("eyeblinkleft", "eyeblinkright")


def blink_from_blendshapes(categories) -> float | None:
    """
    ดึงคะแนนการหลับตาจาก blendshapes คืนค่าเฉลี่ยสองตา (0–1) หรือ None ถ้าไม่มี

    แม่นกว่า EAR แบบเรขาคณิตเพราะโมเดลเรียนรู้มาแล้วว่ารูปตาแต่ละแบบหน้าตาเป็นอย่างไร
    จึงไม่ต้อง calibrate รายบุคคล และทนต่อการหันหน้าและการใส่แว่นได้ดีกว่า

    เทียบชื่อแบบไม่สนตัวพิมพ์ เพื่อไม่ให้พังถ้า MediaPipe เปลี่ยนรูปแบบชื่อ
    """
    if not categories:
        return None
    scores = []
    for cat in categories:
        name = (getattr(cat, "category_name", "") or "").replace("_", "").lower()
        if name in BLENDSHAPE_BLINK:
            scores.append(float(cat.score))
    if not scores:
        return None
    return sum(scores) / len(scores)


# ── ลายเซ็นโครงหน้า (สำหรับ re-identification) ───────────────
# จำนวนมิติของลายเซ็น — ใช้ตรวจว่าเวกเตอร์ที่รับมาถูกรูปแบบ
SIGNATURE_DIMS = 8


def face_signature(landmarks: Sequence) -> tuple[float, ...] | None:
    """
    ลายเซ็นโครงหน้า 8 มิติ ที่**ไม่ขึ้นกับขนาดใบหน้าและระยะห่างจากกล้อง**

    ทุกค่าเป็นสัดส่วนระหว่างระยะทางบนใบหน้าด้วยกันเอง จึงคงที่แม้คนเดินเข้า-ออก
    ใช้เฉพาะจุดที่**โครงสร้างคงที่** — ไม่ใช้ความสูงเปลือกตาหรือการอ้าปาก
    เพราะค่าพวกนั้นเปลี่ยนตลอดเวลาที่กะพริบตาหรือพูด

    คืน None ถ้าใบหน้าผิดรูปจนหารไม่ได้

    ⚠️ **นี่คือข้อมูลชีวมิติแบบอ่อน** — ระบุตัวตนซ้ำภายในเซสชันได้
    แต่ย้อนกลับเป็นภาพใบหน้าไม่ได้ และระบบเก็บไว้ใน RAM เท่านั้น ไม่เขียนลงดิสก์
    ดูหัวข้อความเป็นส่วนตัวใน README ก่อนเปิดใช้ในพื้นที่ที่มีผู้อื่น
    """
    face_w = _dist(landmarks, FACE_LEFT, FACE_RIGHT)
    face_h = _dist(landmarks, FOREHEAD, CHIN)
    if face_w < EPSILON or face_h < EPSILON:
        return None

    lx, ly = _xy(landmarks, LEFT_EYE["outer"])
    rx, ry = _xy(landmarks, RIGHT_EYE["outer"])
    eye_mid_y = (ly + ry) / 2.0
    _nx, nose_y = _xy(landmarks, NOSE_TIP)
    _mlx, mly = _xy(landmarks, MOUTH_LEFT)
    _mrx, mry = _xy(landmarks, MOUTH_RIGHT)
    mouth_mid_y = (mly + mry) / 2.0
    _cx, chin_y = _xy(landmarks, CHIN)

    left_eye_w = _dist(landmarks, LEFT_EYE["outer"], LEFT_EYE["inner"])
    right_eye_w = _dist(landmarks, RIGHT_EYE["outer"], RIGHT_EYE["inner"])

    return (
        _dist(landmarks, LEFT_EYE["outer"], RIGHT_EYE["outer"]) / face_w,   # ช่วงตากว้าง
        _dist(landmarks, LEFT_EYE["inner"], RIGHT_EYE["inner"]) / face_w,   # ระยะหัวตา
        _dist(landmarks, MOUTH_LEFT, MOUTH_RIGHT) / face_w,                 # ความกว้างปาก
        face_h / face_w,                                                     # สัดส่วนหน้า
        (nose_y - eye_mid_y) / face_h,                                       # ตา→จมูก
        (mouth_mid_y - nose_y) / face_h,                                     # จมูก→ปาก
        (chin_y - mouth_mid_y) / face_h,                                     # ปาก→คาง
        left_eye_w / max(right_eye_w, EPSILON),                              # ความไม่สมมาตร
    )


def signature_distance(a: Sequence[float], b: Sequence[float]) -> float:
    """
    ระยะห่างระหว่างลายเซ็นสองอัน — 0.0 = เหมือนกันเป๊ะ · 0.10 = ต่างกันเฉลี่ย 10%

    ใช้ค่าความต่างสัมพัทธ์เฉลี่ย ไม่ใช่ระยะแบบยุคลิด เพราะแต่ละมิติมีสเกลต่างกัน
    ค่าที่ได้จึงตีความเป็นเปอร์เซ็นต์ได้ตรง ๆ และตั้ง threshold ได้ง่าย
    """
    if not a or not b or len(a) != len(b):
        return float("inf")
    total = 0.0
    for x, y in zip(a, b):
        scale = max(abs(x), abs(y), EPSILON)
        total += abs(x - y) / scale
    return total / len(a)


def head_pose_from_matrix(matrix) -> tuple[float, float] | None:
    """
    คำนวณ yaw/pitch เป็น **องศา** จาก facial transformation matrix ขนาด 4×4

    แม่นกว่าวิธีเรขาคณิตเพราะเป็นการแก้ปัญหา pose จริง ไม่ใช่การประมาณจากตำแหน่งจมูก
    แต่ **ต้องยืนยันทิศทางบนหน้าจอก่อนใช้จริง** เพราะแกนอ้างอิงของ MediaPipe
    อาจให้เครื่องหมายกลับด้านกับที่คาด — ปรับได้ด้วย POSE_MATRIX_INVERT_* ใน .env

    คืน None ถ้าเมทริกซ์ไม่ถูกรูปแบบ (เช่นปิด output_facial_transformation_matrixes ไว้)
    """
    try:
        m = [[float(matrix[r][c]) for c in range(3)] for r in range(3)]
    except (TypeError, IndexError):
        return None

    sy = math.hypot(m[0][0], m[1][0])
    if sy < 1e-6:                       # gimbal lock — ท่านี้แยก yaw กับ roll ไม่ได้
        pitch = math.atan2(-m[1][2], m[1][1])
        yaw = math.atan2(-m[2][0], sy)
    else:
        pitch = math.atan2(m[2][1], m[2][2])
        yaw = math.atan2(-m[2][0], sy)
    return math.degrees(yaw), math.degrees(pitch)
