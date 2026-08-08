"""
แหล่งภาพ — รองรับทั้ง Camera Module 3 (CSI ผ่าน Picamera2) และ USB webcam (OpenCV)

เพิ่ม backend ตัวใหม่ = สร้างคลาสที่สืบทอด CameraBackend แล้วลงทะเบียนใน BACKENDS
**ไม่ต้องแก้ main.py หรือโมดูลอื่น**

ทุก backend คืนภาพเป็น numpy array รูปแบบ **BGR** (มาตรฐานของ OpenCV)
เพื่อให้โค้ดฝั่งผู้ใช้ไม่ต้องสนใจว่าภาพมาจากไหน
"""

from __future__ import annotations

import sys

import cv2
import numpy as np

# องศาที่หมุนได้ -> ค่าคงที่ของ OpenCV (ไม่มีตัวเลขวิเศษกระจายในโค้ด)
ROTATIONS = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


class CameraError(RuntimeError):
    """เปิดกล้องไม่ได้ หรืออ่านเฟรมไม่ได้"""


class CameraBackend:
    """อินเทอร์เฟซกลางของแหล่งภาพทุกชนิด"""

    name = "base"

    def __init__(self, cam_cfg: dict):
        self.cfg = cam_cfg

    def open(self) -> None:
        raise NotImplementedError

    def read(self) -> np.ndarray:
        """คืนเฟรม BGR หนึ่งเฟรม — โยน CameraError ถ้าอ่านไม่ได้"""
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError


class Picamera2Backend(CameraBackend):
    """Camera Module 3 ผ่านขั้ว CSI — ไม่กินโควตากระแส USB"""

    name = "csi"

    def __init__(self, cam_cfg: dict):
        super().__init__(cam_cfg)
        self._cam = None

    def open(self) -> None:
        try:
            from picamera2 import Picamera2  # นำเข้าตอนใช้จริง เพื่อให้เครื่องที่ไม่มีก็ยังรันได้
        except ImportError as exc:
            raise CameraError(
                "ไม่พบ picamera2 — ติดตั้งด้วย: sudo apt install -y python3-picamera2"
            ) from exc

        try:
            cam = Picamera2()
            size = (self.cfg["width"], self.cfg["height"])
            # ขอภาพเป็น RGB888 แล้วค่อยแปลงเป็น BGR เองในขั้นตอน read()
            cfg = cam.create_video_configuration(main={"size": size, "format": "RGB888"})
            cam.configure(cfg)
            cam.start()
            self._cam = cam
        except Exception as exc:  # picamera2 โยน exception หลายชนิดมาก
            raise CameraError(f"เปิดกล้อง CSI ไม่ได้: {exc}") from exc

    def read(self) -> np.ndarray:
        if self._cam is None:
            raise CameraError("ยังไม่ได้เปิดกล้อง CSI")
        frame = self._cam.capture_array()
        if frame is None:
            raise CameraError("อ่านเฟรมจากกล้อง CSI ไม่ได้")
        return cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

    def close(self) -> None:
        if self._cam is not None:
            self._cam.stop()
            self._cam.close()
            self._cam = None


class OpenCVBackend(CameraBackend):
    """USB webcam (หรือไฟล์วิดีโอ) ผ่าน cv2.VideoCapture"""

    name = "usb"

    def __init__(self, cam_cfg: dict):
        super().__init__(cam_cfg)
        self._cap = None

    def _device(self):
        """ยอมรับทั้งเลข index ('0') และ path ('/dev/video0')"""
        raw = str(self.cfg["usb_index"])
        return int(raw) if raw.isdigit() else raw

    def open(self) -> None:
        cap = cv2.VideoCapture(self._device())
        if not cap.isOpened():
            raise CameraError(
                f"เปิดกล้อง USB ไม่ได้ (device={self._device()}) — "
                "ตรวจด้วย: ls /dev/video*  หรือเปลี่ยนค่า CAMERA_USB_INDEX"
            )
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.cfg["width"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.cfg["height"])
        cap.set(cv2.CAP_PROP_FPS, self.cfg["fps"])
        # บัฟเฟอร์เล็กที่สุด — ไม่งั้นจะได้เฟรมเก่าค้างและภาพหน่วง
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap = cap

    def read(self) -> np.ndarray:
        if self._cap is None:
            raise CameraError("ยังไม่ได้เปิดกล้อง USB")
        ok, frame = self._cap.read()
        if not ok or frame is None:
            raise CameraError("อ่านเฟรมจากกล้อง USB ไม่ได้ (สายหลุด?)")
        return frame

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


