"""
ส่งสรุปแต่ละหน้าต่างขึ้นตาราง Supabase — ทนเน็ตหลุดและไม่ถ่วงลูปกล้อง

**ข้อบังคับสองข้อที่กำหนดรูปร่างของโมดูลนี้:**

1. **ห้ามถ่วงลูปกล้อง** การ POST ที่ค้าง 10 วินาทีระหว่างลูปหมายถึงเฟรมหายไป 150 เฟรม
   และ landmark ที่ขาดช่วงทำให้การนับหันหน้าเพี้ยน จึงส่งจากเธรดแยก · `send()`
   แค่หย่อนแถวลงคิวแล้วคืนทันที
2. **เน็ตหลุดต้องไม่ทำข้อมูลหาย** คิวอยู่ใน RAM ระหว่างทำงาน และถูกเขียนลงดิสก์
   เมื่อดูเหมือนออฟไลน์จริง ๆ หรือเมื่อปิดโปรแกรม แล้วอ่านกลับตอนเปิดครั้งถัดไป

**การแยกประเภทความล้มเหลว** (สำคัญกว่าที่คิด):
  - 5xx / timeout / เน็ตหลุด → **ลองใหม่** พร้อมหน่วงเพิ่มเป็นเท่าตัว ปัญหาอยู่ปลายทาง
  - 4xx → **ไม่ลองใหม่** payload ผิดหรือ key ไม่ถูก ลองอีกกี่ครั้งก็ผิดเหมือนเดิม
    ทิ้งแถวนั้นแล้วบอกเหตุผลออกมา ดีกว่าวนซ้ำจนคิวเต็มด้วยแถวที่ไม่มีวันผ่าน

**เรื่องการ์ด SD:** ไม่เขียนดิสก์ทุกแถวที่ส่งไม่ผ่าน เพราะการเขียนถี่ ๆ กินอายุการ์ด
เขียนเมื่อหน่วงถึงเพดาน (แปลว่าออฟไลน์นานจริง) และตอนปิดโปรแกรมเท่านั้น
แลกกับความเสี่ยงว่าถ้าไฟดับตอนออฟไลน์ไม่ถึงเพดาน จะเสียแถวที่ยังอยู่ใน RAM
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path


class Uploader:
    """
    คิวส่งข้อมูลขึ้น Supabase

    `post` คือฟังก์ชันส่ง HTTP จริง แยกออกมาเป็นพารามิเตอร์เพื่อให้ทดสอบได้
    ทั้งกรณีสำเร็จ · 4xx · 5xx · เน็ตหลุด โดยไม่ต้องมีเซิร์ฟเวอร์
    คืน status code (int) หรือโยน exception เมื่อเชื่อมต่อไม่ได้
    """

    def __init__(self, cfg: dict, post=None, log=print):
        # ตัด /rest/v1 ที่ติดมาด้วยทิ้ง — URL ที่ก๊อปจากหน้า Supabase มีท่อนนี้อยู่แล้ว
        # และ _urllib_post เติมให้เองอีกที ปล่อยไว้จะได้ /rest/v1/rest/v1/... = 404
        self.url = cfg["url"].rstrip("/").removesuffix("/rest/v1")
        self.key = cfg["key"]
        self.focus_table = cfg["focus_table"]
        self.room_table = cfg["room_table"]
        self.timeout = cfg["timeout_seconds"]
        self.queue_path = Path(cfg["queue_path"])
        self.retry_base = cfg["retry_base_seconds"]
        self.retry_max = cfg["retry_max_seconds"]
        self._log = log
        self._post = post or self._urllib_post

        # maxlen ทำหน้าที่ทิ้งแถวเก่าสุดให้เองเมื่อเต็ม — ตรงกับกฎ FIFO ที่ต้องการ
        self._queue: deque = deque(maxlen=cfg["queue_max"])
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._delay = 0.0
        self._dirty = False          # มีแถวใน RAM ที่ยังไม่ถูกเขียนลงดิสก์
        self.sent = 0
        self.dropped = 0

        self._load_queue()

    # ── สถานะ ────────────────────────────────────────────
    @property
    def enabled(self) -> bool:
        """ไม่มี url/key = ปิดใช้งาน · โปรแกรมส่วนอื่นทำงานได้ครบเหมือนเดิม"""
        return bool(self.url and self.key)

    @property
    def pending(self) -> int:
        with self._lock:
            return len(self._queue)

    # ── คิวบนดิสก์ ────────────────────────────────────────
    def _load_queue(self) -> None:
        """อ่านแถวที่ค้างจากรอบก่อน แล้วล้างไฟล์ทิ้ง (ถือว่าย้ายเข้า RAM แล้ว)"""
        if not self.queue_path.exists():
            return
        try:
            lines = self.queue_path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            self._log(f"[uploader] อ่านคิวเก่าไม่ได้: {exc}")
            return
        restored = 0
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                self._queue.append(json.loads(line))
                restored += 1
            except json.JSONDecodeError:
                continue          # แถวที่พังจากไฟดับกลางเขียน — ข้ามไปเงียบ ๆ
        self.queue_path.unlink(missing_ok=True)
        if restored:
            self._log(f"[uploader] กู้คิวค้างจากรอบก่อน {restored} แถว")

    def persist(self) -> int:
        """เขียนแถวที่ยังไม่ได้ส่งลงดิสก์ คืนจำนวนแถวที่เขียน"""
        with self._lock:
            rows = list(self._queue)
        if not rows:
            self.queue_path.unlink(missing_ok=True)
            self._dirty = False
            return 0
        try:
            self.queue_path.write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
                encoding="utf-8",
            )
        except OSError as exc:
            self._log(f"[uploader] เขียนคิวลงดิสก์ไม่ได้: {exc}")
            return 0
        self._dirty = False
        return len(rows)

    # ── การส่ง ───────────────────────────────────────────
    def _urllib_post(self, table: str, row: dict) -> int:
        """POST หนึ่งแถวผ่าน Supabase REST — ใช้ urllib จึงไม่เพิ่ม dependency"""
        request = urllib.request.Request(
            f"{self.url}/rest/v1/{table}",
            data=json.dumps(row, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                # ไม่ต้องให้ส่งแถวที่บันทึกกลับมา — ประหยัดแบนด์วิดท์บนเน็ตมือถือ
                "Prefer": "return=minimal",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return response.status

    def send(self, row: dict, room: bool = False) -> bool:
        """
        หย่อนแถวลงคิว — คืนทันที ไม่รอเครือข่าย

        คืน False เมื่อไม่ได้ส่ง (ปิดใช้งาน หรือโหมดนี้ไม่มีตารางรองรับ)
        """
        if not self.enabled:
            return False
        table = self.room_table if room else self.focus_table
        if not table:
            return False
        with self._lock:
            was_full = len(self._queue) == self._queue.maxlen
            self._queue.append({"_table": table, "_row": row})
            self._dirty = True
        if was_full:
            self.dropped += 1
            self._log("[uploader] คิวเต็ม — ทิ้งแถวเก่าสุด")
        self._wake.set()
        return True

    def drain_once(self) -> str:
        """
        พยายามส่งแถวหน้าสุดหนึ่งแถว คืนผลเป็นสตริงเพื่อให้ทดสอบและ log ได้

        "empty" · "sent" · "dropped" (4xx) · "retry" (5xx/เน็ตหลุด)
        """
        with self._lock:
            if not self._queue:
                return "empty"
            item = self._queue[0]

        try:
            status = self._post(item["_table"], item["_row"])
        except Exception as exc:                      # เน็ตหลุด · DNS ล่ม · timeout
            self._backoff(f"ส่งไม่ได้ ({exc})")
            return "retry"

        if 200 <= status < 300:
            with self._lock:
                if self._queue and self._queue[0] is item:
                    self._queue.popleft()
                self._dirty = True
            self.sent += 1
            self._delay = 0.0
            return "sent"

        if 400 <= status < 500:
            # payload ผิดหรือ key ไม่ถูก — ลองใหม่ก็ได้ผลเดิม
            with self._lock:
                if self._queue and self._queue[0] is item:
                    self._queue.popleft()
                self._dirty = True
            self.dropped += 1
            self._log(f"[uploader] HTTP {status} — ทิ้งแถวนี้ (ไม่ลองใหม่): {item['_row']}")
            return "dropped"

        self._backoff(f"HTTP {status}")
        return "retry"

    def _backoff(self, reason: str) -> None:
        """เพิ่มหน่วงเป็นเท่าตัว และเขียนคิวลงดิสก์เมื่อหน่วงถึงเพดาน"""
        self._delay = min(self.retry_max, self._delay * 2 or self.retry_base)
        self._log(f"[uploader] {reason} — ลองใหม่ใน {self._delay:.0f}s (ค้าง {self.pending} แถว)")
        # ถึงเพดานแล้วแปลว่าออฟไลน์นานจริง คุ้มที่จะเขียนดิสก์
        if self._delay >= self.retry_max and self._dirty:
            self.persist()

    # ── เธรดเบื้องหลัง ────────────────────────────────────
    def start(self) -> None:
        if not self.enabled or self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="uploader", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            result = self.drain_once()
            if result == "empty":
                self._wake.wait(timeout=1.0)
                self._wake.clear()
            elif result == "retry":
                # รอแบบตื่นได้ เพื่อให้ close() ไม่ต้องรอครบ 60 วินาที
                self._stop.wait(timeout=self._delay)

    def close(self, drain_seconds: float = 2.0) -> None:
        """
        พยายามส่งที่ค้างสักครู่ แล้วเก็บที่เหลือลงดิสก์

        ไม่รอจนหมดคิว เพราะการปิดโปรแกรมต้องเร็ว — ที่เหลือรอบหน้าส่งต่อได้
        """
        deadline = time.monotonic() + drain_seconds
        while self.pending and time.monotonic() < deadline:
            if self.drain_once() in ("retry", "empty"):
                break
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        left = self.persist()
        if left:
            self._log(f"[uploader] เก็บ {left} แถวที่ยังส่งไม่ได้ลง {self.queue_path}")
