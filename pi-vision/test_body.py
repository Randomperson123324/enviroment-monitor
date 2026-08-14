#!/usr/bin/env python3
"""
ทดสอบการอ่านท่าทางร่างกาย โดยไม่ต้องมีกล้องหรือ mediapipe

สร้างโครงร่าง 33 จุดขึ้นมาเอง แล้วตรวจว่า:
  - แต่ละท่าถูกอ่านออก และ **ท่าที่เกือบเข้าเกณฑ์ต้องไม่ถูกอ่านว่าเข้า**
  - จุดที่มองไม่เห็น (visibility ต่ำ) ทำให้ตอบว่าไม่รู้ ไม่ใช่เดา
  - ผลลัพธ์ไม่ขึ้นกับขนาดตัวบนภาพและตำแหน่งในเฟรม
  - GestureHold ต้องเห็นท่าค้างก่อนถึงประกาศ และไม่กระพริบตอน landmark หลุดสั้น ๆ
  - การโบกมือถูกแยกออกจากการยกมือค้าง
  - attach_bodies จับคู่ร่างกับ track ถูกคน แม้ pose มาคนละลำดับกับใบหน้า

รัน:  python3 test_body.py
"""

import math
import sys

import body as bd
from config import CONFIG

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    import main
except ImportError:
    main = None

FAILURES = []
CFG = CONFIG["body"]


def check(name, condition, detail=""):
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


class J:
    """เลียนแบบ NormalizedLandmark ของ pose — มี visibility ด้วย ต่างจากของใบหน้า"""

    def __init__(self, x, y, visibility=1.0):
        self.x, self.y, self.z, self.visibility = x, y, 0.0, visibility


def skeleton(cx=0.5, cy=0.5, size=0.20, seated=False, visible_legs=True, **moves):
    """
    โครงร่างคนยืนตรงหันหน้าเข้ากล้อง แล้วขยับเฉพาะข้อที่ระบุ

    `size` = ครึ่งหนึ่งของความกว้างไหล่ · ทุกอย่างวัดจากค่านี้ ทดสอบเรื่อง
    "ผลไม่ขึ้นกับขนาด" ได้ด้วยการเปลี่ยนค่าเดียว

    `moves` รับเป็น `L_WRIST=(x, y)` โดยพิกัดเป็น**สัดส่วนของความกว้างไหล่**
    เทียบจากกึ่งกลางไหล่ — เขียนเทสได้โดยไม่ต้องคิดพิกัดจริง
    """
    pts = [J(cx, cy, 1.0) for _ in range(33)]
    w = size                                  # ครึ่งความกว้างไหล่
    span = w * 2
    pts[bd.NOSE] = J(cx, cy - w * 2.0)
    pts[bd.L_SHOULDER] = J(cx - w, cy)
    pts[bd.R_SHOULDER] = J(cx + w, cy)
    pts[bd.L_ELBOW] = J(cx - w * 1.1, cy + w * 1.0)
    pts[bd.R_ELBOW] = J(cx + w * 1.1, cy + w * 1.0)
    pts[bd.L_WRIST] = J(cx - w * 1.2, cy + w * 2.0)
    pts[bd.R_WRIST] = J(cx + w * 1.2, cy + w * 2.0)
    hip_y = cy + w * 3.0
    pts[bd.L_HIP] = J(cx - w * 0.6, hip_y)
    pts[bd.R_HIP] = J(cx + w * 0.6, hip_y)

    vis = 1.0 if visible_legs else 0.1
    if seated:
        # นั่งหันหน้าเข้ากล้อง — **ต้นขาชี้เข้าหาเลนส์ จึงหดสั้นบนภาพ**
        # นี่คือกรณีที่ยากที่สุดและเป็นกรณีที่พบบ่อยที่สุด เทสจึงต้องจำลองให้ตรง:
        # ทั้งระยะแนวตั้งและความยาวต้นขาบนภาพเล็กลงพร้อมกัน
        knee_y, spread = hip_y + w * 0.35, w * 0.25
    else:
        knee_y, spread = hip_y + w * 1.9, 0.0
    pts[bd.L_KNEE] = J(cx - w * 0.6 - spread, knee_y, vis)
    pts[bd.R_KNEE] = J(cx + w * 0.6 + spread, knee_y, vis)
    # หน้าแข้งตั้งฉากกับพื้นในทั้งสองท่า
    pts[bd.L_ANKLE] = J(cx - w * 0.6 - spread, knee_y + w * 1.9, vis)
    pts[bd.R_ANKLE] = J(cx + w * 0.6 + spread, knee_y + w * 1.9, vis)
    pts[bd.L_HIP].visibility = pts[bd.R_HIP].visibility = 1.0

    for joint, (dx, dy) in moves.items():
        idx = getattr(bd, joint)
        pts[idx] = J(cx + dx * span, cy + dy * span, pts[idx].visibility)
    return pts


