#!/usr/bin/env python3
"""
ทดสอบการตรวจว่าใครกำลังใช้โทรศัพท์ โดยไม่ต้องมีกล้อง โมเดล หรือ mediapipe

สร้างกรอบโทรศัพท์กับโครงร่างคนขึ้นมาเอง แล้วตรวจว่า:
  - โทรศัพท์ที่วางบนโต๊ะ (ไม่มีมือใครอยู่ใกล้) **ไม่ถูกนับว่ามีคนใช้**
  - โทรศัพท์เครื่องเดียวเป็นของคนเดียว ไม่ถูกแจกให้ทุกคนที่นั่งใกล้
  - หลักฐานจากข้อมูล**ที่มองเห็นจริง**ชนะการเดาจากตำแหน่งใบหน้าเสมอ
  - เมื่อมองไม่เห็นข้อมือ ยังตอบได้แต่ต้องตอบว่า "ไม่มั่นใจ" ไม่ใช่เงียบไปเฉย ๆ
  - ผลไม่ขึ้นกับขนาดตัวบนภาพ (คนนั่งไกลถือโทรศัพท์ = คนนั่งใกล้ถือโทรศัพท์)
  - PhoneHold ไม่ปล่อยป้ายตอนตัวตรวจหลุดไปไม่กี่เฟรม และไม่ค้างตลอดกาลเมื่อวางจริง

รัน:  python3 test_phone.py
"""

import sys

import body as bd
import phone as ph
from config import CONFIG

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAILURES = []
# min_visibility มาจากหมวด body เหมือนตอนรันจริง (main รวมสองหมวดก่อนเรียก)
CFG = {**CONFIG["phone"], "min_visibility": CONFIG["body"]["min_visibility"]}


def check(name, condition, detail=""):
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


class J:
    """เลียนแบบ NormalizedLandmark ของ pose"""

    def __init__(self, x, y, visibility=1.0):
        self.x, self.y, self.z, self.visibility = x, y, 0.0, visibility


def skeleton(cx=0.5, cy=0.5, size=0.10, wrists_visible=True):
    """โครงร่างยืนตรง มือห้อยข้างตัว · `size` = ครึ่งความกว้างไหล่"""
    pts = [J(cx, cy, 1.0) for _ in range(33)]
    w = size
    vis = 1.0 if wrists_visible else 0.1
    pts[bd.NOSE] = J(cx, cy - w * 2.0)
    pts[bd.L_SHOULDER] = J(cx - w, cy)
    pts[bd.R_SHOULDER] = J(cx + w, cy)
    pts[bd.L_ELBOW] = J(cx - w * 1.1, cy + w * 1.0)
    pts[bd.R_ELBOW] = J(cx + w * 1.1, cy + w * 1.0)
    pts[bd.L_WRIST] = J(cx - w * 1.2, cy + w * 2.0, vis)
    pts[bd.R_WRIST] = J(cx + w * 1.2, cy + w * 2.0, vis)
    pts[bd.L_HIP] = J(cx - w * 0.6, cy + w * 3.0)
    pts[bd.R_HIP] = J(cx + w * 0.6, cy + w * 3.0)
    return pts


def face_of(cx=0.5, cy=0.5, size=0.10):
    """กรอบใบหน้าที่เข้าคู่กับ skeleton() ตัวเดียวกัน — จมูกอยู่ที่ cy - size*2"""
    half = size * 0.6
    nose_y = cy - size * 2.0
    return (cx - half, nose_y - half, cx + half, nose_y + half)


def phone_at(x, y, w=0.03, h=0.05):
    return ph.Seen(box=(x - w / 2, y - h / 2, x + w / 2, y + h / 2), score=0.9)


def person(key=1, cx=0.5, cy=0.5, size=0.10, wrists_visible=True, with_pose=True):
    return ph.Person(
        key=key,
        face_box=face_of(cx, cy, size),
        points=skeleton(cx, cy, size, wrists_visible) if with_pose else None,
    )


# ── 1. โทรศัพท์ที่ไม่มีใครถือ ────────────────────────────
print("\n1. โทรศัพท์ที่ไม่มีใครถือ")
alone = person(cx=0.25)
# วางอยู่มุมขวาล่างของเฟรม ห่างจากทั้งมือและใบหน้าของคนเดียวในห้อง
desk = ph.assign([phone_at(0.90, 0.90)], [alone], CFG)
check("โทรศัพท์วางบนโต๊ะไกล ๆ → ไม่มีใครถูกนับว่าใช้อยู่", desk == {}, f"({desk})")

check("ไม่มีโทรศัพท์ในเฟรมเลย → ไม่มีใครถูกนับ", ph.assign([], [alone], CFG) == {})
check("มีโทรศัพท์แต่ไม่มีคน → ไม่ระเบิด และไม่มีใครถูกนับ",
      ph.assign([phone_at(0.5, 0.5)], [], CFG) == {})

