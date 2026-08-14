#!/usr/bin/env python3
"""
ทดสอบการอ่านอารมณ์และการจำคนจากรูป โดยไม่ต้องมีกล้อง mediapipe หรือไฟล์รูปจริง

สองฟีเจอร์นี้ทดสอบแยกจากกล้องได้ทั้งหมด เพราะ:
  - emotion.py รับ blendshapes เข้า คืน label ออก — ป้อน Cat ปลอมได้ตรง ๆ
  - faces.py รับ "ฟังก์ชันถอดลายเซ็นจากไฟล์" เป็นพารามิเตอร์ จึงป้อนตัวปลอมที่คืน
    ลายเซ็นของ PEOPLE ใน fixtures ได้ โดยไม่ต้องมีรูปจริง

ตรวจสิ่งที่จะพังเงียบ ๆ ถ้าโค้ดผิด:
  - หน้านิ่งต้องได้ neutral ไม่ใช่การเดาอารมณ์ให้ครบทุกเฟรม
  - สองอารมณ์ที่คะแนนใกล้กันต้องได้ neutral ไม่ใช่สุ่มเลือกข้าง
  - การพูด (jawOpen กระโดดเป็นเฟรม ๆ) ต้องไม่เปลี่ยนอารมณ์ที่รายงาน
  - การเดา (FACES_GUESS=true) ต้องคืน `confident=False` ทุกครั้งที่ไม่ผ่านเกณฑ์
    ไม่ใช่คืนชื่อเปล่า ๆ ที่ดูเหมือนชื่อที่มั่นใจ
  - **โหมดไม่เดา (FACES_GUESS=false) ต้องยังปฏิเสธได้จริง** — คนที่ไม่มีในแกลเลอรี
    และหน้าคล้ายกันต้องไม่ถูกติดชื่อ
  - วางรูปใหม่แล้วระบบเห็นเอง โดยไม่ต้องรีสตาร์ต
  - **เกณฑ์ที่คำนวณจากชุดรูป (calibrate)** ต้องอยู่เหนือระยะของรูปคนเดียวกัน และ
    ใต้ระยะของคนละคน · ชุดรูปที่แยกคนไม่ออกต้องถูก**รายงาน** ไม่ใช่ตั้งเกณฑ์หลวมให้ผ่าน

รัน:  python3 test_faces_emotion.py
"""

import random
import sys
import tempfile
from pathlib import Path

import emotion as em
import faces as fc
import landmarks as lm
from fixtures import PEOPLE, TWIN, Cat, make_face, noisy

try:
    import main                      # ต้องมี cv2/mediapipe — ไม่มีก็ข้ามส่วนป้ายบนจอ
except Exception:                    # pragma: no cover
    main = None

# คอนโซล Windows ใช้ cp1252 เป็นค่าเริ่มต้น ซึ่งพิมพ์ภาษาไทยไม่ได้ — ถ้าไม่บังคับ utf-8
# เทสจะตายตอน print แล้วดูเหมือน "โค้ดพัง" ทั้งที่ตรรกะยังถูก ซึ่งชวนวินิจฉัยผิดทาง
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAILURES = []


def check(name, condition, detail=""):
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


def blendshapes(**scores):
    """สร้าง blendshapes ปลอม: blendshapes(mouthSmileLeft=0.8, ...)"""
    return [Cat(category_name=k, score=v) for k, v in scores.items()]


print("\n── อารมณ์จาก blendshapes ──────────────────────────────")

check(
    "ยิ้มสองข้างชัด → happy",
    em.classify(blendshapes(mouthSmileLeft=0.8, mouthSmileRight=0.75), 0.35) == ("happy", 0.775),
)

check(
    "คิ้วยก+ตาเบิก+อ้าปาก → surprised",
    em.classify(
        blendshapes(browInnerUp=0.7, eyeWideLeft=0.6, eyeWideRight=0.65, jawOpen=0.55), 0.35
    )[0]
    == "surprised",
)

check(
    "คิ้วขมวด+เม้มปาก → angry",
    em.classify(
        blendshapes(browDownLeft=0.7, browDownRight=0.72, mouthPressLeft=0.5, mouthPressRight=0.55),
        0.35,
    )[0]
    == "angry",
)

# หน้านิ่งคือคำตอบ ไม่ใช่การไม่มีคำตอบ
check(
    "กล้ามเนื้อขยับเล็กน้อยตอนพูด → neutral ไม่ใช่เดาอารมณ์",
    em.classify(blendshapes(mouthSmileLeft=0.12, jawOpen=0.2, browDownLeft=0.1), 0.35)[0]
    == em.NEUTRAL,
)

