#!/usr/bin/env python3
"""
ทดสอบตรรกะโดยไม่ต้องมีกล้องหรือ mediapipe

สร้าง landmark ปลอมขึ้นมาเอง แล้วตรวจว่า:
  - EAR และ head_pose ให้ค่าถูกทิศและไม่ขึ้นกับขนาดใบหน้า
  - analyzer นับการหันหน้าครั้งเดียวต่อการหันหนึ่งครั้ง (ไม่นับซ้ำทุกเฟรม)
  - ป้าย Left/Right สลับตามค่า mirror
  - **EAR baseline เรียนรายบุคคล** — คนตาเล็กกับคนตาโตได้ threshold ต่างกัน
  - **blendshape** ถูกใช้แทน EAR เมื่อมีข้อมูล และถอยกลับไป EAR เมื่อไม่มี
  - **quality gating** — ใบหน้าเล็กเกินไปไม่ถูกวิเคราะห์
  - **tracker หลายคน** — 5 คนพร้อมกันได้ id ครบ · เดินไขว้กันแล้ว id ไม่สลับ
  - pop_window คืนสรุปเมื่อครบเวลาและรีเซ็ตตัวนับ

รัน:  python3 test_logic.py
"""

import io
import sys

import analyzer as az
import landmarks as lm
import modes
from fixtures import PEOPLE, TWIN, Cat, P, detection as det, make_face
from tracker import PersonTracker, iou

# คอนโซล Windows ใช้ cp1252 เป็นค่าเริ่มต้น ซึ่งพิมพ์ภาษาไทยไม่ได้ — ถ้าไม่บังคับ utf-8
# เทสจะตายตอน print แล้วดูเหมือน "โค้ดพัง" ทั้งที่ตรรกะยังถูก ซึ่งชวนวินิจฉัยผิดทาง
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# main import cv2/mediapipe ตอนรันจริงเท่านั้น — ตรงนี้จึงยอมข้ามได้ถ้าไม่มี
try:
    import main
except ImportError:
    main = None

FAILURES = []


def _raises(fn) -> bool:
    """คืน True เมื่อฟังก์ชันโยน ValueError ตามที่ควร"""
    try:
        fn()
    except ValueError:
        return True
    return False


def _error_text(fn) -> str:
    """ข้อความใน ValueError ที่โยนออกมา — ใช้ตรวจว่าคำแนะนำในข้อความยังถูกอยู่

    ข้อความ error เป็นสิ่งที่ผู้ใช้อ่าน มันจึงล้าสมัยได้เงียบ ๆ เหมือนโค้ดส่วนอื่น
    """
    try:
        fn()
    except ValueError as exc:
        return str(exc)
    return ""


class _R:
    """FaceReading เท่าที่ `_who()` ใช้จริง

    สร้างของจริงต้องกรอกอีกยี่สิบฟิลด์ที่ไม่เกี่ยวกับคำถามว่า "ขึ้นชื่ออะไรบนจอ"
    """

    def __init__(self, name=None, person_id=1, name_confident=True):
        self.name = name
        self.person_id = person_id
        self.name_confident = name_confident


def check(name, condition, detail=""):
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)




def fi(points, blink=None, matrix=None):
    """ห่อเป็น FaceInput — blink เป็นคะแนน blendshape 0–1 หรือ None"""
    shapes = None
    if blink is not None:
        shapes = [Cat("eyeBlinkLeft", blink), Cat("eyeBlinkRight", blink)]
    return az.FaceInput(landmarks=points, blendshapes=shapes, matrix=matrix)


CFG = {
    "pose": {
        "method": "geometric",
        "calibration_seconds": 0.5,
        "yaw_threshold": 0.08,
        "pitch_threshold": 0.06,
        "yaw_threshold_deg": 18.0,
        "pitch_threshold_deg": 14.0,
        "matrix_invert_yaw": False,
        "matrix_invert_pitch": False,
        "release_ratio": 0.6,
        "hold_seconds": 0.2,
        "smooth_frames": 3,
    },
    "blink": {
        "method": "auto",
        "closed_score": 0.5,
        "ear_threshold": 0.18,
        "ear_open_percentile": 0.75,
        "ear_close_ratio": 0.65,
        "consecutive_frames": 2,
        "drowsy_seconds": 1.2,
        "normal_rate_min": 8,
        "normal_rate_max": 21,
    },
    "quality": {"min_interocular_px": 40, "good_interocular_px": 90},
    "window": {"seconds": 15.0, "movement_threshold_per_min": 8, "occupancy_samples": 900},
}
TRACKER_CFG = {
    "max_distance": 0.25,
    "forget_seconds": 3.0,
    "weight_distance": 0.5,
    "weight_iou": 0.35,
    "weight_size": 0.15,
    "use_prediction": True,
    "velocity_smoothing": 0.6,
    "swap_guard": True,
    "reid_enabled": True,
    "reid_memory_seconds": 120.0,
    "reid_threshold": 0.05,
    "reid_min_size": 0.12,
    "reid_max_samples": 30,
    "reid_min_samples": 15,
    "reid_ratio": 0.75,
    "reid_threshold_single": 0.08,
    "reid_max_pool": 30,
    "reid_max_attempts": 60,
    "reid_stable_eps": 0.004,
    "reid_stable_needed": 5,
}
FRAME = (640, 480)


class FakeTrack:
    def __init__(self, pid=1):
        self.person_id = pid
        self.state = {}


def feed(an, track, face_of, seconds, t0, dt=0.1, frame=FRAME):
    t = t0
    for _ in range(int(seconds / dt)):
        an.update([(track, face_of(t))], t, dt, frame)
        t += dt
    return t




# ── 1. EAR ──────────────────────────────────────────────
print("\n1. EAR และ head_pose")
check("ตาเปิด EAR สูงกว่าตาปิด",
      lm.average_ear(make_face(eye_open=1.0)) > lm.average_ear(make_face(eye_open=0.05)))
check("EAR ไม่ขึ้นกับขนาดใบหน้า",
      abs(lm.average_ear(make_face(size=0.2)) - lm.average_ear(make_face(size=0.6))) < 1e-6)
check("หันขวา yaw เพิ่ม", lm.head_pose(make_face(yaw=0.25))[0] > lm.head_pose(make_face())[0])
check("ก้มลง pitch เพิ่ม", lm.head_pose(make_face(pitch=0.25))[1] > lm.head_pose(make_face())[1])
check("interocular_px แปรตามขนาดใบหน้า",
      lm.interocular_px(make_face(size=0.6), 640) > lm.interocular_px(make_face(size=0.2), 640))

# ── 2. blendshape ───────────────────────────────────────
print("\n2. blendshape")
check("อ่านคะแนนจาก blendshape ได้",
      abs(lm.blink_from_blendshapes([Cat("eyeBlinkLeft", 0.8), Cat("eyeBlinkRight", 0.6)]) - 0.7) < 1e-9)
check("ชื่อที่มี _ และตัวพิมพ์ต่างกันก็อ่านได้",
      lm.blink_from_blendshapes([Cat("eye_blink_left", 0.4), Cat("EYEBLINKRIGHT", 0.4)]) == 0.4)
check("ไม่มี blendshape คืน None", lm.blink_from_blendshapes(None) is None)
check("ไม่มีชื่อที่ตรงคืน None", lm.blink_from_blendshapes([Cat("jawOpen", 0.9)]) is None)

# ── 3. EAR baseline รายบุคคล ────────────────────────────
print("\n3. EAR baseline รายบุคคล")
an = az.FaceAnalyzer(CFG, mirror=True)
big, small = FakeTrack(1), FakeTrack(2)
t = 100.0
for _ in range(10):
    an.update([(big, fi(make_face(cx=0.3, lid_scale=0.14))),
               (small, fi(make_face(cx=0.7, lid_scale=0.06)))], t, 0.1, FRAME)
    t += 0.1
sb, ss = big.state["analyzer"], small.state["analyzer"]
check("calibrate เสร็จทั้งสองคน", sb.calibrated and ss.calibrated)
check("คนตาโตได้ EAR baseline สูงกว่า", sb.ear_open > ss.ear_open,
      f"({sb.ear_open:.3f} vs {ss.ear_open:.3f})")
check("threshold ต่างกันตามรูปตา", sb.ear_threshold > ss.ear_threshold)
check("threshold = baseline × ratio",
      abs(sb.ear_threshold - sb.ear_open * CFG["blink"]["ear_close_ratio"]) < 1e-9)

# ── 4. quality gating ───────────────────────────────────
print("\n4. quality gating")
a2 = az.FaceAnalyzer(CFG, mirror=True)
tiny, near = FakeTrack(1), FakeTrack(2)
r = a2.update([(tiny, fi(make_face(size=0.05))), (near, fi(make_face(size=0.5)))],
              200.0, 0.1, FRAME)
check("ใบหน้าเล็กถูกทำเครื่องหมายว่าใช้ไม่ได้", not r[0].usable)
check("ใบหน้าใหญ่ใช้ได้", r[1].usable)
check("quality ของใบหน้าเล็กต่ำกว่า", r[0].quality < r[1].quality)
check("ใบหน้าที่ใช้ไม่ได้ไม่ถูกเอาไป calibrate",
      not tiny.state["analyzer"].calibrated and tiny.state["analyzer"].calib_started is None)

# ── 5. นับการหันหน้า ────────────────────────────────────
print("\n5. การนับการหันหน้า")
a3 = az.FaceAnalyzer(CFG, mirror=True)
tr = FakeTrack()
t = feed(a3, tr, lambda _t: fi(make_face()), 1.0, 300.0)
st = tr.state["analyzer"]
check("calibrate ท่านิ่งเสร็จ", st.calibrated)
t = feed(a3, tr, lambda _t: fi(make_face(yaw=0.5)), 2.0, t)
check("หันค้างนาน ๆ นับเป็น 1 ครั้ง", st.window_dirs[az.DIR_RIGHT] == 1,
      f"(ได้ {st.window_dirs[az.DIR_RIGHT]})")
t = feed(a3, tr, lambda _t: fi(make_face()), 1.0, t)
t = feed(a3, tr, lambda _t: fi(make_face(yaw=0.5)), 1.0, t)
check("กลับมาตรงแล้วหันใหม่ นับเป็น 2", st.window_dirs[az.DIR_RIGHT] == 2)
t = feed(a3, tr, lambda _t: fi(make_face()), 1.0, t)
t = feed(a3, tr, lambda _t: fi(make_face(pitch=0.5)), 1.0, t)
check("ก้มลงนับเป็น Down", st.window_dirs[az.DIR_DOWN] == 1)
t = feed(a3, tr, lambda _t: fi(make_face()), 1.0, t)
t = feed(a3, tr, lambda _t: fi(make_face(yaw=0.5)), 0.1, t)
check("หันแวบเดียวไม่ถูกนับ", st.window_dirs[az.DIR_RIGHT] == 2)