def lay_down(pts, cx=0.5, cy=0.5, turn=0.0):
    """
    หมุนโครงร่างทั้งตัวให้นอนลง — `turn` = องศาที่เบนออกจากแนวนอนพอดี

    หมุนทุกจุดรอบจุดเดียวกัน ท่าทางภายใน (แขนอยู่ตรงไหนเทียบกับลำตัว) จึงไม่เปลี่ยน
    เป็นการทดสอบว่า posture() ดู**ทิศของลำตัว**จริง ไม่ได้ดูว่าจุดไหนอยู่สูงต่ำในเฟรม
    """
    import math as _m

    rad = _m.radians(90.0 - turn)
    cos_a, sin_a = _m.cos(rad), _m.sin(rad)
    out = []
    for p in pts:
        dx, dy = p.x - cx, p.y - cy
        out.append(J(cx + dx * cos_a - dy * sin_a,
                     cy + dx * sin_a + dy * cos_a, p.visibility))
    return out


class W:
    """เลียนแบบ world landmark ของ pose — หน่วยเมตร สามแกน จุดกำเนิดที่สะโพก"""

    def __init__(self, x, y, z, visibility=1.0):
        self.x, self.y, self.z, self.visibility = x, y, z, visibility


def world(thigh_deg=0.0, torso_deg=0.0, into_camera=True):
    """
    โครงร่างหน่วยเมตร ที่ต้นขาและลำตัวทำมุมกับแนวดิ่งตามที่ระบุ

    `into_camera=True` = หมุนไปตามแกน z (เข้าหาเลนส์) ซึ่งเป็นแกนที่**หายไปทั้งหมด**
    เมื่อมองจากพิกัดสองแกน · เทสที่หมุนไปทางนี้คือเทสที่พิสูจน์ว่าการวัดสามแกนได้ผลจริง
    ถ้าไปวัดแบบสองแกน ทุกท่าในนี้จะดูเหมือนยืนตรงหมด

    สัดส่วนตามที่วัดได้จากภาพจริง: ไหล่กว้าง 0.33 · ต้นขา 0.36 · ลำตัว 0.45 เมตร
    """
    TORSO_M, THIGH_M, SHIN_M, SHOULDER_M = 0.45, 0.36, 0.40, 0.33
    axis = 'z' if into_camera else 'x'

    def limb(length, deg):
        r = math.radians(deg)
        along, across = length * math.cos(r), length * math.sin(r)
        return (across, along, 0.0) if axis == 'x' else (0.0, along, across)

    pts = [W(0.0, 0.0, 0.0) for _ in range(33)]
    tx, ty, tz = limb(TORSO_M, torso_deg)
    kx, ky, kz = limb(THIGH_M, thigh_deg)
    for side, sign in ((bd.L_HIP, -1), (bd.R_HIP, 1)):
        pts[side] = W(sign * 0.12, 0.0, 0.0)
    for side, sign in ((bd.L_SHOULDER, -1), (bd.R_SHOULDER, 1)):
        pts[side] = W(sign * SHOULDER_M / 2 - tx, -ty, -tz)   # ไหล่อยู่เหนือสะโพก
    for side, sign in ((bd.L_KNEE, -1), (bd.R_KNEE, 1)):
        pts[side] = W(sign * 0.12 + kx, ky, kz)
    for side, sign in ((bd.L_ANKLE, -1), (bd.R_ANKLE, 1)):
        pts[side] = W(sign * 0.12 + kx, ky + SHIN_M, kz)
    return pts


