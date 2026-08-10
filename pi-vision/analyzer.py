"""
ตรรกะการวิเคราะห์ — แปลง landmark ดิบให้กลายเป็นตัวเลขที่มีความหมาย

หน้าที่หลัก:
  1. หาท่านิ่ง (neutral pose) **ของแต่ละคน** อัตโนมัติในช่วงไม่กี่วินาทีแรก
  2. เรียนค่า EAR ตาเปิด **ของแต่ละคน** แล้วตั้งเกณฑ์การกะพริบเป็นสัดส่วนของค่านั้น
     — จำเป็นมากเมื่อมีหลายคน เพราะรูปตาแต่ละคนให้ค่า EAR ต่างกันได้เกิน 2 เท่า
  3. นับ "เหตุการณ์" การหันหน้า — หันค้างหนึ่งครั้ง = นับ 1 ไม่ใช่นับทุกเฟรม
  4. ตัดใบหน้าที่เล็กเกินกว่าจะวัดได้น่าเชื่อถือออกจากการวิเคราะห์ (quality gating)

แล้วสรุปทุก WINDOW_SECONDS ให้อยู่ในรูปแบบเดียวกับตาราง `focus` ของโปรเจกต์
"""

from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass, field

import emotion as em
import landmarks as lm

# ชื่อทิศทาง — ต้องตรงกับที่ components/FocusSection.jsx ใช้เป๊ะ ๆ
DIR_LEFT = "Left"
DIR_RIGHT = "Right"
DIR_UP = "Up"
DIR_DOWN = "Down"
DIRECTIONS = (DIR_LEFT, DIR_RIGHT, DIR_UP, DIR_DOWN)

SECONDS_PER_MINUTE = 60.0

# วิธีตรวจการกะพริบตา
BLINK_BLENDSHAPE = "blendshape"
BLINK_EAR = "ear"
BLINK_AUTO = "auto"
BLINK_OFF = "off"                # โหมดที่ไม่วัดตาเลย

# วิธีคำนวณการหันหน้า
POSE_GEOMETRIC = "geometric"
POSE_MATRIX = "matrix"
POSE_AUTO = "auto"


def empty_direction_counts() -> dict[str, int]:
    return {d: 0 for d in DIRECTIONS}


@dataclass
class FaceInput:
    """ข้อมูลดิบของใบหน้าหนึ่งใบใน 1 เฟรม ที่ main ส่งเข้ามา"""

    landmarks: object
    blendshapes: object = None       # list ของ Category หรือ None
    matrix: object = None            # numpy 4×4 หรือ None


@dataclass
class FaceReading:
    """ผลวิเคราะห์ของใบหน้าหนึ่งใบใน 1 เฟรม — ใช้วาดบนหน้าจอ"""

    person_id: int
    box: tuple[float, float, float, float]
    ear: float
    blink_score: float               # 0–1 · ยิ่งสูงยิ่งตาปิด (จาก blendshape หรือแปลงจาก EAR)
    ear_threshold: float             # เกณฑ์ที่ใช้จริงกับคนนี้
    yaw: float
    pitch: float
    direction: str | None
    calibrating: bool
    calibration_progress: float
    blinks: int
    blink_rate_per_min: float
    drowsy: bool
    eyes_closed_seconds: float
    movement_in_window: int
    quality: float                   # 0–1 · ต่ำ = ใบหน้าเล็กเกินกว่าจะเชื่อค่า EAR
    usable: bool                     # ผ่านเกณฑ์ quality ไหม
    blink_method: str
    pose_method: str
    # การแสดงออกบนใบหน้าที่นิ่งแล้ว (emotion.py) · None = ปิดไว้หรือไม่มี blendshapes
    emotion: str | None = None
    # ชื่อจากแกลเลอรีรูป (faces.py) · None = ไม่มีรูป หรือเทียบแล้วไม่มั่นใจ
    name: str | None = None


