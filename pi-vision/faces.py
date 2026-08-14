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

**เกณฑ์ที่คำนวณจากรูปเอง (`FACES_AUTO_THRESHOLD` — เปิดไว้)** — `FACES_THRESHOLD` ที่ตั้ง
ไว้ตายตัวเป็นค่าที่มาจากใบหน้าสังเคราะห์ตอนพัฒนา ไม่ได้มาจากรูปของคนที่จะใช้จริง
พอมีแกลเลอรีอยู่แล้ว ตัวรูปเองบอกได้ว่าเกณฑ์ควรอยู่ตรงไหน จึงวัดสองอย่างจากรูป:

    รูปคนเดียวกันห่างกันแค่ไหน   (ต้องอยู่**ใต้**เกณฑ์ ไม่งั้นจำคนของตัวเองไม่ได้)
    คนละคนที่ใกล้กันที่สุดห่างแค่ไหน (ต้องอยู่**เหนือ**เกณฑ์ ไม่งั้นติดชื่อผิดคน)

แล้ววางเกณฑ์ไว้กลางช่องว่างระหว่างสองค่านั้น — ดูรายละเอียดใน `calibrate()`

**ท่านิ่งจากรูป (`POSE_NEUTRAL_FROM_PHOTOS` — เปิดไว้)** — รูปลงทะเบียนเป็นภาพ**หน้าตรง**
ตามที่บอกไว้ในคำแนะนำ จึงบอกได้ว่า "หน้าตรง" ของคนนี้ให้ค่า yaw/pitch เท่าไร
(ทุกคนมี bias ประจำตัวจากโครงหน้าที่ไม่สมมาตรและตำแหน่งจมูก — ดู landmarks.head_pose)
`KnownPerson.neutral` คือค่านั้น · analyzer เอาไปใช้แทนการให้คนนั่งนิ่งมองตรง
ตอนเริ่ม ซึ่งเดิมเป็นวิธีเดียวที่มี · ผลคือ **ใครที่มีรูปไม่ต้องรอ calibrate อีก
และไม่มีทางที่ท่าที่บังเอิญทำอยู่ตอนนั้นจะกลายเป็นนิยามของ "ตรง" ของเขาไปทั้งเซสชัน**

จุดศูนย์เดินตาม**ชื่อที่ระบบยกข้อมูลให้** ไม่ใช่ตามความมั่นใจ — ปลายทางบันทึกแถว
ใต้ชื่อนั้นอยู่แล้ว (โหมด known ไม่บันทึกคนที่ไม่มีชื่อเลย) การวัดด้วยจุดศูนย์ของคนอื่น
จึงขัดกับข้อมูลที่กำลังบันทึก · `FACES_GUESS=false` = ไม่ผ่านเกณฑ์แล้วไม่มีชื่อ
คนกลุ่มนั้นจึงกลับไป calibrate สดเองตามเดิมโดยอัตโนมัติ