def bending_over(cx=0.5, cy=0.5, size=0.20):
    """
    ยืนก้มตัวเก็บของ — ลำตัวเกือบขนานพื้น **แต่ขายังตั้งอยู่**

    เป็นท่าที่หลอก "การตรวจนอนจากทิศลำตัว" ได้ตรง ๆ จึงต้องมีเทสของตัวเอง
    """
    w = size
    pts = [J(cx, cy, 1.0) for _ in range(33)]
    hip_y = cy
    # สะโพกอยู่สูง ไหล่ยื่นไปข้างหน้าในระดับเดียวกัน = ลำตัวนอน
    pts[bd.L_HIP] = J(cx + w * 0.6, hip_y)
    pts[bd.R_HIP] = J(cx + w * 0.6, hip_y - w * 0.2)
    pts[bd.L_SHOULDER] = J(cx - w * 2.4, hip_y - w * 0.3)
    pts[bd.R_SHOULDER] = J(cx - w * 2.4, hip_y + w * 0.7)
    pts[bd.NOSE] = J(cx - w * 3.4, hip_y + w * 0.2)
    pts[bd.L_ELBOW] = J(cx - w * 2.0, hip_y + w * 1.0)
    pts[bd.R_ELBOW] = J(cx - w * 2.0, hip_y + w * 1.4)
    pts[bd.L_WRIST] = J(cx - w * 2.2, hip_y + w * 2.0)
    pts[bd.R_WRIST] = J(cx - w * 2.2, hip_y + w * 2.4)
    # ขายังตั้งฉากกับพื้นตามปกติ — นี่คือสิ่งที่แยกการก้มออกจากการนอน
    for hip_x, knee, ankle in ((cx + w * 0.4, bd.L_KNEE, bd.L_ANKLE),
                               (cx + w * 0.8, bd.R_KNEE, bd.R_ANKLE)):
        pts[knee] = J(hip_x, hip_y + w * 1.9)
        pts[ankle] = J(hip_x, hip_y + w * 3.8)
    return pts


print("1. ท่าแขน")
check("ยืนเฉย ๆ ไม่ใช่ท่าอะไร", bd.gesture(skeleton(), CFG) is None)
check("ยกมือข้างเดียว",
      bd.gesture(skeleton(L_WRIST=(-0.5, -0.9)), CFG) == bd.HAND_UP)
check("ยกสองมือชนะยกมือข้างเดียว",
      bd.gesture(skeleton(L_WRIST=(-0.5, -0.9), R_WRIST=(0.5, -0.9)), CFG) == bd.HANDS_UP)
check("แขนเหยียดตรงชี้ขึ้น = ชี้ ไม่ใช่แค่ยกมือ",
      bd.gesture(skeleton(L_ELBOW=(-0.55, -0.5), L_WRIST=(-0.6, -1.1)), CFG) == bd.POINTING)
check("ชี้ไปด้านข้างทั้งที่มืออยู่ต่ำกว่าไหล่",
      bd.gesture(skeleton(L_ELBOW=(-0.9, 0.05), L_WRIST=(-1.5, 0.1)), CFG) == bd.POINTING)
check("เท้าเอว",
      bd.gesture(skeleton(L_WRIST=(-0.32, 1.5), R_WRIST=(0.32, 1.5)), CFG) == bd.HANDS_ON_HIPS)
check("กอดอก",
      bd.gesture(skeleton(L_WRIST=(0.35, 0.9), R_WRIST=(-0.35, 0.9),
                          L_ELBOW=(-0.6, 1.0), R_ELBOW=(0.6, 1.0)), CFG) == bd.ARMS_CROSSED)

print("\n2. ท่าที่เกือบเข้าเกณฑ์ต้องไม่ถูกอ่านว่าเข้า")
# ข้อนี้สำคัญกว่าข้อบน — ระบบที่ตอบว่า "ยกมือ" ตลอดเวลามีค่าเท่ากับไม่มีระบบ
check("ข้อมือระดับไหล่พอดี ยังไม่ใช่การยกมือ",
      bd.gesture(skeleton(L_WRIST=(-0.5, 0.0)), CFG) is None)
