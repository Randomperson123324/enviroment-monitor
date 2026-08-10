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

# คอนโซล Windows ใช้ cp1252 เป็นค่าเริ่มต้น ซึ่งพิมพ์ภาษาไทยไม่ได้ — ถ้าไม่บังคับ utf-8
# เทสจะตายตอน print แล้วดูเหมือน "โค้ดพัง" ทั้งที่ตรรกะยังถูก ซึ่งชวนวินิจฉัยผิดทาง
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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


def _face(cx, cy=0.5, size=0.3, yaw=0.0, stretch=1.0):
    """
    landmark ชุดเล็กพอให้ landmarks.py ใช้งานได้ — index สูงสุดที่ใช้คือ 473

    `stretch` ยืดใบหน้าตามแนวตั้ง ทำให้สัดส่วนโครงหน้าเปลี่ยน = **เป็นคนละคน**
    ในสายตาของ face_signature() ใช้จำลอง "คนที่ไม่มีรูปในโฟลเดอร์"
    """
    pts = [_Point(cx, cy) for _ in range(474)]
    half = size / 2

    def put(i, dx, dy):
        pts[i] = _Point(cx + dx + yaw * half, cy + dy * stretch)

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
    """สามคนนั่งนิ่ง — คนที่สามหันหน้าออกหลังผ่านไปครึ่งทาง

    `only` = ส่งใบหน้าเดียวชุดนี้แทน ใช้ตอนทดสอบโหมดเฉพาะคนในรูป ซึ่งต้องแยกให้ออก
    ว่าใครถูกจำได้และใครไม่ (สามใบหน้าปลอมมีสัดส่วนเท่ากันหมด จึงเป็น "คนเดียวกัน")
    """

    def __init__(self, only=None):
        self.calls = 0
        self.only = only

    def detect_for_video(self, image, timestamp_ms):
        self.calls += 1
        if self.only is not None:
            return _Result([self.only])
        yaw = 0.0 if self.calls < FRAMES_TO_RUN // 2 else 0.6
        return _Result([_face(0.25), _face(0.5), _face(0.75, yaw=yaw)])

    def close(self):
        pass


def install_fakes(monkey_state, only_face=None, photo_face=None,
                  faces_dir=None, window_seconds=None):
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

    landmarker = FakeLandmarker(only=only_face)
    monkey_state["landmarker"] = landmarker
    main.build_landmarker = lambda cfg: landmarker

    # ตัวอ่านรูปปลอม — คืน landmark ของคนคนหนึ่ง เพื่อให้เส้นทาง "จำชื่อจากรูป"
    # ถูกเดินจริงในลูป ไม่ใช่ข้ามไปเพราะสร้างตัวอ่านไม่ได้
    fake_reader = types.SimpleNamespace(close=lambda: None)
    main.build_photo_reader = lambda cfg: (lambda path: photo_face, fake_reader)

    # ชี้แกลเลอรีไปที่โฟลเดอร์ชั่วคราว — ห้ามแตะ faces/ ของผู้ใช้ซึ่งมีรูปคนจริงอยู่
    if faces_dir is not None:
        monkey_state["faces_dir"] = main.CONFIG["faces"]["dir"]
        main.CONFIG["faces"]["dir"] = str(faces_dir)
    # หน้าต่างสรุป 15 วินาทีไม่มีทางปิดได้ใน 80 เฟรม — ย่อลงเพื่อให้มีแถวออกมาให้ตรวจ
    if window_seconds is not None:
        monkey_state["window_seconds"] = main.CONFIG["window"]["seconds"]
        main.CONFIG["window"]["seconds"] = window_seconds

    # ตัวส่งปลอม — เก็บแถวที่ "ถูกส่ง" ไว้ตรวจ โดยไม่แตะเครือข่ายจริง
    sent = []
    monkey_state["sent"] = sent

    class FakeUploader:
        def __init__(self, cfg):
            self.enabled = True

        def start(self):
            pass

        def send(self, row, room=False):
            sent.append(row)
            return True

        def close(self, *a, **kw):
            pass

    monkey_state["uploader_cls"] = main.up_mod.Uploader
    main.up_mod.Uploader = FakeUploader

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


