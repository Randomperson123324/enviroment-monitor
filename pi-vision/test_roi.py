#!/usr/bin/env python3
"""
ทดสอบการซูมเข้าที่ใบหน้า โดยไม่ต้องมีกล้องหรือ mediapipe

ข้อที่สำคัญที่สุดในไฟล์นี้คือ **ลายเซ็นต้องไม่เปลี่ยนหลังครอป** — ถ้าข้อนั้นพัง
ระบบจะไม่ error อะไรเลย มันจะแค่จำคนแย่ลงเรื่อย ๆ โดยไม่มีใครรู้ว่าเพราะอะไร
เทสที่เหลือคุ้มกันขอบเขตของกรอบครอปและการวนคิวให้ทั่ว

รัน:  python3 test_roi.py
"""

import sys

import landmarks as lm
import roi
from fixtures import make_face

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAILURES = []


def check(name, condition, detail=""):
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


class FakeCropLandmarks:
    """
    จำลองสิ่งที่ FaceLandmarker จะคืนมาถ้าป้อนภาพครอปเข้าไป

    ของจริงรับภาพครอปแล้วคืนพิกัดที่อ้างอิงกับภาพครอปนั้น · ที่นี่จึงเอา landmark
    ของเฟรมเต็มมาแปลงกลับเข้าไปในกรอบ ซึ่งเป็นสิ่งเดียวกับที่โมเดลจะทำถ้ามันแม่นสมบูรณ์
    ทำแบบนี้เพื่อแยกคำถาม "คณิตศาสตร์ของการครอป-แปลงกลับถูกไหม" ออกจาก
    "โมเดลแม่นแค่ไหน" — คำถามแรกตอบได้แน่นอน คำถามที่สองตอบได้เฉพาะกับกล้องจริง
    """

    def __init__(self, points, rect, frame_w, frame_h):
        rx1, ry1, rx2, ry2 = rect
        self.points = [
            roi.Point(
                x=(p.x * frame_w - rx1) / (rx2 - rx1),
                y=(p.y * frame_h - ry1) / (ry2 - ry1),
                z=getattr(p, "z", 0.0) * frame_w / (rx2 - rx1),
            )
            for p in points
        ]


W, H = 640, 480
MARGIN = 0.6

print("1. อัตราส่วนของกรอบครอป")
for name, box in (
    ("กลางเฟรม", (0.45, 0.40, 0.55, 0.60)),
    ("ชิดขอบซ้ายบน", (0.00, 0.00, 0.06, 0.08)),
    ("ชิดขอบขวาล่าง", (0.94, 0.92, 1.00, 1.00)),
    ("ใบหน้าจิ๋วมุมขวาบน", (0.96, 0.02, 0.99, 0.06)),
    ("ใบหน้าเต็มเฟรม", (0.0, 0.0, 1.0, 1.0)),
):
    rx1, ry1, rx2, ry2 = roi.crop_rect(box, W, H, MARGIN)
    got = (rx2 - rx1) / (ry2 - ry1)
    check(f"[{name}] อัตราส่วนตรงกับเฟรม", abs(got - W / H) < 0.02,
          f"(ได้ {got:.4f} ต้องการ {W/H:.4f})")
    check(f"[{name}] กรอบอยู่ในเฟรมทั้งหมด",
          0 <= rx1 < rx2 <= W and 0 <= ry1 < ry2 <= H,
          f"(ได้ {(rx1, ry1, rx2, ry2)})")