check("ข้อมือสูงกว่าไหล่นิดเดียว ยังไม่ถึงเกณฑ์",
      bd.gesture(skeleton(L_WRIST=(-0.5, -0.04)), CFG) is None)
check("แขนงอ ไม่ใช่การชี้",
      bd.gesture(skeleton(L_ELBOW=(-0.9, 0.05), L_WRIST=(-0.9, -0.5)), CFG) != bd.POINTING)
check("มือห้อยข้างตัว ไม่ใช่เท้าเอว",
      bd.gesture(skeleton(), CFG) != bd.HANDS_ON_HIPS)
check("มือประสานหน้าท้องแต่ไม่ข้ามฝั่ง ไม่ใช่กอดอก",
      bd.gesture(skeleton(L_WRIST=(-0.05, 0.9), R_WRIST=(0.05, 0.9)), CFG) != bd.ARMS_CROSSED)

print("\n3. ไม่ขึ้นกับขนาดตัวและตำแหน่งในเฟรม")
far = bd.gesture(skeleton(cx=0.15, cy=0.30, size=0.04, L_WRIST=(-0.5, -0.9)), CFG)
near = bd.gesture(skeleton(cx=0.70, cy=0.55, size=0.22, L_WRIST=(-0.5, -0.9)), CFG)
check("คนไกลกับคนใกล้ทำท่าเดียวกัน ได้คำตอบเดียวกัน", far == near == bd.HAND_UP,
      f"(ไกล {far} · ใกล้ {near})")

print("\n4. ยืน / นั่ง — วัดมุมต้นขาในสามแกน")
# ทุกท่าในหมวดนี้หมุน**เข้าหาเลนส์** ซึ่งเป็นแกนที่หายไปทั้งหมดในพิกัดสองแกน
# ถ้าวัดแบบสองแกน ทุกข้อจะตอบว่า "ยืน" หมด — นี่คือข้อพิสูจน์ว่าสามแกนได้ผลจริง
seen = skeleton()
check("ต้นขาห้อยดิ่ง = ยืน",
      bd.posture(seen, CFG, world=world(thigh_deg=5)) == (bd.STANDING, True))
check("ต้นขาพับไปข้างหน้า 80° = นั่ง",
      bd.posture(seen, CFG, world=world(thigh_deg=80)) == (bd.SITTING, True))
check("นั่งโดยต้นขาชี้เข้าหาเลนส์ตรง ๆ — กรณีที่วิธีสองแกนแพ้",
      bd.posture(seen, CFG, world=world(thigh_deg=88)) == (bd.SITTING, True))
check("มุมกลาง ๆ = ตอบข้างที่ใกล้กว่า แต่ไม่มั่นใจ",
      bd.posture(seen, CFG, world=world(thigh_deg=45))[1] is False)
check("เกณฑ์เป็นองศาจริง ไม่ใช่อัตราส่วนที่ปรับจนพอใช้",
      CFG["stand_angle"] == 30.0 and CFG["sit_angle"] == 60.0)

# หมุนไปทางด้านข้างแทน (แกนที่สองแกนก็เห็น) ต้องได้คำตอบเดียวกัน
check("หมุนไปด้านข้างหรือเข้าหาเลนส์ ต้องได้คำตอบเดียวกัน",
      bd.posture(seen, CFG, world=world(thigh_deg=80, into_camera=False))
      == bd.posture(seen, CFG, world=world(thigh_deg=80, into_camera=True)))

check("นั่งแล้วยังอ่านท่าแขนได้ตามปกติ",
      bd.gesture(skeleton(seated=True, L_WRIST=(-0.5, -0.9)), CFG) == bd.HAND_UP)
check("มองไม่เห็นขาแต่ยังอ่านท่าแขนได้",
      bd.gesture(skeleton(visible_legs=False, L_WRIST=(-0.5, -0.9)), CFG) == bd.HAND_UP)