# ── 6. ป้ายทิศตาม mirror ────────────────────────────────
print("\n6. ป้ายทิศตามค่า mirror")
for mirror, expect in ((True, az.DIR_RIGHT), (False, az.DIR_LEFT)):
    a4 = az.FaceAnalyzer(CFG, mirror=mirror)
    tk = FakeTrack()
    tt = feed(a4, tk, lambda _t: fi(make_face()), 1.0, 400.0)
    feed(a4, tk, lambda _t: fi(make_face(yaw=0.5)), 1.0, tt)
    check(f"mirror={mirror} → นับเป็น {expect}",
          tk.state["analyzer"].window_dirs[expect] == 1)

# ── 6.5 ท่านิ่งจากรูปลงทะเบียน ──────────────────────────
print("\n6.5 ท่านิ่งจากรูปลงทะเบียน (ไม่ต้องนั่ง calibrate)")

# คนคนนี้จมูกเบี้ยวไปทางหนึ่งเป็นทุนเดิม — ตอนมองตรงก็ยังได้ yaw ไม่เป็นศูนย์
# นี่คือ bias ประจำตัวที่การ calibrate มีไว้เพื่อหักออก
BIAS = 0.05
registration = make_face(yaw=BIAS)                # รูปลงทะเบียนของเขา (ภาพไม่ถูกพลิก)
photo_neutral = lm.head_pose(registration)        # ค่าที่ main อ่านจากรูปแล้วส่งต่อ


def mirrored(points):
    """ภาพเดียวกันหลังกล้องพลิกซ้าย-ขวา (CAMERA_MIRROR) — พิกัด x กลายเป็น 1-x

    ต้องจำลองข้อนี้ให้ตรงกับของจริง เพราะรูปลงทะเบียน**ไม่ได้**ถูกพลิก แต่ภาพสด
    ถูกพลิก · การเทียบสองอย่างนี้โดยไม่แปลงคือบั๊กที่มองไม่เห็นจากหน้าจอ
    """
    return [P(1.0 - p.x, p.y) for p in points]


def track_with_neutral(neutral=photo_neutral):
    """track ที่ main ใส่ท่านิ่ง**ดิบจากรูป**ไว้ให้แล้ว (analyzer เป็นคนแปลงเอง)"""
    tk = FakeTrack()
    tk.state["neutral_pose"] = neutral
    return tk


live_straight = mirrored(registration)            # ภาพสดตอนเขามองตรง (กล้องพลิกแล้ว)
live_turned = mirrored(make_face(yaw=BIAS + 0.5))  # ภาพสดตอนเขาหันจริง ๆ

a_pn = az.FaceAnalyzer(CFG, mirror=True)
tk_pn = track_with_neutral()
# เฟรมแรกเลย ยังไม่มีเวลาให้ calibrate — ต้องวัดได้ทันที
first = a_pn.update([(tk_pn, fi(live_straight))], 700.0, 0.1, FRAME)[0]
s_pn = tk_pn.state["analyzer"]
check("มีท่านิ่งจากรูป → ใช้ได้ตั้งแต่เฟรมแรก ไม่ต้องรอ",
      s_pn.calibrated and not first.calibrating)
check("และบันทึกที่มาไว้ว่ามาจากรูป", s_pn.neutral_source == az.NEUTRAL_PHOTOS)
check("คนที่ bias เอียงแล้วมองตรง → ไม่ถูกนับว่าหันหน้า", first.direction is None,
      f"(yaw {first.yaw:+.4f})")
check("หักท่านิ่งออกแล้วเหลือเกือบศูนย์", abs(first.yaw) < 1e-9, f"({first.yaw:+.6f})")

# ของจริงที่ต้องได้: หันจริงยังนับได้ตามปกติ
t_pn = feed(a_pn, tk_pn, lambda _t: fi(live_turned), 1.0, 700.1)
check("หันหน้าจริง ๆ ยังนับได้ตามเดิม", sum(s_pn.window_dirs.values()) == 1,
      f"({s_pn.window_dirs})")

# ไม่พลิกภาพ = รูปกับภาพสดอยู่ในระบบพิกัดเดียวกัน ใช้ค่าจากรูปได้ตรง ๆ
a_nomirror = az.FaceAnalyzer(CFG, mirror=False)
tk_nomirror = track_with_neutral()
r_nm = a_nomirror.update([(tk_nomirror, fi(registration))], 710.0, 0.1, FRAME)[0]
check("ไม่พลิกภาพ → ใช้ค่าจากรูปตรง ๆ ก็ยังหักได้เป็นศูนย์", abs(r_nm.yaw) < 1e-9,
      f"({r_nm.yaw:+.6f})")

# ถ้าลืมกลับเครื่องหมายตอนพลิกภาพ จุดอ้างอิงจะเอียงผิดข้าง = เพี้ยนสองเท่าของ bias
a_wrong = az.FaceAnalyzer(CFG, mirror=True)
tk_wrong = track_with_neutral((-photo_neutral[0], photo_neutral[1]))   # เครื่องหมายผิด
r_ws = a_wrong.update([(tk_wrong, fi(live_straight))], 720.0, 0.1, FRAME)[0]
check("เครื่องหมายผิดข้าง → เพี้ยนเป็นสองเท่าของ bias (เทสนี้ยืนยันว่าการแปลงสำคัญจริง)",
      abs(r_ws.yaw) > 2 * BIAS - 1e-6, f"({r_ws.yaw:+.4f})")

# ชื่อมาช้ากว่าการ calibrate ได้ (ต้องรอลายเซ็นนิ่งก่อน) — ค่าจากรูปต้องชนะอยู่ดี
a_late = az.FaceAnalyzer(CFG, mirror=True)
tk_late = FakeTrack()
t_late = feed(a_late, tk_late, lambda _t: fi(mirrored(make_face(yaw=BIAS + 0.3))), 1.0, 800.0)
s_late = tk_late.state["analyzer"]
check("ยังไม่รู้ว่าเป็นใคร → calibrate สดไปก่อนตามเดิม",
      s_late.neutral_source == az.NEUTRAL_LIVE)
live_neutral = s_late.neutral_yaw
tk_late.state["neutral_pose"] = photo_neutral
a_late.update([(tk_late, fi(live_straight))], t_late, 0.1, FRAME)
check("พอรู้ชื่อทีหลัง → ค่าจากรูปทับค่าที่ calibrate สดไว้",
      s_late.neutral_source == az.NEUTRAL_PHOTOS and s_late.neutral_yaw != live_neutral,
      f"(สด {live_neutral:+.4f} → รูป {s_late.neutral_yaw:+.4f})")

# ชื่อที่เดาไว้ก่อนถูกแก้เป็นชื่อที่มั่นใจทีหลังได้ — จุดศูนย์ต้องย้ายตามชื่อ
# ไม่งั้นค่าของคนที่เดาผิดจะค้างอยู่ทั้งที่ระบบรู้แล้วว่าเป็นใคร
a_sw = az.FaceAnalyzer(CFG, mirror=True)
tk_sw = track_with_neutral()                      # ตอนแรกเดาว่าเป็นคนที่ bias +0.05
a_sw.update([(tk_sw, fi(live_straight))], 950.0, 0.1, FRAME)
s_sw = tk_sw.state["analyzer"]
guessed = s_sw.neutral_yaw
other = (photo_neutral[0] + 0.03, photo_neutral[1])       # คนละคน bias คนละค่า
tk_sw.state["neutral_pose"] = other
a_sw.update([(tk_sw, fi(live_straight))], 950.1, 0.1, FRAME)
check("ชื่อเปลี่ยน → จุดศูนย์ย้ายตามค่าของคนใหม่",
      s_sw.neutral_yaw != guessed and s_sw.neutral_source == az.NEUTRAL_PHOTOS,
      f"({guessed:+.4f} → {s_sw.neutral_yaw:+.4f})")
before_switch = s_sw.neutral_yaw
a_sw.update([(tk_sw, fi(live_straight))], 950.2, 0.1, FRAME)
check("ค่าเดิมซ้ำ → ไม่ทำงานซ้ำทุกเฟรม", s_sw.neutral_yaw == before_switch)

# ปุ่ม c ต้องมีผลจริงกับคนที่มีรูป ไม่งั้นค่าจากรูปจะถูกใส่กลับในเฟรมถัดไป
a_re = az.FaceAnalyzer(CFG, mirror=True)
tk_re = track_with_neutral()
a_re.update([(tk_re, fi(live_straight))], 900.0, 0.1, FRAME)
s_re = tk_re.state["analyzer"]
a_re.recalibrate([tk_re])
check("กด c → ทิ้งท่านิ่งจากรูป กลับไป calibrate สด",
      not s_re.calibrated and s_re.prefer_live)
t_re = feed(a_re, tk_re, lambda _t: fi(live_straight), 1.0, 900.1)
check("และค่าจากรูปต้องไม่แอบกลับมาทับอีก", s_re.neutral_source == az.NEUTRAL_LIVE)

# EAR ตาเปิดยังต้องเรียนจากภาพสด — รูปนิ่งใบเดียวเชื่อไม่ได้ (คนในรูปอาจกำลังกะพริบ)
a_ear = az.FaceAnalyzer(CFG, mirror=True)
tk_ear = track_with_neutral()
a_ear.update([(tk_ear, fi(live_straight))], 1000.0, 0.1, FRAME)
s_ear = tk_ear.state["analyzer"]
check("ได้ท่านิ่งจากรูปแล้ว แต่ EAR ยังไม่รู้", s_ear.calibrated and not s_ear.ear_ready)
feed(a_ear, tk_ear, lambda _t: fi(live_straight), 1.0, 1000.1)
check("เรียน EAR ตาเปิดจากภาพสดต่อจนครบ", s_ear.ear_ready and s_ear.ear_open is not None)
check("และการเรียน EAR ต้องไม่ไปทับท่านิ่งที่ได้จากรูป",
      s_ear.neutral_source == az.NEUTRAL_PHOTOS)