print("\n1b. บังคับอัตราส่วนที่ต่างจากภาพต้นทาง (ใช้กับรูปลงทะเบียน)")
# รูปจากมือถือเป็นแนวตั้ง แต่ลายเซ็นต้องเทียบกับภาพจากกล้อง 4:3 ได้
# วัดจริงแล้ว: ไม่ทำข้อนี้ คนเดียวกันถ่ายแนวตั้งกับแนวนอนห่างกัน 0.077 (เกินเกณฑ์ 0.045)
CAM = 4 / 3
for label, (pw, ph) in (
    ("รูปแนวตั้งจากมือถือ", (853, 1280)),
    ("รูปสี่เหลี่ยมจัตุรัส", (900, 900)),
    ("รูปแนวนอนกว้างมาก", (1920, 720)),
):
    r = roi.crop_rect((0.40, 0.30, 0.60, 0.45), pw, ph, MARGIN, aspect=CAM)
    got = (r[2] - r[0]) / (r[3] - r[1])
    check(f"[{label}] ตัดออกมาได้ 4:3 ตามกล้อง", abs(got - CAM) < 0.02,
          f"(ได้ {got:.3f})")
    check(f"[{label}] กรอบยังอยู่ในรูป", 0 <= r[0] < r[2] <= pw and 0 <= r[1] < r[3] <= ph,
          f"(ได้ {r})")
check("ไม่ระบุ aspect = ใช้อัตราส่วนของภาพต้นทางตามเดิม",
      abs((lambda r: (r[2]-r[0])/(r[3]-r[1]))(roi.crop_rect((0.4, 0.3, 0.6, 0.45), 853, 1280,
                                                            MARGIN)) - 853/1280) < 0.02)

print("\n2. ลายเซ็นต้องไม่เปลี่ยนหลังครอป")
# ข้อนี้คือเหตุผลที่ crop_rect ต้องล็อกอัตราส่วน — ถ้าเลิกล็อก ข้อนี้จะพังทันที
for label, kw in (
    ("หน้าตรงกลางเฟรม", dict(cx=0.5, cy=0.5, size=0.30)),
    ("คนอยู่ไกล (หน้าเล็ก)", dict(cx=0.5, cy=0.5, size=0.05)),
    ("อยู่มุมเฟรม", dict(cx=0.12, cy=0.15, size=0.08)),
    ("หันหน้า", dict(cx=0.6, cy=0.4, size=0.12, yaw=0.20, pitch=0.10)),
):
    full = make_face(**kw)
    rect = roi.crop_rect(lm.bounding_box(full), W, H, MARGIN)
    cropped = FakeCropLandmarks(full, rect, W, H).points
    back = roi.remap(cropped, rect, W, H)

    a, b = lm.face_signature(full), lm.face_signature(back)
    worst = max(abs(x - y) for x, y in zip(a, b))
    check(f"[{label}] ลายเซ็นเท่าเดิม", worst < 1e-9, f"(ต่างสุด {worst:.2e})")

    pa, pb = lm.head_pose(full), lm.head_pose(back)
    check(f"[{label}] ท่าหันหน้าเท่าเดิม",
          max(abs(pa[0] - pb[0]), abs(pa[1] - pb[1])) < 1e-9)

    ea, eb = lm.average_ear(full), lm.average_ear(back)
    check(f"[{label}] EAR เท่าเดิม", abs(ea - eb) < 1e-9)

print("\n3. เทสที่พิสูจน์ว่าเทสข้างบนไวจริง")
# ถ้าข้อ 2 ผ่านเพราะเทสมันหลวม ไม่ใช่เพราะโค้ดถูก ข้อนี้จะผ่านไปด้วย — ซึ่งแปลว่าพัง
full = make_face(cx=0.5, cy=0.5, size=0.20)
rect = roi.crop_rect(lm.bounding_box(full), W, H, MARGIN)
squashed = (rect[0], rect[1], rect[2], rect[1] + int((rect[3] - rect[1]) * 0.6))
cropped = FakeCropLandmarks(full, squashed, W, H).points
back = roi.remap(cropped, rect, W, H)      # ครอปบี้ แต่แปลงกลับด้วยกรอบที่ถูก
a, b = lm.face_signature(full), lm.face_signature(back)
worst = max(abs(x - y) for x, y in zip(a, b))
check("กรอบที่อัตราส่วนผิดต้องทำให้ลายเซ็นเพี้ยน", worst > 1e-3,
      f"(ต่างสุด {worst:.2e} — น้อยไป แปลว่าเทสข้อ 2 ไม่ไว)")