def run(mode_key, **kw):
    state = {}
    main = install_fakes(state, **kw)
    sys.argv = ["main.py", "--mode", mode_key]
    try:
        code = main.main()
    finally:
        # คืนค่าที่ยืมมาแก้ ไม่งั้นการรันรอบถัดไปจะเห็นค่าที่เพี้ยนแล้ว
        main.up_mod.Uploader = state["uploader_cls"]
        if "faces_dir" in state:
            main.CONFIG["faces"]["dir"] = state["faces_dir"]
        if "window_seconds" in state:
            main.CONFIG["window"]["seconds"] = state["window_seconds"]
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

# ── โหมดเฉพาะคนในรูป ────────────────────────────────────
# ข้อสัญญาของโหมดนี้มีสองข้อ และทั้งคู่ต้องจริงในลูปจริง ไม่ใช่แค่ในค่าตั้ง:
#   1. คนที่มีรูป → ถูกจำได้ · ขึ้นชื่อบนจอ · มีแถวส่งขึ้นฐานข้อมูล
#   2. คนที่ไม่มีรูป → ขึ้นว่า unknown · **ไม่มีแถวใด ๆ** ถูกส่ง
print("\nโหมดเฉพาะคนในรูป — รันลูปจริงทั้งกรณีมีรูปและไม่มีรูป")
import tempfile  # noqa: E402
from pathlib import Path as _Path  # noqa: E402

ME = _face(0.5)                     # ใบหน้าที่กล้องเห็น
STRANGER = _face(0.5, stretch=1.6)  # สัดส่วนต่างออกไป = คนละคนในสายตาของลายเซ็น

with tempfile.TemporaryDirectory() as gallery_dir:
    # ไฟล์เปล่าพอ — ตัวอ่านรูปปลอมไม่ได้อ่านเนื้อไฟล์ แต่ faces.py ต้องเห็นว่ามีไฟล์
    (_Path(gallery_dir) / "Ann.jpg").write_bytes(b"")

    code, state = run("known", only_face=ME, photo_face=ME,
                      faces_dir=gallery_dir, window_seconds=0.5)
    drawn, sent = state["drawn"], state["sent"]
    check("[known] ลูปจบด้วยสถานะปกติ", code == 0, f"(ได้ {code})")
    check("[known] คนที่มีรูปขึ้นชื่อบนจอ",
          any("Ann" in t for t in drawn), f"(ที่วาด {drawn[:3]})")
    check("[known] ไม่มีหมายเลข track หลุดขึ้นจอแทนชื่อ",
          not [t for t in drawn if "#" in t], f"(หลุด {[t for t in drawn if '#' in t][:3]})")
    check("[known] มีแถวถูกส่งขึ้นฐานข้อมูล", len(sent) > 0, f"(ได้ {len(sent)} แถว)")
    check("[known] ทุกแถวมีชื่อกำกับ ไม่มีแถวที่ name เป็น null",
          bool(sent) and all(r["name"] == "Ann" for r in sent),
          f"({[r.get('name') for r in sent[:3]]})")

    # คนแปลกหน้า: แกลเลอรีมีแค่ Ann และใบหน้าที่เห็นเป็นสัดส่วนอื่น
    code2, state2 = run("known", only_face=STRANGER, photo_face=ME,
                        faces_dir=gallery_dir, window_seconds=0.5)
    drawn2, sent2 = state2["drawn"], state2["sent"]
    check("[known] คนที่ไม่มีรูปขึ้นว่า unknown", any("unknown" in t for t in drawn2),
          f"(ที่วาด {drawn2[:3]})")
    check("[known] ไม่ติดชื่อคนอื่นให้คนแปลกหน้า", not any("Ann" in t for t in drawn2))
    check("[known] คนที่ไม่มีรูปไม่ถูกบันทึกเลย", sent2 == [], f"(ส่งไป {sent2[:2]})")

# โหมดรายบุคคลต้องไม่ถูกกระทบ — ยังบันทึกทุกคนแม้ไม่มีรูป
code3, state3 = run("person", only_face=STRANGER, photo_face=None, window_seconds=0.5)
check("[person] ยังบันทึกคนที่ไม่มีรูปตามเดิม", len(state3["sent"]) > 0,
      f"(ได้ {len(state3['sent'])} แถว)")
check("[person] และไม่มีชื่อปลอมโผล่มา",
      all(r["name"] is None for r in state3["sent"]))

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
