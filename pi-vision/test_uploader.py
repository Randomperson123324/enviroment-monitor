#!/usr/bin/env python3
"""
ทดสอบตัวส่งข้อมูลขึ้น Supabase โดยไม่ต้องมีเน็ตหรือเซิร์ฟเวอร์

Uploader รับฟังก์ชันส่ง HTTP เข้ามาเป็นพารามิเตอร์ จึงจำลองได้ทุกกรณีที่สำคัญ
และเรียก drain_once() เองแบบ synchronous ได้ ทำให้เทสไม่ต้องพึ่ง sleep และไม่แกว่ง

ตรวจสิ่งที่จะทำข้อมูลหายหรือทำคิวตันถ้าโค้ดผิด:
  - 4xx ต้อง **ไม่** ลองใหม่ (payload ผิด ลองอีกก็ผิดเหมือนเดิม จะตันคิวไปเปล่า ๆ)
  - 5xx / เน็ตหลุด ต้องลองใหม่ และแถวต้องยังอยู่ในคิว
  - หน่วงต้องเพิ่มเป็นเท่าตัวและไม่เกินเพดาน
  - คิวเต็มต้องทิ้ง**แถวเก่าสุด** ไม่ใช่แถวใหม่
  - ปิดโปรแกรมแล้วแถวที่ค้างต้องอยู่บนดิสก์ และรอบถัดไปต้องอ่านกลับมาส่งต่อได้
  - ไม่มี url/key = ปิดตัวเอง ไม่ใช่พังหรือส่งไปที่ว่าง

รัน:  python3 test_uploader.py
"""

import json
import sys
import tempfile
from pathlib import Path

from uploader import Uploader

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


def cfg(tmp, **over):
    base = {
        "url": "https://example.supabase.co",
        "key": "test-key",
        "focus_table": "focus",
        "room_table": "",
        "timeout_seconds": 1.0,
        "queue_path": str(Path(tmp) / "queue.jsonl"),
        "queue_max": 5000,
        "retry_base_seconds": 1.0,
        "retry_max_seconds": 8.0,
    }
    base.update(over)
    return base


ROW = {"person": 1, "movement": 3, "direction": {"Left": 1}, "face_count": 1,
       "name": "Ann", "emotion": "happy"}

print("\n── การส่งปกติ ─────────────────────────────────────────")

with tempfile.TemporaryDirectory() as tmp:
    seen = []
    up = Uploader(cfg(tmp), post=lambda table, row: (seen.append((table, row)), 201)[1], log=lambda *_: None)
    check("มี url/key → เปิดใช้งาน", up.enabled)
    up.send(ROW)
    check("send() หย่อนลงคิวแล้วคืนทันที", up.pending == 1)
    check("ส่งสำเร็จ → ออกจากคิว", up.drain_once() == "sent" and up.pending == 0)
    check("ส่งไปตารางที่ตั้งไว้ พร้อมคอลัมน์ใหม่",
          seen[0][0] == "focus" and seen[0][1]["emotion"] == "happy")
    check("คิวว่างแล้ว drain ต่อได้ ไม่พัง", up.drain_once() == "empty")

with tempfile.TemporaryDirectory() as tmp:
    up = Uploader(cfg(tmp, url="", key=""), post=lambda *a: 201, log=lambda *_: None)
    check("ไม่มี url/key → ปิดตัวเอง", not up.enabled)
    check("ปิดอยู่ → send() ไม่เข้าคิว", up.send(ROW) is False and up.pending == 0)

with tempfile.TemporaryDirectory() as tmp:
    up = Uploader(cfg(tmp), post=lambda *a: 201, log=lambda *_: None)
    check("โหมดห้องรวมที่ไม่มีตาราง → ไม่ส่ง (ไม่ใช่ส่งผิดตาราง)",
          up.send({"occupancy": 3}, room=True) is False)

print("\n── ความล้มเหลวคนละชนิดต้องจัดการคนละแบบ ───────────────")

with tempfile.TemporaryDirectory() as tmp:
    logs = []
    up = Uploader(cfg(tmp), post=lambda *a: 400, log=logs.append)
    up.send(ROW)
    check("4xx → ทิ้งแถว ไม่ลองใหม่", up.drain_once() == "dropped" and up.pending == 0)
    check("4xx → บอกเหตุผลออกมา ไม่เงียบหาย",
          any("400" in m for m in logs) and up.dropped == 1)