print("\n4b. ไม่เห็นขา — เดาได้ แต่ต้องบอกว่าเดา")
# ตัวอยู่ครึ่งบนของเฟรม สะโพกราว y=0.49 ซึ่งอยู่สูงกว่า BODY_FRAME_EDGE ชัดเจน
hidden = bd.posture(skeleton(cy=0.25, size=0.08, visible_legs=False), CFG)
check("ขาหายทั้งที่ตัวอยู่กลางเฟรม = มีโต๊ะบัง → เดาว่านั่ง",
      hidden == (bd.SITTING, False), f"(ได้ {hidden})")
# สะโพกชิดขอบล่าง = ตัวถูกเฟรมตัด ไม่ใช่ถูกบัง — คนละสาเหตุ คนละคำตอบ
cut = bd.posture(skeleton(cy=0.80, visible_legs=False), CFG, previous=bd.STANDING)
check("ตัวถูกขอบล่างตัด = คงท่าเดิมไว้ ไม่ด่วนสรุปว่านั่ง",
      cut == (bd.STANDING, False), f"(ได้ {cut})")
check("ไม่เห็นตัวเลย = คงท่าเดิม",
      bd.posture([J(0.5, 0.5, 0.0)] * 33, CFG, previous=bd.LYING) == (bd.LYING, False))
check("ไม่เห็นตัวและไม่เคยรู้ท่ามาก่อน = ยังต้องตอบอะไรสักอย่าง",
      bd.posture([J(0.5, 0.5, 0.0)] * 33, CFG)[0] in (bd.STANDING, bd.SITTING, bd.LYING))
check("ไม่มี world landmark = วัดขาไม่ได้ ตกไปใช้หลักฐานอ้อมตามปกติ",
      bd.posture(skeleton(cy=0.25, size=0.08), CFG, world=None) == (bd.SITTING, False))

print("\n4b2. ยืน/นั่ง จากความสูงศีรษะ เมื่อมองไม่เห็นขา")

# ── ตัววัด: ต้องไม่ขึ้นกับระยะห่างจากกล้องและอัตราส่วนภาพ ──
WIDE = 864 / 480          # โหมดที่ใช้จริงตอนนี้
SQUARE = 640 / 480

near = bd.head_level(skeleton(cy=0.5, size=0.20), WIDE, CFG["min_visibility"])
far = bd.head_level(skeleton(cy=0.5, size=0.05), WIDE, CFG["min_visibility"])
check("คนเดียวกันท่าเดียวกัน ใกล้หรือไกลกล้องต้องได้ค่าเท่ากัน",
      near is not None and abs(near - far) < 1e-9, f"(ใกล้ {near} · ไกล {far})")

# ⚠️ ข้อนี้คือเหตุผลที่ต้องส่ง aspect เข้าไป · ถ้าลืมแปลงหน่วย ค่าจะเปลี่ยนตาม
# ความละเอียดที่ผู้ใช้กดปุ่ม r เลือก ทั้งที่คนนั่งอยู่ท่าเดิมไม่ได้ขยับเลย
#
# 864×480 กับ 640×480 คือเซนเซอร์ตัวเดียวกันที่ถูกตัดขอบซ้าย-ขวา (ดู README):
# สูงเท่ากัน สเกลพิกเซลเท่ากัน คนคนเดิมจึงอยู่ที่พิกัด**พิกเซล**เดิมทุกประการ
# เปลี่ยนแค่ความกว้างเฟรมที่เอาไปหาร x — จึงเขียนเทสเป็นพิกเซลตรง ๆ แทนสัดส่วน
def pixel_pose(nose_y, shoulder_y, half_span, frame_w, frame_h=480):
    pts = [J(0.5, 0.5, 1.0) for _ in range(33)]
    cx = frame_w / 2
    pts[bd.NOSE] = J(cx / frame_w, nose_y / frame_h)
    pts[bd.L_SHOULDER] = J((cx - half_span) / frame_w, shoulder_y / frame_h)
    pts[bd.R_SHOULDER] = J((cx + half_span) / frame_w, shoulder_y / frame_h)
    return pts

wide_px = bd.head_level(pixel_pose(100, 180, 60, 864), WIDE, CFG["min_visibility"])
sq_px = bd.head_level(pixel_pose(100, 180, 60, 640), SQUARE, CFG["min_visibility"])
check("ท่าเดิมแต่เปลี่ยนความละเอียด → ค่าต้องไม่กระโดด",
      abs(wide_px - sq_px) < 1e-9, f"(16:9 {wide_px:.4f} · 4:3 {sq_px:.4f})")

