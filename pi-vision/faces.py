"""
จำคนจากรูปที่ผู้ใช้วางไว้ในโฟลเดอร์ — แทนการแจก id ใหม่ให้คนเดิมทุกครั้ง

วิธีใช้: วางรูปใน `pi-vision/faces/` ตั้งชื่อไฟล์เป็นชื่อคน

    faces/สมชาย.jpg
    faces/Nok.png
    faces/Ann/1.jpg        ← โฟลเดอร์ต่อคน ใส่ได้หลายรูป (แม่นขึ้น)
    faces/Ann/2.jpg

ระบบอ่านรูปตอนเริ่มทำงาน คำนวณลายเซ็นโครงหน้าของแต่ละคน แล้วเทียบกับใบหน้าที่เห็น
ในกล้อง · โฟลเดอร์ว่าง = ไม่มีอะไรเปลี่ยน ระบบยังใช้ id ตัวเลขเหมือนเดิม
**ฟีเจอร์นี้เปิดตัวเองเมื่อมีรูป** ไม่ต้องตั้งค่าอะไรเพิ่ม

──────────────────────────────────────────────────────────────────────────────
⚠️ **ข้อนี้เปลี่ยนจุดยืนเรื่องความเป็นส่วนตัวของโปรเจกต์** เดิม tracker.py จงใจ
ไม่จำหน้า — เดินออกจากเฟรมแล้วกลับมาก็ได้ id ใหม่ เพื่อไม่ให้ข้อมูลผูกกับตัวบุคคล
พอมีแกลเลอรีรูป ข้อมูลการเคลื่อนไหวและอารมณ์จะผูกกับ**ชื่อคนจริง** และรูปถูกเก็บ
ลงดิสก์ ก่อนใส่รูปควรได้รับความยินยอมจากเจ้าของใบหน้า และอย่าวางโฟลเดอร์นี้
ในที่ที่แชร์กับคนอื่น
──────────────────────────────────────────────────────────────────────────────

**สิ่งที่วิธีนี้ทำได้และทำไม่ได้:** ลายเซ็นคือสัดส่วนโครงหน้า 8 ค่า (landmarks.face_signature)
แยกคนที่โครงหน้าต่างกันได้ แต่ **ไม่ใช่ระบบยืนยันตัวตน** พี่น้องหน้าคล้ายกันอาจแยกไม่ออก
ถ้าต้องการความแม่นระดับยืนยันตัวตน ต้องใช้โมเดล face embedding ซึ่งเป็นงานแยก

**โหมดการตัดสิน (`FACES_GUESS`)** — ค่าเริ่มต้นคือ `true` = **เดาคนที่ใกล้ที่สุดเสมอ**
ตามที่ผู้ใช้ต้องการ ไม่ตอบว่าไม่รู้ · ที่ต้องรู้คือการเดาไม่ได้ทำให้แม่นขึ้น มันแค่ย้าย
ความผิดพลาดจาก "ไม่มีชื่อ" ไปเป็น "ชื่อผิด" ซึ่งมองไม่เห็นจากปลายทาง เพราะข้อมูลของ
คนแปลกหน้าจะไปกองอยู่ใต้ชื่อคนที่มีรูปที่หน้าคล้ายที่สุด โดยไม่มีอะไรบอกว่าเกิดขึ้น
จึงยังคืน `confident` มาด้วยทุกครั้ง เพื่อให้หน้าจอเติม `?` ต่อท้ายชื่อที่ยังไม่มั่นใจได้
ตั้ง `FACES_GUESS=false` เพื่อกลับไปเป็น "ไม่มั่นใจให้ใช้หมายเลขแทน"
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from landmarks import signature_distance

# นามสกุลรูปที่รับ — เท่าที่ OpenCV อ่านได้แน่นอน
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


@dataclass
class KnownPerson:
    """คนหนึ่งคนในแกลเลอรี — ลายเซ็นเฉลี่ยจากรูปทุกใบของเขา"""

    name: str
    signature: tuple[float, ...]
    samples: int
    files: tuple[str, ...] = ()


def _mean_signature(sigs: list[tuple[float, ...]]) -> tuple[float, ...] | None:
    """
    เฉลี่ยลายเซ็นหลายใบเข้าด้วยกัน

    เหตุผลเดียวกับที่ tracker เฉลี่ยหลายเฟรม: ลายเซ็นจากรูปเดียวมี noise จากมุมกล้อง
    และการแสดงออกในรูปนั้น ๆ การเฉลี่ยลด noise ลงตาม √N — รูปมากกว่าหนึ่งใบต่อคน
    จึงแม่นกว่าอย่างมีนัย
    """
    if not sigs:
        return None
    dims = len(sigs[0])
    return tuple(sum(s[i] for s in sigs) / len(sigs) for i in range(dims))


def _person_files(directory: Path) -> dict[str, list[Path]]:
    """
    จับคู่ชื่อคน → ไฟล์รูปของเขา

    รับสองแบบ: ไฟล์เดี่ยว (ชื่อไฟล์ = ชื่อคน) และโฟลเดอร์ต่อคน (ชื่อโฟลเดอร์ = ชื่อคน)
    """
    people: dict[str, list[Path]] = {}
    if not directory.is_dir():
        return people

    for entry in sorted(directory.iterdir()):
        if entry.is_dir():
            shots = [p for p in sorted(entry.iterdir()) if p.suffix.lower() in IMAGE_SUFFIXES]
            if shots:
                people[entry.name] = shots
        elif entry.suffix.lower() in IMAGE_SUFFIXES:
            people.setdefault(entry.stem, []).append(entry)
    return people


def _fingerprint(directory: Path) -> tuple:
    """
    สถานะปัจจุบันของโฟลเดอร์แบบย่อ — ใช้ตรวจว่ามีรูปเพิ่ม/ลบ/แก้ไขไหม

    ดูชื่อ ขนาด และเวลาแก้ไข เพื่อให้การวางรูปใหม่มีผลโดยไม่ต้องรีสตาร์ต
    และไม่ต้องอ่านไฟล์รูปซ้ำทุกครั้งที่ตรวจ
    """
    items = []
    for name, files in sorted(_person_files(directory).items()):
        for f in files:
            try:
                st = f.stat()
                items.append((name, f.name, st.st_size, int(st.st_mtime)))
            except OSError:
                continue
    return tuple(items)


class FaceGallery:
    """
    แกลเลอรีใบหน้าที่รู้จัก + การเทียบใบหน้าที่เห็นกับแกลเลอรี

    `extract` คือฟังก์ชันที่รับ path รูป แล้วคืนลายเซ็น (หรือ None ถ้าไม่เจอหน้า)
    แยกออกมาเป็นพารามิเตอร์เพื่อให้โมดูลนี้ทดสอบได้โดยไม่ต้องมี mediapipe หรือรูปจริง
    — main.py ส่งตัวจริงที่ใช้ FaceLandmarker เข้ามา
    """

    def __init__(self, directory, cfg: dict, extract):
        self.directory = Path(directory)
        self.threshold = cfg["threshold"]
        self.ratio = cfg["ratio"]
        self.min_size = cfg["min_size"]
        # เดาคนที่ใกล้ที่สุดเสมอ แทนการตอบว่าไม่รู้ (ดูหัวไฟล์)
        self.guess = cfg.get("guess", True)
        self.rescan_seconds = cfg["rescan_seconds"]
        self._extract = extract
        self.people: dict[str, KnownPerson] = {}
        self.skipped: list[str] = []          # รูปที่หาใบหน้าไม่เจอ — ควรบอกผู้ใช้
        self._fingerprint: tuple = ()
        self._checked_at = 0.0

    # ── การโหลดแกลเลอรี ───────────────────────────────────
    def scan(self) -> int:
        """อ่านรูปทั้งหมดใหม่ คืนจำนวนคนที่ใช้ได้"""
        self.people = {}
        self.skipped = []
        for name, files in _person_files(self.directory).items():
            sigs = []
            for path in files:
                sig = self._extract(path)
                if sig is None:
                    self.skipped.append(str(path))
                    continue
                sigs.append(tuple(sig))
            mean = _mean_signature(sigs)
            if mean is not None:
                self.people[name] = KnownPerson(
                    name=name,
                    signature=mean,
                    samples=len(sigs),
                    files=tuple(str(p) for p in files),
                )
        self._fingerprint = _fingerprint(self.directory)
        return len(self.people)

    def maybe_rescan(self, now: float) -> bool:
        """
        อ่านใหม่ถ้าโฟลเดอร์เปลี่ยน — เรียกได้ทุกเฟรม ราคาถูก

        เช็คแค่ทุก rescan_seconds และเทียบลายนิ้วมือของโฟลเดอร์ก่อน จะได้ไม่ไปถอด
        ลายเซ็นจากรูปทุกใบใหม่ทั้งที่ไม่มีอะไรเปลี่ยน
        """
        if self.rescan_seconds <= 0 or now - self._checked_at < self.rescan_seconds:
            return False
        self._checked_at = now
        if _fingerprint(self.directory) == self._fingerprint:
            return False
        self.scan()
        return True

    # ── การเทียบ ─────────────────────────────────────────
    def identify(self, signature, face_size: float):
        """
        ชื่อของคนที่ลายเซ็นตรงที่สุด — คืน `(ชื่อ, ระยะ, มั่นใจไหม)`

        คืน `None` เมื่อ**เทียบไม่ได้เลย** ซึ่งคนละเรื่องกับ "เทียบแล้วไม่มั่นใจ":
        ไม่มีรูปในแกลเลอรี · ยังไม่มีลายเซ็น · ใบหน้าเล็กเกินกว่าจะให้ landmark ที่ใช้ได้
        (ใบหน้าเล็กไม่ได้ให้คำตอบที่ "มั่นใจน้อย" มันให้คำตอบที่เป็นสัญญาณรบกวนล้วน ๆ
        การเดาจากมันจึงไม่ใช่การเดาที่มีข้อมูล — เป็นการสุ่ม)

        `มั่นใจ` = ผ่านเกณฑ์เดียวกับ re-identification ใน tracker.py ซึ่งเป็นปัญหาเดียวกัน
          1. ระยะต่ำกว่า threshold
          2. ratio test — ตัวที่ใกล้สุดดีกว่าอันดับสองอย่างชัดเจน · สองคนคล้ายกันพอ ๆ กัน
             แปลว่าแยกไม่ออกจริง ๆ

        `guess=True` (ค่าเริ่มต้น) คืนชื่อที่ใกล้ที่สุดแม้ไม่ผ่านเกณฑ์ ให้ผู้เรียกตัดสินใจ
        ว่าจะแสดงต่างจากชื่อที่มั่นใจไหม · `guess=False` คืน None เมื่อไม่ผ่านเกณฑ์
        """
        if not self.people or not signature or face_size < self.min_size:
            return None

        scored = sorted(
            (signature_distance(p.signature, signature), p.name) for p in self.people.values()
        )
        best, name = scored[0]
        confident = best < self.threshold and not (
            len(scored) > 1 and best > scored[1][0] * self.ratio
        )
        if not confident and not self.guess:
            return None
        return name, best, confident

    @property
    def names(self) -> list[str]:
        return sorted(self.people)

    @property
    def enabled(self) -> bool:
        """มีคนในแกลเลอรีหรือยัง — ไม่มีรูป = ระบบทำงานแบบเดิมทุกอย่าง"""
        return bool(self.people)


def landmark_extractor(detect):
    """
    สร้างฟังก์ชันถอดลายเซ็นจากไฟล์รูป โดยใช้ตัวตรวจใบหน้าที่ส่งเข้ามา

    `detect(path) -> landmarks | None` — main.py ห่อ FaceLandmarker (โหมด IMAGE) ไว้
    ในนี้ ส่วนโมดูลนี้แค่แปลง landmarks เป็นลายเซ็น จึงไม่ต้องรู้จัก mediapipe เลย
    """
    from landmarks import face_signature

    def extract(path):
        landmarks = detect(path)
        if not landmarks:
            return None
        return face_signature(landmarks)

    return extract


def ensure_directory(directory) -> Path:
    """
    สร้างโฟลเดอร์ faces/ พร้อมไฟล์อธิบาย ถ้ายังไม่มี

    มีโฟลเดอร์ว่างรออยู่ทำให้คนรู้ว่าต้องวางรูปที่ไหน โดยไม่ต้องอ่านเอกสารก่อน
    """
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    readme = path / "README.txt"
    if not readme.exists():
        readme.write_text(
            "วางรูปใบหน้าที่นี่ ตั้งชื่อไฟล์เป็นชื่อคน เช่น somchai.jpg\n"
            "ใส่หลายรูปต่อคนได้โดยสร้างโฟลเดอร์ชื่อคนแล้วใส่รูปข้างใน — แม่นกว่ารูปเดียว\n"
            "หนึ่งรูปควรมีใบหน้าเดียว หันตรง เห็นชัด\n"
            "โฟลเดอร์ว่าง = ระบบใช้หมายเลขแทนชื่อเหมือนเดิม\n",
            encoding="utf-8",
        )
    return path