# วิธี matrix คิดเป็นองศา ส่วนค่าจากรูปเป็นสัดส่วน — ห้ามเอามาหักกัน
CFG_MATRIX = {**CFG, "pose": {**CFG["pose"], "method": "matrix"}}
a_mx = az.FaceAnalyzer(CFG_MATRIX, mirror=True)
tk_mx = track_with_neutral()
identity = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
r_mx = a_mx.update([(tk_mx, fi(live_straight, matrix=identity))], 1100.0, 0.1, FRAME)[0]
check("วิธี matrix ไม่รับค่าจากรูป (คนละหน่วย) → calibrate สดตามเดิม",
      r_mx.pose_method == az.POSE_MATRIX and not tk_mx.state["analyzer"].calibrated)

CFG_OFF = {**CFG, "pose": {**CFG["pose"], "neutral_from_photos": False}}
a_off = az.FaceAnalyzer(CFG_OFF, mirror=True)
tk_off = track_with_neutral()
a_off.update([(tk_off, fi(live_straight))], 1200.0, 0.1, FRAME)
check("ปิด POSE_NEUTRAL_FROM_PHOTOS → กลับไปพฤติกรรมเดิมทุกอย่าง",
      not tk_off.state["analyzer"].calibrated)

# ── 7. การกะพริบตา ──────────────────────────────────────
print("\n7. การกะพริบตา")
for label, blink_of in (
    ("blendshape", lambda closed: fi(make_face(), blink=0.9 if closed else 0.05)),
    ("EAR", lambda closed: fi(make_face(eye_open=0.05 if closed else 1.0))),
):
    a5 = az.FaceAnalyzer(CFG, mirror=True)
    tk = FakeTrack()
    t = feed(a5, tk, lambda _t: blink_of(False), 1.0, 500.0)
    s5 = tk.state["analyzer"]
    for _ in range(3):
        t = feed(a5, tk, lambda _t: blink_of(True), 0.3, t)
        t = feed(a5, tk, lambda _t: blink_of(False), 0.5, t)
    check(f"[{label}] นับการกะพริบได้ 3 ครั้ง", s5.window_blinks == 3, f"(ได้ {s5.window_blinks})")
    check(f"[{label}] ยังไม่ง่วง", not s5.drowsy)
    t = feed(a5, tk, lambda _t: blink_of(True), 2.0, t)
    check(f"[{label}] หลับตานาน → ง่วง", s5.drowsy)
    check(f"[{label}] การหลับตานานไม่นับเป็นกะพริบ", s5.window_blinks == 3)

a6 = az.FaceAnalyzer(CFG, mirror=True)
tk6 = FakeTrack()
res = a6.update([(tk6, fi(make_face(), blink=0.9))], 600.0, 0.1, FRAME)
check("มี blendshape → ใช้วิธี blendshape", res[0].blink_method == az.BLINK_BLENDSHAPE)
res = a6.update([(tk6, fi(make_face()))], 600.1, 0.1, FRAME)
check("ไม่มี blendshape → ถอยไปใช้ EAR", res[0].blink_method == az.BLINK_EAR)

# ── 8. tracker หลายคน ───────────────────────────────────
print("\n8. tracker หลายคน")
tk = PersonTracker(TRACKER_CFG)
xs = [0.1, 0.3, 0.5, 0.7, 0.9]
five = [det(make_face(cx=x, size=0.12)) for x in xs]
tracks = tk.assign(five, 0.0)
check("5 คนพร้อมกันได้ id ครบไม่ซ้ำ", len({t.person_id for t in tracks}) == 5)
moved = [det(make_face(cx=x + 0.01, size=0.12)) for x in xs]
again = tk.assign(moved, 0.1)
check("ขยับทีละนิด id คงเดิมทั้ง 5 คน",
      [t.person_id for t in tracks] == [t.person_id for t in again])
check("active_count = 5", tk.active_count == 5)

# คนเดินไขว้กัน — A ไปขวา B ไปซ้าย จนสลับตำแหน่งกัน
tk2 = PersonTracker(TRACKER_CFG)
a_x, b_x, tt = 0.35, 0.65, 0.0
first = tk2.assign([det(make_face(cx=a_x, size=0.14)), det(make_face(cx=b_x, size=0.14))], tt)
id_a, id_b = first[0].person_id, first[1].person_id
for _ in range(6):
    tt += 0.1
    a_x += 0.05
    b_x -= 0.05
    got = tk2.assign([det(make_face(cx=a_x, size=0.14)), det(make_face(cx=b_x, size=0.14))], tt)
check("คนเดินสวนกัน id ไม่สลับ",
      got[0].person_id == id_a and got[1].person_id == id_b,
      f"(ได้ {got[0].person_id},{got[1].person_id} คาดหวัง {id_a},{id_b})")

tk3 = PersonTracker(TRACKER_CFG)
tk3.assign([det(make_face(cx=0.5, size=0.2))], 0.0)
far = tk3.assign([det(make_face(cx=0.95, size=0.2))], 0.1)
check("กระโดดไกลเกิน max_distance = คนใหม่", far[0].person_id != 1)
tk3.assign([], 10.0)
check("หายไปนานเกิน forget_seconds → ลืม id", tk3.active_count == 0)

check("IoU กรอบเดียวกัน = 1", abs(iou((0, 0, 1, 1), (0, 0, 1, 1)) - 1.0) < 1e-9)
check("IoU กรอบไม่ทับกัน = 0", iou((0, 0, 0.4, 0.4), (0.6, 0.6, 1, 1)) == 0.0)

# ── 8b. คนขยับเยอะแล้ว id ไม่หลุด ───────────────────────
print("\n8b. คนขยับเยอะแล้ว id ไม่หลุด")

# ⚠️ นาฬิกาต้องเป็นของแต่ละคน ไม่ใช่เรือนเดียวใช้ร่วมกันทั้งเฟรม
# ของเดิมคิด dt จาก track ที่เพิ่งเห็นล่าสุด · คนที่นั่งนิ่งให้เห็นทุกเฟรมจึงกด dt
# ของ**ทุกคน**ให้เหลือหนึ่งเฟรม รวมถึงคนที่หายไปเป็นวินาที
tk_dt = PersonTracker(TRACKER_CFG)
sitter = det(make_face(cx=0.85, size=0.12))
walker0 = tk_dt.assign([det(make_face(cx=0.20, size=0.12)), sitter], 0.0)
walker_id = walker0[0].person_id
t_dt = 0.0
for _ in range(4):                       # คนเดินหายไป ส่วนคนนั่งยังเห็นอยู่ทุกเฟรม
    t_dt += 0.066
    tk_dt.assign([sitter], t_dt)
t_dt += 0.066
# กลับมาในระยะที่ห่างจากจุดเดิมพอสมควร — คนเดินจริงเดินได้เท่านี้ใน 0.33 วินาที
back = tk_dt.assign([det(make_face(cx=0.36, size=0.12)), sitter], t_dt)
check("คนที่หายไปหลายเฟรมกลับมาแล้วยังเป็น id เดิม แม้มีคนอื่นนั่งนิ่งอยู่ในเฟรม",
      back[0].person_id == walker_id,
      f"(ได้ {back[0].person_id} คาดหวัง {walker_id})")

# ทำนายไกลเกินขอบฟ้าไม่ได้ — คนที่หยุดเดินต้องไม่ถูกทำนายว่าไปไกลลิบ
tk_hz = PersonTracker({**TRACKER_CFG, "predict_horizon": 0.1})
tk_hz.assign([det(make_face(cx=0.30, size=0.12))], 0.0)
tk_hz.assign([det(make_face(cx=0.45, size=0.12))], 0.1)   # เดินขวาเร็ว 1.5/วินาที
stopped = tk_hz.assign([det(make_face(cx=0.46, size=0.12))], 2.0)  # แล้วหยุดยาว 1.9 วินาที
check("หยุดเดินตอนหายไป → ยังเป็นคนเดิม (ไม่ถูกทำนายว่าเดินต่อจนหลุดวง)",
      stopped[0].person_id == 1, f"(ได้ {stopped[0].person_id})")

_far = PersonTracker({**TRACKER_CFG, "predict_horizon": float("inf")})
_far.assign([det(make_face(cx=0.30, size=0.12))], 0.0)
_far.assign([det(make_face(cx=0.45, size=0.12))], 0.1)
check("ไม่จำกัดขอบฟ้า = พฤติกรรมเดิม (คนหยุดเดินกลายเป็นคนใหม่)",
      _far.assign([det(make_face(cx=0.46, size=0.12))], 2.0)[0].person_id != 1)

# กรอบที่เอาไปคิด IoU ต้องเลื่อนตามการทำนายด้วย ไม่งั้นขัดกับสัญญาณระยะทาง
_t = PersonTracker(TRACKER_CFG).assign([det(make_face(cx=0.4, size=0.12))], 0.0)[0]
_t.vx, _t.vy = 1.0, 0.0
x1, _y1, x2, _y2 = _t.box
px1, _py1, px2, _py2 = _t.predict_box(0.1)
check("predict_box เลื่อนกรอบตามความเร็ว ขนาดคงเดิม",
      abs(px1 - (x1 + 0.1)) < 1e-9 and abs((px2 - px1) - (x2 - x1)) < 1e-9)

# วงจับคู่: ค่า default ต้องไม่ขยาย (วัดแล้วว่าการขยายทำให้คนใหม่สวมรอย id คนเก่า)
_gate = PersonTracker(TRACKER_CFG)
check("ค่า default: วงไม่ขยายตามเวลาที่หายไป",
      _gate._gate(0.0) == _gate._gate(5.0) == TRACKER_CFG["max_distance"])
_grow = PersonTracker({**TRACKER_CFG, "gate_drift": 1.0, "max_gate": 0.6})
check("เปิด gate_drift แล้วขยายจริงและติดเพดาน",
      abs(_grow._gate(0.1) - 0.35) < 1e-9 and _grow._gate(10.0) == 0.6)

# ── 9. ลายเซ็นโครงหน้า ──────────────────────────────────
print("\n9. ลายเซ็นโครงหน้า")
sig_a = lm.face_signature(make_face(**PEOPLE["A"]))
check("ลายเซ็นมีครบ 8 มิติ", sig_a is not None and len(sig_a) == lm.SIGNATURE_DIMS)
check("ลายเซ็นไม่ขึ้นกับขนาดใบหน้า",
      lm.signature_distance(sig_a, lm.face_signature(make_face(size=0.6, **PEOPLE["A"]))) < 1e-6)
check("ลายเซ็นไม่ขึ้นกับตำแหน่งในภาพ",
      lm.signature_distance(sig_a, lm.face_signature(make_face(cx=0.9, cy=0.2, **PEOPLE["A"]))) < 1e-6)