check(
    "ไม่มี blendshapes เลย → None (ต่างจาก neutral)",
    em.classify([], 0.35) is None and em.classify(None, 0.35) is None,
)

# ยิ้มปนตกใจ: เดาข้างใดข้างหนึ่งจะได้ค่าที่แกว่งไปมาทั้งที่หน้าไม่เปลี่ยน
tie = blendshapes(
    mouthSmileLeft=0.62, mouthSmileRight=0.60, browInnerUp=0.60, eyeWideLeft=0.62,
    eyeWideRight=0.60, jawOpen=0.60,
)
check("สองอารมณ์คะแนนใกล้กัน + margin → neutral", em.classify(tie, 0.35, margin=0.08)[0] == em.NEUTRAL)
check("ถ้าไม่ตั้ง margin ก็ยังเลือกตัวที่คะแนนสูงสุดได้", em.classify(tie, 0.35, margin=0.0)[0] in em.EXPRESSIONS)

print("\n── การกรองตามเวลา (EmotionState) ──────────────────────")

st = em.EmotionState(window=12, hold=6)
for _ in range(8):
    st.update(blendshapes(mouthSmileLeft=0.8, mouthSmileRight=0.8), 0.35, 0.08)
check("ยิ้มต่อเนื่อง → รายงาน happy", st.label == "happy")

# การพูดทำให้ jawOpen กระโดดสองสามเฟรม — ต้องไม่กลายเป็น surprised
before = st.label
for _ in range(3):
    st.update(blendshapes(jawOpen=0.9, browInnerUp=0.5, eyeWideLeft=0.5, eyeWideRight=0.5), 0.35, 0.08)
check("อ้าปากพูดแวบเดียว → ยังรายงานค่าเดิม", st.label == before)

for _ in range(9):
    st.update(blendshapes(jawOpen=0.9, browInnerUp=0.8, eyeWideLeft=0.8, eyeWideRight=0.8), 0.35, 0.08)
check("ตกใจค้างไว้นานพอ → เปลี่ยนเป็น surprised", st.label == "surprised")

st2 = em.EmotionState(window=12, hold=6)
st2.update(blendshapes(mouthSmileLeft=0.9, mouthSmileRight=0.9), 0.35, 0.08)
kept = st2.label
st2.update(None, 0.35, 0.08)
check("เฟรมที่ไม่มี blendshapes ไม่รีเซ็ตค่าเป็น neutral", st2.label == kept)

print("\n── แกลเลอรีใบหน้าจากรูป ───────────────────────────────")

# สองนโยบายของการตัดสิน — เทสทั้งคู่ เพราะสลับได้ด้วย FACES_GUESS
#
# ปิด auto_threshold ในชุดนี้ทั้งหมด เพราะที่ตรวจตรงนี้คือ**นโยบายการตัดสิน**
# ซึ่งต้องวัดที่เกณฑ์คงที่ ไม่งั้นเวลาเทสล้มจะแยกไม่ออกว่าการตัดสินเพี้ยน
# หรือแค่เกณฑ์ขยับ — การคำนวณเกณฑ์เองมีชุดเทสของตัวเองอยู่ข้างล่าง
CFG = {"threshold": 0.045, "ratio": 0.75, "min_size": 0.12, "rescan_seconds": 0.0,
       "guess": True, "auto_threshold": False}
CFG_STRICT = {**CFG, "guess": False}

# ค่าเดียวกับ config.py — ชุดเทสของการคำนวณเกณฑ์เองใช้ชุดนี้
CFG_AUTO = {**CFG, "auto_threshold": True, "auto_intra_percentile": 0.9,
            "auto_spread": 1.5, "auto_inter_fraction": 0.5,
            "auto_min": 0.01, "auto_max": 0.09}