@dataclass
class WindowSummary:
    """สรุปหนึ่งหน้าต่างเวลา — รูปแบบตรงกับ 1 แถวของตาราง focus"""

    started_at: float
    ended_at: float
    person: int | None
    movement: int
    direction: dict[str, int]
    face_count: int
    avg_ear: float | None
    blinks: int
    usable_faces: int = 0            # จำนวนใบหน้าที่ผ่าน quality gate

    # ── ค่าระดับห้อง ──────────────────────────────────────
    # จำนวนคนแบบมัธยฐานตลอดหน้าต่าง — ทนกว่า face_count ซึ่งเป็นค่าสูงสุด
    # และจึงกระโดดตามเงาหรือใบหน้าที่ตรวจเจอแวบเดียว
    occupancy: int = 0
    # กี่ครั้งที่วัดได้ว่า "หน้าอยู่กลาง" เทียบกับจำนวนครั้งที่วัดได้ทั้งหมด
    # None = ยังไม่มีใบหน้าที่ calibrate เสร็จให้วัด (ต่างจาก 0.0 ที่แปลว่าไม่มีใครมองตรงเลย)
    attention_ratio: float | None = None
    people_measured: int = 0         # จำนวนคนที่มีข้อมูลจริงในหน้าต่างนี้
    # การแสดงออกของคนที่รายงาน (person) ตอนปิดหน้าต่าง
    emotion: str | None = None
    # ชื่อของคนนั้นถ้าจำได้จากแกลเลอรีรูป — person ยังเป็นเลข track เหมือนเดิม
    # เก็บทั้งสองอย่างเพราะเป็นตัวตนต่างชนิด: เลขคือ "คนเดิมในเซสชันนี้"
    # ชื่อคือ "คนนี้คือใคร" และอาจไม่รู้ก็ได้
    name: str | None = None

    @property
    def duration(self) -> float:
        return self.ended_at - self.started_at

    def movement_per_minute(self) -> float:
        return self.movement * SECONDS_PER_MINUTE / max(self.duration, 1e-6)

    def movement_per_person_per_minute(self) -> float:
        """
        อัตราการหันหน้าเฉลี่ย **ต่อคน** — ตัวนี้เท่านั้นที่เทียบข้ามคาบที่มีคนไม่เท่ากันได้
        ห้อง 30 คนย่อมมีการขยับรวมมากกว่าห้อง 5 คนโดยที่สมาธิไม่ได้แย่กว่าเลย
        """
        return self.movement_per_minute() / max(self.people_measured, 1)

    def to_focus_row(self) -> dict:
        """
        แปลงเป็น payload ที่ INSERT ลงตาราง focus ได้ตรง ๆ

        `name` และ `emotion` ต้องมีคอลัมน์รองรับก่อน (ดู README หัวข้อฐานข้อมูล)
        ค่าที่เป็น None แปลว่า "ไม่รู้" ไม่ใช่ "ไม่มี" — ปลายทางอย่าตีความเป็นค่าว่าง
        """
        return {
            "person": self.person,
            "movement": self.movement,
            "direction": dict(self.direction),
            "face_count": self.face_count,
            "name": self.name,
            "emotion": self.emotion,
        }

    def to_room_row(self) -> dict:
        """
        payload สำหรับโหมดห้องรวม — ไม่มีคอลัมน์ person เพราะโหมดนี้ไม่รู้ว่าใครเป็นใคร
        ตั้งใจแยกเมธอดออกจาก to_focus_row() เพื่อให้ไม่มีทางเผลอส่ง id รายคนออกไป
        """
        return {
            "occupancy": self.occupancy,
            "peak_occupancy": self.face_count,
            "movement_per_person_per_min": round(self.movement_per_person_per_minute(), 2),
            "attention_ratio": (
                round(self.attention_ratio, 3) if self.attention_ratio is not None else None
            ),
            "direction": dict(self.direction),
        }