check("ลายเซ็นไม่เปลี่ยนตอนกะพริบตา",
      lm.signature_distance(sig_a, lm.face_signature(make_face(eye_open=0.05, **PEOPLE["A"]))) < 1e-6)
d_ab = lm.signature_distance(sig_a, lm.face_signature(make_face(**PEOPLE["B"])))
d_ac = lm.signature_distance(sig_a, lm.face_signature(make_face(**PEOPLE["C"])))
check("คนละคนได้ระยะห่างเกิน threshold",
      d_ab > TRACKER_CFG["reid_threshold"] and d_ac > TRACKER_CFG["reid_threshold"],
      f"(A-B={d_ab:.3f} A-C={d_ac:.3f} threshold={TRACKER_CFG['reid_threshold']})")
check("ลายเซ็นความยาวไม่เท่ากันคืน inf",
      lm.signature_distance((1.0, 2.0), (1.0,)) == float("inf"))

# ── 10. re-identification ───────────────────────────────
print("\n10. re-identification")
FRAMES = TRACKER_CFG["reid_min_samples"] + 2
face_of = lambda who, size=0.3: make_face(cx=0.5, size=size, **PEOPLE[who])


def see(tk, who, t0, frames=FRAMES, size=0.3, step=0.1):
    """ให้ tracker เห็นคนคนหนึ่งต่อเนื่องหลายเฟรม คืน (track, เวลาสุดท้าย)"""
    t, track = t0, None
    for _ in range(frames):
        track = tk.assign([det(face_of(who, size))], t)[0]
        t += step
    return track, t


def leave(tk, t0):
    """คนออกจากเฟรมนานพอจนถูกย้ายไป lost"""
    t = t0 + TRACKER_CFG["forget_seconds"] + 1
    tk.assign([], t)
    return t


tkr = PersonTracker(TRACKER_CFG)
first, t = see(tkr, "A", 0.0)
id_a = first.person_id
check("ลายเซ็นยังไม่พร้อมตอนเห็นเฟรมเดียว",
      not PersonTracker(TRACKER_CFG).assign([det(face_of("A"))], 0.0)[0].signature_ready)
check("เห็นครบหลายเฟรมแล้วลายเซ็นพร้อม", first.signature_ready,
      f"(สะสม {first.signature_n} ตัวอย่าง ต้องการ {TRACKER_CFG['reid_min_samples']})")

t = leave(tkr, t)
check("ออกจากเฟรมแล้วย้ายไปกลุ่ม lost", tkr.active_count == 0 and tkr.lost_count == 1)

back, t = see(tkr, "A", t + 20.0)
check("คนเดิมกลับมาได้ id เดิม", back.person_id == id_a,
      f"(ได้ {back.person_id} คาดหวัง {id_a})")
check("นับ reid_hits", tkr.reid_hits == 1)
check("ไม่มีใครค้างในกลุ่ม lost", tkr.lost_count == 0)

t = leave(tkr, t)
newcomer, t = see(tkr, "B", t + 5.0)
check("คนใหม่ได้ id ใหม่ ไม่ใช่ id ของคนเดิม", newcomer.person_id != id_a)

# state เดิม (EAR baseline / ท่านิ่ง) ต้องกลับมาด้วย ไม่ต้อง calibrate ใหม่
tkr_s = PersonTracker(TRACKER_CFG)
tr_s, ts = see(tkr_s, "C", 0.0)
tr_s.state["analyzer"] = "STATE_เดิม"
ts = leave(tkr_s, ts)
revived, _ = see(tkr_s, "C", ts + 5.0)
check("คืน state เดิมมาด้วย ไม่ต้อง calibrate ใหม่",
      revived.state.get("analyzer") == "STATE_เดิม")

# ลืมเมื่อพ้นเวลาจำ
tkr2 = PersonTracker({**TRACKER_CFG, "reid_memory_seconds": 5.0})
tr2, t2 = see(tkr2, "A", 0.0)
old_id = tr2.person_id
t2 = leave(tkr2, t2)
tkr2.assign([], t2 + 10.0)
check("พ้นเวลาจำแล้วลืมลายเซ็น", tkr2.lost_count == 0)
after, _ = see(tkr2, "A", t2 + 11.0)
check("ลืมแล้วกลับมาได้ id ใหม่", after.person_id != old_id)

# ปิด re-ID แล้วต้องไม่จำ
tkr3 = PersonTracker({**TRACKER_CFG, "reid_enabled": False})
tr3, t3 = see(tkr3, "A", 0.0)
gone_id = tr3.person_id
t3 = leave(tkr3, t3)
check("ปิด re-ID แล้วไม่เก็บลายเซ็น", tkr3.lost_count == 0)
back3, _ = see(tkr3, "A", t3 + 1.0)
check("ปิด re-ID แล้วกลับมาได้ id ใหม่", back3.person_id != gone_id)

# ใบหน้าเล็กเกินไปไม่ถูกใช้เทียบ
tkr4 = PersonTracker(TRACKER_CFG)
tr4, t4 = see(tkr4, "A", 0.0)
kept = tr4.person_id
t4 = leave(tkr4, t4)
tiny, _ = see(tkr4, "A", t4 + 5.0, size=0.05)
check("ใบหน้าเล็กเกินไปไม่ถูก re-ID", tiny.person_id != kept)

# ratio test — สองคนที่หน้าคล้ายกันมากอยู่ในกลุ่ม lost พร้อมกัน ต้องไม่เดา
# จำลองสถานการณ์จริง เช่น พี่น้องหน้าคล้ายกัน หรือฝาแฝด
d_twin = lm.signature_distance(sig_a, lm.face_signature(make_face(**TWIN)))
check("สร้างคู่หน้าคล้ายกันได้จริง", d_twin < 0.02, f"(ห่างกัน {d_twin:.4f})")

tkr6 = PersonTracker(TRACKER_CFG)
t6 = 0.0
for _ in range(FRAMES):                                   # A กับฝาแฝดอยู่พร้อมกัน
    pair = tkr6.assign(
        [det(make_face(cx=0.25, size=0.3, **PEOPLE["A"])),
         det(make_face(cx=0.75, size=0.3, **TWIN))], t6)
    t6 += 0.1
known = {p.person_id for p in pair}
t6 = leave(tkr6, t6)
check("สองคนคล้ายกันอยู่ในกลุ่ม lost พร้อมกัน", tkr6.lost_count == 2,
      f"(ได้ {tkr6.lost_count})")

id_twin_a = pair[0].person_id
exact, _ = see(tkr6, "A", t6 + 1.0)
check("A กลับมาแบบตรงเป๊ะ → จำได้ถูกคนแม้มีฝาแฝดอยู่ในกลุ่ม lost",
      exact.person_id == id_twin_a,
      f"(ได้ {exact.person_id} คาดหวัง {id_twin_a})")

# หน้าที่อยู่ "กึ่งกลาง" ระหว่างสองคนที่จำไว้ — ห่างเท่า ๆ กันทั้งคู่ จึงเดาไม่ได้
MID = dict(aspect=1.305, eye_span=0.6225, mouth_span=0.4025)
mid_pts = make_face(cx=0.5, size=0.3, **MID)
d_to_a = lm.signature_distance(lm.face_signature(mid_pts), sig_a)
d_to_twin = lm.signature_distance(lm.face_signature(mid_pts), lm.face_signature(make_face(**TWIN)))
check("หน้ากึ่งกลางห่างจากทั้งสองคนพอ ๆ กัน",
      abs(d_to_a - d_to_twin) < 0.005, f"({d_to_a:.4f} vs {d_to_twin:.4f})")

tkr7 = PersonTracker(TRACKER_CFG)
t7 = 0.0
for _ in range(FRAMES):
    pair7 = tkr7.assign(
        [det(make_face(cx=0.25, size=0.3, **PEOPLE["A"])),
         det(make_face(cx=0.75, size=0.3, **TWIN))], t7)
    t7 += 0.1
known7 = {p.person_id for p in pair7}
t7 = leave(tkr7, t7)

t8 = t7 + 1.0
for _ in range(FRAMES):
    amb = tkr7.assign([det(make_face(cx=0.5, size=0.3, **MID))], t8)[0]
    t8 += 0.1
check("หน้ากำกวม → ไม่เดา แจก id ใหม่แทน",
      amb.person_id not in known7,
      f"(ได้ {amb.person_id} · id ที่จำไว้ {sorted(known7)})")

# ปิด ratio test แล้วต้องยอมเดา — ยืนยันว่า guard คือตัวที่กันไว้จริง
tkr8 = PersonTracker({**TRACKER_CFG, "reid_ratio": 1.0})
t9 = 0.0
for _ in range(FRAMES):
    pair8 = tkr8.assign(
        [det(make_face(cx=0.25, size=0.3, **PEOPLE["A"])),
         det(make_face(cx=0.75, size=0.3, **TWIN))], t9)
    t9 += 0.1
known8 = {p.person_id for p in pair8}
t9 = leave(tkr8, t9)
t10 = t9 + 1.0
for _ in range(FRAMES):
    guessed = tkr8.assign([det(make_face(cx=0.5, size=0.3, **MID))], t10)[0]
    t10 += 0.1
check("ปิด ratio test แล้วยอมเดา — ยืนยันว่า guard คือตัวที่กันไว้",
      guessed.person_id in known8, f"(ได้ {guessed.person_id})")

# provisional — id ชั่วคราวระหว่างรอตัดสินว่าเป็นคนเดิมหรือไม่
tkr9 = PersonTracker(TRACKER_CFG)
tr9, t9 = see(tkr9, "A", 0.0)
check("คนแรกของเซสชันไม่ provisional (ไม่มีใครให้เทียบ)", not tr9.provisional)
id9 = tr9.person_id
t9 = leave(tkr9, t9)

first_frame = tkr9.assign([det(face_of("A"))], t9 + 5.0)[0]
check("กลับเข้ามาเฟรมแรกได้ id ชั่วคราวและถูกทำเครื่องหมาย provisional",
      first_frame.provisional and first_frame.person_id != id9,
      f"(id={first_frame.person_id} provisional={first_frame.provisional})")

t10 = t9 + 5.1
for _ in range(FRAMES):
    settled = tkr9.assign([det(face_of("A"))], t10)[0]
    t10 += 0.1
check("สะสมพอแล้วกลายเป็น id เดิมและเลิก provisional",
      settled.person_id == id9 and not settled.provisional,
      f"(id={settled.person_id} provisional={settled.provisional})")