def gallery_for(mapping, directory, cfg=CFG, jitter=0.0, seed=11):
    """
    แกลเลอรีที่อ่าน "รูป" จากชื่อไฟล์ตาม mapping — ไม่ต้องมีรูปจริง

    คืน `PhotoFace` แบบเดียวกับตัวจริง (`fc.landmark_extractor`) คือมีทั้งลายเซ็น
    และท่าหันหน้าในรูปใบนั้น เพราะทั้งสองอย่างมาจาก landmark ชุดเดียวกัน

    `jitter` จำลองว่ารูปแต่ละใบของคนเดียวกัน**ไม่เหมือนกันเป๊ะ** (มุม แสง วันที่ถ่าย)
    ต้องมีข้อนี้เวลาทดสอบการคำนวณเกณฑ์ ไม่งั้นรูปทุกใบให้ลายเซ็นเดียวกันหมด
    ระยะของรูปคนเดียวกันจะเป็น 0 ซึ่งไม่มีทางเกิดขึ้นจากรูปจริง
    """
    rng = random.Random(seed)

    def extract(path):
        shape = mapping.get(Path(path).parent.name) or mapping.get(Path(path).stem)
        if not shape:
            return None
        points = make_face(**shape)
        if jitter:
            points = noisy(points, jitter, rng)
        return fc.PhotoFace(signature=lm.face_signature(points), pose=lm.head_pose(points))

    return fc.FaceGallery(directory, cfg, extract)


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / "Ann.jpg").write_bytes(b"x")
    (root / "Bee.jpg").write_bytes(b"x")

    g = gallery_for({"Ann": PEOPLE["A"], "Bee": PEOPLE["B"]}, root)
    check("อ่านรูปสองใบ → รู้จักสองคน", g.scan() == 2 and g.names == ["Ann", "Bee"])
    check("มีคนในแกลเลอรี → ฟีเจอร์เปิดตัวเอง", g.enabled)

    sig_a = lm.face_signature(make_face(**PEOPLE["A"]))
    sig_b = lm.face_signature(make_face(**PEOPLE["B"]))
    sig_c = lm.face_signature(make_face(**PEOPLE["C"]))

    hit_a = g.identify(sig_a, face_size=0.3)
    check("เจอ Ann จากใบหน้าของ A", hit_a is not None and hit_a[0] == "Ann", f"({hit_a})")
    check("ตรงกับรูปเป๊ะ → มั่นใจ (ไม่มี ? บนจอ)", hit_a is not None and hit_a[2] is True)
    hit_b = g.identify(sig_b, face_size=0.3)
    check("เจอ Bee จากใบหน้าของ B", hit_b is not None and hit_b[0] == "Bee", f"({hit_b})")

    # ── นโยบาย "เดาเสมอ" (ค่าเริ่มต้น ตามที่ผู้ใช้สั่ง) ──
    # C ไม่มีในแกลเลอรี แต่ต้องได้ชื่อ **พร้อมธงว่าไม่มั่นใจ** ไม่ใช่ได้ชื่อเปล่า ๆ
    hit_c = g.identify(sig_c, face_size=0.3)
    check("คนที่ไม่มีในแกลเลอรีก็ยังได้ชื่อที่ใกล้ที่สุด (ไม่ตอบว่าไม่รู้)",
          hit_c is not None and hit_c[0] in ("Ann", "Bee"), f"({hit_c})")
    check("แต่ต้องบอกว่าไม่มั่นใจ เพื่อให้หน้าจอเติม ? ต่อท้าย",
          hit_c is not None and hit_c[2] is False, f"({hit_c})")

    # ── นโยบายเดิม "ไม่มั่นใจไม่เดา" ต้องยังใช้ได้จริง ──
    g_strict = gallery_for({"Ann": PEOPLE["A"], "Bee": PEOPLE["B"]}, root, CFG_STRICT)
    g_strict.scan()
    check("FACES_GUESS=false → คนที่ไม่มีในแกลเลอรีไม่ถูกติดชื่อ",
          g_strict.identify(sig_c, face_size=0.3) is None)
    check("FACES_GUESS=false → คนที่มีรูปยังจำได้ปกติ",
          (g_strict.identify(sig_a, face_size=0.3) or [None])[0] == "Ann")

    # เทียบไม่ได้เลย ≠ เทียบแล้วไม่มั่นใจ — สองกรณีนี้คืน None ทั้งคู่แม้เปิดการเดา
    # เพราะการเดาจากสัญญาณรบกวนล้วน ๆ ไม่ใช่การเดา เป็นการสุ่ม
    check("ใบหน้าเล็กเกินเกณฑ์ → ไม่เทียบเลย แม้เปิดการเดา",
          g.identify(sig_a, face_size=0.05) is None)
    check("ไม่มีลายเซ็น → ไม่เทียบเลย แม้เปิดการเดา", g.identify(None, face_size=0.3) is None)