# ── 2. โทรศัพท์ในมือ ─────────────────────────────────────
print("\n2. โทรศัพท์ในมือ")
p = person(cx=0.5, cy=0.5, size=0.10)
# มือขวาอยู่ที่ (0.5 + 0.12, 0.5 + 0.20) ตามสูตรใน skeleton()
in_hand = ph.assign([phone_at(0.62, 0.70)], [p], CFG)
check("โทรศัพท์อยู่ที่ข้อมือ → ถูกนับว่าใช้อยู่", 1 in in_hand, f"({in_hand})")
check("และเป็นการ**วัด** ไม่ใช่การเดา", in_hand[1].confident is True)

far = ph.assign([phone_at(0.62, 0.70)], [person(cx=0.5, cy=0.5, size=0.04)], CFG)
check("คนตัวเล็ก (นั่งไกล) กับโทรศัพท์ที่ห่างเท่าเดิมบนภาพ → ไกลเกินมือ ไม่ถูกนับ",
      far == {}, f"({far})")
# ระยะที่ "เท่ากันเมื่อวัดเป็นสัดส่วนของตัว" ต้องให้คำตอบเดียวกันทุกขนาด
small = person(cx=0.5, cy=0.5, size=0.04)
near_small = ph.assign([phone_at(0.5 + 0.04 * 1.2, 0.5 + 0.04 * 2.0)], [small], CFG,)
check("คนตัวเล็กที่ถือโทรศัพท์อยู่ในมือจริง → ถูกนับเหมือนคนตัวใหญ่",
      1 in near_small, f"({near_small})")

# ── 3. หลายคนในเฟรม ─────────────────────────────────────
print("\n3. หลายคนในเฟรม")
left = person(key=1, cx=0.30, cy=0.50, size=0.08)
right = person(key=2, cx=0.70, cy=0.50, size=0.08)
# อยู่ที่มือขวาของคนซ้ายพอดี (0.30 + 0.096, 0.50 + 0.16)
one = ph.assign([phone_at(0.396, 0.66)], [left, right], CFG)
check("โทรศัพท์เครื่องเดียว → มีเจ้าของคนเดียว", len(one) == 1, f"({one})")
check("และเป็นคนที่มืออยู่ใกล้ที่สุด", 1 in one, f"({one})")

two = ph.assign([phone_at(0.396, 0.66), phone_at(0.604, 0.66)], [left, right], CFG)
check("สองเครื่องสองคน → ได้ทั้งคู่ ไม่สลับกัน", set(two) == {1, 2}, f"({two})")

# ── 4. เมื่อมองไม่เห็นข้อมือ (กล้องตั้งโต๊ะ) ──────────────
print("\n4. เมื่อมองไม่เห็นข้อมือ")
blind = person(cx=0.5, cy=0.5, size=0.10, wrists_visible=False)
guessed = ph.assign([phone_at(0.55, 0.55)], [blind], CFG)
check("โทรศัพท์ใต้ใบหน้า แม้ไม่เห็นข้อมือ → ยังตอบได้", 1 in guessed, f"({guessed})")
check("แต่ต้องบอกว่าเป็นการเดา ไม่ใช่การวัด", guessed[1].confident is False)

above = ph.assign([phone_at(0.5, 0.05)], [blind], CFG)
check("ของที่อยู่**เหนือ**ศีรษะ (เช่นจอบนผนัง) → ไม่ใช่ท่าถือโทรศัพท์",
      above == {}, f"({above})")

no_pose = person(with_pose=False)
check("ไม่มี pose เลย (โมเดลท่าทางไม่เห็นคนนี้) → ยังเดาจากใบหน้าได้ ไม่ระเบิด",
      ph.assign([phone_at(0.55, 0.55)], [no_pose], CFG)[1].confident is False)

# ── กรณีจริงจากรูปใน faces/ ──
# ตัวตรวจเห็นของสี่เหลี่ยมมืดบนโต๊ะที่มุมขวาล่าง (คะแนน 0.40) ส่วนคนอยู่กลางภาพ
# มองไม่เห็นข้อมือทั้งสองข้าง (visibility 0.09 / 0.05) จึงเข้าชั้นเดาเต็ม ๆ
# ⚠️ เคยนับผิดว่าเธอกำลังใช้โทรศัพท์ ตอนที่ชั้นเดาวัดเป็นรัศมีอันเดียว — ดู _face_gap
REAL_PHONE = ph.Seen(box=(0.890, 0.797, 0.995, 0.870), score=0.40)
REAL_FACE = (0.190, 0.323, 0.642, 0.734)
REAL_ASPECT = 864 / 1152
on_desk = ph.assign([REAL_PHONE],
                    [ph.Person(key=1, face_box=REAL_FACE, points=None)],
                    CFG, aspect=REAL_ASPECT)
check("ของบนโต๊ะข้าง ๆ ในรูปจริง → ไม่ถูกนับว่าเธอกำลังใช้โทรศัพท์",
      on_desk == {}, f"({on_desk})")
# ของชิ้นเดียวกันแต่ย้ายมาอยู่ใต้คางในระยะที่มือถืออยู่ ต้องยังตอบว่าใช่
fx1, fy1, fx2, fy2 = REAL_FACE
cx, below = (fx1 + fx2) / 2, fy2 + 0.05
in_front = ph.assign([phone_at(cx, below, w=0.10, h=0.07)],
                     [ph.Person(key=1, face_box=REAL_FACE, points=None)],
                     CFG, aspect=REAL_ASPECT)