tkr10 = PersonTracker(TRACKER_CFG)
tr10, t11 = see(tkr10, "A", 0.0)
t11 = leave(tkr10, t11)
newp, t12 = see(tkr10, "B", t11 + 1.0)     # คนใหม่จริง ๆ ไม่เหมือนใครในกลุ่มที่จำไว้
check("คนใหม่จริงยัง provisional ระหว่างที่ยังลองเทียบอยู่", newp.provisional)

for _ in range(TRACKER_CFG["reid_max_attempts"] + 5):
    newp = tkr10.assign([det(face_of("B"))], t12)[0]
    t12 += 0.1
check("คนใหม่จริงเลิก provisional เมื่อลองครบแล้วไม่เข้ากับใคร",
      not newp.provisional and newp.person_id != tr10.person_id,
      f"(id={newp.person_id} provisional={newp.provisional})")

# ปุ่มลืมทันที
tkr5 = PersonTracker(TRACKER_CFG)
see(tkr5, "A", 0.0)
tkr5.forget_all()
check("forget_all ล้างทั้ง active และ lost",
      tkr5.active_count == 0 and tkr5.lost_count == 0)

# ── 11. หน้าต่างสรุป ─────────────────────────────────────
print("\n11. pop_window")
a7 = az.FaceAnalyzer(CFG, mirror=True)
tk7 = FakeTrack(pid=7)
t = feed(a7, tk7, lambda _t: fi(make_face()), 1.0, 700.0)
t = feed(a7, tk7, lambda _t: fi(make_face(yaw=0.5)), 1.0, t)
check("ยังไม่ครบเวลา → ยังไม่สรุป", a7.pop_window([tk7], t) is None)
summary = a7.pop_window([tk7], 700.0 + CFG["window"]["seconds"] + 1)
check("ครบเวลาแล้วได้สรุป", summary is not None)
if summary:
    check("person ตรงกับ track", summary.person == 7)
    check("movement นับได้ 1", summary.movement == 1, f"(ได้ {summary.movement})")
    check("direction ครบ 4 ทิศ", set(summary.direction) == set(az.DIRECTIONS))
    check("usable_faces ถูกนับ", summary.usable_faces == 1, f"(ได้ {summary.usable_faces})")
    check("to_focus_row มีคอลัมน์ครบตามตาราง focus",
          set(summary.to_focus_row())
          == {"person", "movement", "direction", "face_count", "name", "emotion",
              "posture", "posture_confident"})
    # None = "ไม่รู้" ไม่ใช่ "ไม่มี" — ไม่มีรูปในแกลเลอรีและยังไม่เห็นการแสดงออก
    # ปลายทางต้องแยกสองอย่างนี้ออกจากกันได้
    check("ยังไม่รู้ชื่อ/อารมณ์ → คอลัมน์เป็น None ไม่ใช่ค่าว่าง",
          summary.to_focus_row()["name"] is None
          and summary.to_focus_row()["emotion"] is None)
    # ไม่มีท่า = ไม่มีความมั่นใจให้รายงาน · ถ้าปล่อยให้เป็น true ตามค่าตั้งต้นของ
    # dataclass แถวที่ไม่เคยเห็นตัวคนจะดูเหมือนมี "ท่าที่วัดได้" อยู่ในฐานข้อมูล
    check("ไม่เห็นร่างกาย → posture เป็น None และไม่มีธงความมั่นใจ",
          summary.to_focus_row()["posture"] is None
          and summary.to_focus_row()["posture_confident"] is None)
    check("ตัวนับถูกรีเซ็ต", sum(tk7.state["analyzer"].window_dirs.values()) == 0)

# ท่าที่ main.py เก็บไว้ใน track.state ต้องไปโผล่ในแถวที่ส่งขึ้นตาราง
# (แดชบอร์ดอ่านคอลัมน์นี้ — ถ้าขาดไป หน้าเว็บจะขึ้น "--" โดยไม่มีอะไรบอกว่าทำไม)
a8 = az.FaceAnalyzer(CFG, mirror=True)
tk8 = FakeTrack(pid=8)
tk8.state["posture"] = "sitting"
tk8.state["posture_confident"] = False
t8 = feed(a8, tk8, lambda _t: fi(make_face()), 1.0, 900.0)
feed(a8, tk8, lambda _t: fi(make_face(yaw=0.5)), 1.0, t8)
row8 = a8.pop_window([tk8], 900.0 + CFG["window"]["seconds"] + 1)
check("ท่าจาก track.state ไปถึงแถวที่ส่ง",
      row8 is not None and row8.to_focus_row()["posture"] == "sitting")
# ธงนี้คือสิ่งเดียวที่แยก "วัดมุมต้นขาได้จริง" ออกจาก "เดาเพราะขาถูกโต๊ะบัง"
# หายไปเมื่อไร ปลายทางจะนับท่าที่เดาไว้รวมกับท่าที่วัดได้โดยไม่รู้ตัว
check("ท่าที่ยังไม่มั่นใจถูกทำเครื่องหมายไว้ ไม่ใช่ส่งไปเหมือนท่าที่วัดได้",
      row8 is not None and row8.to_focus_row()["posture_confident"] is False)

# ── 12. โหมดการทำงาน ────────────────────────────────────
print("\n12. โหมดการทำงาน")
room, person = modes.get("room"), modes.get("person")
check("โหมดห้องรวมไม่คำนวณลายเซ็นและไม่ทำ re-ID",
      not room.signatures and not room.reid)
check("โหมดห้องรวมไม่รายงาน id รายคน", not room.report_person)
check("โหมดห้องรวมไม่วัดตา", not room.eyes)
check("โหมดรายบุคคลยังทำ re-ID และวัดตาได้ตามเดิม",
      person.signatures and person.reid and person.eyes)

base_tracker = dict(TRACKER_CFG)
room_tracker = room.apply_to_tracker(base_tracker)
check("โหมดห้องรวมปิด reid_enabled ให้อัตโนมัติ", room_tracker["reid_enabled"] is False)
check("apply_to_tracker ไม่แก้ dict เดิม", base_tracker["reid_enabled"] is True)
check("โหมดรายบุคคลไม่แตะค่า reid", person.apply_to_tracker(base_tracker)["reid_enabled"] is True)

known = modes.get("known")
check("โหมดเฉพาะคนในรูปอ่านแกลเลอรีและรายงานเฉพาะคนที่รู้จัก",
      known.gallery and known.known_only)
check("โหมดเฉพาะคนในรูปไม่ทำ re-ID (ไม่สะสม pool ของคนแปลกหน้า)", not known.reid)
check("โหมดห้องรวมไม่อ่านแกลเลอรีรูปเลย", not room.gallery)
check("โหมดรายบุคคลอ่านแกลเลอรีได้ แต่ไม่จำกัดเฉพาะคนที่รู้จัก",
      person.gallery and not person.known_only)

# ⚠️ กับดักที่ทำให้โหมดนี้ "เงียบสนิท" ได้: การเฉลี่ยลายเซ็นข้ามเฟรมเคยผูกอยู่กับ
# reid_enabled ตัวเดียว ถ้ายังผูกอยู่ โหมด known (reid=False) จะไม่มีลายเซ็นให้เทียบ
# กับรูปเลย → ไม่มีใครถูกจำ โดยไม่มี error ให้เห็น
known_tracker = known.apply_to_tracker(base_tracker)
check("โหมดเฉพาะคนในรูปยังเฉลี่ยลายเซ็นเพื่อเทียบกับรูป",
      known_tracker["learn_signatures"] is True)
check("แต่ปิดการจำคนที่ออกจากเฟรม", known_tracker["reid_enabled"] is False)
check("โหมดห้องรวมไม่เฉลี่ยลายเซ็นเลย",
      room.apply_to_tracker(base_tracker)["learn_signatures"] is False)

# ต้องเป็นจริงในตัว tracker เอง ไม่ใช่แค่ในค่าตั้ง
tkr_known = PersonTracker(known_tracker)
tk_t = 0.0
for _ in range(TRACKER_CFG["reid_min_samples"] + 5):
    tk_known = tkr_known.assign([det(face_of("A"))], tk_t)[0]
    tk_t += 0.1
check("tracker เรียนลายเซ็นจริงแม้ปิด re-ID",
      tk_known.signature_ready and tk_known.signature_n > 1,
      f"(n={tk_known.signature_n})")
check("ปิด re-ID แล้วไม่มีใครถูกเก็บไว้ในกลุ่มที่จำ", tkr_known.lost_count == 0)

# การรายงาน: คนที่ไม่มีชื่อต้องไม่โผล่ในสรุป และต้องไม่ถูกนับรวมเข้าแถวของคนที่มีชื่อ
a_known = az.FaceAnalyzer(CFG, mirror=True, known_only=True)
named, stranger = FakeTrack(pid=11), FakeTrack(pid=12)
named.state["name"] = "Ann"
tk = 900.0
for track in (named, stranger):
    tk_end = feed(a_known, track, lambda _t: fi(make_face()), 1.0, tk)
# คนแปลกหน้าหันหน้าไปมา ส่วนคนที่มีชื่อนั่งนิ่ง
feed(a_known, named, lambda _t: fi(make_face()), 1.0, tk_end)
feed(a_known, stranger, lambda _t: fi(make_face(yaw=0.5)), 1.0, tk_end)
sum_known = a_known.pop_window([named, stranger], tk + CFG["window"]["seconds"] + 1)
check("รายงานคนที่จับคู่รูปได้เท่านั้น",
      sum_known is not None and sum_known.person == 11 and sum_known.name == "Ann",
      f"(person={sum_known.person if sum_known else None})")
check("การหันหน้าของคนแปลกหน้าไม่ถูกนับเข้าแถวของคนที่มีชื่อ",
      sum_known is not None and sum_known.movement == 0,
      f"(movement={sum_known.movement if sum_known else None})")

# ไม่มีใครรู้จักในหน้าต่างนั้น = ไม่มีอะไรให้รายงาน (main.py ใช้เงื่อนไขนี้ตัดสินว่าจะไม่ส่ง)
a_none = az.FaceAnalyzer(CFG, mirror=True, known_only=True)
lone = FakeTrack(pid=13)
feed(a_none, lone, lambda _t: fi(make_face()), 1.0, 1000.0)
sum_none = a_none.pop_window([lone], 1000.0 + CFG["window"]["seconds"] + 1)
check("ไม่มีคนที่รู้จักเลย → person/name ว่าง ไม่ใช่ของคนแปลกหน้า",
      sum_none is not None and sum_none.person is None and sum_none.name is None)
check("โหมดรายบุคคลยังรายงานคนที่ไม่มีชื่อได้ตามเดิม",
      az.FaceAnalyzer(CFG, mirror=True).known_only is False)