BACKENDS = {
    Picamera2Backend.name: Picamera2Backend,
    OpenCVBackend.name: OpenCVBackend,
}

# ลำดับการลองเมื่อ CAMERA_SOURCE=auto — CSI ก่อนเพราะไม่กินโควตากระแส USB
AUTO_ORDER = (Picamera2Backend.name, OpenCVBackend.name)


# v4l2 VIDIOC_QUERYCAP — ถามความสามารถของอุปกรณ์โดย **ไม่ต้องเปิดเพื่อจับภาพ**
# ค่า ioctl มาจาก _IOR('V', 0, struct v4l2_capability) โดย struct ยาว 104 ไบต์
_VIDIOC_QUERYCAP = 0x80685600
_V4L2_CAP_VIDEO_CAPTURE = 0x00000001  # โหนดนี้จับภาพวิดีโอได้จริง
_V4L2_CAP_DEVICE_CAPS = 0x80000000    # ช่อง device_caps ใช้ได้ (คือ cap ของโหนดนี้เอง)


def _v4l2_capture_devices() -> list[tuple[int, str]]:
    """คืน [(index, ชื่อกล้อง)] ของโหนด /dev/video* ที่ "จับภาพได้จริง" บน Linux

    ทำไมไม่ probe ด้วย cv2.VideoCapture: เว็บแคม USB (UVC) หนึ่งตัวมักสร้างโหนดหลายอัน
    เช่น video0 (ภาพ) + video1 (metadata) การ cv2.VideoCapture โหนด metadata จะ
    บล็อกนานมากกว่าจะยอมแพ้ ทำให้ลูปแสดงผลค้าง — ดูอาการ "กด v แล้วค้างนาน"

    วิธีนี้เปิดด้วย O_NONBLOCK (ไม่บล็อก) แล้วถาม QUERYCAP อย่างเดียว เร็วและ
    กรองโหนด metadata ทิ้งได้ เพราะเช็ค device_caps เฉพาะของโหนดนั้น ๆ
    """
    import fcntl
    import glob
    import os
    import re
    import struct

    def _index(path: str) -> int:
        m = re.search(r"(\d+)$", path)
        return int(m.group(1)) if m else 0

    devices: list[tuple[int, str]] = []
    for path in sorted(glob.glob("/dev/video*"), key=_index):
        try:
            fd = os.open(path, os.O_RDWR | os.O_NONBLOCK)
        except OSError:
            continue
        try:
            buf = bytearray(104)
            fcntl.ioctl(fd, _VIDIOC_QUERYCAP, buf)
            card = buf[16:48].split(b"\x00", 1)[0].decode("utf-8", "replace").strip()
            # capabilities = ของทั้งอุปกรณ์ (ทุกโหนดรวมกัน), device_caps = ของโหนดนี้เอง
            capabilities, device_caps = struct.unpack_from("<II", buf, 84)
            caps = device_caps if capabilities & _V4L2_CAP_DEVICE_CAPS else capabilities
            if caps & _V4L2_CAP_VIDEO_CAPTURE:
                devices.append((_index(path), card))
        except OSError:
            pass  # โหนดตอบ ioctl ไม่ได้ — ข้ามไป
        finally:
            os.close(fd)
    return devices


