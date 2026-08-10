"""
ติดตามว่าใบหน้าที่เห็นในเฟรมนี้ คือคนเดียวกับเฟรมก่อนหรือเปล่า

รองรับหลายคนพร้อมกัน โดยใช้สามอย่างร่วมกันเพื่อกันการสลับ id:

  1. **ทำนายตำแหน่ง** จากความเร็วในเฟรมก่อน — คนที่กำลังเดินจะถูกจับคู่ถูกตัว
     แม้ขยับไปไกลระหว่างเฟรม
  2. **cost แบบผสม** — ระยะทาง + IoU ของกรอบ + ความต่างของขนาดใบหน้า
     ขนาดช่วยแยกคนที่อยู่ใกล้กล้องออกจากคนที่อยู่ไกล แม้ตำแหน่งบนภาพใกล้กัน
  3. **swap guard** — หลังจับคู่เสร็จ ตรวจทุกคู่ว่าถ้าสลับกันแล้ว cost รวมดีขึ้นไหม
     ถ้าดีขึ้นให้สลับ · แก้กรณีที่ greedy ตัดสินใจผิดตอนสองคนเดินไขว้กัน

**ข้อจำกัดที่ต้องรู้:** โมดูลนี้ไม่จำหน้าใคร มันจับคู่ตำแหน่งและโครงหน้าภายในเซสชัน
เท่านั้น id ที่แจกไปไม่ผูกกับตัวบุคคลและหายไปเมื่อปิดโปรแกรม

การจำ**ชื่อ**คนอยู่ใน `faces.py` แยกออกไป และทำงานเฉพาะเมื่อผู้ใช้วางรูปไว้ใน `faces/`
— โมดูลนี้ไม่รู้เรื่องนั้นเลย ชื่อถูกใส่ไว้ใน `Track.state["name"]` โดย main.py
(ดูหัวข้อความเป็นส่วนตัวใน README ก่อนวางรูป)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from landmarks import signature_distance as lm_signature_distance

# ค่าที่ใช้เมื่อจับคู่ไม่ได้เลย — สูงกว่า cost ที่เป็นไปได้ทุกกรณี
COST_IMPOSSIBLE = float("inf")


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """Intersection over Union ของกรอบสองอัน (x1, y1, x2, y2) พิกัด normalized"""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Detection:
    """ใบหน้าหนึ่งใบที่ตรวจพบในเฟรมปัจจุบัน"""

    cx: float
    cy: float
    box: tuple[float, float, float, float]
    # ลายเซ็นโครงหน้าจาก landmarks.face_signature() — ใช้จำ id เมื่อคนกลับเข้าเฟรม
    signature: tuple[float, ...] | None = None

    @property
    def size(self) -> float:
        """ขนาดใบหน้าโดยประมาณ (รากที่สองของพื้นที่กรอบ)"""
        return math.sqrt(
            max(0.0, self.box[2] - self.box[0]) * max(0.0, self.box[3] - self.box[1])
        )


@dataclass
class Track:
    """หนึ่ง id ที่กำลังติดตามอยู่ หรือเคยติดตามแล้วหายไป"""

    person_id: int
    cx: float
    cy: float
    box: tuple[float, float, float, float]
    last_seen: float
    vx: float = 0.0          # ความเร็วต่อวินาที ใช้ทำนายตำแหน่งถัดไป
    vy: float = 0.0
    hits: int = 1            # จับคู่สำเร็จมากี่เฟรม — ใช้บอกความน่าเชื่อถือ
    signature: tuple[float, ...] | None = None
    signature_n: int = 0     # จำนวนตัวอย่างที่เฉลี่ยเข้าไปในลายเซ็นแล้ว
    min_samples: int = 1     # ต้องมีกี่ตัวอย่างถึงจะเชื่อลายเซ็นได้
    reid_resolved: bool = False   # จับคู่กับคนเดิมได้แล้ว — เลิกพยายาม
    reid_attempts: int = 0        # ลองจับคู่ไปกี่ครั้งแล้ว (ยังไม่สำเร็จ)
    # id นี้ยังไม่แน่ — อาจกลายเป็น id เดิมของคนที่เคยหายไป เมื่อลายเซ็นสะสมพอ
    # ปลายทางไม่ควรบันทึก id ที่ยัง provisional เพราะอีกไม่กี่วินาทีมันจะเปลี่ยน
    provisional: bool = False
    sig_delta: float = 1.0        # ลายเซ็นเปลี่ยนไปเท่าไรตอนอัปเดตล่าสุด
    sig_stable_n: int = 0         # นิ่งติดต่อกันมากี่ครั้ง
    stable_eps: float = 0.0       # เปลี่ยนน้อยกว่านี้ = ถือว่านิ่ง
    stable_needed: int = 10**9    # ต้องนิ่งติดต่อกันกี่ครั้งถึงเชื่อได้
    # ให้ analyzer เก็บ state ต่อคน (EAR baseline, ท่านิ่ง, ตัวนับ) ไว้ตรงนี้
    state: dict = field(default_factory=dict)

    @property
    def size(self) -> float:
        return math.sqrt(
            max(0.0, self.box[2] - self.box[0]) * max(0.0, self.box[3] - self.box[1])
        )

    @property
    def signature_ready(self) -> bool:
        """
        ลายเซ็นเสถียรพอจะใช้จับคู่หรือยัง

        ต้องเฉลี่ยจากหลายเฟรม — จากการวัด ลายเซ็นจากเฟรมเดียว**แยกคนไม่ออกเลย**
        เพราะ landmark สั่นระหว่างเฟรมมากกว่าความต่างระหว่างคนที่หน้าคล้ายกัน
        การเฉลี่ยลด noise ลงตาม √N

        มีสองทางที่ถือว่าพร้อม:
          1. เก็บครบ min_samples เฟรม (เกณฑ์ปลอดภัยเสมอ)
          2. **ลายเซ็นหยุดขยับแล้ว** — ถ้าสภาพแสงและระยะดี ค่าจะนิ่งเร็วกว่านั้นมาก
             ทางนี้ทำให้จำคนได้เร็วขึ้นโดยไม่ลดความปลอดภัย เพราะความนิ่ง
             เป็นหลักฐานตรง ๆ ว่า noise ต่ำพอแล้ว
        """
        if self.signature is None:
            return False
        return self.signature_n >= self.min_samples or self.sig_stable_n >= self.stable_needed

    def predict(self, dt: float) -> tuple[float, float]:
        """ตำแหน่งที่คาดว่าจะอยู่หลังผ่านไป dt วินาที"""
        return self.cx + self.vx * dt, self.cy + self.vy * dt

    def learn_signature(self, sig: tuple[float, ...] | None, max_samples: int) -> None:
        """
        เฉลี่ยลายเซ็นใหม่เข้ากับของเดิมแบบ running mean

        หยุดถ่วงน้ำหนักหลังครบ max_samples เพื่อให้ลายเซ็นนิ่ง
        ไม่ถูกดึงไปมาจากเฟรมที่คนหันหน้าเอียงเล็กน้อย
        """
        if sig is None:
            return
        if self.signature is None:
            self.signature = tuple(sig)
            self.signature_n = 1
            return
        n = min(self.signature_n, max_samples)
        updated = tuple(
            (old * n + new) / (n + 1) for old, new in zip(self.signature, sig)
        )
        # วัดว่าค่าเฉลี่ยขยับไปแค่ไหน — ถ้าแทบไม่ขยับแปลว่าลายเซ็นนิ่งแล้ว
        self.sig_delta = lm_signature_distance(self.signature, updated)
        self.sig_stable_n = self.sig_stable_n + 1 if self.sig_delta <= self.stable_eps else 0
        self.signature = updated
        self.signature_n += 1

    def update(self, det: Detection, now: float, smoothing: float) -> None:
        dt = max(1e-3, now - self.last_seen)
        raw_vx = (det.cx - self.cx) / dt
        raw_vy = (det.cy - self.cy) / dt
        # เฉลี่ยความเร็วแบบ exponential — กันความเร็วกระโดดจาก landmark ที่สั่น
        self.vx = smoothing * self.vx + (1 - smoothing) * raw_vx
        self.vy = smoothing * self.vy + (1 - smoothing) * raw_vy
        self.cx, self.cy = det.cx, det.cy
        self.box = det.box
        self.last_seen = now
        self.hits += 1

    def revive(self, det: Detection, now: float) -> None:
        """กลับมาติดตามต่อหลังหายไป — ความเร็วเดิมใช้ไม่ได้แล้ว ต้องรีเซ็ต"""
        self.cx, self.cy = det.cx, det.cy
        self.box = det.box
        self.last_seen = now
        self.vx = self.vy = 0.0
        self.hits += 1


class PersonTracker:
    def __init__(self, tracker_cfg: dict):
        self.max_distance = tracker_cfg["max_distance"]
        self.forget_seconds = tracker_cfg["forget_seconds"]
        self.w_distance = tracker_cfg["weight_distance"]
        self.w_iou = tracker_cfg["weight_iou"]
        self.w_size = tracker_cfg["weight_size"]
        self.velocity_smoothing = tracker_cfg["velocity_smoothing"]
        self.use_prediction = tracker_cfg["use_prediction"]
        self.swap_guard = tracker_cfg["swap_guard"]

        # re-identification — จำ id เมื่อคนออกจากเฟรมแล้วกลับมา
        self.reid_enabled = tracker_cfg["reid_enabled"]
        # เฉลี่ยลายเซ็นข้ามเฟรมไหม — คนละเรื่องกับการจำคนที่ออกจากเฟรม
        # re-ID ต้องใช้ แต่การเทียบกับ**รูปในโฟลเดอร์** ก็ต้องใช้เหมือนกันโดยไม่ต้องมี pool
        # ไม่ระบุ = ตามค่า reid_enabled เพื่อให้ config เก่าได้พฤติกรรมเดิมเป๊ะ
        self.learn_signatures = tracker_cfg.get("learn_signatures", self.reid_enabled)
        self.reid_memory_seconds = tracker_cfg["reid_memory_seconds"]
        self.reid_threshold = tracker_cfg["reid_threshold"]
        self.reid_min_size = tracker_cfg["reid_min_size"]
        self.reid_max_samples = tracker_cfg["reid_max_samples"]
        self.reid_min_samples = tracker_cfg["reid_min_samples"]
        self.reid_ratio = tracker_cfg["reid_ratio"]
        self.reid_threshold_single = tracker_cfg["reid_threshold_single"]
        self.reid_max_pool = tracker_cfg["reid_max_pool"]
        self.reid_max_attempts = tracker_cfg["reid_max_attempts"]
        self.reid_stable_eps = tracker_cfg["reid_stable_eps"]
        self.reid_stable_needed = tracker_cfg["reid_stable_needed"]

        self._tracks: dict[int, Track] = {}   # กำลังเห็นอยู่ในเฟรม
        self._lost: dict[int, Track] = {}     # หายไปแล้ว แต่ยังจำลายเซ็นไว้
        self._next_id = 1
        self.reid_hits = 0                    # นับจำนวนครั้งที่คืน id เดิมสำเร็จ
        self.new_ids_issued = 0               # นับ id ใหม่ที่แจกไป (ยิ่งน้อยยิ่งดี)

    # ── การคิด cost ───────────────────────────────────────
    def _cost(self, track: Track, det: Detection, dt: float) -> float:
        """
        cost ยิ่งต่ำยิ่งน่าจะเป็นคนเดียวกัน

        รวมสามสัญญาณ: ระยะจากตำแหน่งที่ทำนายไว้ · 1−IoU ของกรอบ · ความต่างของขนาด
        """
        px, py = track.predict(dt) if self.use_prediction else (track.cx, track.cy)
        dist = math.hypot(det.cx - px, det.cy - py)
        if dist > self.max_distance:
            return COST_IMPOSSIBLE

        size_ratio = abs(track.size - det.size) / max(track.size, det.size, 1e-6)
        return (
            self.w_distance * (dist / max(self.max_distance, 1e-6))
            + self.w_iou * (1.0 - iou(track.box, det.box))
            + self.w_size * size_ratio
        )

    def _forget_stale(self, now: float) -> None:
        """
        ย้าย track ที่หายไปนานเกิน forget_seconds ไปกลุ่ม lost แทนการลบทิ้ง

        กลุ่ม lost เก็บไว้เพื่อคืน id เดิมถ้าคนกลับเข้ามาในเฟรมอีก
        และจะถูกลบจริงเมื่อเกิน reid_memory_seconds
        """
        for pid in [
            p for p, t in self._tracks.items() if now - t.last_seen > self.forget_seconds
        ]:
            track = self._tracks.pop(pid)
            if self.reid_enabled and track.signature_ready:
                self._lost[pid] = track

        for pid in [
            p for p, t in self._lost.items() if now - t.last_seen > self.reid_memory_seconds
        ]:
            del self._lost[pid]

        # จำกัดด้วย "จำนวนคน" เป็นหลัก ไม่ใช่เวลา — คนที่เดินออกไปนานแล้วกลับมา
        # ยังควรได้ id เดิม ตราบใดที่ยังจำไหว เอาคนที่เห็นล่าสุดนานที่สุดออกก่อน
        while len(self._lost) > self.reid_max_pool:
            oldest = min(self._lost.items(), key=lambda kv: kv[1].last_seen)[0]
            del self._lost[oldest]

    def _reidentify(self, det: Detection, live_sig: tuple[float, ...] | None) -> Track | None:
        """
        หา track ที่หายไปซึ่งลายเซ็นตรงกับใบหน้านี้มากที่สุด

        คืน None ถ้าไม่มั่นใจพอ — จะได้แจก id ใหม่แทน

        **หลักการออกแบบ: การแจก id ใหม่ผิด เสียหายน้อยกว่าการรวมข้อมูลสองคนเข้าด้วยกันมาก**
        จึงตั้งเงื่อนไขเข้มไว้สามชั้น
          1. ใบหน้าต้องใหญ่พอ — ใบหน้าเล็กให้ landmark ที่ไม่แม่น
          2. ระยะห่างต้องต่ำกว่า threshold
          3. **ratio test** — ตัวที่ใกล้ที่สุดต้องดีกว่าอันดับสองอย่างชัดเจน
             ถ้ามีสองคนที่คล้ายกันพอ ๆ กัน แปลว่าเดาไม่ได้ → ไม่เดา
        """
        if not (self.reid_enabled and self._lost and live_sig):
            return None
        if det.size < self.reid_min_size:
            return None

        scored = sorted(
            (
                (lm_signature_distance(t.signature, live_sig), t)
                for t in self._lost.values()
                if t.signature_ready
            ),
            key=lambda x: x[0],
        )
        if not scored:
            return None

        # มีผู้สมัครคนเดียว → ไม่มีใครให้สับสนด้วย จึงผ่อนเกณฑ์ได้
        # (ความเสี่ยงเดียวคือคนแปลกหน้าถูกนับเป็นคนเดิม ซึ่งต่ำกว่าความเสี่ยงจำสลับคนมาก)
        limit = self.reid_threshold if len(scored) > 1 else self.reid_threshold_single
        if scored[0][0] >= limit:
            return None
        if len(scored) > 1 and scored[0][0] > scored[1][0] * self.reid_ratio:
            return None            # อันดับหนึ่งกับสองใกล้กันเกินไป — ไม่เสี่ยงเดา
        return scored[0][1]

    def _apply_swap_guard(self, pairs: list, dets: list[Detection], dt: float) -> None:
        """
        ตรวจทุกคู่ว่าถ้าสลับ track กันแล้ว cost รวมต่ำลงไหม — ถ้าใช่ให้สลับ

        แก้กรณีคลาสสิกที่ greedy พลาด: สองคนเดินสวนกัน คนที่อยู่ใกล้กว่าเล็กน้อย
        ถูกหยิบไปก่อนทั้งที่จริง ๆ เป็นของอีกคน
        """
        improved = True
        guard = 0
        while improved and guard < len(pairs):
            improved = False
            guard += 1
            for i in range(len(pairs)):
                for j in range(i + 1, len(pairs)):
                    di, ti = pairs[i]
                    dj, tj = pairs[j]
                    now_cost = self._cost(ti, dets[di], dt) + self._cost(tj, dets[dj], dt)
                    swap_cost = self._cost(tj, dets[di], dt) + self._cost(ti, dets[dj], dt)
                    if swap_cost < now_cost:
                        pairs[i], pairs[j] = (di, tj), (dj, ti)
                        improved = True

    # ── API หลัก ──────────────────────────────────────────
    def assign(self, detections: list[Detection], now: float) -> list[Track]:
        """
        รับใบหน้าทั้งหมดในเฟรมนี้ คืน Track ตามลำดับเดียวกัน

        ใบหน้าที่จับคู่กับ track เดิมไม่ได้จะได้ id ใหม่
        """
        self._forget_stale(now)

        # dt เฉลี่ยจาก track ที่มีอยู่ — ใช้ทำนายตำแหน่ง
        dt = 0.0
        if self._tracks:
            dt = max(1e-3, now - max(t.last_seen for t in self._tracks.values()))

        # สร้างคู่ที่เป็นไปได้ทั้งหมด แล้วเรียงจาก cost ต่ำไปสูง
        candidates = []
        for di, det in enumerate(detections):
            for pid, track in self._tracks.items():
                c = self._cost(track, det, dt)
                if c < COST_IMPOSSIBLE:
                    candidates.append((c, di, pid))
        candidates.sort(key=lambda x: x[0])

        pairs: list[tuple[int, Track]] = []
        used_dets: set[int] = set()
        used_tracks: set[int] = set()
        for _c, di, pid in candidates:
            if di in used_dets or pid in used_tracks:
                continue
            pairs.append((di, self._tracks[pid]))
            used_dets.add(di)
            used_tracks.add(pid)

        if self.swap_guard and len(pairs) > 1:
            self._apply_swap_guard(pairs, detections, dt)

        result: list[Track | None] = [None] * len(detections)
        for di, track in pairs:
            track.update(detections[di], now, self.velocity_smoothing)
            result[di] = track

        # ใบหน้าที่จับคู่กับ track ที่กำลังเห็นอยู่ไม่ได้ = คนใหม่ (ชั่วคราว)
        #
        # ยัง re-ID ตอนนี้ไม่ได้ เพราะมีลายเซ็นแค่เฟรมเดียวซึ่งวัดแล้วว่าแยกคนไม่ออก
        # ต้องรอสะสมหลายเฟรมก่อน แล้วค่อยตัดสินใน _resolve_pending_reid()
        for di, det in enumerate(detections):
            if result[di] is not None:
                continue
            track = Track(
                person_id=self._next_id,
                cx=det.cx,
                cy=det.cy,
                box=det.box,
                last_seen=now,
                min_samples=self.reid_min_samples,
                stable_eps=self.reid_stable_eps,
                stable_needed=self.reid_stable_needed,
                # ถ้ามีคนอยู่ในกลุ่ม lost id นี้อาจกลายเป็น id เดิมได้ จึงยังไม่แน่
                provisional=bool(self.reid_enabled and self._lost),
            )
            self._tracks[self._next_id] = track
            self._next_id += 1
            self.new_ids_issued += 1
            result[di] = track

        # เรียนลายเซ็นจากใบหน้าที่ใหญ่พอเท่านั้น — ใบหน้าเล็กให้ landmark ที่ไม่แม่น
        if self.learn_signatures:
            for di, det in enumerate(detections):
                if det.size >= self.reid_min_size:
                    result[di].learn_signature(det.signature, self.reid_max_samples)
        # ส่วนการ**เทียบกับคนที่หายไป** ทำเฉพาะเมื่อเปิด re-ID จริง ๆ
        if self.reid_enabled:
            self._resolve_pending_reid(detections, result)

        return result  # type: ignore[return-value]

    def _resolve_pending_reid(self, detections: list[Detection], result: list) -> None:
        """
        track ที่สะสมลายเซ็นพอแล้ว → ลองเทียบกับคนที่เคยหายไป

        **ลองซ้ำได้หลายครั้ง** ไม่ใช่ตัดสินครั้งเดียวแล้วเลิก เพราะการลองครั้งแรก
        อาจล้มเหลวด้วยเหตุที่แก้ได้เอง เช่น
          - ตอนนั้นคนเดิมยังไม่ถูกย้ายเข้ากลุ่ม lost
          - ลายเซ็นยังไม่นิ่งพอ แล้วนิ่งขึ้นในเฟรมถัดมา
          - คนหันหน้าอยู่ ทำให้ลายเซ็นเพี้ยนชั่วคราว
        การเลิกตั้งแต่ครั้งแรกทำให้แจก id ใหม่ทั้งที่จริง ๆ จำได้

        ถ้าจับคู่ได้ จะ**คืน id เดิมและดึง state เดิมกลับมาด้วย** (EAR baseline · ท่านิ่ง)
        """
        for di, det in enumerate(detections):
            track = result[di]
            if track.reid_resolved or not track.signature_ready:
                continue
            if track.reid_attempts >= self.reid_max_attempts:
                track.provisional = False       # หมดโอกาสแล้ว — ยืนยันว่าเป็นคนใหม่จริง
                continue
            track.reid_attempts += 1

            old = self._reidentify(det, track.signature)
            if old is None:
                if not self._lost:
                    track.provisional = False   # ไม่มีใครให้เทียบแล้ว = คนใหม่แน่นอน
                continue
            track.reid_resolved = True
            track.provisional = False

            del self._lost[old.person_id]
            self._tracks.pop(track.person_id, None)
            # ย้าย id และ state เดิมมาใส่ track ปัจจุบัน แล้วเก็บลายเซ็นที่เฉลี่ยมากกว่าไว้
            if old.signature_n > track.signature_n:
                track.signature = old.signature
                track.signature_n = old.signature_n
            track.person_id = old.person_id
            track.state = old.state
            self._tracks[track.person_id] = track
            self.reid_hits += 1

    @property
    def active_count(self) -> int:
        return len(self._tracks)

    @property
    def lost_count(self) -> int:
        """จำนวนคนที่ยังจำลายเซ็นไว้แต่ไม่เห็นในเฟรมแล้ว"""
        return len(self._lost)

    @property
    def tracks(self) -> list[Track]:
        return list(self._tracks.values())

    def forget_all(self) -> None:
        """ลืมทุก id และทุกลายเซ็นทันที — ผูกกับปุ่มลัดเพื่อความเป็นส่วนตัว"""
        self._tracks.clear()
        self._lost.clear()