**ข้อจำกัดที่ต้องรู้:** รูปในโฟลเดอร์บอกได้แค่ว่ารูป**ด้วยกันเอง**ห่างกันแค่ไหน
มันไม่รู้จักสัญญาณรบกวนของกล้องตัวที่จะใช้จริง ระยะจากกล้อง หรือแสงในห้องนั้น
ค่าที่ได้จึงถูกคูณด้วย `FACES_AUTO_SPREAD` เผื่อไว้ และยังถูกคุมด้วยเพดานบน-ล่าง
(`FACES_AUTO_MIN` / `FACES_AUTO_MAX`) — การ calibrate นี้ทำให้เกณฑ์**เข้ากับชุดรูป**
ไม่ใช่ทำให้ลายเซ็น 8 ค่าแยกคนได้เก่งขึ้น ฝาแฝดก็ยังเป็นฝาแฝด (แต่ระบบจะบอกให้รู้)
"""

from __future__ import annotations

import math
import os
import statistics
from dataclasses import dataclass
from pathlib import Path

from landmarks import signature_distance

# นามสกุลรูปที่รับ — เท่าที่ OpenCV อ่านได้แน่นอน
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


@dataclass
class PhotoFace:
    """สิ่งที่อ่านได้จากรูปลงทะเบียนหนึ่งใบ

    รวมสองอย่างที่มาจาก landmark ชุดเดียวกัน จึงไม่ต้องอ่านรูปสองรอบ:
    ลายเซ็นโครงหน้า (ใช้บอกว่าเป็นใคร) และท่าหันหน้าในรูปนั้น (ใช้เป็นจุดอ้างอิง
    ว่า "หน้าตรง" ของคนนี้อยู่ตรงไหน — ดู `KnownPerson.neutral`)
    """

    signature: tuple[float, ...]
    pose: tuple[float, float] | None = None      # (yaw, pitch) แบบ geometric


@dataclass
class KnownPerson:
    """คนหนึ่งคนในแกลเลอรี — ลายเซ็นเฉลี่ยจากรูปทุกใบของเขา

    เก็บลายเซ็นรายใบไว้ด้วย (`signatures`) ไม่ใช่เก็บแค่ค่าเฉลี่ย เพราะการกระจาย
    ของรูปคนเดียวกันคือครึ่งหนึ่งของข้อมูลที่ใช้ตั้งเกณฑ์เอง — ดู `calibrate()`
    """

    name: str
    signature: tuple[float, ...]
    samples: int
    files: tuple[str, ...] = ()
    signatures: tuple[tuple[float, ...], ...] = ()
    # ท่านิ่งของคนนี้ที่อ่านได้จากรูป — ค่ามัธยฐานของ (yaw, pitch) ทุกใบ
    # None = ไม่มีรูปใบไหนให้ค่าท่าทางได้ · ดูหัวไฟล์ว่าเอาไปใช้ทำอะไร
    neutral: tuple[float, float] | None = None


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


def _median_pose(poses: list[tuple[float, float]]) -> tuple[float, float] | None:
    """
    ท่านิ่งจากหลายรูป — มัธยฐานแยกแกน ไม่ใช่ค่าเฉลี่ย

    มัธยฐานทนต่อรูปที่หลุดโทนไปใบเดียว (คนเผลอหันหน้าในรูปนั้น) แบบเดียวกับที่
    analyzer ใช้มัธยฐานกับเฟรมตอน calibrate สด — ค่าเฉลี่ยจะถูกรูปใบนั้นดึงไปทั้งชุด
    """
    if not poses:
        return None
    return (
        statistics.median([p[0] for p in poses]),
        statistics.median([p[1] for p in poses]),
    )


def usable_neutrals(
    people: dict, yaw_limit: float, pitch_limit: float, pitch_quorum: int
) -> tuple[dict, dict]:
    """
    คัดว่าท่านิ่งของใครใช้เป็นจุดอ้างอิงได้ — คืน `(ใช้ได้, {ชื่อ: เหตุผลที่ใช้ไม่ได้})`

    ค่าที่อ่านจากรูปหน้าตรง**ไม่เป็นศูนย์อยู่แล้ว** โครงหน้าไม่สมมาตรและตำแหน่งจมูก
    ทำให้แต่ละคนมี bias ประจำตัว ซึ่งคือสิ่งที่เราต้องการวัดพอดี · แต่ถ้ารูปนั้นคน
    หันหน้าอยู่จริง ๆ ค่าที่ได้จะรวมการหันเข้าไปด้วย ระบบจะจำ "ท่าหันข้าง" เป็นท่าตรง
    ของคนนั้นไปตลอด แล้วเขาจะถูกนับว่าหันหน้าตลอดเวลาที่นั่งมองตรง

    **สองแกนนี้ตรวจด้วยวิธีเดียวกันไม่ได้:**

      yaw   ของใบหน้าหน้าตรงอยู่ใกล้ศูนย์ตามธรรมชาติ (ซ้าย-ขวาเกือบสมมาตร)
            จึงเทียบกับศูนย์ตรง ๆ ได้ · เกินเกณฑ์การหันหน้า = รูปนั้นถ้าเป็นภาพสด
            ก็จะถูกนับว่า "หันหน้า" อยู่แล้ว เอามาเป็นนิยามของ "ตรง" ไม่ได้

      pitch **ไม่มีศูนย์ให้เทียบ** เพราะปลายจมูกอยู่ต่ำกว่าแนวตาเป็นทุนเดิม
            ค่าปกติของหน้าตรงอยู่ราว 0.2–0.3 ไม่ใช่ 0 (ดู landmarks.head_pose)
            จึงเทียบกับ**มัธยฐานของคนอื่นในแกลเลอรี**แทน = จับได้เฉพาะคนที่ก้ม/เงย
            ต่างจากกลุ่ม · ทำได้ต่อเมื่อมีคนมากพอ (`pitch_quorum`) ไม่งั้นข้ามแกนนี้

    ⚠️ **สิ่งที่วิธีนี้จับไม่ได้เลย: ทั้งชุดเอียงเท่ากันหมด** เช่นถ่ายรูปทุกคนด้วย
    มุมกล้องที่กดลงมา แล้วกล้องที่ใช้จริงอยู่ระดับตา — ทุกคนจะมีจุดอ้างอิงที่เพี้ยน
    ไปทางเดียวกัน และไม่มีอะไรในชุดรูปบอกได้ · ถ่ายรูปลงทะเบียนด้วยมุมกล้องใกล้เคียง
    กับกล้องตัวที่จะใช้จริง (ดู README)
    """
    neutrals = {n: p.neutral for n, p in sorted(people.items()) if p.neutral}
    rejected = {n: "อ่านท่าหันหน้าจากรูปไม่ได้" for n in sorted(people) if not people[n].neutral}

    pitches = [pose[1] for pose in neutrals.values()]
    center = statistics.median(pitches) if len(pitches) >= max(1, pitch_quorum) else None

    good = {}
    for name, (yaw, pitch) in neutrals.items():
        if abs(yaw) > yaw_limit:
            rejected[name] = f"รูปหันข้างอยู่ (yaw {yaw:+.3f} เกิน {yaw_limit:.3f})"
        elif center is not None and abs(pitch - center) > pitch_limit:
            rejected[name] = (
                f"รูปก้ม/เงยต่างจากคนอื่นในแกลเลอรี (pitch {pitch:+.3f} "
                f"ห่างจากกลาง {center:+.3f} เกิน {pitch_limit:.3f})"
            )
        else:
            good[name] = (yaw, pitch)
    return good, rejected


def _percentile(values: list[float], q: float) -> float:
    """ค่าที่ตำแหน่ง q (0–1) ของข้อมูลที่เรียงแล้ว — วิธีเดียวกับที่ analyzer ใช้กับ EAR"""
    ordered = sorted(values)
    idx = min(len(ordered) - 1, int(len(ordered) * q))
    return ordered[idx]


def _self_distances(signatures) -> list[float]:
    """
    ระยะของรูปแต่ละใบ เทียบกับค่าเฉลี่ยของรูป**ใบอื่น**ของคนเดียวกัน

    ต้องกันตัวเองออกจากค่าเฉลี่ย (leave-one-out) ไม่งั้นรูปแต่ละใบจะถูกเทียบกับ
    ค่าเฉลี่ยที่มีตัวมันเองอยู่ด้วย ซึ่งดึงค่าเฉลี่ยเข้าหาตัวมันเอง — ยิ่งรูปน้อยยิ่ง
    ดึงแรง ผลคือประเมินการกระจายต่ำกว่าความจริง แล้วได้เกณฑ์ที่เข้มเกินจนจำใครไม่ได้

    คนที่มีรูปใบเดียวไม่ให้ข้อมูลข้อนี้เลย (คืน list ว่าง) — ไม่ใช่ให้ระยะ 0
    """
    if len(signatures) < 2:
        return []
    out = []
    for i, sig in enumerate(signatures):
        others = _mean_signature([s for j, s in enumerate(signatures) if j != i])
        if others is not None:
            out.append(signature_distance(others, sig))
    return out


def _closest_pair(people: dict) -> tuple[float, str, str] | None:
    """คู่คนที่ลายเซ็นใกล้กันที่สุดในแกลเลอรี — คืน (ระยะ, ชื่อ, ชื่อ)"""
    names = sorted(people)
    pairs = [
        (signature_distance(people[a].signature, people[b].signature), a, b)
        for i, a in enumerate(names)
        for b in names[i + 1:]
    ]
    return min(pairs) if pairs else None


@dataclass
class Calibration:
    """ผลของการตั้งเกณฑ์จากชุดรูป — เก็บที่มาไว้ด้วย ไม่ใช่เก็บแค่ตัวเลข

    ที่มาสำคัญพอ ๆ กับตัวเลข เพราะเวลาระบบจำผิด คำถามแรกคือ "เกณฑ์นี้มาจากไหน"
    ถ้าเหลือแต่ตัวเลขลอย ๆ จะแยกไม่ออกว่าเป็นค่าที่คำนวณมา ค่าที่ชนเพดาน หรือค่า
    ที่ตั้งไว้ใน .env
    """

    threshold: float
    source: str                              # "auto" = คำนวณจากรูป · "config" = ค่าใน .env
    reason: str = ""                         # ทำไมถึงคำนวณไม่ได้ (source="config")
    intra: float | None = None               # รูปคนเดียวกันห่างกันแค่ไหน (เปอร์เซ็นไทล์บน)
    inter: float | None = None               # คนละคนที่ใกล้กันที่สุดห่างแค่ไหน
    closest: tuple[str, str] | None = None   # คู่นั้นคือใคร
    clamped: bool = False                    # ค่าที่คำนวณได้ชนเพดานบน/ล่างไหม

    @property
    def separated(self) -> bool:
        """ชุดรูปนี้แยกคนออกจากกันได้จริงไหม — รูปคนเดียวกันต้องใกล้กว่าคนละคน"""
        if self.intra is None or self.inter is None:
            return True                      # ไม่มีข้อมูลให้ตัดสิน = ไม่มีอะไรให้เตือน
        return self.intra < self.inter

    @property
    def message(self) -> str:
        """บรรทัดเดียวสำหรับ console — ต้องเห็นทั้งค่าและที่มา"""
        if self.source != "auto":
            return f"เกณฑ์ความเหมือน {self.threshold:.3f} (จากค่าที่ตั้งไว้ — {self.reason})"
        parts = []
        if self.intra is not None:
            parts.append(f"รูปคนเดียวกันห่าง {self.intra:.3f}")
        if self.inter is not None:
            near = f" ({self.closest[0]}·{self.closest[1]})" if self.closest else ""
            parts.append(f"คนละคนใกล้สุด {self.inter:.3f}{near}")
        tail = " · ชนเพดาน" if self.clamped else ""
        return f"เกณฑ์ความเหมือน {self.threshold:.3f} — คำนวณจากรูป: " + " · ".join(parts) + tail

    @property
    def warning(self) -> str | None:
        """คำเตือนเมื่อชุดรูปเองแยกคนไม่ออก — คืน None ถ้าไม่มีอะไรต้องเตือน"""
        if self.separated:
            return None
        pair = f"{self.closest[0]} กับ {self.closest[1]}" if self.closest else "บางคู่"
        return (
            f"! {pair} หน้าใกล้กัน ({self.inter:.3f}) พอ ๆ กับที่รูปคนเดียวกันห่างกัน "
            f"({self.intra:.3f}) — ชุดรูปนี้แยกสองคนนี้ไม่ออก เกณฑ์ถูกตั้งให้เข้มที่สุด "
            "เท่าที่ทำได้แล้ว · เพิ่มรูปที่ชัดกว่านี้ให้ทั้งคู่จะช่วยได้"
        )


def calibrate(people: dict, cfg: dict) -> Calibration:
    """
    ตั้งเกณฑ์ความเหมือน (`threshold`) จากชุดรูปในโฟลเดอร์เอง

    เกณฑ์ที่ดีต้องอยู่ระหว่างสองเส้นที่วัดได้จากรูปโดยตรง:

        พื้น (floor)   = ระยะที่รูปคนเดียวกันห่างกัน × `auto_spread`
                        ต่ำกว่านี้ = ปฏิเสธรูปของคนคนนั้นเอง จำใครไม่ได้เลย
        เพดาน (ceiling) = ระยะของคู่คนที่ใกล้กันที่สุด × `auto_inter_fraction`
                        สูงกว่านี้ = เริ่มยอมรับคนอื่นเป็นคนนี้ ซึ่งคือการติดชื่อผิด

    เลือกค่ากลางแบบ **geometric mean** ไม่ใช่ค่ากลางเลขคณิต เพราะระยะพวกนี้เป็น
    สัดส่วน (0.02 ต่อ 0.08 คือ "ห่างกัน 4 เท่า" ไม่ใช่ "ห่างกัน 0.06") ค่ากลางเชิงคูณ
    จึงอยู่กึ่งกลางจริงในเชิงที่ใช้ตัดสิน

    `auto_spread` คือส่วนเผื่อสำหรับสิ่งที่**รูปบอกไม่ได้** — กล้องจริงสั่น แสงต่าง
    ระยะต่าง ทั้งหมดนี้ทำให้ลายเซ็นจากกล้องห่างจากรูปมากกว่าที่รูปห่างกันเอง
    `auto_inter_fraction` คือระยะปลอดภัยที่กันไว้ใต้คู่ที่ใกล้ที่สุด

    กรณีที่ข้อมูลไม่ครบ (ตั้งใจให้ทำงานได้ทุกแบบ ไม่ใช่บังคับให้ผู้ใช้จัดชุดรูปให้ครบก่อน):
      - คนเดียวหลายรูป → มีแต่พื้น ใช้พื้นเป็นเกณฑ์
      - หลายคนคนละรูปเดียว → มีแต่เพดาน ใช้เพดานเป็นเกณฑ์
      - คนเดียวรูปเดียว → **ไม่มีอะไรให้วัดเลย** คืนค่าใน .env ตามเดิม ไม่เดา

    เมื่อพื้นสูงกว่าเพดาน (เช่นในแกลเลอรีมีพี่น้องหน้าคล้ายกัน) เกณฑ์จะถูกกดลงมา
    ที่เพดาน = ต่ำกว่าระยะที่รูปคนเดียวกันยังห่างกันเอง ผลคือระบบจะไม่ "มั่นใจ"
    กับใครในคู่นั้นเลย **ซึ่งเป็นผลลัพธ์ที่ถูกต้อง** ของชุดรูปที่แยกสองคนนั้นไม่ออก
    ดีกว่าเลือกข้างแล้วเงียบ · `Calibration.warning` จะบอกผู้ใช้ว่าเกิดขึ้นกับใคร
    """
    if not cfg.get("auto_threshold", True):
        return Calibration(threshold=cfg["threshold"], source="config",
                           reason="ปิด FACES_AUTO_THRESHOLD ไว้")

    intra_all: list[float] = []
    for person in people.values():
        intra_all += _self_distances(person.signatures)
    intra = _percentile(intra_all, cfg["auto_intra_percentile"]) if intra_all else None

    near = _closest_pair(people)
    inter = near[0] if near else None
    closest = (near[1], near[2]) if near else None

    floor = intra * cfg["auto_spread"] if intra is not None else None
    ceiling = inter * cfg["auto_inter_fraction"] if inter is not None else None

    if floor is not None and ceiling is not None:
        # ค่ากลางระหว่างพื้นกับเพดาน แต่**ห้ามเกินเพดาน** — สองอย่างนี้ต่างกันเฉพาะ
        # ตอนที่พื้นสูงกว่าเพดาน (ชุดรูปแยกคนไม่ออก) ซึ่งเป็นตอนที่สำคัญที่สุดพอดี:
        # ปล่อยให้ค่ากลางลอยขึ้นไปเหนือเพดานเมื่อไร ระยะจากกล้องถึงคนทั้งคู่จะตกอยู่
        # ใต้เกณฑ์พร้อมกัน แล้วคำตอบว่าเป็นใครก็ขึ้นกับว่ารูปของใครบังเอิญเบี้ยวน้อยกว่า
        # — ได้ชื่อที่ดู "มั่นใจ" จากเสียงรบกวนล้วน ๆ ซึ่งแย่กว่าการไม่ตอบ
        raw = min(math.sqrt(floor * ceiling), ceiling)
    elif floor is not None:
        raw = floor
    elif ceiling is not None:
        raw = ceiling
    else:
        return Calibration(
            threshold=cfg["threshold"], source="config",
            reason="ต้องมีคนสองคนขึ้นไป หรือคนเดียวที่มีรูปสองใบขึ้นไป ถึงจะวัดได้",
        )

    threshold = min(max(raw, cfg["auto_min"]), cfg["auto_max"])
    return Calibration(
        threshold=threshold,
        source="auto",
        intra=intra,
        inter=inter,
        closest=closest,
        clamped=abs(threshold - raw) > 1e-9,
    )


class FaceGallery:
    """
    แกลเลอรีใบหน้าที่รู้จัก + การเทียบใบหน้าที่เห็นกับแกลเลอรี

    `extract` คือฟังก์ชันที่รับ path รูป แล้วคืนลายเซ็น (หรือ None ถ้าไม่เจอหน้า)
    แยกออกมาเป็นพารามิเตอร์เพื่อให้โมดูลนี้ทดสอบได้โดยไม่ต้องมี mediapipe หรือรูปจริง
    — main.py ส่งตัวจริงที่ใช้ FaceLandmarker เข้ามา
    """

    def __init__(self, directory, cfg: dict, extract):
        self.directory = Path(directory)
        self.cfg = cfg
        # เกณฑ์ที่ใช้จริง — ถูกเขียนทับด้วยค่าที่คำนวณจากรูปทุกครั้งที่ scan()
        # (ดู calibrate) · ค่าใน .env ยังเป็นค่าตั้งต้นและเป็นค่าที่ใช้เมื่อวัดจากรูปไม่ได้
        self.threshold = cfg["threshold"]
        self.calibration = Calibration(threshold=self.threshold, source="config",
                                       reason="ยังไม่ได้อ่านรูป")
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
        """
        อ่านรูปทั้งหมดใหม่ คืนจำนวนคนที่ใช้ได้

        ตั้งเกณฑ์ความเหมือนใหม่จากชุดรูปที่เพิ่งอ่านด้วย — ต้องทำที่นี่ ไม่ใช่ตอนสร้าง
        object เพราะชุดรูปเปลี่ยนได้ระหว่างที่โปรแกรมทำงาน (ดู maybe_rescan)
        และเกณฑ์ที่คำนวณจากชุดรูปเก่าไม่ใช่เกณฑ์ของชุดรูปใหม่
        """
        self.people = {}
        self.skipped = []
        for name, files in _person_files(self.directory).items():
            sigs, poses = [], []
            for path in files:
                photo = self._extract(path)
                if photo is None or photo.signature is None:
                    self.skipped.append(str(path))
                    continue
                sigs.append(tuple(photo.signature))
                if photo.pose is not None:
                    poses.append(tuple(photo.pose))
            mean = _mean_signature(sigs)
            if mean is not None:
                self.people[name] = KnownPerson(
                    name=name,
                    signature=mean,
                    samples=len(sigs),
                    files=tuple(str(p) for p in files),
                    signatures=tuple(sigs),
                    neutral=_median_pose(poses),
                )
        self.calibration = calibrate(self.people, self.cfg)
        self.threshold = self.calibration.threshold
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
    สร้างฟังก์ชันอ่านรูปหนึ่งใบเป็น `PhotoFace` โดยใช้ตัวตรวจใบหน้าที่ส่งเข้ามา

    `detect(path) -> landmarks | None` — main.py ห่อ FaceLandmarker (โหมด IMAGE) ไว้
    ในนี้ ส่วนโมดูลนี้แค่แปลง landmarks เป็นตัวเลข จึงไม่ต้องรู้จัก mediapipe เลย

    ท่าหันหน้าคิดจาก landmark ชุดเดียวกับลายเซ็น (`landmarks.head_pose` ตัวเดียวกับ
    ที่ใช้กับภาพสด) จึงเทียบกันได้ตรง ๆ และไม่มีต้นทุนเพิ่มนอกจากเลขคณิตไม่กี่ตัว
    """
    from landmarks import face_signature, head_pose

    def extract(path):
        landmarks = detect(path)
        if not landmarks:
            return None
        signature = face_signature(landmarks)
        if signature is None:
            return None
        return PhotoFace(signature=signature, pose=head_pose(landmarks))

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
            "โฟลเดอร์ว่าง = ระบบใช้หมายเลขแทนชื่อเหมือนเดิม\n"
            "\n"
            "ระบบตั้งเกณฑ์ความเหมือนเองจากรูปพวกนี้ (ดูบรรทัด 'เกณฑ์ความเหมือน' ตอนเปิดโปรแกรม)\n"
            "จึงควรมีอย่างน้อย 2 รูปต่อคน — รูปใบเดียวไม่บอกว่ารูปของคนคนนั้นต่างกันได้แค่ไหน\n",
            encoding="utf-8",
        )
    return path
