"""
โหมดการทำงานของ pi-vision

โหมดไม่ใช่ไปป์ไลน์คนละเส้น — เป็นแค่ **นโยบาย** ที่ทับค่าตั้งบางตัวของไปป์ไลน์เดิม
ทำแบบนี้เพื่อไม่ให้มีโค้ดวิเคราะห์ใบหน้าสองชุดที่ต้องคอยแก้ให้ตรงกัน

ตอนนี้มีสองโหมด
  room    — วัดภาพรวมของห้อง ไม่แยกรายบุคคล ไม่เก็บลายเซ็นโครงหน้า
  person  — ติดตามทีละคนพร้อม re-ID (โหมดเดิม)

ถ้าจะเพิ่มโหมดใหม่ ให้เพิ่ม Mode เข้า MODES แล้วโมดูลอื่นจะรับไปเองทั้งหมด
"""

from __future__ import annotations

from dataclasses import dataclass

ROOM = "room"
PERSON = "person"


@dataclass(frozen=True)
class Mode:
    """นโยบายหนึ่งชุด — อ่านอย่างเดียว ไม่มีใครแก้ระหว่างรันได้"""

    key: str
    label: str
    summary: str                 # อธิบายสั้น ๆ ตอนถามผู้ใช้ให้เลือก
    signatures: bool             # คำนวณลายเซ็นโครงหน้าไหม (ข้อมูลชีวมิติแบบอ่อน)
    reid: bool                   # คืน id เดิมเมื่อคนออกไปแล้วกลับมาไหม
    report_person: bool          # ใส่คอลัมน์ person ลงตาราง focus ไหม
    per_person_hud: bool         # HUD แสดงทีละคน หรือแสดงภาพรวมห้อง
    eyes: bool                   # วัดการกะพริบตา · EAR · ความง่วง ไหม

    def apply_to_tracker(self, tracker_cfg: dict) -> dict:
        """คืน tracker config ชุดใหม่ที่ผ่านนโยบายของโหมดนี้แล้ว (ไม่แก้ของเดิม)"""
        cfg = dict(tracker_cfg)
        if not self.reid:
            cfg["reid_enabled"] = False
        return cfg


MODES: dict[str, Mode] = {
    ROOM: Mode(
        key=ROOM,
        label="ห้องรวม",
        summary="นับคน + การหันหน้ารวมของห้อง ไม่แยกรายบุคคล ไม่วัดตา ไม่เก็บลายเซ็นใบหน้า",
        signatures=False,
        reid=False,
        report_person=False,
        per_person_hud=False,
        # ไม่วัดตาเลย — ระดับห้องต้องการแค่ "มีกี่คน" กับ "หันหน้ากันแค่ไหน"
        # การกะพริบตาและความง่วงเป็นสภาวะของร่างกายรายบุคคล ไม่ใช่ค่าของห้อง
        # และการหาค่า EAR ต้องซูมเข้าไปที่ตาแต่ละคน ซึ่งเกินกว่าที่โหมดนี้ควรทำ
        eyes=False,
    ),
    PERSON: Mode(
        key=PERSON,
        label="รายบุคคล",
        summary="ติดตามแยกทีละคนด้วย id · วัดการกะพริบตาและความง่วง · จำ id ได้เมื่อกลับมา",
        signatures=True,
        reid=True,
        report_person=True,
        per_person_hud=True,
        eyes=True,
    ),
}

ORDER = (ROOM, PERSON)          # ลำดับที่แสดงในเมนู — ห้องรวมขึ้นก่อนเพราะปลอดภัยกว่า
DEFAULT = ROOM


def get(key: str | None) -> Mode:
    """แปลงชื่อโหมดเป็น Mode — ชื่อที่ไม่รู้จักถือเป็นความผิดพลาดของค่าตั้ง ไม่เดาให้"""
    if key is None:
        return MODES[DEFAULT]
    normalized = key.strip().lower()
    if normalized not in MODES:
        raise ValueError(
            f"ไม่รู้จักโหมด {key!r} — ที่มีคือ {', '.join(ORDER)}"
        )
    return MODES[normalized]


def menu_lines() -> list[str]:
    """ข้อความเมนูสำหรับถามผู้ใช้ — แยกจากการพิมพ์เพื่อให้เทสตรวจได้"""
    lines = ["", "  เลือกโหมดการทำงาน"]
    for i, key in enumerate(ORDER, start=1):
        mode = MODES[key]
        star = " (ค่าเริ่มต้น)" if key == DEFAULT else ""
        lines.append(f"    {i}) {mode.label:<10}{star}")
        lines.append(f"       {mode.summary}")
    lines.append("")
    return lines


def parse_choice(raw: str) -> Mode | None:
    """
    ตีความสิ่งที่ผู้ใช้พิมพ์ — รับได้ทั้งเลขข้อและชื่อโหมด
    คืน None เมื่อพิมพ์อะไรที่ตีความไม่ได้ (ผู้เรียกควรถามซ้ำ ไม่ใช่เดา)
    """
    text = raw.strip().lower()
    if not text:
        return MODES[DEFAULT]        # กด Enter เฉย ๆ = เอาค่าเริ่มต้น
    if text.isdigit():
        index = int(text) - 1
        return MODES[ORDER[index]] if 0 <= index < len(ORDER) else None
    return MODES.get(text)