check("ชื่อโหมดที่ไม่รู้จักต้อง error ไม่ใช่เดาให้", _raises(lambda: modes.get("ห้อง")))
check("เลือกด้วยเลขข้อได้", modes.parse_choice("1").key == modes.ORDER[0])
check("เลือกด้วยชื่อได้", modes.parse_choice("PERSON ").key == "person")
check("กด Enter เฉย ๆ ได้ค่าเริ่มต้น", modes.parse_choice("").key == modes.DEFAULT)
check("พิมพ์มั่วคืน None เพื่อให้ถามซ้ำ", modes.parse_choice("9") is None)
check("เมนูพูดถึงทุกโหมดที่อยู่ในเมนู",
      all(any(modes.MODES[k].label in line for line in modes.menu_lines()) for k in modes.ORDER))

# ── โหมดติดตามกิจกรรมเข้ามาแทนข้อ 1 ────────────────────
# ห้องรวมถูกถอดออกจาก**เมนู** ไม่ใช่ถูกลบ — สองอย่างนี้ต่างกัน และข้อที่ตามมาคือ
# ตัวกันไม่ให้การถอดออกจากเมนูกลายเป็นการลบทิ้งโดยไม่มีใครสังเกต
check("เมนูข้อ 1 คือโหมดติดตามกิจกรรม", modes.ORDER[0] == modes.ACTIVITY)
check("ห้องรวมไม่อยู่ในเมนูแล้ว", modes.ROOM not in modes.ORDER)
check("ห้องรวมยังเรียกใช้ได้อยู่", modes.get("room").key == modes.ROOM)
check("ห้องรวมยังอยู่ใน ALL ให้ --mode ใช้ได้", modes.ROOM in modes.ALL)
check("พิมพ์ room ที่หน้าเมนูยังได้ ทั้งที่ไม่มีข้อให้กด",
      modes.parse_choice("room").key == modes.ROOM)
check("เมนูบอกว่ายังมีโหมดที่ไม่อยู่ในลิสต์",
      any(modes.ROOM in line for line in modes.menu_lines()))
check("ข้อความ error บอกครบทุกโหมดรวมที่ไม่อยู่ในเมนู",
      _raises(lambda: modes.get("ห้อง")) and modes.ROOM in _error_text(lambda: modes.get("ห้อง")))

# ธงความสามารถใหม่ต้องปิดสนิทในโหมดเดิม ไม่งั้นของใหม่จะรั่วเข้าไปเปลี่ยนพฤติกรรมเดิม
NEW_FLAGS = ("full_range", "roi_zoom", "activity", "zoom_panel")
check("โหมดเดิมทั้งสามไม่มีธงใหม่เปิดเลย",
      all(not getattr(modes.MODES[k], f)
          for k in (modes.ROOM, modes.PERSON, modes.KNOWN) for f in NEW_FLAGS))
check("โหมดติดตามกิจกรรมเปิดธงใหม่ครบ",
      all(getattr(modes.MODES[modes.ACTIVITY], f) for f in NEW_FLAGS))

# ── การซูมต้องมาพร้อมการลดเกณฑ์ขนาดใบหน้า ──────────────
# ซูมแล้วได้ landmark ดีของคนไกล แต่ถ้าเกณฑ์ยังเป็นของเดิม landmark นั้นจะถูกทิ้ง
# ที่ประตูบานเดิม และการซูมจะไม่ให้ประโยชน์อะไรเลย — ข้อนี้กันไม่ให้หลุด
_zoom = modes.MODES[modes.ACTIVITY]
_plain = modes.MODES[modes.PERSON]
check("โหมดที่ซูม ลดเกณฑ์ขนาดใบหน้าของ tracker ลง",
      _zoom.apply_to_tracker(TRACKER_CFG)["reid_min_size"]
      < _plain.apply_to_tracker(TRACKER_CFG)["reid_min_size"])
_faces_cfg = {"min_size": 0.12}
check("โหมดที่ซูม ลดเกณฑ์ขนาดใบหน้าของแกลเลอรีลงด้วย",
      _zoom.apply_to_faces(_faces_cfg)["min_size"] < 0.12)
check("โหมดที่ไม่ซูม เกณฑ์ต้องไม่ถูกแตะ",
      _plain.apply_to_faces(_faces_cfg)["min_size"] == 0.12
      and _plain.apply_to_tracker(TRACKER_CFG)["reid_min_size"]
      == TRACKER_CFG["reid_min_size"])
check("apply_to_faces ไม่แก้ dict เดิม", _faces_cfg["min_size"] == 0.12)
# เกณฑ์ที่ตั้งไว้เข้มกว่าค่าของโหมดซูมอยู่แล้ว ต้องไม่ถูกทำให้หลวมขึ้น
check("ค่าที่เข้มกว่าอยู่แล้วต้องไม่ถูกผ่อนให้หลวมลง",
      _zoom.apply_to_faces({"min_size": 0.01})["min_size"] == 0.01)
# ตัวตนมาจากโฟลเดอร์ faces/ เท่านั้น — ไม่แจกหมายเลขให้ใครใหม่
_act = modes.MODES[modes.ACTIVITY]
check("โหมดติดตามกิจกรรมรู้จักเฉพาะคนที่มีรูป", _act.known_only and _act.gallery)
check("ไม่เก็บ pool ลายเซ็นของคนที่ไม่มีรูปไว้จำ", _act.reid is False)
check("แต่ยังเฉลี่ยลายเซ็นข้ามเฟรมเพื่อเทียบกับรูป",
      _act.signatures and _act.apply_to_tracker(TRACKER_CFG)["learn_signatures"] is True)
if main is not None:
    check("ยังไม่มีชื่อ → ไม่ขึ้นหมายเลขในโหมดที่รู้จักเฉพาะคนในรูป",
          "#" not in main._who(_R(name=None, person_id=7), known_only=True))
    check("...และไม่ประกาศว่า unknown ทั้งที่ยังหาไม่เสร็จ",
          "unknown" not in main._who(_R(name=None, person_id=7), known_only=True))
    check("โหมดอื่นยังขึ้นหมายเลขตามเดิม",
          main._who(_R(name=None, person_id=7), known_only=False) == "#7")
    check("มีรูปแล้วขึ้นชื่อ", main._who(_R(name="Ann"), known_only=True) == "Ann")
    check("ชื่อที่ยังไม่มั่นใจมี ? ต่อท้าย",
          main._who(_R(name="Ann", name_confident=False), known_only=True) == "Ann?")

# ลำดับความสำคัญของการเลือกโหมด
if main is None:
    print("  skip ลำดับความสำคัญของโหมด — ไม่มี cv2/mediapipe ในเครื่องนี้")
else:
    check("flag ชนะทุกอย่าง", main.resolve_mode("person", "room").key == "person")
    check("VISION_MODE ใช้เมื่อไม่มี flag", main.resolve_mode(None, "person").key == "person")
    # ทางที่ไม่มีใครเลือกต้องไม่ตกไปที่โหมดที่จำหน้า แม้เมนูข้อ 1 จะเป็นโหมดนั้น
    check("ไม่มี TTY ไม่ค้างรอ input",
          main.resolve_mode(None, "", stream=io.StringIO()).key == modes.HEADLESS_DEFAULT)
    check("ไม่มี TTY ต้องไม่ได้โหมดที่จำหน้าโดยไม่มีใครเลือก",
          not main.resolve_mode(None, "", stream=io.StringIO()).signatures)
    check("--mode room ยังสั่งได้", main.resolve_mode("room", "").key == modes.ROOM)

# ── 12b. เลือกกล้องก่อนเปิดโปรแกรม ──────────────────────
print("\n12b. เลือกกล้องก่อนเปิดโปรแกรม")
if main is None:
    print("  skip — ไม่มี cv2/mediapipe ในเครื่องนี้")
else:
    CAMS = [
        {"source": "csi", "index": None, "label": "CSI camera"},
        {"source": "usb", "index": 0, "label": "USB camera 0", "current": True},
        {"source": "usb", "index": 2, "label": "USB camera 2"},
    ]
    BASE_CAM = {"source": "auto", "usb_index": "0", "width": 640}

    class Tty(io.StringIO):
        """stdin ปลอมที่อ้างว่าเป็น TTY — ตัวเลือกจะถามเฉพาะเมื่อมีคนตอบได้"""

        def isatty(self):
            return True

    def pick(answers, cams=CAMS, cfg=None):
        """ตอบคำถามด้วยบรรทัดที่กำหนด แล้วคืน cam_cfg ที่ได้"""
        import builtins

        replies = list(answers)
        real_input = builtins.input
        builtins.input = lambda *_a: replies.pop(0)
        try:
            return main.choose_camera(cfg or BASE_CAM, scan=lambda c: cams, stream=Tty())
        finally:
            builtins.input = real_input

    picked = pick(["3"])
    check("เลือกข้อ 3 → ได้ USB index 2",
          picked["source"] == "usb" and picked["usb_index"] == "2", f"({picked})")
    check("ค่าอื่นใน cam_cfg ไม่ถูกแตะ", picked["width"] == 640)
    check("ไม่แก้ dict เดิม", BASE_CAM["source"] == "auto")

    check("เลือก CSI → ไม่ยัด usb_index ให้",
          pick(["1"])["source"] == "csi" and pick(["1"])["usb_index"] == "0")
    check("กด Enter เฉย ๆ = ตัวแรกในรายการ", pick([""])["source"] == "csi")
    check("พิมพ์มั่วแล้วถามซ้ำ ไม่ใช่เดาให้", pick(["ก", "9", "2"])["usb_index"] == "0")

    # ไม่มีใครตอบได้ = ต้องไม่ค้าง · นี่คือกรณี systemd/cron ซึ่งจะทำให้บริการไม่ขึ้นเลย
    quiet = main.choose_camera(BASE_CAM, scan=lambda c: CAMS, stream=io.StringIO())
    check("ไม่มี TTY → ไม่ถาม ใช้ค่าใน .env", quiet == BASE_CAM)

    one = main.choose_camera(BASE_CAM, scan=lambda c: [CAMS[2]], stream=Tty())
    check("เจอกล้องตัวเดียว → ไม่ถาม เลือกให้เลย", one["usb_index"] == "2", f"({one})")

    none_found = main.choose_camera(BASE_CAM, scan=lambda c: [], stream=Tty())
    check("ไม่เจอกล้องเลย → ไม่ถาม ปล่อยให้ Camera.open รายงานปัญหาจริง",
          none_found == BASE_CAM)

    def boom(_cfg):
        raise OSError("v4l2 หาย")

    check("การสำรวจล้มเหลว → ไม่ทำให้เปิดโปรแกรมไม่ได้",
          main.choose_camera(BASE_CAM, scan=boom, stream=Tty()) == BASE_CAM)

    pinned = dict(BASE_CAM, usb_name="c922")
    check("ปักชื่อกล้องไว้แล้ว → ไม่ถามซ้ำแม้มี TTY",
          main.choose_camera(pinned, scan=lambda c: CAMS, stream=Tty()) == pinned)

