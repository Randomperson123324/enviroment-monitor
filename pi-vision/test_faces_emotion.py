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
  - **คนที่ไม่มีในแกลเลอรีต้องไม่ถูกติดชื่อ** และหน้าคล้ายกันต้องปฏิเสธ ไม่ใช่เดา
  - วางรูปใหม่แล้วระบบเห็นเอง โดยไม่ต้องรีสตาร์ต

รัน:  python3 test_faces_emotion.py
"""

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

CFG = {"threshold": 0.045, "ratio": 0.75, "min_size": 0.12, "rescan_seconds": 0.0}


def gallery_for(mapping, directory, cfg=CFG):
    """แกลเลอรีที่ถอดลายเซ็นจากชื่อไฟล์ตาม mapping — ไม่ต้องมีรูปจริง"""

    def extract(path):
        shape = mapping.get(Path(path).parent.name) or mapping.get(Path(path).stem)
        return lm.face_signature(make_face(**shape)) if shape else None

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
    hit_b = g.identify(sig_b, face_size=0.3)
    check("เจอ Bee จากใบหน้าของ B", hit_b is not None and hit_b[0] == "Bee", f"({hit_b})")

    # ข้อสำคัญที่สุด: คนที่ไม่ได้ลงทะเบียนต้องไม่ถูกติดชื่อของคนอื่น
    check("คนที่ไม่มีในแกลเลอรี (C) ต้องไม่ถูกติดชื่อ", g.identify(sig_c, face_size=0.3) is None)

    check("ใบหน้าเล็กเกินเกณฑ์ → ไม่เทียบ", g.identify(sig_a, face_size=0.05) is None)
    check("ไม่มีลายเซ็น → ไม่เทียบ", g.identify(None, face_size=0.3) is None)

def live_signature(shape, frames=20, level=0.015, seed=7):
    """
    ลายเซ็นแบบที่มาจากกล้องจริง — เฉลี่ยจากหลายเฟรมที่ landmark สั่น

    ต้องทดสอบด้วยค่านี้ ไม่ใช่ลายเซ็นจาก make_face ตรง ๆ เพราะลายเซ็นที่ตรงกับรูป
    ลงทะเบียนแบบเป๊ะทุกหลักไม่มีทางเกิดขึ้นจากกล้อง — และ ratio test จะดูเหมือน
    ไม่ทำงานทั้งที่จริง ๆ มันไม่ควรทำงานเมื่อระยะเป็นศูนย์
    """
    import random

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

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / "Ann.jpg").write_bytes(b"x")
    (root / "Twin.jpg").write_bytes(b"x")
    g = gallery_for({"Ann": PEOPLE["A"], "Twin": TWIN}, root)
    g.scan()
    live_a = live_signature(PEOPLE["A"])
    d_ann = lm.signature_distance(g.people["Ann"].signature, live_a)
    d_twin = lm.signature_distance(g.people["Twin"].signature, live_a)
    # หน้าคล้ายกันมาก → ratio test ต้องปฏิเสธ ดีกว่าติดชื่อผิดคน
    check(
        "สองคนหน้าคล้ายกันในแกลเลอรี → ปฏิเสธ ไม่เดา",
        g.identify(live_a, face_size=0.3) is None,
        f"(Ann {d_ann:.4f} · Twin {d_twin:.4f} · ratio {d_ann / max(d_twin, 1e-9):.2f})",
    )
    check(
        "และเหตุผลที่ปฏิเสธคือ ratio test ไม่ใช่ threshold",
        d_ann < g.threshold,
        f"(Ann {d_ann:.4f} < {g.threshold})",
    )

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
        def __init__(self, emotion=None, scores=None, name=None, pid=3):
            self.emotion, self.emotion_scores, self.name, self.person_id = \
                emotion, scores, name, pid

    check("HUD โชว์ neutral ออกมา ไม่เว้นว่าง", "neutral" in main._mood(R("neutral")))
    check("HUD โชว์อารมณ์ที่อ่านได้", "happy" in main._mood(R("happy")))
    check("ปิดฟีเจอร์ (emotion=None) จึงเว้นว่างได้ — คนละกรณีกับหน้านิ่ง",
          main._mood(R(None)) == "")
    check("คะแนนดิบเรียงจากมากไปน้อยให้อ่านง่าย",
          main._mood_scores(R("happy", {"happy": 0.8, "sad": 0.1})).startswith("happy"))
    check("ไม่มีคะแนนก็ไม่พัง", main._mood_scores(R("happy")) == "")

    # โหมดเฉพาะคนในรูป: คนที่ไม่มีรูปต้องไม่ขึ้นหมายเลข เพราะหมายเลขสื่อว่า "จำได้"
    check("โหมดปกติโชว์หมายเลข track", main._who(R(pid=3)) == "#3")
    check("โหมดเฉพาะคนในรูปเขียน unknown แทนหมายเลข",
          main._who(R(pid=3), known_only=True) == "unknown")
    check("จำชื่อได้แล้วโชว์ชื่อทั้งสองโหมด",
          main._who(R(name="Ann"), known_only=True) == "Ann"
          and main._who(R(name="Ann")) == "Ann")
else:
    print("  skip ป้ายบนหน้าจอ — ไม่มี cv2/mediapipe ในเครื่องนี้")

print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
