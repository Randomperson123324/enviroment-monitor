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
          set(summary.to_focus_row()) == {"person", "movement", "direction", "face_count"})
    check("ตัวนับถูกรีเซ็ต", sum(tk7.state["analyzer"].window_dirs.values()) == 0)

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

check("ชื่อโหมดที่ไม่รู้จักต้อง error ไม่ใช่เดาให้", _raises(lambda: modes.get("ห้อง")))
check("เลือกด้วยเลขข้อได้", modes.parse_choice("1").key == modes.ORDER[0])
check("เลือกด้วยชื่อได้", modes.parse_choice("PERSON ").key == "person")
check("กด Enter เฉย ๆ ได้ค่าเริ่มต้น", modes.parse_choice("").key == modes.DEFAULT)
check("พิมพ์มั่วคืน None เพื่อให้ถามซ้ำ", modes.parse_choice("9") is None)
check("เมนูพูดถึงทุกโหมด",
      all(any(m.label in line for line in modes.menu_lines()) for m in modes.MODES.values()))

# ลำดับความสำคัญของการเลือกโหมด
if main is None:
    print("  skip ลำดับความสำคัญของโหมด — ไม่มี cv2/mediapipe ในเครื่องนี้")
else:
    check("flag ชนะทุกอย่าง", main.resolve_mode("person", "room").key == "person")
    check("VISION_MODE ใช้เมื่อไม่มี flag", main.resolve_mode(None, "person").key == "person")
    check("ไม่มี TTY ไม่ค้างรอ input",
          main.resolve_mode(None, "", stream=io.StringIO()).key == modes.DEFAULT)

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
