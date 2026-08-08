#!/usr/bin/env python3
"""
รันลูปหลักจริง ๆ แบบไม่ต้องมีกล้อง เพื่อให้โค้ดทุกบรรทัดในลูปถูกเรียกอย่างน้อยหนึ่งครั้ง

test_logic.py ทดสอบตรรกะทีละชิ้น แต่ไม่เคยเข้าไปในลูปของ main() เลย
บั๊กอย่างชื่อตัวแปรผิดหรือลำดับการวาดผิดจึงหลุดรอดไปโผล่ตอนรันจริงบน Pi
ไฟล์นี้ปิดช่องนั้นด้วยการแทนกล้อง · โมเดล · หน้าต่าง ด้วยของปลอม

รัน:  python3 test_room_smoke.py
"""

import sys
import types

import numpy as np

FAILURES = []
FRAMES_TO_RUN = 80


def check(name, condition, detail=""):
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


# ── ของปลอมแทน mediapipe ────────────────────────────────
class _Point:
    __slots__ = ("x", "y", "z")

    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


def _face(cx, cy=0.5, size=0.3, yaw=0.0):
    """landmark ชุดเล็กพอให้ landmarks.py ใช้งานได้ — index สูงสุดที่ใช้คือ 473"""
    pts = [_Point(cx, cy) for _ in range(474)]
    half = size / 2

    def put(i, dx, dy):
        pts[i] = _Point(cx + dx + yaw * half, cy + dy)

    put(1, 0.0, 0.0)                 # ปลายจมูก
    put(10, 0.0, -half)              # หน้าผาก
    put(152, 0.0, half)              # คาง
    put(234, -half, 0.0)             # ขอบหน้าซ้าย
    put(454, half, 0.0)              # ขอบหน้าขวา
    put(61, -half * 0.4, half * 0.5)   # มุมปากซ้าย
    put(291, half * 0.4, half * 0.5)   # มุมปากขวา
    for i, (dx, dy) in (
        (33, (-half * 0.55, -half * 0.15)), (133, (-half * 0.2, -half * 0.15)),
        (159, (-half * 0.38, -half * 0.24)), (145, (-half * 0.38, -half * 0.06)),
        (160, (-half * 0.45, -half * 0.23)), (144, (-half * 0.45, -half * 0.07)),
        (158, (-half * 0.3, -half * 0.23)), (153, (-half * 0.3, -half * 0.07)),
        (263, (half * 0.55, -half * 0.15)), (362, (half * 0.2, -half * 0.15)),
        (386, (half * 0.38, -half * 0.24)), (374, (half * 0.38, -half * 0.06)),
        (385, (half * 0.45, -half * 0.23)), (380, (half * 0.45, -half * 0.07)),
        (387, (half * 0.3, -half * 0.23)), (373, (half * 0.3, -half * 0.07)),
    ):
        put(i, dx, dy)
    return pts


class _Result:
    def __init__(self, faces):
        self.face_landmarks = faces
        self.face_blendshapes = None
        self.facial_transformation_matrixes = None


class FakeLandmarker:
    """สามคนนั่งนิ่ง — คนที่สามหันหน้าออกหลังผ่านไปครึ่งทาง"""

    def __init__(self):
        self.calls = 0

    def detect_for_video(self, image, timestamp_ms):
        self.calls += 1
        yaw = 0.0 if self.calls < FRAMES_TO_RUN // 2 else 0.6
        return _Result([_face(0.25), _face(0.5), _face(0.75, yaw=yaw)])

    def close(self):
        pass


def install_fakes(monkey_state):
    import cv2

    import camera as cam
    import landmarks as lm
    import main

    # ดักการคำนวณ EAR — โหมดห้องรวมต้องไม่เรียกแม้แต่ครั้งเดียว
    ear_calls = []
    monkey_state["ear_calls"] = ear_calls
    real_ear = getattr(lm, "_real_average_ear", None) or lm.average_ear
    lm._real_average_ear = real_ear
    lm.average_ear = lambda pts: (ear_calls.append(1), real_ear(pts))[1]
    import analyzer as az_mod

    az_mod.lm = lm

    # กล้องปลอม — คืนภาพดำขนาดคงที่
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    monkey_state["camera_open"] = cam.Camera.open
    monkey_state["camera_read"] = cam.Camera.read
    monkey_state["camera_close"] = cam.Camera.close
    cam.Camera.open = lambda self: "fake"
    cam.Camera.read = lambda self: frame.copy()
    cam.Camera.close = lambda self: None

    landmarker = FakeLandmarker()
    monkey_state["landmarker"] = landmarker
    main.build_landmarker = lambda cfg: landmarker

    # mediapipe ปลอม — main import ข้างในฟังก์ชัน จึงยัดเข้า sys.modules ได้
    fake_mp = types.ModuleType("mediapipe")
    fake_mp.Image = lambda image_format=None, data=None: object()
    fake_mp.ImageFormat = types.SimpleNamespace(SRGB=0)
    sys.modules["mediapipe"] = fake_mp

    # หน้าต่างปลอม — เก็บภาพไว้ตรวจ แล้วส่งปุ่ม q เมื่อครบจำนวนเฟรม
    shown = []
    monkey_state["shown"] = shown
    cv2.imshow = lambda name, img: shown.append(img)
    cv2.destroyAllWindows = lambda: None
    cv2.waitKey = lambda ms: (ord("q") if len(shown) >= FRAMES_TO_RUN else 255)

    # ดักทุกข้อความที่ถูกวาดลงภาพ — นี่คือสิ่งที่คนยืนดูจอมองเห็นจริง ๆ
    drawn = []
    monkey_state["drawn"] = drawn
    real_puttext = cv2.putText

    def spy_puttext(img, text, *a, **kw):
        drawn.append(text)
        return real_puttext(img, text, *a, **kw)

    cv2.putText = spy_puttext
    monkey_state["restore_puttext"] = real_puttext
    return main