@dataclass
class _PersonState:
    """state สะสมต่อคน — เก็บใน Track.state จึงหายไปพร้อมกับ id"""

    # ท่านิ่ง
    yaw_buf: deque = field(default_factory=deque)
    pitch_buf: deque = field(default_factory=deque)
    calib_yaw: list = field(default_factory=list)
    calib_pitch: list = field(default_factory=list)
    calib_ear: list = field(default_factory=list)
    calib_started: float | None = None
    neutral_yaw: float = 0.0
    neutral_pitch: float = 0.0
    ear_open: float | None = None       # EAR ตาเปิดของคนนี้ (เรียนตอน calibrate)
    ear_threshold: float = 0.0
    calibrated: bool = False

    # การหันหน้า
    current_dir: str | None = None
    pending_dir: str | None = None
    pending_since: float = 0.0

    # การกะพริบตา
    closed_frames: int = 0
    eye_closed_since: float | None = None
    blink_times: deque = field(default_factory=deque)
    drowsy: bool = False

    # ตัวกรองอารมณ์ของคนนี้ (emotion.EmotionState) — สร้างครั้งแรกที่ใช้
    emotion: object = None

    # ตัวนับภายในหน้าต่างปัจจุบัน
    window_dirs: dict = field(default_factory=empty_direction_counts)
    window_blinks: int = 0

    def reset_window(self) -> None:
        self.window_dirs = empty_direction_counts()
        self.window_blinks = 0