# ── 12c. เลือกกล้องด้วยชื่อรุ่นและ backend ───────────────
print("\n12c. เลือกกล้องด้วยชื่อรุ่นและ backend")
if main is None:
    print("  skip — ไม่มี cv2/mediapipe ในเครื่องนี้")
else:
    import cv2

    import camera as cam_mod

    FAKE_DEVS = [(0, "Integrated Camera"), (1, "c922 Pro Stream Webcam"),
                 (2, "Xiaomi 13T (Windows Virtual Camera)")]

    def with_devices(devices, fn):
        """แทนที่การสำรวจกล้องชั่วคราว — เทสต์ต้องรันได้บนเครื่องที่ไม่มีกล้อง"""
        real = cam_mod.capture_devices
        cam_mod.capture_devices = lambda: list(devices)
        try:
            return fn()
        finally:
            cam_mod.capture_devices = real

    check("หาชื่อแบบไม่สนตัวพิมพ์และไม่ต้องพิมพ์เต็ม",
          with_devices(FAKE_DEVS, lambda: cam_mod.find_by_name("C922")) == (1, FAKE_DEVS[1][1]))
    check("ชื่อที่ไม่มีจริง → None ไม่ใช่เดาตัวที่ใกล้เคียง",
          with_devices(FAKE_DEVS, lambda: cam_mod.find_by_name("brio")) is None)
    check("ชื่อว่าง → ไม่ค้นหา (ใช้ index ตามเดิม)",
          with_devices(FAKE_DEVS, lambda: cam_mod.find_by_name("  ")) is None)

    def pick_device(cfg):
        backend = cam_mod.OpenCVBackend(cfg)
        return with_devices(FAKE_DEVS, backend._pick)

    base_usb = {"source": "usb", "usb_index": "0", "usb_name": "", "api": "auto",
                "width": 640, "height": 480, "fps": 15, "fourcc": ""}
    check("ไม่ตั้งชื่อ → ใช้ index และได้ชื่อรุ่นติดมาด้วย",
          pick_device(dict(base_usb)) == (0, "Integrated Camera"))
    check("ตั้งชื่อ → ชนะ index ที่ตั้งไว้",
          pick_device(dict(base_usb, usb_name="c922")) == (1, "c922 Pro Stream Webcam"))

    try:
        pick_device(dict(base_usb, usb_name="brio"))
        found_name = False
    except cam_mod.CameraError as exc:
        # ต้องฟ้อง ไม่ใช่ถอยไปเปิด index 0 เงียบ ๆ — และต้องบอกด้วยว่าเจออะไรบ้าง
        found_name = "c922 Pro Stream Webcam" in str(exc)
    check("ตั้งชื่อแล้วหาไม่เจอ → ฟ้องพร้อมรายชื่อที่เจอ ไม่ใช่เปิดกล้องอื่นให้", found_name)

    check("Linux/Pi ปล่อยให้ OpenCV เลือก backend เอง",
          cam_mod.resolve_api("auto")[0] in ("dshow", "any"))
    check("ระบุ backend มาเองต้องได้ตามนั้น", cam_mod.resolve_api("msmf")[0] == "msmf")
    check("backend ที่ไม่รู้จัก → ไม่ระเบิด ถอยไปให้ OpenCV เลือก",
          cam_mod.resolve_api("ห่วย")[1] == cv2.CAP_ANY)

    # ── ชัตเตอร์: ตั้งเองเพื่อลดภาพเบลอตอนคนขยับ ──
    class FakeCap:
        """จด cap.set() ที่ถูกเรียก ตามลำดับ — ลำดับสำคัญกับ auto exposure"""

        def __init__(self):
            self.sets = []

        def set(self, prop, value):
            self.sets.append((prop, value))
            return True

    def sets_of(**over):
        backend = cam_mod.OpenCVBackend(dict(base_usb, **over))
        cap = FakeCap()
        backend._apply_exposure(cap)
        return cap.sets

    check("ไม่ตั้งค่าชัตเตอร์ → ไม่ไปยุ่งกับกล้องเลย ปล่อยให้มันปรับเอง",
          sets_of() == [])
    exposure_sets = sets_of(exposure="-7", gain="255")
    check("ตั้งชัตเตอร์ → ปิด auto ก่อนเสมอ ไม่งั้นกล้องทับค่ากลับทันที",
          exposure_sets[0] == (cv2.CAP_PROP_AUTO_EXPOSURE, cam_mod.MANUAL_EXPOSURE)
          and exposure_sets[1] == (cv2.CAP_PROP_EXPOSURE, -7.0),
          f"({exposure_sets})")
    check("ตั้ง gain ด้วยได้", (cv2.CAP_PROP_GAIN, 255.0) in exposure_sets)
    check("ตั้ง gain อย่างเดียว → ไม่ไปแตะ auto exposure",
          sets_of(gain="128") == [(cv2.CAP_PROP_GAIN, 128.0)])

    # ── เลือกโหมดภาพจากที่ฮาร์ดแวร์บอกว่ารองรับ ──
    # รายการจริงจาก Logitech C922 (ตัดมาบางส่วน) — (กว้าง, สูง, fps, รหัสภาพ)
    C922 = [
        (2304, 1296, 2.0, "YUY2"), (1920, 1080, 5.0, "YUY2"), (1920, 1080, 30.0, "MJPG"),
        (1280, 720, 10.0, "YUY2"), (1280, 720, 30.0, "MJPG"),
        (1024, 576, 15.0, "YUY2"), (960, 720, 15.0, "YUY2"),
        (864, 480, 24.0, "YUY2"), (800, 600, 24.0, "YUY2"), (800, 448, 30.0, "YUY2"),
        (640, 480, 30.0, "YUY2"), (640, 360, 30.0, "YUY2"), (320, 240, 30.0, "YUY2"),
    ]
    pick = lambda fps, cap=1280: cam_mod.best_mode(C922, fps, cap)

    check("ขอ 20fps → ได้โหมด 16:9 ที่ใหญ่สุดที่ทำได้ (864x480)", pick(20) == (864, 480))
    check("ขอ 15fps → ได้ภาพใหญ่ขึ้นเพราะเกณฑ์หลวมลง", pick(15) == (1024, 576))
    check("ขอ 30fps → ยอมได้ภาพเล็กลงเพื่อความเร็ว", pick(30) == (800, 448))
    check("เพดานความกว้างคุมไม่ให้คว้าโหมดใหญ่เกิน", pick(20, 640) == (640, 360))
    check("ไม่มีโหมดไหนทำได้ → None ไม่ใช่เดาให้", pick(99) is None)

    # ⚠️ หัวใจของการเลือก: 800x600 (4:3) มีพิกเซลมากกว่า 864x480 (16:9) และเร็วเท่ากัน
    # แต่ 4:3 บนเซนเซอร์ 16:9 คือภาพที่ถูกตัดขอบข้างทิ้ง — เลือกพิกเซลแล้วเสียมุมมอง
    check("โหมด 4:3 ที่พิกเซลเยอะกว่าต้องแพ้โหมด 16:9 (4:3 = ภาพที่ถูกตัดขอบ)",
          pick(24) == (864, 480), f"(ได้ {pick(24)})")

    # MJPG บอกว่าทำ 30fps ที่ 1080p ได้ แต่ OpenCV สั่งกล้องเปลี่ยนรหัสภาพไม่สำเร็จ
    # (วัดแล้วที่ 1280x720: ตั้ง MJPG หรือไม่ตั้งก็ได้ 10fps เท่ากัน) เชื่อไม่ได้
    check("ไม่เอาความเร็วของโหมดบีบอัดมาคิด เพราะสั่งใช้จริงไม่ได้",
          pick(30) != (1920, 1080) and pick(30) != (1280, 720))

    check("รายการว่าง → None", cam_mod.best_mode([], 15, 1280) is None)
    check("มีแต่โหมด 4:3 ก็ต้องเลือกได้ ไม่ใช่ยอมแพ้",
          cam_mod.best_mode([(640, 480, 30.0, "YUY2")], 15, 1280) == (640, 480))

    # เลือกกล้องจากเมนูขณะรัน = ผู้ใช้ชี้ด้วยมือ · ชื่อที่ปักไว้ต้องไม่ลากกลับไปตัวเดิม
    class FakeBackend(cam_mod.CameraBackend):
        name = "usb"

        def open(self):
            self.label, self.actual = "fake", (640, 480)

        def close(self):
            pass

    real_backends = dict(cam_mod.BACKENDS)
    cam_mod.BACKENDS["usb"] = FakeBackend
    try:
        cam = cam_mod.Camera(dict(base_usb, usb_name="c922"))
        cam.open()
        cam.switch("usb", 2)
        check("สลับกล้องจากเมนู → ล้าง usb_name ที่ปักไว้", cam.cfg["usb_name"] == "")
        check("สลับกล้องจากเมนู → ใช้ index ที่เลือก", cam.cfg["usb_index"] == "2")

        # เปลี่ยนความละเอียดขณะรัน — ต้องปิดโหมดเลือกอัตโนมัติ ไม่งั้น _size()
        # จะลากกลับไปโหมดที่มันคิดว่าดีที่สุดทันทีที่เปิดใหม่ แล้วปุ่มดูเหมือนกดไม่ติด
        cam_auto = cam_mod.Camera(dict(base_usb, auto_size=True))
        cam_auto.open()
        cam_auto.resize(1280, 720)
        check("เปลี่ยนความละเอียดเอง → ปิด auto_size", cam_auto.cfg["auto_size"] is False)
        check("เปลี่ยนความละเอียดเอง → cfg ตามที่เลือก",
              (cam_auto.cfg["width"], cam_auto.cfg["height"]) == (1280, 720))

        # เปิดโหมดใหม่ไม่ได้ = ต้องกลับไปโหมดเดิมที่ใช้ได้ ไม่ใช่ปล่อยกล้องดับ
        class PickyBackend(FakeBackend):
            def open(self):
                if self.cfg["width"] == 9999:
                    raise cam_mod.CameraError("โหมดนี้เปิดไม่ได้")
                super().open()

        cam_mod.BACKENDS["usb"] = PickyBackend
        cam_back = cam_mod.Camera(dict(base_usb, width=800, height=600))
        cam_back.open()
        try:
            cam_back.resize(9999, 9999)
            rolled = False
        except cam_mod.CameraError:
            rolled = (cam_back.cfg["width"], cam_back.cfg["height"]) == (800, 600)
        check("เปิดโหมดใหม่ไม่ได้ → ถอยกลับโหมดเดิมแล้วค่อยฟ้อง", rolled)
        check("ถอยกลับแล้วกล้องยังเปิดอยู่ ไม่ได้ค้างดับ", cam_back.backend is not None)
    finally:
        cam_mod.BACKENDS.clear()
        cam_mod.BACKENDS.update(real_backends)