high = bd.head_level(skeleton(cy=0.30, size=0.10), WIDE, CFG["min_visibility"])
low = bd.head_level(skeleton(cy=0.60, size=0.10), WIDE, CFG["min_visibility"])
check("ศีรษะสูงขึ้นในเฟรม = ค่ามากขึ้น", high > low, f"({high:.2f} vs {low:.2f})")
check("มองไม่เห็นไหล่ = ไม่ตอบ ไม่ใช่เดา",
      bd.head_level([J(0.5, 0.5, 0.0)] * 33, WIDE, CFG["min_visibility"]) is None)

# ── การจำและการตอบ ──
def level_at(cy, size=0.10):
    return bd.head_level(skeleton(cy=cy, size=size), WIDE, CFG["min_visibility"])

fresh = bd.HeadPosture(CFG)
check("ยังไม่เคยจดอะไร = ไม่ตอบ ปล่อยให้หลักฐานอ้อมทำงาน",
      fresh.guess(level_at(0.4)) is None)

# ระยะยกตัวจริง: ลุกยืนแล้วศีรษะขึ้นราวหนึ่งเท่าของความกว้างไหล่
sit_cy, size = 0.55, 0.10
shoulder_h = 2 * size * WIDE          # ความกว้างไหล่ในหน่วย "ส่วนของความสูงเฟรม"
stand_cy = sit_cy - CFG["head_rise"] * shoulder_h

both = bd.HeadPosture(CFG)
both.learn(bd.SITTING, level_at(sit_cy, size))
both.learn(bd.STANDING, level_at(stand_cy, size))
check("จดครบสองท่าแล้ว ตอบท่านั่งได้แบบมั่นใจ",
      both.guess(level_at(sit_cy, size)) == (bd.SITTING, True))
check("จดครบสองท่าแล้ว ตอบท่ายืนได้แบบมั่นใจ",
      both.guess(level_at(stand_cy, size)) == (bd.STANDING, True))

one = bd.HeadPosture(CFG)
one.learn(bd.SITTING, level_at(sit_cy, size))
check("รู้แค่ท่านั่ง — อยู่ที่เดิมก็ยังตอบว่านั่ง",
      one.guess(level_at(sit_cy, size))[0] == bd.SITTING)
check("รู้แค่ท่านั่ง — ศีรษะยกขึ้นเต็มระยะ = ยืน",
      one.guess(level_at(stand_cy, size))[0] == bd.STANDING)
check("รู้แค่ท่าเดียว ต้องไม่อ้างว่ามั่นใจ",
      one.guess(level_at(stand_cy, size))[1] is False)
check("ขยับหัวเล็กน้อย (เอนตัว) ต้องไม่กลายเป็นยืน",
      one.guess(level_at(sit_cy - 0.2 * shoulder_h, size))[0] == bd.SITTING)

# จดท่าที่ยังเดาอยู่ไม่ได้ — ไม่งั้นจะกลายเป็นเดาซ้อนเดา
strict = bd.HeadPosture(CFG)
strict.learn(bd.LYING, level_at(0.5))
strict.learn(bd.SITTING, None)
check("ท่านอนกับค่าว่างไม่ถูกจด", strict.guess(level_at(0.5)) is None)

# สองท่าที่จดไว้ใกล้กันเกินไป = ยังแยกไม่ออกจริง อย่าเพิ่งอ้างว่ามั่นใจ
narrow = bd.HeadPosture(CFG)
narrow.learn(bd.SITTING, 1.0)
narrow.learn(bd.STANDING, 1.0 + CFG["head_min_gap"] * 0.5)
check("สองท่าห่างกันไม่พอ → ยังตอบได้แต่ไม่มั่นใจ", narrow.guess(1.0)[1] is False)

print("\n4c. นอน")
flat = world(torso_deg=88, thigh_deg=88)
check("ลำตัวและขาขนานพื้น = นอน", bd.posture(seen, CFG, world=flat) == (bd.LYING, True))
check("นอนเอียง 20 องศาก็ยังนอน",
      bd.posture(seen, CFG, world=world(torso_deg=70, thigh_deg=70)) == (bd.LYING, True))