def run(mode_key):
    state = {}
    main = install_fakes(state)
    sys.argv = ["main.py", "--mode", mode_key]
    code = main.main()
    return code, state


print("\nรันลูปหลักจริงด้วยกล้องปลอม")
for mode_key, expect_id_on_screen, expect_eyes in (("room", False, False),
                                                   ("person", True, True)):
    code, state = run(mode_key)
    check(f"[{mode_key}] ลูปจบด้วยสถานะปกติ", code == 0, f"(ได้ {code})")
    check(f"[{mode_key}] วาดภาพออกจอจริง", len(state["shown"]) >= FRAMES_TO_RUN,
          f"(ได้ {len(state['shown'])} เฟรม)")
    check(f"[{mode_key}] เรียกโมเดลทุกเฟรม", state["landmarker"].calls >= FRAMES_TO_RUN)

    drawn = state["drawn"]
    with_id = [t for t in drawn if "#" in t]
    check(f"[{mode_key}] มีข้อความขึ้นจอจริง", bool(drawn), "(ไม่มีข้อความเลย)")
    if expect_id_on_screen:
        check(f"[{mode_key}] แสดง id รายคนตามที่ควร", bool(with_id))
    else:
        check(f"[{mode_key}] ไม่มี id หลุดขึ้นจอแม้แต่ครั้งเดียว",
              not with_id, f"(หลุด {with_id[:3]})")

    # cv2.putText วาดอักษรไทยไม่ได้ — ถ้ามีไทยหลุดมา ผู้ใช้จะเห็นเป็นกล่องสี่เหลี่ยม
    thai = [t for t in drawn if any("฀" <= c <= "๿" for c in t)]
    check(f"[{mode_key}] ไม่มีอักษรไทยถูกส่งไปวาดบนภาพ", not thai, f"(พบ {thai[:2]})")

    # การวัดตา — โหมดห้องรวมต้องไม่แตะเลย ไม่ใช่วัดแล้วซ่อน
    ear_calls = len(state["ear_calls"])
    on_screen = [t for t in drawn if "eye" in t or "blink" in t or "DROWSY" in t]
    if expect_eyes:
        check(f"[{mode_key}] เรียกคำนวณ EAR จริง", ear_calls > 0, f"(เรียก {ear_calls} ครั้ง)")
        check(f"[{mode_key}] มีค่าที่เกี่ยวกับตาขึ้นจอ", bool(on_screen))
    else:
        check(f"[{mode_key}] ไม่เรียกคำนวณ EAR แม้แต่ครั้งเดียว", ear_calls == 0,
              f"(เรียก {ear_calls} ครั้ง)")
        check(f"[{mode_key}] ไม่มีค่าที่เกี่ยวกับตาขึ้นจอ", not on_screen,
              f"(หลุด {on_screen[:3]})")

# ── ตรวจว่าโหมดห้องรวมไม่เก็บลายเซ็นจริง ────────────────
print("\nโหมดห้องรวมต้องไม่มีลายเซ็นโครงหน้าอยู่ในหน่วยความจำ")
import modes  # noqa: E402
from tracker import Detection, PersonTracker  # noqa: E402

room_tracker = PersonTracker(modes.get("room").apply_to_tracker(
    __import__("config").CONFIG["tracker"]
))
t = 0.0
for _ in range(30):
    room_tracker.assign([Detection(cx=0.5, cy=0.5, box=(0.35, 0.35, 0.65, 0.65),
                                   signature=None)], t)
    t += 0.1
tracks = room_tracker.assign([Detection(cx=0.5, cy=0.5, box=(0.35, 0.35, 0.65, 0.65),
                                        signature=None)], t)
check("track ไม่มีลายเซ็นสะสมเลย",
      all(getattr(tr, "signature", None) is None for tr in tracks))
check("ไม่มีใครถูกเก็บไว้ในกลุ่มที่จำได้", room_tracker.lost_count == 0)
check("ตัวนับ re-ID เป็นศูนย์เสมอ", room_tracker.reid_hits == 0)

print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