def live_signature(shape, frames=20, level=0.015, seed=7):
    """
    ลายเซ็นแบบที่มาจากกล้องจริง — เฉลี่ยจากหลายเฟรมที่ landmark สั่น

    ต้องทดสอบด้วยค่านี้ ไม่ใช่ลายเซ็นจาก make_face ตรง ๆ เพราะลายเซ็นที่ตรงกับรูป
    ลงทะเบียนแบบเป๊ะทุกหลักไม่มีทางเกิดขึ้นจากกล้อง — และ ratio test จะดูเหมือน
    ไม่ทำงานทั้งที่จริง ๆ มันไม่ควรทำงานเมื่อระยะเป็นศูนย์
    """
    rng = random.Random(seed)
    sigs = [lm.face_signature(noisy(make_face(**shape), level, rng)) for _ in range(frames)]
    dims = len(sigs[0])
    return tuple(sum(sig[i] for sig in sigs) / len(sigs) for i in range(dims))


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / "Ann.jpg").write_bytes(b"x")
    g_solo = gallery_for({"Ann": PEOPLE["A"]}, root)
    g_solo.scan()
    live_a = live_signature(PEOPLE["A"])
    hit = g_solo.identify(live_a, face_size=0.3)
    check("ใบหน้าจากกล้อง (เฉลี่ยเฟรมที่สั่น) ยังจำ Ann ได้", hit is not None and hit[0] == "Ann",
          f"({hit})")
    check("และมั่นใจ ไม่ใช่แค่เดาถูก", hit is not None and hit[2] is True, f"({hit})")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / "Ann.jpg").write_bytes(b"x")
    (root / "Twin.jpg").write_bytes(b"x")
    g = gallery_for({"Ann": PEOPLE["A"], "Twin": TWIN}, root)
    g.scan()
    live_a = live_signature(PEOPLE["A"])
    d_ann = lm.signature_distance(g.people["Ann"].signature, live_a)
    d_twin = lm.signature_distance(g.people["Twin"].signature, live_a)
    # หน้าคล้ายกันมาก (ระยะต่างกันแค่ 1%) — กรณีที่ "ใกล้ที่สุด" ไม่มีความหมาย
    detail = f"(Ann {d_ann:.4f} · Twin {d_twin:.4f} · ratio {d_ann / max(d_twin, 1e-9):.2f})"
    hit_twin = g.identify(live_a, face_size=0.3)
    check("หน้าคล้ายกัน: เดาไปข้างหนึ่งตามที่สั่ง", hit_twin is not None, detail)
    check("แต่ต้องติดธงว่าไม่มั่นใจ — นี่คือกรณีที่การเดาผิดได้ง่ายที่สุด",
          hit_twin is not None and hit_twin[2] is False, detail)
    check(
        "และเหตุผลที่ไม่มั่นใจคือ ratio test ไม่ใช่ threshold",
        d_ann < g.threshold,
        f"(Ann {d_ann:.4f} < {g.threshold})",
    )

    g_twin_strict = gallery_for({"Ann": PEOPLE["A"], "Twin": TWIN}, root, CFG_STRICT)
    g_twin_strict.scan()
    check("FACES_GUESS=false → หน้าคล้ายกันปฏิเสธ ไม่เดา",
          g_twin_strict.identify(live_a, face_size=0.3) is None, detail)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    person = root / "Ann"
    person.mkdir()
    (person / "1.jpg").write_bytes(b"x")
    (person / "2.jpg").write_bytes(b"x")
    g = gallery_for({"Ann": PEOPLE["A"]}, root)
    g.scan()
    check("โฟลเดอร์ต่อคน: หลายรูปรวมเป็นคนเดียว",
          g.names == ["Ann"] and g.people["Ann"].samples == 2)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    g = gallery_for({"Ann": PEOPLE["A"]}, root, {**CFG, "rescan_seconds": 1.0})
    check("โฟลเดอร์ว่าง → ปิดตัวเอง ระบบใช้หมายเลขต่อ", g.scan() == 0 and not g.enabled)

    (root / "Ann.jpg").write_bytes(b"x")
    check("ยังไม่ถึงรอบตรวจ → ไม่อ่านใหม่", g.maybe_rescan(now=0.5) is False)
    check("ถึงรอบแล้วและมีรูปใหม่ → อ่านเองไม่ต้องรีสตาร์ต",
          g.maybe_rescan(now=2.0) is True and g.names == ["Ann"])
    check("ไม่มีอะไรเปลี่ยน → ไม่อ่านซ้ำ", g.maybe_rescan(now=4.0) is False)

    skipped = gallery_for({}, root)          # extract คืน None = หาใบหน้าไม่เจอ
    check("รูปที่หาใบหน้าไม่เจอ → ข้ามและรายงานให้ผู้ใช้รู้",
          skipped.scan() == 0 and len(skipped.skipped) == 1)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    fc.ensure_directory(root / "faces")
    check("สร้างโฟลเดอร์ faces/ พร้อมคำอธิบายให้ผู้ใช้",
          (root / "faces" / "README.txt").exists())

