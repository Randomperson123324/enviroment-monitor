#!/usr/bin/env python3
"""
วัดผลของการตั้งค่า re-identification — จำลองสถานการณ์จริงแล้วนับสองอย่าง

  1. **id ใหม่ที่แจกไป** — ยิ่งน้อยยิ่งดี (เป้าหมายที่ขอ)
  2. **การจำสลับคน** — ต้องเป็น 0 เสมอ ไม่ว่าจะปรับอะไร

ข้อ 2 สำคัญกว่าข้อ 1 มาก เพราะการรวมข้อมูลสองคนเข้าด้วยกันทำให้ข้อมูลเสียหาย
โดยไม่มีสัญญาณเตือน ส่วนการแจก id ใหม่แค่ทำให้ข้อมูลกระจัดกระจาย

รัน:  python3 bench_reid.py
"""

import random

import landmarks as lm
from fixtures import PEOPLE, detection as det, make_face, noisy
from tracker import PersonTracker

# ── สถานการณ์จำลอง ──────────────────────────────────────
SCENARIO = {
    "fps": 15,
    "noise": 0.015,          # landmark สั่น ±1.5% ต่อเฟรม
    "seed": 20260802,
}

BASE_CFG = {
    "max_distance": 0.25,
    "weight_distance": 0.5,
    "weight_iou": 0.35,
    "weight_size": 0.15,
    "use_prediction": True,
    "velocity_smoothing": 0.6,
    "swap_guard": True,
    "reid_enabled": True,
    "reid_threshold": 0.05,
    "reid_min_size": 0.12,
    "reid_max_samples": 30,
    "reid_min_samples": 15,
    "reid_ratio": 0.75,
    "reid_max_pool": 30,
    "reid_threshold_single": 0.08,
    "reid_stable_eps": 0.006,
    "reid_stable_needed": 5,
}

CURRENT = {
    **BASE_CFG,
    "forget_seconds": 6.0,
    "reid_memory_seconds": 3600.0,
    "reid_max_attempts": 60,
    "reid_threshold_single": 0.08,
    "reid_stable_needed": 5,
}
NO_REID = {**CURRENT, "reid_enabled": False}
ONE_SHOT = {**CURRENT, "reid_max_attempts": 1, "reid_threshold_single": 0.05}
# เผื่อไว้ให้สคริปต์อื่น import ได้
AFTER = CURRENT


def build_timeline(fps):
    """
    ตารางเวลาว่าใครอยู่ในเฟรมบ้าง — เลียนแบบการใช้งานจริงในห้องเรียน

    คืน list ของ (วินาที, [ชื่อคนที่อยู่ในเฟรม])
    """
    events = []

    def add(seconds, who):
        for _ in range(int(seconds * fps)):
            events.append(list(who))

    add(8, ["A"])            # A นั่งทำงาน
    add(0.4, [])             # หลุดสั้น ๆ — หันหน้า/มีคนเดินบัง
    add(6, ["A"])
    add(0.6, [])             # หลุดสั้นอีกครั้ง
    add(6, ["A"])
    add(15, [])              # A ลุกไปเข้าห้องน้ำ
    add(8, ["A"])            # A กลับมา
    add(6, ["A", "B"])       # B เข้ามาด้วย
    add(0.5, ["A"])          # B หลุดชั่วครู่
    add(8, ["A", "B"])
    add(20, [])              # ทั้งคู่ออกไปพัก
    add(8, ["A", "B"])       # กลับมาทั้งคู่
    add(6, ["A", "B", "C"])  # C เข้ามาเพิ่ม
    return events


def run(cfg, label, skip_provisional=True):
    rng = random.Random(SCENARIO["seed"])
    fps = SCENARIO["fps"]
    tk = PersonTracker(cfg)

    # ตำแหน่งประจำของแต่ละคน — ไม่ทับกัน
    slot = {"A": 0.25, "B": 0.55, "C": 0.82}
    id_history: dict[str, set] = {k: set() for k in slot}
    id_owner: dict[int, str] = {}
    swaps = 0

    t = 0.0
    for present in build_timeline(fps):
        dets = []
        for who in present:
            pts = noisy(
                make_face(cx=slot[who], size=0.30, **PEOPLE[who]), SCENARIO["noise"], rng
            )
            dets.append(det(pts))
        tracks = tk.assign(dets, t)
        for who, tr in zip(present, tracks):
            if skip_provisional and tr.provisional:
                continue                        # ยังไม่แน่ — ปลายทางจะยังไม่บันทึก
            id_history[who].add(tr.person_id)
            owner = id_owner.get(tr.person_id)
            if owner is None:
                id_owner[tr.person_id] = who
            elif owner != who:
                swaps += 1                      # id เดียวถูกใช้กับคนละคน
        t += 1.0 / fps

    total_ids = sum(len(v) for v in id_history.values())
    print(
        f"{label:8} | id ใหม่ทั้งหมด {tk.new_ids_issued:3} | "
        f"จำได้ {tk.reid_hits:3} ครั้ง | "
        + " ".join(f"{k}={len(v)}" for k, v in id_history.items())
        + f" | รวม {total_ids} id สำหรับ 3 คน | จำสลับคน {swaps}"
    )
    return tk.new_ids_issued, swaps, total_ids


print("สถานการณ์: A นั่งทำงาน → หลุดสั้น ๆ 2 ครั้ง → ออกไป 15 วิ → กลับมา")
print("           → B เข้ามา → ทั้งคู่ออกไป 20 วิ → กลับมา → C เข้ามา")
print(f"landmark สั่น ±{SCENARIO['noise']*100:.1f}% ต่อเฟรม · {SCENARIO['fps']} fps\n")
print("อุดมคติ: 3 id สำหรับ 3 คน · จำสลับคน 0\n")

off = run(NO_REID, "ปิด re-ID")
raw = run(CURRENT, "ไม่กรอง", skip_provisional=False)
one = run(ONE_SHOT, "ลองครั้งเดียว")
now = run(CURRENT, "ปัจจุบัน")

print()
print(f"ปิด re-ID    : ปลายทางเห็น {off[2]} id  (แต่ละครั้งที่ออกไปแล้วกลับมา = คนใหม่)")
print(f"ไม่กรองชั่วคราว: ปลายทางเห็น {raw[2]} id  (เห็น id ชั่วคราวก่อนระบบตัดสินใจได้)")
print(f"ลองครั้งเดียว : ปลายทางเห็น {one[2]} id")
print(f"**ปัจจุบัน**   : ปลายทางเห็น {now[2]} id  ← อุดมคติคือ 3")
print()
print(f"การจำสลับคน — ต้องเป็น 0 ทุกแบบ: "
      f"ปิด={off[1]} ไม่กรอง={raw[1]} ครั้งเดียว={one[1]} ปัจจุบัน={now[1]}"
      + ("  ✓" if max(off[1], raw[1], one[1], now[1]) == 0 else "  ✗ มีการจำสลับคน"))