# ⚠️ กรณีนี้เคยตอบไม่ได้เลย ต้องมีเกณฑ์ BODY_MIN_TORSO มาคอยกันไว้: คนนอนหันหัว
# เข้ากล้องมีลำตัวหดจนสั้นบนภาพ ทิศที่คำนวณได้เป็นสัญญาณรบกวน · ในสามแกนลำตัวนั้น
# ชี้ไปตามแกน z ซึ่งวัดได้ตามปกติ เกณฑ์นั้นจึงถูกลบทิ้งไปทั้งข้อ
check("นอนหันหัวเข้ากล้อง — เดิมตอบไม่ได้ ตอนนี้ตอบได้",
      bd.posture(seen, CFG, world=world(torso_deg=90, thigh_deg=90)) == (bd.LYING, True))
check("นอนแม้มองไม่เห็นขา — ลำตัวอย่างเดียวก็บอกได้",
      bd.posture(skeleton(visible_legs=False), CFG,
                 world=world(torso_deg=88, thigh_deg=88)) == (bd.LYING, True))
check("ยืนตรงต้องไม่ถูกรายงานว่านอน",
      bd.posture(seen, CFG, world=world(thigh_deg=5))[0] != bd.LYING)
check("นั่งตรงต้องไม่ถูกรายงานว่านอน",
      bd.posture(seen, CFG, world=world(thigh_deg=80))[0] != bd.LYING)
# ก้มตัวเก็บของ: ลำตัวขนานพื้นเหมือนคนนอน แต่ขายังตั้ง
bent = bd.posture(seen, CFG, world=world(torso_deg=85, thigh_deg=10))
check("ยืนก้มตัวเก็บของ — ลำตัวขนานพื้นแต่ขายังตั้ง ต้องไม่ใช่นอน",
      bent[0] == bd.STANDING and bent[1] is False, f"(ได้ {bent})")

print("\n4d. กันท่ากระพริบ")
ph = bd.PostureHold(CFG)
check("ครั้งแรกรับไปเลย ไม่ต้องรอ", ph.update(bd.STANDING, True, 0.0) == (bd.STANDING, True))
check("เห็นท่าใหม่แวบเดียว ยังไม่เปลี่ยน",
      ph.update(bd.SITTING, True, 0.2)[0] == bd.STANDING)
check("เห็นค้างครบเวลาแล้วเปลี่ยน",
      ph.update(bd.SITTING, True, CFG["posture_hold_seconds"] + 0.3)[0] == bd.SITTING)
# ท่าที่เดาต้องใช้เวลานานกว่า ไม่งั้นขาที่โผล่มาแวบเดียวจะพลิกคำตอบทันที
slow = bd.PostureHold(CFG)
slow.update(bd.SITTING, True, 0.0)
t = CFG["posture_hold_seconds"] + 0.3
check("ท่าที่เดา ต้องค้างนานกว่าท่าที่วัดได้",
      slow.update(bd.STANDING, False, t)[0] == bd.SITTING, "(เปลี่ยนเร็วเกินไป)")
# นับจาก t (ตอนที่เห็นท่าใหม่ครั้งแรก) ไม่ใช่จากศูนย์ — ตัวจับเวลาเริ่มตอนนั้น
check("...แต่พอค้างนานพอก็เปลี่ยนได้",
      slow.update(bd.STANDING, False,
                  t + CFG["posture_hold_seconds"] * CFG["posture_unsure_multiplier"] + 0.1
                  )[0] == bd.STANDING)
# วัดได้ชัดขึ้นในท่าเดิม ต้องยกระดับความมั่นใจทันที ไม่ต้องรอ
up = bd.PostureHold(CFG)
up.update(bd.SITTING, False, 0.0)
check("ท่าเดิมแต่วัดได้ชัดขึ้น = มั่นใจขึ้นทันที",
      up.update(bd.SITTING, True, 0.1) == (bd.SITTING, True))