print("\n── ตั้งเกณฑ์เองจากชุดรูป (calibrate) ──────────────────")


def photos(root, name, count, ext=".jpg"):
    """สร้างไฟล์รูปเปล่า ๆ ให้คนหนึ่งคน — หลายใบ = โฟลเดอร์ต่อคน"""
    if count == 1:
        (root / f"{name}{ext}").write_bytes(b"x")
        return
    folder = root / name
    folder.mkdir()
    for i in range(count):
        (folder / f"{i}{ext}").write_bytes(b"x")


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 3)
    photos(root, "Bee", 3)
    g = gallery_for({"Ann": PEOPLE["A"], "Bee": PEOPLE["B"]}, root, CFG_AUTO, jitter=0.006)
    g.scan()
    cal = g.calibration
    detail = f"(intra {cal.intra:.4f} · เกณฑ์ {cal.threshold:.4f} · inter {cal.inter:.4f})"

    check("ชุดรูปที่ครบ → คำนวณเกณฑ์เอง ไม่ใช้ค่าใน .env", cal.source == "auto", detail)
    # หัวใจของทั้งฟีเจอร์: เกณฑ์ต้องอยู่ในช่องว่างระหว่างสองค่าที่วัดได้จากรูป
    check("เกณฑ์อยู่เหนือระยะที่รูปคนเดียวกันห่างกัน (ไม่งั้นจำคนของตัวเองไม่ได้)",
          cal.intra < cal.threshold, detail)
    check("และอยู่ใต้ระยะของคู่คนที่ใกล้กันที่สุด (ไม่งั้นติดชื่อผิดคน)",
          cal.threshold < cal.inter, detail)
    check("เกณฑ์ที่ใช้จริงคือค่าที่คำนวณได้ ไม่ใช่ค่าใน .env",
          g.threshold == cal.threshold and g.threshold != CFG_AUTO["threshold"], detail)
    check("ชุดรูปนี้แยกคนออกจากกันได้ → ไม่มีคำเตือน",
          cal.separated and cal.warning is None, detail)
    check("รายงานคู่ที่ใกล้กันที่สุดว่าเป็นใคร", cal.closest == ("Ann", "Bee"), f"({cal.closest})")

    # เกณฑ์ที่กว้างขึ้นตามความเลอะของชุดรูปต้องมีผลจริง ไม่ใช่แค่ตัวเลขสวย ๆ
    live_a = live_signature(PEOPLE["A"])
    hit = g.identify(live_a, face_size=0.3)
    check("ใบหน้าจากกล้องยังถูกจำได้อย่างมั่นใจด้วยเกณฑ์ที่คำนวณเอง",
          hit is not None and hit[0] == "Ann" and hit[2] is True, f"({hit})")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 3)
    photos(root, "Bee", 3)
    g_off = gallery_for({"Ann": PEOPLE["A"], "Bee": PEOPLE["B"]}, root,
                        {**CFG_AUTO, "auto_threshold": False}, jitter=0.006)
    g_off.scan()
    check("FACES_AUTO_THRESHOLD=false → ใช้ค่าใน .env ตรง ๆ เหมือนเดิม",
          g_off.threshold == CFG_AUTO["threshold"] and g_off.calibration.source == "config")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 1)
    g_one = gallery_for({"Ann": PEOPLE["A"]}, root, CFG_AUTO)
    g_one.scan()
    # คนเดียวรูปเดียว = ไม่มีทั้งระยะของคนเดียวกันและระยะระหว่างคน — ไม่มีอะไรให้วัด
    check("คนเดียวรูปเดียว → ไม่เดาเกณฑ์ กลับไปใช้ค่าใน .env",
          g_one.calibration.source == "config" and g_one.threshold == CFG_AUTO["threshold"])
    check("และบอกเหตุผลว่าทำไมถึงคำนวณไม่ได้", bool(g_one.calibration.reason))

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 4)
    g_solo = gallery_for({"Ann": PEOPLE["A"]}, root, CFG_AUTO, jitter=0.006)
    g_solo.scan()
    cal = g_solo.calibration
    check("คนเดียวหลายรูป → ตั้งเกณฑ์จากการกระจายของรูปคนนั้นได้",
          cal.source == "auto" and cal.intra is not None and cal.inter is None,
          f"({cal.threshold:.4f})")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 3)
    photos(root, "Twin", 3)
    g_twin = gallery_for({"Ann": PEOPLE["A"], "Twin": TWIN}, root, CFG_AUTO, jitter=0.006)
    g_twin.scan()
    cal = g_twin.calibration
    detail = f"(intra {cal.intra:.4f} · inter {cal.inter:.4f} · เกณฑ์ {cal.threshold:.4f})"
    # ชุดรูปที่มีฝาแฝดแยกไม่ออกจริง ๆ — สิ่งที่ต้องไม่เกิดคือระบบตั้งเกณฑ์หลวมให้ผ่าน
    check("รูปคนละคนใกล้กว่ารูปคนเดียวกัน → รู้ตัวว่าแยกไม่ออก", not cal.separated, detail)
    check("และเตือนโดยระบุว่าเป็นคู่ไหน",
          cal.warning is not None and "Ann" in cal.warning and "Twin" in cal.warning)
    # เพดานที่ต่ำกว่าพื้นต้องดึงเกณฑ์**ลง** ไม่ใช่ปล่อยให้พื้นดันเกณฑ์ขึ้นไปคลุมทั้งคู่
    check("ไม่ขยายเกณฑ์ตามความเลอะของรูป — เกณฑ์ต้องต่ำกว่าพื้นที่คำนวณจากรูปคนเดียวกัน",
          cal.threshold < cal.intra * CFG_AUTO["auto_spread"], detail)
    check("เกณฑ์ยังอยู่ในขอบเขตที่ตั้งไว้ ไม่หลุดไปสุดทาง",
          CFG_AUTO["auto_min"] <= cal.threshold <= CFG_AUTO["auto_max"], detail)
    # ข้อที่สำคัญที่สุดของชุดรูปแบบนี้ — ตัวเลขเป็นอย่างไรไม่สำคัญเท่าว่าปลายทาง
    # ต้องไม่ได้ชื่อที่ดู "มั่นใจ" ทั้งที่ระบบแยกสองคนนี้ไม่ออก
    hit_twin = g_twin.identify(live_signature(PEOPLE["A"]), face_size=0.3)
    check("คู่ที่แยกไม่ออก → ไม่มีทางได้ชื่อแบบมั่นใจ (ติด ? หรือไม่ตอบ)",
          hit_twin is None or hit_twin[2] is False, f"({hit_twin})")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 2)
    photos(root, "Bee", 2)
    g = gallery_for({"Ann": PEOPLE["A"], "Bee": PEOPLE["B"], "Cee": PEOPLE["C"]},
                    root, {**CFG_AUTO, "rescan_seconds": 1.0}, jitter=0.006)
    g.scan()
    before = g.threshold
    photos(root, "Cee", 2)
    changed = g.maybe_rescan(now=2.0)
    # เกณฑ์ของชุดรูปเก่าไม่ใช่เกณฑ์ของชุดรูปใหม่ — คนที่เพิ่งเพิ่มเข้ามาอาจหน้าคล้ายคนเดิม
    # จนเพดานต้องต่ำลง ถ้าใช้เกณฑ์เดิมต่อ คนใหม่จะถูกตัดสินด้วยเกณฑ์ของห้องที่ไม่มีเขา
    check("วางรูปคนใหม่ระหว่างรัน → คำนวณเกณฑ์ใหม่ด้วย ไม่ใช้ของเดิมต่อ",
          changed and "Cee" in g.names and g.threshold == g.calibration.threshold
          and g.calibration.closest is not None,
          f"(เดิม {before:.4f} → ใหม่ {g.threshold:.4f})")