def list_cameras(cam_cfg: dict, active: tuple | None = None, max_probe: int = 6) -> list[dict]:
    """สำรวจกล้องที่พร้อมใช้ สำหรับ "เมนูเลือกกล้อง" ในหน้าต่างแสดงผล

    คืน list ของ dict: {"source", "index", "label", "current"}
      source  = "csi" หรือ "usb"
      index   = เลข index ของ USB (None สำหรับ CSI)
      label   = ข้อความสั้น ๆ ไว้โชว์ในเมนู
      current = True ถ้าเป็นกล้องที่กำลังใช้อยู่

    `active` = (source, usb_index) ของกล้องที่เปิดอยู่ตอนนี้ — ใช้ทำเครื่องหมายตัวที่ใช้อยู่

    เรียกเฉพาะตอนผู้ใช้เปิดเมนู ไม่ใช่ทุกเฟรม
    """
    cams: list[dict] = []

    # CSI ผ่าน Picamera2 — ถ้าไลบรารีมีและตรวจพบกล้องอย่างน้อยหนึ่งตัว
    try:
        from picamera2 import Picamera2

        if Picamera2.global_camera_info():
            cams.append({"source": "csi", "index": None, "label": "CSI camera (Picamera2)"})
    except Exception:
        pass  # ไม่มี picamera2 หรือไม่มีกล้อง CSI — ข้ามไป

    if sys.platform.startswith("linux"):
        # Linux/Pi: ถามความสามารถผ่าน v4l2 — เร็วและไม่ค้างเพราะไม่เปิดเพื่อจับภาพ
        for idx, card in _v4l2_capture_devices():
            label = f"USB camera {idx}" + (f" — {card}" if card else "")
            cams.append({"source": "usb", "index": idx, "label": label})
    else:
        # อื่น ๆ (เช่นเครื่อง dev Windows): ไม่มี v4l2 — ถอยไป probe ด้วย OpenCV
        # กล้องที่ใช้อยู่ถูกจับไว้ เปิดซ้ำไม่ได้ จึงใส่เองโดยไม่ต้อง probe
        active_usb = str(active[1]) if active and active[0] == "usb" else None
        for idx in range(max_probe):
            if str(idx) == active_usb:
                cams.append({"source": "usb", "index": idx, "label": f"USB camera {idx}"})
                continue
            cap = cv2.VideoCapture(idx)
            opened = cap.isOpened()
            cap.release()
            if opened:
                cams.append({"source": "usb", "index": idx, "label": f"USB camera {idx}"})

    # ทำเครื่องหมายตัวที่ใช้อยู่ เพื่อให้เมนูเน้นให้เห็น
    for c in cams:
        c["current"] = bool(
            active
            and c["source"] == active[0]
            and (active[0] == "csi" or str(c["index"]) == str(active[1]))
        )
    return cams


class Camera:
    """
    ตัวห่อ backend — จัดการเลือก source, พลิก/หมุนภาพ ให้ที่เดียว
    ใช้เป็น context manager ได้:  with Camera(cfg) as cam: ...
    """

    def __init__(self, cam_cfg: dict):
        self.cfg = cam_cfg
        self.backend: CameraBackend | None = None

    def open(self) -> str:
        """เปิดกล้อง คืนชื่อ backend ที่ใช้ได้จริง"""
        source = self.cfg["source"].lower()
        candidates = AUTO_ORDER if source == "auto" else (source,)

        errors = []
        for name in candidates:
            backend_cls = BACKENDS.get(name)
            if backend_cls is None:
                raise CameraError(
                    f"ไม่รู้จัก CAMERA_SOURCE='{name}' — ใช้ได้: {', '.join(BACKENDS)} หรือ auto"
                )
            backend = backend_cls(self.cfg)
            try:
                backend.open()
                self.backend = backend
                return name
            except CameraError as exc:
                errors.append(f"  [{name}] {exc}")

        raise CameraError("เปิดกล้องไม่ได้เลยสักตัว:\n" + "\n".join(errors))

    def switch(self, source: str, usb_index=None) -> str:
        """สลับไปใช้กล้องตัวอื่นขณะโปรแกรมกำลังรัน — ปิดตัวเดิมแล้วเปิดตัวใหม่

        ต้องปิดตัวเดิมก่อนเพราะอุปกรณ์เดียวกันเปิดซ้อนสองที่ไม่ได้
        ถ้าเปิดตัวใหม่ไม่สำเร็จ จะพยายามกลับไปเปิดตัวเดิมให้ แล้วค่อยโยน CameraError
        เพื่อไม่ให้โปรแกรมหลุดเพียงเพราะผู้ใช้เลือกกล้องผิดตัว
        """
        prev_source = self.cfg["source"]
        prev_index = self.cfg["usb_index"]

        self.close()
        self.cfg["source"] = source
        if usb_index is not None:
            self.cfg["usb_index"] = str(usb_index)
        try:
            return self.open()
        except CameraError:
            # ถอยกลับไปกล้องเดิม — ตัวเดิมเพิ่งเปิดได้อยู่ ปกติจะเปิดกลับได้
            self.cfg["source"] = prev_source
            self.cfg["usb_index"] = prev_index
            self.open()
            raise

    def read(self) -> np.ndarray:
        if self.backend is None:
            raise CameraError("ยังไม่ได้เรียก open()")
        frame = self.backend.read()

        rotate = self.cfg["rotate"] % 360
        if rotate in ROTATIONS:
            frame = cv2.rotate(frame, ROTATIONS[rotate])
        if self.cfg["mirror"]:
            frame = cv2.flip(frame, 1)
        return frame

    def close(self) -> None:
        if self.backend is not None:
            self.backend.close()
            self.backend = None

    def __enter__(self) -> "Camera":
        self.open()
        return self

    def __exit__(self, *_exc) -> None:
        self.close()