print("\n5. ถือค้างก่อนประกาศ")
hold = bd.GestureHold(CFG)
check("เห็นแวบเดียวยังไม่ประกาศ", hold.update(bd.HAND_UP, 0.0) is None)
check("ยังไม่ครบเวลา ยังไม่ประกาศ", hold.update(bd.HAND_UP, CFG["hold_seconds"] * 0.5) is None)
check("ครบเวลาแล้วประกาศ",
      hold.update(bd.HAND_UP, CFG["hold_seconds"] + 0.01) == bd.HAND_UP)
check("landmark หลุดหนึ่งเฟรม ป้ายต้องไม่หาย",
      hold.update(None, CFG["hold_seconds"] + 0.05) == bd.HAND_UP)
check("หายนานพอถึงเลิกแสดง",
      hold.update(None, CFG["hold_seconds"] + CFG["release_seconds"] + 0.1) is None)

flap = bd.GestureHold(CFG)
t = 0.0
for _ in range(6):                      # สลับไปมาเร็ว ๆ แบบที่ landmark สั่นทำให้เกิด
    t += CFG["hold_seconds"] * 0.3
    flap.update(bd.HAND_UP, t)
    t += CFG["hold_seconds"] * 0.3
    flap.update(bd.ARMS_CROSSED, t)
check("ท่าสลับไปมาเร็ว ๆ ต้องไม่มีป้ายไหนถูกประกาศ", flap.current is None,
      f"(ได้ {flap.current})")

print("\n6. โบกมือ")
wave = bd.GestureHold(CFG)
t, x, out = 0.0, 0.0, None
for i in range(14):                     # ยกมือค้างไว้แล้วแกว่งซ้าย-ขวา
    t += 0.08
    x = 0.2 if i % 2 else -0.2          # แกว่ง ±0.2 = 20% ของความกว้างไหล่ต่อครั้ง
    out = wave.update(bd.HAND_UP, t, wrist_x=x, unit=1.0)
check("ยกมือแล้วแกว่ง = โบกมือ", out == bd.WAVING, f"(ได้ {out})")

steady = bd.GestureHold(CFG)
t, out = 0.0, None
for _ in range(14):                     # ยกค้างนิ่ง ๆ ไม่แกว่ง
    t += 0.08
    out = steady.update(bd.HAND_UP, t, wrist_x=0.0, unit=1.0)
check("ยกค้างเฉย ๆ ไม่ใช่การโบก", out == bd.HAND_UP, f"(ได้ {out})")

print("\n7. จับคู่ร่างกับใบหน้า")
if main is None:
    print("  skip — ไม่มี cv2/mediapipe ในเครื่องนี้")
else:
    from tracker import Track

    left = Track(person_id=1, cx=0.25, cy=0.30, box=(0.18, 0.22, 0.32, 0.40), last_seen=0.0)
    right = Track(person_id=2, cx=0.75, cy=0.30, box=(0.68, 0.22, 0.82, 0.40), last_seen=0.0)
    # pose มาสลับลำดับกับ track โดยตั้งใจ — ลำดับของโมเดลไม่ผูกกับลำดับของ tracker
    poses = [skeleton(cx=0.75, cy=0.42, size=0.05), skeleton(cx=0.25, cy=0.42, size=0.05)]
    got = main.attach_bodies([left, right], poses)
    # คืน**ลำดับ** ไม่ใช่ตัว landmark เพราะผู้เรียกต้องหยิบทั้งพิกัดบนภาพและพิกัดเมตร
    # ซึ่งเป็นสองลิสต์ที่เรียงตรงกัน — ลำดับเป็นกุญแจที่ใช้ได้กับทั้งคู่
    check("คนซ้ายได้ร่างของคนซ้าย", got.get(1) == 1, f"(ได้ {got})")
    check("คนขวาได้ร่างของคนขวา", got.get(2) == 0, f"(ได้ {got})")

    lonely = main.attach_bodies([left], [skeleton(cx=0.95, cy=0.90, size=0.05)])
    check("ร่างที่อยู่คนละมุมห้องไม่ถูกจับคู่มั่ว", lonely == {})

    one_body = main.attach_bodies([left, right], [skeleton(cx=0.25, cy=0.42, size=0.05)])
    check("มีร่างเดียว จับคู่ได้คนเดียว ไม่แจกให้ทั้งสอง", len(one_body) == 1)

print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