# ── 12d. ปุ่มลัดเปลี่ยนความละเอียด ───────────────────────
print("\n12d. ปุ่มลัดเปลี่ยนความละเอียด")
if main is None:
    print("  skip — ไม่มี cv2/mediapipe ในเครื่องนี้")
else:
    # รายการจริงจาก C922 เรียงจากใหญ่ไปเล็กเหมือนที่ Camera.sizes() คืนมา
    SIZES = [(2304, 1536, 2.0), (2304, 1296, 2.0), (1920, 1080, 5.0), (1600, 896, 8.0),
             (1280, 720, 10.0), (960, 720, 15.0), (1024, 576, 15.0), (800, 600, 24.0),
             (864, 480, 24.0), (800, 448, 30.0), (640, 480, 30.0), (640, 360, 30.0),
             (432, 240, 30.0), (320, 240, 30.0)]

    class FakeCam:
        def __init__(self, sizes=None, fail=False):
            self.actual = (864, 480)
            self.asked = []
            self._sizes = SIZES if sizes is None else sizes
            self._fail = fail

        def sizes(self):
            return list(self._sizes)

        def resize(self, w, h):
            self.asked.append((w, h))
            if self._fail:
                raise main.CameraError("เปิดไม่ได้")
            self.actual = (w, h)
            return self.actual

    def opened_menu(cam):
        menu = main.ResolutionMenu()
        menu.handle(main.KEY_RESOLUTION, cam)
        return menu

    m = opened_menu(FakeCam())
    check("กด r แล้วเมนูเปิด", m.open)
    check("ตัดโหมดที่ช้าเกินใช้งานทิ้ง (ไม่มีอะไรต่ำกว่า 10fps)",
          all(f >= main.ResolutionMenu.MIN_FPS for _w, _h, f in m.sizes))
    check("โหมดยักษ์ที่วิ่ง 2fps ต้องไม่กินช่องจนโหมดที่ใช้ได้หลุดรายการ",
          (640, 360) in [(w, h) for w, h, _f in m.sizes], f"({m.sizes})")
    check("แสดงไม่เกินจำนวนปุ่มตัวเลขที่มี", len(m.sizes) <= len(main.ResolutionMenu.DIGITS))

    cam = FakeCam()
    m = opened_menu(cam)
    want = m.sizes[2][:2]
    check("กดเลข 3 → สั่งเปลี่ยนเป็นโหมดที่สาม",
          m.handle(ord("3"), cam) and cam.asked == [want], f"({cam.asked})")
    check("เปลี่ยนสำเร็จ → เมนูปิดเอง", not m.open)

    cam2 = FakeCam()
    m2 = opened_menu(cam2)
    check("กดเลขที่เกินรายการ → ไม่ทำอะไร ไม่ระเบิด",
          m2.handle(ord("9"), cam2) is True and cam2.asked in ([], [m2.sizes[8][:2]]))

    m3 = opened_menu(FakeCam())
    check("กด r ซ้ำ → ปิดเมนู", m3.handle(main.KEY_RESOLUTION, FakeCam()) and not m3.open)
    m4 = opened_menu(FakeCam())
    m4.handle(27, FakeCam())
    check("กด Esc → ปิดเมนู", not m4.open)

    m5 = main.ResolutionMenu()
    check("เมนูปิดอยู่ → ไม่กินปุ่มอื่น ปล่อยให้ปุ่มลัดเดิมทำงาน",
          m5.handle(ord("c"), FakeCam()) is False)
    check("เมนูเปิดอยู่ → กินทุกปุ่ม ไม่ให้หลุดไปสั่ง calibrate ใหม่",
          opened_menu(FakeCam()).handle(ord("c"), FakeCam()) is True)

    cam_bad = FakeCam(fail=True)
    m6 = opened_menu(cam_bad)
    m6.handle(ord("1"), cam_bad)
    check("เปลี่ยนโหมดไม่สำเร็จ → เมนูค้างไว้พร้อมข้อความ ไม่ปิดเงียบ ๆ",
          m6.open and m6.message)

    m7 = opened_menu(FakeCam(sizes=[]))
    check("กล้องที่บอกรายการโหมดไม่ได้ → ขึ้นข้อความ ไม่ใช่เมนูเปล่า",
          m7.sizes == [] and m7.message)

# ── 13. ค่าระดับห้อง ────────────────────────────────────
print("\n13. ค่าระดับห้อง")
a8 = az.FaceAnalyzer(CFG, mirror=True, report_person=False, track_eyes=False)
t8 = 800.0
people8 = [FakeTrack(i) for i in range(1, 4)]

# สามคน calibrate ท่านิ่งพร้อมกัน
for _ in range(10):
    a8.update([(p, fi(make_face(cx=0.2 + 0.3 * i))) for i, p in enumerate(people8)],
              t8, 0.1, FRAME)
    t8 += 0.1
check("attention_ratio = 100% เมื่อทุกคนมองตรง", a8.attention_ratio() == 1.0,
      f"(ได้ {a8.attention_ratio()})")
check("occupancy นับได้ 3 คน", a8.occupancy() == 3, f"(ได้ {a8.occupancy()})")

# คนที่สามหันหน้าออกไป — สัดส่วนมองตรงต้องลดลงเหลือราว 2 ใน 3
for _ in range(10):
    faces8 = [(p, fi(make_face(cx=0.2 + 0.3 * i))) for i, p in enumerate(people8[:2])]
    faces8.append((people8[2], fi(make_face(cx=0.8, yaw=0.5))))
    a8.update(faces8, t8, 0.1, FRAME)
    t8 += 0.1
ratio8 = a8.attention_ratio()
check("มีคนหันออกแล้วสัดส่วนมองตรงลดลง", 0.5 < ratio8 < 1.0, f"(ได้ {ratio8:.2f})")

summary8 = a8.pop_window(people8, 800.0 + CFG["window"]["seconds"] + 1)
check("โหมดห้องรวมไม่ใส่ id ลงในสรุป", summary8.person is None)
check("people_measured นับเฉพาะคนที่ calibrate เสร็จ", summary8.people_measured == 3,
      f"(ได้ {summary8.people_measured})")
# ต้องตรวจก่อนเรียก update() อีก ไม่งั้นตัวนับถูกเติมใหม่แล้ว
check("ตัวนับระดับห้องถูกรีเซ็ตหลังปิดหน้าต่าง",
      a8.occupancy() == 0 and a8.attention_ratio() is None)

# ตาต้องไม่ถูกวัดเลย — ค่าเป็นศูนย์/None ไม่ใช่ตัวเลขที่ไม่ได้วัดจริง
check("ไม่วัดตา → avg_ear เป็น None", summary8.avg_ear is None)
check("ไม่วัดตา → นับกะพริบเป็นศูนย์", summary8.blinks == 0)
r8 = a8.update([(people8[0], fi(make_face(cx=0.2, eye_open=0.02)))], t8, 0.1, FRAME)[0]
check("ตาปิดสนิทก็ไม่ถูกนับว่ากะพริบ", r8.blink_score == 0.0 and not r8.drowsy)
check("ไม่วัดตา → blink_method บอกตรง ๆ ว่าปิดอยู่", r8.blink_method == az.BLINK_OFF,
      f"(ได้ {r8.blink_method})")
check("ไม่วัดตา → ไม่เรียน EAR baseline",
      people8[0].state["analyzer"].ear_open is None)
check("แต่ยังหาท่านิ่งได้ตามปกติ", people8[0].state["analyzer"].calibrated)

# โหมดรายบุคคลยังวัดตาได้เหมือนเดิม — ยืนยันว่าไม่ได้ปิดทั้งระบบ
a9 = az.FaceAnalyzer(CFG, mirror=True)
tk9 = FakeTrack(1)
t9 = feed(a9, tk9, lambda _t: fi(make_face()), 1.0, 900.0)
r9 = a9.update([(tk9, fi(make_face(eye_open=0.02)))], t9, 0.1, FRAME)[0]
check("โหมดวัดตายังให้คะแนนตาปิดสูงตามเดิม", r9.blink_score > 0.5,
      f"(ได้ {r9.blink_score:.2f})")
check("โหมดวัดตายังเรียน EAR baseline ตามเดิม",
      tk9.state["analyzer"].ear_open is not None)

row8 = summary8.to_room_row()
check("to_room_row ไม่มีคอลัมน์ person", "person" not in row8)
check("to_room_row มีค่าที่ผู้ใช้เลือกครบ",
      {"occupancy", "movement_per_person_per_min", "attention_ratio"} <= set(row8))

# อัตราต่อคนต้องหารด้วยจำนวนคนจริง ไม่ใช่รายงานผลรวมดิบ
many = az.WindowSummary(started_at=0.0, ended_at=60.0, person=None, movement=20,
                        direction=az.empty_direction_counts(), face_count=10,
                        avg_ear=None, blinks=0, people_measured=10)
few = az.WindowSummary(started_at=0.0, ended_at=60.0, person=None, movement=9,
                       direction=az.empty_direction_counts(), face_count=3,
                       avg_ear=None, blinks=0, people_measured=3)
check("ห้องคนเยอะที่ขยับรวมมากกว่า แต่ต่อคนน้อยกว่า ต้องได้คะแนนดีกว่า",
      many.movement_per_person_per_minute() < few.movement_per_person_per_minute(),
      f"({many.movement_per_person_per_minute():.2f} vs "
      f"{few.movement_per_person_per_minute():.2f})")
check("ไม่มีคนวัดได้ ต้องไม่หารด้วยศูนย์",
      az.WindowSummary(started_at=0.0, ended_at=60.0, person=None, movement=0,
                       direction=az.empty_direction_counts(), face_count=0,
                       avg_ear=None, blinks=0).movement_per_person_per_minute() == 0.0)

# ── สรุป ────────────────────────────────────────────────
print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