check("ของชิ้นเดียวกันย้ายมาอยู่ใต้คาง → ถูกนับ (ชั้นเดายังทำงาน ไม่ได้ปิดไปเฉย ๆ)",
      1 in in_front, f"({in_front})")

# หลักฐานที่วัดได้ต้องชนะการเดา แม้คนที่เดาจะอยู่ใกล้กว่าเมื่อดูเป็นตัวเลขดิบ
holder = person(key=1, cx=0.30, cy=0.50, size=0.08)
watcher = person(key=2, cx=0.46, cy=0.50, size=0.08, wrists_visible=False)
mixed = ph.assign([phone_at(0.396, 0.66)], [holder, watcher], CFG)
check("คนที่เห็นมือถืออยู่จริง ชนะคนที่แค่อยู่ใกล้", set(mixed) == {1}, f"({mixed})")

# ── 5. แปลงกรอบจากตัวตรวจ ───────────────────────────────
print("\n5. แปลงกรอบจากตัวตรวจ")


class Box:
    def __init__(self, x, y, w, h):
        self.origin_x, self.origin_y, self.width, self.height = x, y, w, h


class Cat:
    def __init__(self, score):
        self.score = score


class Det:
    def __init__(self, x, y, w, h, score):
        self.bounding_box = Box(x, y, w, h)
        self.categories = [Cat(score)]


boxes = ph.to_boxes([Det(320, 240, 32, 48, 0.8)], 640, 480)
check("พิกเซล → normalized ถูกต้อง",
      boxes and abs(boxes[0].box[0] - 0.5) < 1e-9 and abs(boxes[0].box[3] - 0.6) < 1e-9,
      f"({boxes[0].box if boxes else None})")
check("คะแนนต่ำกว่าเกณฑ์ถูกตัดทิ้ง", ph.to_boxes([Det(320, 240, 32, 48, 0.2)], 640, 480, 0.4) == [])
check("กรอบล้นขอบภาพถูกหนีบให้อยู่ใน 0–1",
      ph.to_boxes([Det(600, 460, 200, 200, 0.9)], 640, 480)[0].box[2] == 1.0)
check("กรอบที่กว้าง/สูงเป็นศูนย์ถูกทิ้ง", ph.to_boxes([Det(10, 10, 0, 10, 0.9)], 640, 480) == [])

# ── 6. กันป้ายกระพริบ (PhoneHold) ───────────────────────
print("\n6. กันป้ายกระพริบ (PhoneHold)")
HOLD = CFG["hold_seconds"]
RELEASE = CFG["release_seconds"]
held = ph.Held(distance=0.2, confident=True)

h = ph.PhoneHold(CFG)
check("เห็นเฟรมแรก → ยังไม่ประกาศทันที", h.update(held, 0.0) == (False, False))
check(f"เห็นค้างไม่ครบ {HOLD}s → ยังไม่ประกาศ", h.update(held, HOLD * 0.5) == (False, False))
check("เห็นค้างครบแล้ว → ประกาศ", h.update(held, HOLD + 0.01) == (True, True))

# ตัวตรวจหลุดไปแวบเดียว — เรื่องปกติของ object detector ป้ายต้องไม่หาย
# เวลาปล่อยนับจาก**เฟรมแรกที่ไม่เจอ** ไม่ใช่จากตอนประกาศ — จึงต้องบวก gone ทุกครั้ง
gone = HOLD + 0.2
h.update(None, gone)
check("ตรวจไม่เจอชั่วครู่ → ป้ายยังอยู่", h.update(None, gone + RELEASE * 0.5)[0] is True)
check(f"หายครบ {RELEASE}s → ปล่อยป้าย", h.update(None, gone + RELEASE + 0.02)[0] is False)

h2 = ph.PhoneHold(CFG)
h2.update(held, 0.0)
h2.update(None, HOLD * 0.5)          # หลุดก่อนครบเวลาถือค้าง
h2.update(held, HOLD * 0.6)
check("นับเวลาถือค้างใหม่เมื่อหลุดกลางคัน ไม่สะสมข้ามช่วง",
      h2.update(held, HOLD * 1.1) == (False, False))

# เริ่มจากการเดา แล้วเห็นมือชัดขึ้นทีหลัง
h3 = ph.PhoneHold(CFG)
unsure = ph.Held(distance=1.0, confident=False)
h3.update(unsure, 0.0)
h3.update(unsure, HOLD + 0.01)
check("เริ่มจากการเดา → ป้ายขึ้นแบบไม่มั่นใจ", h3.update(unsure, HOLD + 0.02) == (True, False))
check("เห็นข้อมือชัดทีหลัง → ยกระดับเป็นมั่นใจได้ทันที",
      h3.update(held, HOLD + 0.03) == (True, True))
check("เฟรมถัดมามองไม่เห็นข้อมืออีก → ไม่ลดระดับกลับ (การเห็นแล้วลบไม่ได้)",
      h3.update(unsure, HOLD + 0.04) == (True, True))

print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