with tempfile.TemporaryDirectory() as tmp:
    up = Uploader(cfg(tmp), post=lambda *a: 503, log=lambda *_: None)
    up.send(ROW)
    check("5xx → ลองใหม่ และแถวยังอยู่ในคิว",
          up.drain_once() == "retry" and up.pending == 1)

with tempfile.TemporaryDirectory() as tmp:
    def dead(*_a):
        raise OSError("network unreachable")

    up = Uploader(cfg(tmp), post=dead, log=lambda *_: None)
    up.send(ROW)
    check("เน็ตหลุด → ลองใหม่ ไม่ทิ้งข้อมูล",
          up.drain_once() == "retry" and up.pending == 1)

    delays = []
    for _ in range(5):
        up.drain_once()
        delays.append(up._delay)
    check("หน่วงเพิ่มเป็นเท่าตัว", delays[:3] == [2.0, 4.0, 8.0], f"({delays})")
    check("หน่วงไม่เกินเพดาน", max(delays) == 8.0, f"({delays})")

with tempfile.TemporaryDirectory() as tmp:
    calls = {"n": 0}

    def flaky(*_a):
        calls["n"] += 1
        return 503 if calls["n"] == 1 else 201

    up = Uploader(cfg(tmp), post=flaky, log=lambda *_: None)
    up.send(ROW)
    up.drain_once()                                   # ล้มครั้งแรก
    check("กลับมาออนไลน์ → ส่งแถวเดิมได้และหน่วงถูกรีเซ็ต",
          up.drain_once() == "sent" and up._delay == 0.0 and up.pending == 0)

print("\n── คิวเต็มและการเก็บลงดิสก์ ────────────────────────────")

with tempfile.TemporaryDirectory() as tmp:
    up = Uploader(cfg(tmp, queue_max=3), post=lambda *a: 503, log=lambda *_: None)
    for i in range(5):
        up.send({**ROW, "movement": i})
    rows = [item["_row"]["movement"] for item in up._queue]
    check("คิวเต็ม → ทิ้งแถวเก่าสุด เก็บแถวใหม่ไว้", rows == [2, 3, 4], f"({rows})")
    check("นับจำนวนที่ทิ้งไว้ให้ตรวจได้", up.dropped == 2, f"({up.dropped})")

with tempfile.TemporaryDirectory() as tmp:
    conf = cfg(tmp)
    up = Uploader(conf, post=lambda *a: 503, log=lambda *_: None)
    up.send(ROW)
    up.send({**ROW, "movement": 9})
    up.close(drain_seconds=0)
    saved = Path(conf["queue_path"])
    check("ปิดโปรแกรม → แถวที่ค้างถูกเขียนลงดิสก์", saved.exists())
    lines = [json.loads(l) for l in saved.read_text(encoding="utf-8").splitlines() if l.strip()]
    check("เขียนครบทุกแถวที่ค้าง", len(lines) == 2, f"({len(lines)})")

    # รอบถัดไป: ต้องอ่านคิวกลับมาและส่งต่อได้
    sent = []
    up2 = Uploader(conf, post=lambda t, r: (sent.append(r), 201)[1], log=lambda *_: None)
    check("รอบถัดไปอ่านคิวค้างกลับมา", up2.pending == 2)
    check("อ่านแล้วลบไฟล์คิว (ถือว่าย้ายเข้า RAM แล้ว)", not saved.exists())
    up2.drain_once()
    up2.drain_once()
    check("ส่งแถวที่ค้างได้ครบ เรียงเดิม",
          up2.pending == 0 and [r["movement"] for r in sent] == [3, 9],
          f"({[r['movement'] for r in sent]})")

with tempfile.TemporaryDirectory() as tmp:
    conf = cfg(tmp)
    Path(conf["queue_path"]).write_text('{"_table":"focus","_row":{"movement":1}}\n{ครึ่งบรรทัดที่พัง\n',
                                        encoding="utf-8")
    up = Uploader(conf, post=lambda *a: 201, log=lambda *_: None)
    check("แถวที่พังจากไฟดับกลางเขียน → ข้ามไป ไม่ทำให้เปิดโปรแกรมไม่ได้", up.pending == 1)

with tempfile.TemporaryDirectory() as tmp:
    up = Uploader(cfg(tmp), post=lambda *a: 201, log=lambda *_: None)
    up.close(drain_seconds=0)
    check("ไม่มีอะไรค้าง → ไม่ทิ้งไฟล์คิวเปล่าไว้", not Path(cfg(tmp)["queue_path"]).exists())

print("\n" + "─" * 56)
if FAILURES:
    print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
    sys.exit(1)
print("ผ่านทั้งหมด")