print("\n── ท่านิ่งที่อ่านจากรูปลงทะเบียน ─────────────────────")

# รูปหน้าตรงบอกได้ว่า "ตรง" ของคนนี้ให้ค่าเท่าไร — analyzer เอาไปใช้แทนการนั่งนิ่ง
BIAS = 0.05                       # คนนี้จมูกเบี้ยว ตอนมองตรงก็ยังได้ yaw ไม่เป็นศูนย์
TILTED = dict(PEOPLE["A"])        # โครงหน้าเดิม แต่รูปที่ใช้ลงทะเบียนหันข้างอยู่

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 3)
    g = gallery_for({"Ann": {**PEOPLE["A"], "yaw": BIAS}}, root, CFG_AUTO)
    g.scan()
    expected = lm.head_pose(make_face(**PEOPLE["A"], yaw=BIAS))
    neutral = g.people["Ann"].neutral
    check("อ่านท่านิ่งจากรูปได้", neutral is not None)
    check("ตรงกับท่าในรูปจริง ๆ", abs(neutral[0] - expected[0]) < 1e-9, f"({neutral} vs {expected})")
    check("ค่าที่ได้ไม่เป็นศูนย์ — bias ประจำตัวคือสิ่งที่ต้องหักออก", abs(neutral[0]) > 1e-6)

    # แกน pitch ของหน้าตรงไม่ได้อยู่ใกล้ศูนย์เลย (จมูกอยู่ต่ำกว่าแนวตาเป็นทุนเดิม)
    # ถ้าเผลอเอาเกณฑ์การก้ม/เงยมาจับตรง ๆ รูปหน้าตรงทุกใบจะถูกปฏิเสธหมด
    check("pitch ของหน้าตรงห่างจากศูนย์มาก — จึงเทียบกับศูนย์ไม่ได้", neutral[1] > 0.06,
          f"(pitch {neutral[1]:+.3f})")

    good, rejected = fc.usable_neutrals({"Ann": g.people["Ann"]}, 0.08, 0.06, pitch_quorum=3)
    check("bias ปกติ → ใช้เป็นจุดอ้างอิงได้", good.get("Ann") == neutral and not rejected)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Turned", 3)
    g = gallery_for({"Turned": {**TILTED, "yaw": 0.5}}, root, CFG_AUTO)
    g.scan()
    good, rejected = fc.usable_neutrals(g.people, 0.08, 0.06, pitch_quorum=3)
    # ถ้ายอมรับรูปแบบนี้ คนคนนี้นั่งมองตรงจะถูกนับว่า "หันหน้า" ตลอดเวลา
    check("รูปที่คนหันข้างอยู่ → ไม่รับเป็นจุดอ้างอิง และบอกเหตุผล",
          not good and "yaw" in rejected.get("Turned", ""), f"({rejected})")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    for name in ("Ann", "Bee", "Cee", "Dee"):
        photos(root, name, 2)
    # สามคนถ่ายมุมเดียวกัน · Dee ก้มหน้าในรูปของเธอ
    g = gallery_for({"Ann": {**PEOPLE["A"], "yaw": BIAS}, "Bee": PEOPLE["B"],
                     "Cee": PEOPLE["C"], "Dee": {**PEOPLE["A"], "pitch": 0.6}},
                    root, CFG_AUTO)
    g.scan()
    good, rejected = fc.usable_neutrals(g.people, 0.08, 0.06, pitch_quorum=3)
    check("คนที่ก้ม/เงยต่างจากกลุ่ม → ถูกคัดออกด้วยการเทียบมัธยฐานของแกลเลอรี",
          "Dee" in rejected and "pitch" in rejected["Dee"], f"({rejected})")
    check("ส่วนคนที่เหลือยังใช้ได้ตามปกติ", set(good) == {"Ann", "Bee", "Cee"}, f"({sorted(good)})")

    # คนน้อยเกินไป มัธยฐานยังไม่มีความหมาย — ต้องข้ามการตรวจแกนนั้น ไม่ใช่เดา
    two = {k: g.people[k] for k in ("Ann", "Dee")}
    good2, rejected2 = fc.usable_neutrals(two, 0.08, 0.06, pitch_quorum=3)
    check("แกลเลอรีเล็กเกินไป → ข้ามการตรวจ pitch แทนที่จะตัดสินจากข้อมูลที่ไม่พอ",
          set(good2) == {"Ann", "Dee"} and not rejected2, f"({rejected2})")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    photos(root, "Ann", 3)
    g = gallery_for({"Ann": {**PEOPLE["A"], "yaw": BIAS}}, root, CFG_AUTO)
    g.scan()
    if main is not None:
        pose_cfg = {"method": "geometric", "yaw_threshold": 0.08, "pitch_threshold": 0.06,
                    "neutral_from_photos": True, "photo_neutral_max_ratio": 1.0,
                    "photo_neutral_min_people": 3}
        picked = main.photo_neutrals(g, pose_cfg, announce=False)
        check("main คัดเฉพาะคนที่รูปหน้าตรงพอ", picked == {"Ann": g.people["Ann"].neutral})
        check("ปิดฟีเจอร์ → วิธีวัดไม่รองรับ",
              not main.photo_neutral_supported({**pose_cfg, "neutral_from_photos": False},
                                               {"transform_matrix": False}))
        check("วิธี matrix → ไม่รองรับ (คนละหน่วยกับค่าจากรูป)",
              not main.photo_neutral_supported({**pose_cfg, "method": "matrix"},
                                               {"transform_matrix": True}))
        check("วิธี auto ที่โมเดลส่ง matrix มาด้วย → ไม่รองรับเหมือนกัน",
              not main.photo_neutral_supported({**pose_cfg, "method": "auto"},
                                               {"transform_matrix": True}))
        check("วิธี auto ที่ไม่มี matrix → ถอยไป geometric จึงรองรับ",
              main.photo_neutral_supported({**pose_cfg, "method": "auto"},
                                           {"transform_matrix": False}))
    else:
        print("  skip การคัดท่านิ่งฝั่ง main — ไม่มี cv2/mediapipe ในเครื่องนี้")

