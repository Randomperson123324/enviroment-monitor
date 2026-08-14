"""
ตรวจหาใบหน้าด้วยโมเดล **full-range** — เห็นคนที่อยู่ไกลกว่าที่ไปป์ไลน์เดิมเห็น

`FaceLandmarker` มีตัวตรวจใบหน้าของตัวเองอยู่ข้างใน เป็นรุ่น short-range ที่ไม่มี
ตัวเลือกให้เปลี่ยน ระยะจึงจบราว 2 เมตร · โมดูลนี้เอา `FaceDetector` รุ่น full-range
(BlazeFace ตัวเดียวกับที่ API เก่าเรียกด้วย `model_selection=1` ซึ่งถูกถอดออกไปแล้ว
ใน mediapipe 1.0) มาวางไว้**หน้า**ไปป์ไลน์ เพื่อหาใบหน้าที่ตัวเดิมมองไม่เห็น

⚠️ **ตัวตรวจอย่างเดียวไม่พอ** — มันคืนแค่กรอบ ไม่มี landmark จึงยังวัดตาไม่ได้
เทียบกับรูปในแกลเลอรีไม่ได้ อ่านอารมณ์ไม่ได้ · กรอบที่ได้จากที่นี่ต้องถูกส่งต่อให้
`roi.py` ครอปแล้วขยาย ก่อนป้อนเข้า FaceLandmarker อีกที ถึงจะได้ข้อมูลครบ
สองโมดูลนี้จึงเป็นฟีเจอร์เดียวกัน ไม่ใช่สองฟีเจอร์

โมดูลนี้ **ไม่ import mediapipe** — ตัวตรวจถูกส่งเข้ามาจาก main แบบเดียวกับที่
`faces.py` รับ `extract` เข้ามา จึงทดสอบได้โดยไม่ต้องมีโมเดลหรือกล้อง
"""

from __future__ import annotations

from dataclasses import dataclass

from tracker import iou


@dataclass
class Found:
    """ใบหน้าหนึ่งใบที่ตัวตรวจเห็น — พิกัด normalized เหมือนที่เหลือทั้งระบบ"""

    box: tuple[float, float, float, float]
    score: float = 0.0

    @property
    def size(self) -> float:
        return max(0.0, self.box[2] - self.box[0])


def to_boxes(detections, frame_w: int, frame_h: int) -> list[Found]:
    """
    แปลงผลจาก mediapipe FaceDetector เป็นกรอบ normalized

    ตัวตรวจคืนพิกัด**พิกเซล** (origin_x/y + width/height) ส่วนที่เหลือของระบบใช้
    พิกัด normalized ทั้งหมด — แปลงที่นี่ที่เดียว จะได้ไม่มีใครข้างล่างต้องรู้เรื่องนี้

    กรอบถูกหนีบให้อยู่ใน 0–1 เพราะตัวตรวจคืนกรอบที่ล้นขอบภาพได้เมื่อใบหน้าอยู่ชิดขอบ
    """
    out = []
    for det in detections or []:
        bb = det.bounding_box
        x1 = max(0.0, bb.origin_x / frame_w)
        y1 = max(0.0, bb.origin_y / frame_h)
        x2 = min(1.0, (bb.origin_x + bb.width) / frame_w)
        y2 = min(1.0, (bb.origin_y + bb.height) / frame_h)
        if x2 <= x1 or y2 <= y1:
            continue
        cats = getattr(det, "categories", None) or []
        out.append(Found(box=(x1, y1, x2, y2),
                         score=float(getattr(cats[0], "score", 0.0)) if cats else 0.0))
    return out


def unmatched(found: list[Found], known_boxes, min_iou: float) -> list[Found]:
    """
    ใบหน้าที่ตัวตรวจเห็น **แต่ FaceLandmarker ไม่เห็น** — คือคนที่อยู่ไกลเกินไป

    นี่คือรายชื่อที่ต้องเอาไปซูม · ใบหน้าที่ทั้งสองตัวเห็นตรงกันไม่ต้องทำอะไรเพิ่ม
    เพราะมี landmark ครบอยู่แล้วจากภาพเต็ม

    จับคู่ด้วย IoU ไม่ใช่ระยะห่างจุดศูนย์กลาง เพราะกรอบจากตัวตรวจกับกรอบที่คำนวณจาก
    landmark มีขนาดต่างกันพอสมควร (ตัวตรวจให้กรอบที่กว้างกว่า) IoU ทนต่อข้อนั้นได้ดีกว่า
    """
    return [
        f for f in found
        if not any(iou(f.box, kb) >= min_iou for kb in known_boxes)
    ]
