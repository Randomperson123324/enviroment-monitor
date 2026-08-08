"""
ใบหน้าจำลองสำหรับการทดสอบ — ใช้ร่วมกันระหว่าง test_logic.py และ bench_reid.py

ไม่ต้องมีกล้องหรือ mediapipe · สร้าง landmark เท่าที่ landmarks.py ต้องใช้
"""

from dataclasses import dataclass

import landmarks as lm


@dataclass
class P:
    """เลียนแบบ NormalizedLandmark ของ mediapipe"""

    x: float
    y: float
    z: float = 0.0


@dataclass
class Cat:
    """เลียนแบบ Category ของ mediapipe (ใช้กับ blendshapes)"""

    category_name: str
    score: float


def make_face(
    cx=0.5,
    cy=0.5,
    size=0.3,
    yaw=0.0,
    pitch=0.0,
    eye_open=1.0,
    lid_scale=0.09,
    aspect=1.3,
    eye_span=0.62,
    mouth_span=0.40,
):
    """
    สร้าง landmark ปลอมของใบหน้าหนึ่งใบ

    lid_scale  จำลอง "คนตาโต / คนตาเล็ก" — ค่าสูง = EAR ตาเปิดสูงกว่า
    aspect / eye_span / mouth_span จำลอง **โครงหน้าที่ต่างกันระหว่างคน**
    ใช้ทดสอบ re-identification ว่าแยกคนออกจากกันได้จริง
    """
    n = max(lm.FACE_RIGHT, lm.CHIN, lm.RIGHT_EYE["inner"], lm.MOUTH_RIGHT) + 1
    pts = [P(cx, cy) for _ in range(n)]

    half_w, half_h = size / 2, size / 2 * aspect
    pts[lm.FACE_LEFT] = P(cx - half_w, cy)
    pts[lm.FACE_RIGHT] = P(cx + half_w, cy)
    pts[lm.FOREHEAD] = P(cx, cy - half_h)
    pts[lm.CHIN] = P(cx, cy + half_h)

    eye_y = cy - half_h * 0.25
    eye_dx = half_w * eye_span
    pts[lm.LEFT_EYE["outer"]] = P(cx - eye_dx, eye_y)
    pts[lm.LEFT_EYE["inner"]] = P(cx - eye_dx * 0.35, eye_y)
    pts[lm.RIGHT_EYE["outer"]] = P(cx + eye_dx, eye_y)
    pts[lm.RIGHT_EYE["inner"]] = P(cx + eye_dx * 0.35, eye_y)

    mouth_y = cy + half_h * 0.45
    pts[lm.MOUTH_LEFT] = P(cx - half_w * mouth_span, mouth_y)
    pts[lm.MOUTH_RIGHT] = P(cx + half_w * mouth_span, mouth_y)

    lid = half_h * lid_scale * eye_open
    for eye, sign in ((lm.LEFT_EYE, -1), (lm.RIGHT_EYE, 1)):
        ex = cx + sign * eye_dx * 0.7
        for i, up in enumerate(eye["upper"]):
            pts[up] = P(ex + (i - 0.5) * 0.01, eye_y - lid)
        for i, low in enumerate(eye["lower"]):
            pts[low] = P(ex + (i - 0.5) * 0.01, eye_y + lid)

    nose_base_y = eye_y + half_h * 0.5
    pts[lm.NOSE_TIP] = P(cx + yaw * size, nose_base_y + pitch * (half_h * 2))
    return pts


def noisy(points, level, rng):
    """จำลอง landmark ที่สั่นระหว่างเฟรม — level 0.015 = ±1.5%"""
    return [
        P(p.x * (1 + rng.uniform(-level, level)), p.y * (1 + rng.uniform(-level, level)))
        for p in points
    ]


def detection(points):
    """แปลง landmark เป็น Detection พร้อมลายเซ็น"""
    from tracker import Detection

    cx, cy = lm.centroid(points)
    return Detection(
        cx=cx, cy=cy, box=lm.bounding_box(points), signature=lm.face_signature(points)
    )


# โครงหน้าสามแบบที่ต่างกันจริง — ใช้ทดสอบ re-identification
PEOPLE = {
    "A": dict(aspect=1.30, eye_span=0.62, mouth_span=0.40),
    "B": dict(aspect=1.55, eye_span=0.50, mouth_span=0.55),
    "C": dict(aspect=1.15, eye_span=0.72, mouth_span=0.32),
}

# หน้าคล้าย A มาก — จำลองพี่น้อง/ฝาแฝด สำหรับทดสอบ ratio test
TWIN = dict(aspect=1.31, eye_span=0.625, mouth_span=0.405)