print("\n── หน้านิ่งต้องมองเห็นได้ ว่าไม่ใช่ฟีเจอร์พัง ──────────────")

# ก่อนหน้านี้ทุกทางแสดงผลซ่อน neutral ไว้ ผลคือคนที่นั่งหน้านิ่ง (เวลาส่วนใหญ่)
# ไม่เห็นอะไรเลย และสรุปว่าการอ่านอารมณ์ไม่ทำงาน — นี่คือเทสที่กันอาการนั้นกลับมา
neutral_cats = [Cat("mouthSmileLeft", 0.02), Cat("mouthSmileRight", 0.02)]
happy_cats = [Cat("mouthSmileLeft", 0.80), Cat("mouthSmileRight", 0.78)]

check("หน้านิ่งได้คำตอบว่า neutral ไม่ใช่ None",
      em.classify(neutral_cats, 0.35, 0.08) == (em.NEUTRAL, 0.02))
check("ไม่มี blendshapes เลย = ไม่รู้ (None) ซึ่งคนละเรื่องกับ neutral",
      em.classify(None, 0.35, 0.08) is None)
check("คะแนนดิบอ่านได้ทุกการแสดงออก เพื่อเอาไปปรับ threshold",
      set(em.expression_scores(happy_cats)) <= set(em.EXPRESSIONS)
      and em.expression_scores(happy_cats)["happy"] > 0.7)