print("\n4. remap")
rect_full = (0, 0, W, H)
pts = make_face(cx=0.5, cy=0.5, size=0.2)
same = roi.remap(pts, rect_full, W, H)
check("ครอบทั้งเฟรม = พิกัดไม่เปลี่ยนเลย",
      all(abs(p.x - q.x) < 1e-12 and abs(p.y - q.y) < 1e-12 for p, q in zip(pts, same)))

print("\n5. เกลี่ยกรอบ")
check("ไม่มีกรอบเดิม = ใช้กรอบใหม่ตรง ๆ",
      roi.blend_rect(None, (10, 20, 30, 40), 0.6) == (10, 20, 30, 40))
blended = roi.blend_rect((0, 0, 100, 100), (100, 100, 200, 200), 0.5)
check("เกลี่ยครึ่ง-ครึ่งได้กึ่งกลาง", blended == (50, 50, 150, 150), f"(ได้ {blended})")


class T:
    """track เท่าที่ roi.pick ใช้"""

    def __init__(self, pid, roi_at=None):
        self.person_id = pid
        self.state = {} if roi_at is None else {"roi_at": roi_at}


print("\n6. วนคิวให้ทั่ว")
when = lambda t: t.state.get("roi_at", roi.NEVER)     # noqa: E731
check("โควตา 0 = ไม่ซูมใคร", roi.pick([T(1), T(2)], 0, when) == [])
check("คนที่ยังไม่เคยถูกซูมได้ก่อน",
      [t.person_id for t in roi.pick([T(1, 5.0), T(2)], 1, when)] == [2])
check("คนที่รอนานที่สุดได้ก่อน",
      [t.person_id for t in roi.pick([T(1, 8.0), T(2, 3.0), T(3, 5.0)], 2, when)] == [2, 3])
check("โควตามากกว่าจำนวนคน ก็ไม่พัง",
      len(roi.pick([T(1), T(2)], 9, when)) == 2)

# มีคนมากกว่าโควตาหลายเท่า ทุกคนต้องได้คิวภายในไม่กี่รอบ ไม่มีใครถูกทิ้งถาวร
people = [T(i) for i in range(1, 6)]
clock, seen = 0.0, set()
for _ in range(3):                       # 5 คน โควตา 2 → ครบภายใน 3 รอบ
    clock += 1.0
    for t in roi.pick(people, 2, when):
        t.state["roi_at"] = clock
        seen.add(t.person_id)
check("5 คน โควตา 2 → ทุกคนได้คิวภายใน 3 รอบ", len(seen) == 5, f"(ได้ {sorted(seen)})")

print("\n7. คัดคนที่ตัวตรวจเห็นแต่ landmarker ไม่เห็น")
import detect as dt                                        # noqa: E402

near = (0.40, 0.40, 0.60, 0.70)          # คนใกล้ — landmarker เห็นอยู่แล้ว
far = (0.05, 0.30, 0.09, 0.36)           # คนไกล — เหลือกรอบเล็กนิดเดียว
found = [dt.Found(box=near, score=0.9), dt.Found(box=far, score=0.7)]
left = dt.unmatched(found, [near], min_iou=0.3)
check("เหลือเฉพาะคนที่ landmarker พลาด", [f.box for f in left] == [far])
check("ไม่มีใครถูก landmarker เห็นเลย = ต้องซูมทุกคน",
      len(dt.unmatched(found, [], min_iou=0.3)) == 2)
# กรอบจากตัวตรวจกว้างกว่ากรอบที่คำนวณจาก landmark เสมอ — ต้องยังจับคู่กันได้
looser = (0.38, 0.36, 0.62, 0.74)
check("กรอบที่ขนาดต่างกันพอควรยังจับคู่กันได้",
      dt.unmatched([dt.Found(box=looser)], [near], min_iou=0.3) == [])

print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