class FaceAnalyzer:
    def __init__(
        self, cfg: dict, mirror: bool, report_person: bool = True, track_eyes: bool = True
    ):
        # report_person=False (โหมดห้องรวม) ทำให้คอลัมน์ person เป็น None เสมอ
        # บังคับไว้ตรงนี้ที่เดียว เพื่อไม่ให้ id หลุดออกไปทางเส้นทางใดเส้นทางหนึ่ง
        self.report_person = report_person
        # track_eyes=False (โหมดห้องรวม) ไม่คำนวณ EAR · ไม่นับกะพริบ · ไม่ตรวจความง่วง
        # ค่าที่เกี่ยวกับตาจะเป็นศูนย์/None ทั้งหมด ไม่ใช่ตัวเลขที่ไม่ได้วัดจริง
        self.track_eyes = track_eyes
        self.pose_cfg = cfg["pose"]
        self.blink_cfg = cfg["blink"]
        self.window_cfg = cfg["window"]
        self.quality_cfg = cfg["quality"]
        # อาจไม่มีคีย์นี้ถ้ามีใครส่ง config เก่าเข้ามา — ปิดฟีเจอร์ดีกว่าพังทั้งไพป์ไลน์
        self.emotion_cfg = cfg.get("emotion", {"enabled": False})

        # ภาพที่พลิกกระจกแล้วทำให้ทิศในภาพตรงกับทิศของตัวผู้ใช้เอง
        # ถ้าไม่พลิกต้องสลับป้าย Left/Right ไม่งั้นแดชบอร์ดจะรายงานกลับข้าง
        self._dir_positive_x = DIR_RIGHT if mirror else DIR_LEFT
        self._dir_negative_x = DIR_LEFT if mirror else DIR_RIGHT

        self._window_start: float | None = None
        self._window_ear_sum = 0.0
        self._window_ear_n = 0
        self._window_max_faces = 0
        self._window_max_usable = 0
        # ค่าระดับห้อง — เก็บทีละเฟรมแล้วค่อยสรุปตอนปิดหน้าต่าง
        self._occupancy_samples: deque = deque(
            maxlen=max(1, int(self.window_cfg["occupancy_samples"]))
        )
        self._center_samples = 0        # กี่ครั้งที่วัดได้ว่าหน้าอยู่กลาง
        self._pose_samples = 0          # วัดทิศทางได้ทั้งหมดกี่ครั้ง

    def _reset_room_counters(self) -> None:
        self._occupancy_samples.clear()
        self._center_samples = 0
        self._pose_samples = 0

    # ── การเลือกวิธีวัด ────────────────────────────────────
    def _blink_score(self, face: FaceInput, ear: float, st: _PersonState) -> tuple[float, str]:
        """
        คืน (คะแนนการหลับตา 0–1, ชื่อวิธีที่ใช้)

        blendshape ดีกว่าเพราะโมเดลปรับให้เข้ากับรูปตาแต่ละคนมาแล้ว
        ส่วน EAR ต้องอาศัย baseline รายบุคคลที่เรียนตอน calibrate
        """
        method = self.blink_cfg["method"]
        if method in (BLINK_BLENDSHAPE, BLINK_AUTO):
            score = lm.blink_from_blendshapes(face.blendshapes)
            if score is not None:
                return score, BLINK_BLENDSHAPE
            if method == BLINK_BLENDSHAPE:
                # ผู้ใช้บังคับให้ใช้ blendshape แต่ไม่มีข้อมูล → ถือว่าตาเปิด
                return 0.0, BLINK_BLENDSHAPE

        # แปลง EAR เป็นคะแนน 0–1 โดยเทียบกับ threshold ของคนนี้
        # ต่ำกว่า threshold = ตาปิด → คะแนนสูง
        thr = st.ear_threshold or self.blink_cfg["ear_threshold"]
        score = 0.0 if thr <= 0 else max(0.0, min(1.0, (thr - ear) / max(thr, 1e-6) + 0.5))
        return score, BLINK_EAR

    def _pose(self, face: FaceInput, st: _PersonState) -> tuple[float, float, str]:
        """คืน (yaw, pitch, ชื่อวิธี) — หน่วยขึ้นกับวิธี แต่ผ่านการหักท่านิ่งเหมือนกัน"""
        method = self.pose_cfg["method"]
        if method in (POSE_MATRIX, POSE_AUTO) and face.matrix is not None:
            angles = lm.head_pose_from_matrix(face.matrix)
            if angles is not None:
                yaw, pitch = angles
                if self.pose_cfg["matrix_invert_yaw"]:
                    yaw = -yaw
                if self.pose_cfg["matrix_invert_pitch"]:
                    pitch = -pitch
                return yaw, pitch, POSE_MATRIX
        yaw, pitch = lm.head_pose(face.landmarks)
        return yaw, pitch, POSE_GEOMETRIC

    def _thresholds(self, pose_method: str) -> tuple[float, float]:
        """เกณฑ์การหันหน้า — คนละหน่วยกันระหว่างสองวิธี จึงต้องแยกค่า"""
        if pose_method == POSE_MATRIX:
            return self.pose_cfg["yaw_threshold_deg"], self.pose_cfg["pitch_threshold_deg"]
        return self.pose_cfg["yaw_threshold"], self.pose_cfg["pitch_threshold"]

    # ── ท่านิ่ง + EAR baseline ────────────────────────────
    def _update_calibration(
        self, st: _PersonState, yaw: float, pitch: float, ear: float, now: float
    ) -> float:
        if st.calibrated:
            return 1.0
        if st.calib_started is None:
            st.calib_started = now

        st.calib_yaw.append(yaw)
        st.calib_pitch.append(pitch)
        if self.track_eyes:
            st.calib_ear.append(ear)

        elapsed = now - st.calib_started
        need = self.pose_cfg["calibration_seconds"]
        if elapsed >= need and st.calib_yaw:
            # ใช้ค่ามัธยฐาน ไม่ใช่ค่าเฉลี่ย — ทนต่อเฟรมที่ landmark กระโดด
            st.neutral_yaw = statistics.median(st.calib_yaw)
            st.neutral_pitch = statistics.median(st.calib_pitch)

            if self.track_eyes:
                # EAR ตาเปิดของคนนี้: ใช้เปอร์เซ็นไทล์สูง เพราะระหว่าง calibrate
                # ผู้ใช้ย่อมกะพริบตาบ้าง ค่าเฉลี่ยจะถูกดึงต่ำลง
                ears = sorted(st.calib_ear)
                idx = min(len(ears) - 1,
                          int(len(ears) * self.blink_cfg["ear_open_percentile"]))
                st.ear_open = ears[idx]
                st.ear_threshold = st.ear_open * self.blink_cfg["ear_close_ratio"]

            st.calibrated = True
            st.calib_yaw.clear()
            st.calib_pitch.clear()
            st.calib_ear.clear()
            return 1.0
        return min(1.0, elapsed / max(need, 1e-6))

    def recalibrate(self, tracks) -> None:
        """สั่ง calibrate ใหม่ทุกคน (ผูกกับปุ่มลัดใน main)"""
        for track in tracks:
            st = track.state.get("analyzer")
            if isinstance(st, _PersonState):
                st.calibrated = False
                st.calib_started = None
                st.calib_yaw.clear()
                st.calib_pitch.clear()
                st.calib_ear.clear()
                st.ear_open = None
                st.ear_threshold = 0.0
                st.current_dir = None
                st.pending_dir = None

    # ── การหันหน้า ────────────────────────────────────────
    def _classify(self, dy: float, dp: float, yaw_t: float, pitch_t: float) -> str | None:
        yaw_ratio = abs(dy) / max(yaw_t, 1e-6)
        pitch_ratio = abs(dp) / max(pitch_t, 1e-6)
        if yaw_ratio < 1.0 and pitch_ratio < 1.0:
            return None
        if yaw_ratio >= pitch_ratio:
            return self._dir_positive_x if dy > 0 else self._dir_negative_x
        return DIR_DOWN if dp > 0 else DIR_UP

    def _update_direction(
        self, st: _PersonState, dy: float, dp: float, now: float, yaw_t: float, pitch_t: float
    ) -> str | None:
        zone = self._classify(dy, dp, yaw_t, pitch_t)
        r = self.pose_cfg["release_ratio"]

        if zone is None:
            st.pending_dir = None
            if abs(dy) < yaw_t * r and abs(dp) < pitch_t * r:
                st.current_dir = None       # กลับมาตรงกลางแล้ว พร้อมนับครั้งใหม่
            return None

        if zone == st.current_dir:
            return zone                     # อยู่ในโซนเดิมที่นับไปแล้ว

        if zone != st.pending_dir:
            st.pending_dir = zone
            st.pending_since = now
            return zone

        if now - st.pending_since >= self.pose_cfg["hold_seconds"]:
            st.window_dirs[zone] += 1
            st.current_dir = zone
            st.pending_dir = None
        return zone

    # ── การกะพริบตา ───────────────────────────────────────
    def _update_blink(self, st: _PersonState, score: float, now: float) -> None:
        closed = score >= self.blink_cfg["closed_score"]

        if closed:
            st.closed_frames += 1
            if st.eye_closed_since is None:
                st.eye_closed_since = now
            st.drowsy = (now - st.eye_closed_since) >= self.blink_cfg["drowsy_seconds"]
            return

        if st.closed_frames >= self.blink_cfg["consecutive_frames"] and not st.drowsy:
            st.blink_times.append(now)
            st.window_blinks += 1
        st.closed_frames = 0
        st.eye_closed_since = None
        st.drowsy = False

        cutoff = now - SECONDS_PER_MINUTE
        while st.blink_times and st.blink_times[0] < cutoff:
            st.blink_times.popleft()

    # ── ลูปหลัก ───────────────────────────────────────────
    def update(
        self, faces: list[tuple], now: float, dt: float, frame_size: tuple[int, int]
    ) -> list[FaceReading]:
        """
        faces: list ของ (track, FaceInput)
        frame_size: (width, height) ใช้คำนวณ quality จากขนาดใบหน้าเป็นพิกเซล
        """
        if self._window_start is None:
            self._window_start = now

        self._window_max_faces = max(self._window_max_faces, len(faces))
        readings: list[FaceReading] = []
        smooth_n = max(1, self.pose_cfg["smooth_frames"])
        width = frame_size[0]
        usable_now = 0

        for track, face in faces:
            st = track.state.get("analyzer")
            if not isinstance(st, _PersonState):
                st = _PersonState()
                track.state["analyzer"] = st

            points = face.landmarks

            # quality: ใบหน้าต้องใหญ่พอที่ระยะเปลือกตาจะเกินสัญญาณรบกวน
            eye_px = lm.interocular_px(points, width)
            min_px = self.quality_cfg["min_interocular_px"]
            good_px = self.quality_cfg["good_interocular_px"]
            quality = max(0.0, min(1.0, (eye_px - min_px) / max(good_px - min_px, 1e-6)))
            usable = eye_px >= min_px
            if usable:
                usable_now += 1

            raw_yaw, raw_pitch, pose_method = self._pose(face, st)
            st.yaw_buf.append(raw_yaw)
            st.pitch_buf.append(raw_pitch)
            while len(st.yaw_buf) > smooth_n:
                st.yaw_buf.popleft()
            while len(st.pitch_buf) > smooth_n:
                st.pitch_buf.popleft()

            # มัธยฐานทนต่อเฟรมที่ landmark กระโดดได้ดีกว่าค่าเฉลี่ย
            yaw = statistics.median(st.yaw_buf)
            pitch = statistics.median(st.pitch_buf)

            # โหมดที่ไม่วัดตาไม่แตะ landmark ของตาเลย — ไม่ใช่วัดแล้วซ่อน
            if self.track_eyes:
                ear = lm.average_ear(points)
                score, blink_method = self._blink_score(face, ear, st)
            else:
                ear, score, blink_method = 0.0, 0.0, BLINK_OFF

            # ใบหน้าที่ quality ต่ำไม่ควรถูกเอาไป calibrate หรือวิเคราะห์
            progress = (
                self._update_calibration(st, yaw, pitch, ear, now) if usable else 0.0
            )

            direction = None
            if usable and st.calibrated:
                if self.track_eyes:
                    self._window_ear_sum += ear
                    self._window_ear_n += 1
                yaw_t, pitch_t = self._thresholds(pose_method)
                dy = yaw - st.neutral_yaw
                dp = pitch - st.neutral_pitch
                direction = self._update_direction(st, dy, dp, now, yaw_t, pitch_t)
                if self.track_eyes:
                    self._update_blink(st, score, now)
                # นับเฉพาะใบหน้าที่ calibrate เสร็จแล้ว — คนที่ยังไม่เสร็จ
                # ไม่มี neutral ให้เทียบ จะนับเป็น "มองตรง" ทันทีทั้งที่ยังไม่รู้
                self._pose_samples += 1
                if direction is None:
                    self._center_samples += 1

            # อารมณ์: ใช้ blendshapes ชุดเดียวกับที่ตรวจการหลับตา ไม่มี inference เพิ่ม
            # เทียบเฉพาะใบหน้าที่ผ่าน quality เพราะใบหน้าเล็กให้ blendshape ที่ไม่แม่น
            emotion_label = None
            if self.emotion_cfg.get("enabled") and usable:
                if st.emotion is None:
                    st.emotion = em.EmotionState(
                        window=self.emotion_cfg["window_frames"],
                        hold=self.emotion_cfg["hold_frames"],
                    )
                emotion_label = st.emotion.update(
                    face.blendshapes,
                    self.emotion_cfg["threshold"],
                    self.emotion_cfg["margin"],
                )

            closed_for = (now - st.eye_closed_since) if st.eye_closed_since else 0.0
            readings.append(
                FaceReading(
                    person_id=track.person_id,
                    box=lm.bounding_box(points),
                    ear=ear,
                    blink_score=score,
                    ear_threshold=st.ear_threshold,
                    yaw=yaw - st.neutral_yaw if st.calibrated else 0.0,
                    pitch=pitch - st.neutral_pitch if st.calibrated else 0.0,
                    direction=direction,
                    calibrating=not st.calibrated,
                    calibration_progress=progress,
                    blinks=len(st.blink_times),
                    blink_rate_per_min=float(len(st.blink_times)),
                    drowsy=st.drowsy,
                    eyes_closed_seconds=closed_for,
                    movement_in_window=sum(st.window_dirs.values()),
                    quality=quality,
                    usable=usable,
                    blink_method=blink_method,
                    pose_method=pose_method,
                    emotion=emotion_label,
                    # ชื่อถูกใส่ไว้ใน track.state โดย main.py ตอนเทียบกับแกลเลอรีรูป
                    # analyzer ไม่รู้จัก faces.py เลย จึงทดสอบแยกกันได้
                    name=track.state.get("name"),
                )
            )

        self._window_max_usable = max(self._window_max_usable, usable_now)
        self._occupancy_samples.append(usable_now)
        return readings

    def pop_window(self, tracks, now: float) -> WindowSummary | None:
        """ถ้าครบรอบหน้าต่างแล้ว คืนสรุปหนึ่งก้อนแล้วเริ่มนับใหม่ ไม่งั้นคืน None"""
        if self._window_start is None:
            self._window_start = now
            return None
        if now - self._window_start < self.window_cfg["seconds"]:
            return None

        total_dirs = empty_direction_counts()
        total_blinks = 0
        busiest_person, busiest_moves = None, -1
        # ชื่อและอารมณ์ของคนที่ถูกรายงาน เก็บคู่กับ id เพื่อไม่ให้หลุดไปคนละคน
        busiest_name, busiest_emotion = None, None
        people_measured = 0

        for track in tracks:
            st = track.state.get("analyzer")
            if not isinstance(st, _PersonState):
                continue
            if st.calibrated:
                people_measured += 1
            moves = sum(st.window_dirs.values())
            for key, value in st.window_dirs.items():
                total_dirs[key] += value
            total_blinks += st.window_blinks
            # ไม่รายงาน id ที่ยังไม่แน่ — อีกไม่กี่วินาทีมันอาจเปลี่ยนเป็น id เดิมของคนที่เคยหายไป
            # การบันทึก id ชั่วคราวลงฐานข้อมูลทำให้ข้อมูลของคนเดียวกันกระจัดกระจาย
            if moves > busiest_moves and not getattr(track, "provisional", False):
                busiest_person, busiest_moves = track.person_id, moves
                busiest_name = track.state.get("name")
                busiest_emotion = st.emotion.label if st.emotion is not None else None
            st.reset_window()

        summary = WindowSummary(
            started_at=self._window_start,
            ended_at=now,
            person=busiest_person if self.report_person else None,
            movement=sum(total_dirs.values()),
            direction=total_dirs,
            face_count=self._window_max_faces,
            avg_ear=(self._window_ear_sum / self._window_ear_n) if self._window_ear_n else None,
            blinks=total_blinks,
            usable_faces=self._window_max_usable,
            occupancy=self.occupancy(),
            attention_ratio=self.attention_ratio(),
            people_measured=people_measured,
            # โหมดห้องรวมไม่รายงานรายบุคคล ชื่อจึงต้องเงียบไปด้วย ไม่ใช่แค่ id
            name=busiest_name if self.report_person else None,
            emotion=busiest_emotion,
        )

        self._window_start = now
        self._window_ear_sum = 0.0
        self._window_ear_n = 0
        self._window_max_faces = 0
        self._window_max_usable = 0
        self._reset_room_counters()
        return summary

    # ── ค่าระดับห้อง อ่านได้ระหว่างรัน (HUD ใช้) ───────────
    def occupancy(self) -> int:
        """จำนวนคนแบบมัธยฐาน — เฟรมที่ตรวจไม่เจอชั่วครู่จึงไม่ดึงค่าลง"""
        if not self._occupancy_samples:
            return 0
        return int(statistics.median(self._occupancy_samples))

    def attention_ratio(self) -> float | None:
        """สัดส่วนการวัดที่หน้าอยู่กลาง — None เมื่อยังไม่มีใครให้วัด"""
        if not self._pose_samples:
            return None
        return self._center_samples / self._pose_samples