if main is not None:
    class R:
        def __init__(self, emotion=None, scores=None, name=None, pid=3, sure=True):
            self.emotion, self.emotion_scores, self.name, self.person_id = \
                emotion, scores, name, pid
            self.name_confident = sure

    check("HUD โชว์ neutral ออกมา ไม่เว้นว่าง", "neutral" in main._mood(R("neutral")))
    check("HUD โชว์อารมณ์ที่อ่านได้", "happy" in main._mood(R("happy")))
    check("ปิดฟีเจอร์ (emotion=None) จึงเว้นว่างได้ — คนละกรณีกับหน้านิ่ง",
          main._mood(R(None)) == "")
    check("คะแนนดิบเรียงจากมากไปน้อยให้อ่านง่าย",
          main._mood_scores(R("happy", {"happy": 0.8, "sad": 0.1})).startswith("happy"))
    check("ไม่มีคะแนนก็ไม่พัง", main._mood_scores(R("happy")) == "")

    # ยังไม่มีชื่อ (ลายเซ็นไม่นิ่งพอ/แกลเลอรีว่าง) → หมายเลข track ไม่ใช่คำว่า unknown
    check("ยังเทียบไม่ได้ → โชว์หมายเลข track", main._who(R(pid=3)) == "#3")
    check("ไม่มีคำว่า unknown บนจอแล้ว",
          "unknown" not in main._who(R(pid=3), known_only=True))
    check("ชื่อที่มั่นใจโชว์เปล่า ๆ", main._who(R(name="Ann")) == "Ann")
    check("ชื่อที่เดาโชว์ ? ต่อท้าย — ผู้ดูจอต้องแยกออกจากชื่อที่มั่นใจ",
          main._who(R(name="Ann", sure=False)) == "Ann?")
else:
    print("  skip ป้ายบนหน้าจอ — ไม่มี cv2/mediapipe ในเครื่องนี้")

print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
