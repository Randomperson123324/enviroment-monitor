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

# ชื่อ backend ของ OpenCV -> ค่าคงที่ · "any" = ปล่อยให้ OpenCV เลือกเอง
#
# ⚠️ บน Windows การปล่อยให้เลือกเองไม่ใช่ทางที่ปลอดภัย: OpenCV จะลอง Media
# Foundation ก่อน ซึ่งเว็บแคม USB หลายรุ่น (วัดกับ Logitech C922) **ไม่โผล่ในนั้นเลย**
# กล้องที่เสียบอยู่จริงจึงกลายเป็น "เปิดไม่ได้" ทั้งที่ DirectShow เปิดได้ใน 0.5 วินาที
# ดู _default_api() ว่าทำไมค่า auto จึงเลือก dshow ให้บน Windows
CAPTURE_APIS = {
    "any": cv2.CAP_ANY,
    "dshow": getattr(cv2, "CAP_DSHOW", cv2.CAP_ANY),
    "msmf": getattr(cv2, "CAP_MSMF", cv2.CAP_ANY),
    "v4l2": getattr(cv2, "CAP_V4L2", cv2.CAP_ANY),
    "avfoundation": getattr(cv2, "CAP_AVFOUNDATION", cv2.CAP_ANY),
}


def _default_api() -> str:
    """backend ที่ควรใช้เมื่อ CAMERA_API=auto — เลือกตามระบบปฏิบัติการ

    Windows: DirectShow · เหตุผลเชิงตัวเลขจากการวัดบนเครื่อง dev เครื่องหนึ่ง
      · C922 ผ่าน DirectShow: เปิดได้ใน 0.5 วินาที
      · C922 ผ่าน Media Foundation (ค่าที่ OpenCV เลือกเอง): เปิดไม่ได้เลย
      · กล้องในตัวเครื่องผ่าน Media Foundation: เปิดได้แต่ใช้เวลา 84 วินาที
    ค่า auto จึงเลี่ยง Media Foundation ไว้ก่อน แล้วค่อยถอยไปหาเมื่อ DirectShow แพ้

    Linux/Pi: ปล่อยให้ OpenCV เลือก (V4L2 อยู่แล้ว) — ไม่มีปัญหาแบบข้างบน
    """
    return "dshow" if sys.platform == "win32" else "any"


def resolve_api(name: str) -> tuple[str, int]:
    """คืน (ชื่อที่ใช้จริง, ค่าคงที่ของ OpenCV) — ชื่อที่ไม่รู้จักถือเป็น auto"""
    key = (name or "auto").strip().lower()
    if key in ("", "auto"):
        key = _default_api()
    return key, CAPTURE_APIS.get(key, cv2.CAP_ANY)


class CameraError(RuntimeError):
    """เปิดกล้องไม่ได้ หรืออ่านเฟรมไม่ได้"""


class CameraBackend:
    """อินเทอร์เฟซกลางของแหล่งภาพทุกชนิด"""

    name = "base"

    def __init__(self, cam_cfg: dict):
        self.cfg = cam_cfg
        # ชื่อรุ่นที่อ่านได้ (ว่าง = ถามไม่ได้) และขนาดภาพ**ที่ได้จริง**หลังเปิด
        # ขนาดที่ขอกับขนาดที่ได้ไม่จำเป็นต้องตรงกัน — กล้องเลือกโหมดที่ใกล้เคียงให้แทน
        self.label = ""
        self.actual: tuple[int, int] | None = None
        # ที่มาของขนาดภาพ (เลือกเองจากฮาร์ดแวร์ หรือใช้ค่าที่ตั้งไว้ และเพราะอะไร)
        self.mode_note = ""
        # อุปกรณ์ที่เปิดได้จริง — ใช้ถามรายการโหมดของกล้องตัวนี้ทีหลัง
        self.device = None

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
            self.label = "CSI camera"
            self.actual = size
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

    def _pick(self):
        """คืน (device, ชื่อ) ที่จะเปิด — CAMERA_USB_NAME มาก่อน CAMERA_USB_INDEX เสมอ

        ตั้งชื่อไว้แล้วหาไม่เจอถือเป็นข้อผิดพลาด ไม่ใช่เรื่องที่ควรถอยไปใช้ index เงียบ ๆ
        เพราะการเงียบ ๆ เปิดกล้องผิดตัวคือสิ่งที่ผู้ใช้ตั้งชื่อไว้เพื่อไม่ให้เกิด
        """
        want = str(self.cfg.get("usb_name") or "").strip()
        if want:
            hit = find_by_name(want)
            if hit is not None:
                return hit[0], hit[1]
            found = ", ".join(f"[{i}] {n}" for i, n in capture_devices())
            raise CameraError(
                f"ไม่พบกล้องที่ชื่อมีคำว่า '{want}' — "
                + (f"ที่เจอตอนนี้: {found}" if found else "ไม่เจอกล้องสักตัว")
                + " · แก้ CAMERA_USB_NAME หรือลบทิ้งเพื่อใช้ CAMERA_USB_INDEX แทน"
            )
        device = self._device()
        names = dict(capture_devices())
        return device, names.get(device, "")

    def _size(self, device) -> tuple[int, int]:
        """ขนาดภาพที่จะขอจากกล้อง — ถามฮาร์ดแวร์ก่อน ถ้าถามไม่ได้ค่อยใช้ค่าใน config

        ⚠️ ไม่ตั้งขนาดเลยแล้วรับค่าที่กล้องให้มาเองไม่ใช่ทางเลือกที่ดี: ค่า default
        ของ C922 คือ 640x480 ซึ่งเป็นโหมด 4:3 ที่ตัดมุมนอนทิ้ง 25% — "ไม่เลือก"
        จึงเท่ากับเลือกโหมดที่แคบที่สุด ต้องเลือกให้จริง ๆ จากรายการที่มันรองรับ
        """
        want = (int(self.cfg["width"]), int(self.cfg["height"]))
        if not self.cfg.get("auto_size", False):
            return want
        modes = capture_modes(device)
        if not modes:
            self.mode_note = "ถามโหมดจากกล้องไม่ได้ — ใช้ขนาดที่ตั้งไว้"
            return want
        picked = best_mode(modes, float(self.cfg["fps"]),
                           int(self.cfg.get("auto_max_width", 1280)))
        if picked is None:
            self.mode_note = (f"ไม่มีโหมดไหนทำได้ถึง {self.cfg['fps']}fps — ใช้ขนาดที่ตั้งไว้")
            return want
        self.mode_note = f"เลือกจาก {len(modes)} โหมดที่กล้องรองรับ"
        return picked

    def _start(self, device, api: int, size: tuple[int, int]):
        """เปิดอุปกรณ์แล้วตั้งค่าภาพ — คืน cap ที่เปิดได้ หรือ None ถ้าเปิดไม่ขึ้น"""
        cap = cv2.VideoCapture(device, api)
        if not cap.isOpened():
            cap.release()
            return None
        # ⚠️ ลำดับสำคัญ: ต้องตั้ง FOURCC **ก่อน** ขนาดภาพ ไม่งั้นกล้องจะเลือกโหมด
        # ตามขนาดที่ขอไปก่อนแล้วค่อยถูกบังคับเปลี่ยนรหัสภาพ ซึ่งบางรุ่นไม่ยอมเปลี่ยน
        fourcc = str(self.cfg.get("fourcc") or "").strip().upper()
        if fourcc:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc[:4].ljust(4)))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, size[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, size[1])
        cap.set(cv2.CAP_PROP_FPS, self.cfg["fps"])
        # บัฟเฟอร์เล็กที่สุด — ไม่งั้นจะได้เฟรมเก่าค้างและภาพหน่วง
        # (ไดรเวอร์ไม่จำเป็นต้องทำตาม — DirectShow เก็บ 1–2 เฟรมอยู่ดี)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._apply_exposure(cap)
        return cap

    def _apply_exposure(self, cap) -> None:
        """ตั้งเวลาเปิดชัตเตอร์เอง เพื่อลดภาพเบลอตอนคนขยับ

        ⚠️ ต้องปิด auto ก่อนตั้งค่า ไม่งั้นกล้องจะทับค่าที่ตั้งกลับทันที
        ค่า 0.25 = manual · 0.75 = auto เป็นข้อตกลงของ OpenCV เอง ไม่ใช่ของ UVC

        ไม่ตั้งอะไรเลย (ค่าว่าง) = ปล่อยให้กล้องปรับเอง ซึ่งเหมาะกับแสงที่เปลี่ยนไปมา
        แต่กล้องจะเลือกชัตเตอร์ยาวเมื่อแสงน้อย และชัตเตอร์ยาวคือที่มาของภาพเบลอ
        """
        exposure = str(self.cfg.get("exposure") or "").strip()
        gain = str(self.cfg.get("gain") or "").strip()
        if not exposure and not gain:
            return
        if exposure:
            cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, MANUAL_EXPOSURE)
            cap.set(cv2.CAP_PROP_EXPOSURE, float(exposure))
        if gain:
            cap.set(cv2.CAP_PROP_GAIN, float(gain))

    def open(self) -> None:
        device, name = self._pick()
        asked_api = str(self.cfg.get("api") or "auto").strip().lower()
        api_name, api = resolve_api(asked_api)
        size = self._size(device)

        cap = self._start(device, api, size)
        if cap is None and asked_api in ("", "auto"):
            # backend ที่เลือกให้อัตโนมัติเปิดไม่ขึ้น — ยังมีทางอื่นให้ลองก่อนยอมแพ้
            # (วัดมาแล้วว่ากล้องในตัวเครื่องบางรุ่นมีแต่ Media Foundation เท่านั้นที่เห็น)
            # เตือนล่วงหน้าเพราะทางนั้นเปิดช้าเป็นสิบวินาที ไม่อยากให้ดูเหมือนโปรแกรมค้าง
            print(f"[camera] {api_name} เปิด {name or device} ไม่ได้ — "
                  "ลอง backend สำรอง (อาจใช้เวลาสักครู่)", file=sys.stderr)
            api_name, cap = "any", self._start(device, cv2.CAP_ANY, size)

        if cap is None:
            raise CameraError(
                f"เปิดกล้อง USB ไม่ได้ (device={device}"
                + (f" · {name}" if name else "")
                + f" · backend={api_name}) — ตรวจว่ามีโปรแกรมอื่นใช้กล้องอยู่หรือไม่ "
                "แล้วลองเปลี่ยน CAMERA_USB_INDEX / CAMERA_API"
            )
        self._cap = cap
        self.label = name
        self.device = device
        # กล้องมีสิทธิ์ปฏิเสธขนาดที่ขอแล้วให้โหมดอื่นแทน · ต้องจดขนาด**ที่ได้จริง**
        # ไว้ ไม่งั้นทั้งไปป์ไลน์จะคำนวณบนขนาดที่ไม่ตรงกับภาพที่ไหลเข้ามา
        self.actual = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                       int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))

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


# ── Windows: ถามรายชื่อกล้องจาก DirectShow โดยไม่เปิดกล้องสักตัว ──────────
# GUID ของ COM ที่ต้องใช้ (ค่าคงที่ของ Windows ไม่ใช่ค่าที่เราตั้งเอง)
_CLSID_SYSTEM_DEVICE_ENUM = "{62BE5D10-60EB-11d0-BD3B-00A0C911CE86}"
_IID_ICREATE_DEV_ENUM = "{29840822-5B84-11D0-BD3B-00A0C911CE86}"
_CLSID_VIDEO_INPUT_CATEGORY = "{860BB310-5D01-11d0-BD3B-00A0C911CE86}"
_IID_IPROPERTY_BAG = "{55272A00-42CB-11CE-8135-00AA004BB851}"
_IID_IBASE_FILTER = "{56A86895-0AD4-11CE-B03A-0020AF0BA770}"
_IID_IAM_STREAM_CONFIG = "{C6E13340-30AC-11d0-A18C-00A0C9118956}"

# ตำแหน่งเมธอดใน vtable ของแต่ละอินเทอร์เฟซ (นับรวม IUnknown สามตัวแรกเสมอ)
_SLOT_RELEASE = 2               # IUnknown::Release
_SLOT_CREATE_CLASS_ENUM = 3     # ICreateDevEnum::CreateClassEnumerator
_SLOT_ENUM_NEXT = 3             # IEnumMoniker::Next
_SLOT_BIND_TO_STORAGE = 9       # IMoniker::BindToStorage (IPersistStream กินสี่ช่อง)
_SLOT_BAG_READ = 3              # IPropertyBag::Read
_SLOT_QUERY_INTERFACE = 0       # IUnknown::QueryInterface
_SLOT_BIND_TO_OBJECT = 8        # IMoniker::BindToObject
_SLOT_ENUM_PINS = 10            # IBaseFilter::EnumPins (IMediaFilter กินหกช่อง)
_SLOT_PIN_NEXT = 3              # IEnumPins::Next
_SLOT_QUERY_DIRECTION = 9       # IPin::QueryDirection
_SLOT_GET_NUM_CAPS = 5          # IAMStreamConfig::GetNumberOfCapabilities
_SLOT_GET_STREAM_CAPS = 6       # IAMStreamConfig::GetStreamCaps

_PINDIR_OUTPUT = 1              # ⚠️ INPUT=0 OUTPUT=1 — สลับกันแล้วจะได้ pin ที่ไม่มีโหมดเลย


def _dshow_devices() -> list[tuple[int, str]]:
    """คืน [(index, ชื่อกล้อง)] ตามลำดับที่ DirectShow นับ — ตรงกับ index ที่ OpenCV ใช้

    ทำไมไม่ probe ด้วย cv2.VideoCapture เหมือนเดิม: การเปิดกล้องเพื่อ**ถามว่ามีกล้องไหม**
    แพงมากบน Windows · กล้องในตัวเครื่องที่วัดได้ใช้เวลา 63–84 วินาทีต่อการเปิดหนึ่งครั้ง
    การไล่ index 0–5 จึงกินเวลานานกว่าหนึ่งนาที ทั้งที่ผู้ใช้แค่อยากเห็นรายชื่อ

    วิธีนี้ถาม COM ตรง ๆ (ICreateDevEnum → IPropertyBag) ใช้เวลาราว 0.15 วินาที
    ไม่เปิดอุปกรณ์เลยสักตัว และได้**ชื่อรุ่น**ติดมาด้วย ซึ่ง probe แบบเดิมไม่มีทางรู้
    """
    import ctypes
    from ctypes import POINTER, byref, c_void_p, c_wchar_p

    ole32 = ctypes.windll.ole32
    oleaut32 = ctypes.windll.oleaut32

    class GUID(ctypes.Structure):
        _fields_ = [("d1", ctypes.c_ulong), ("d2", ctypes.c_ushort),
                    ("d3", ctypes.c_ushort), ("d4", ctypes.c_ubyte * 8)]

        def __init__(self, text: str):
            super().__init__()
            if ole32.CLSIDFromString(c_wchar_p(text), byref(self)) != 0:
                raise OSError(f"GUID ไม่ถูกต้อง: {text}")

    class VARIANT(ctypes.Structure):
        # โครงจริงยาวกว่านี้ แต่ BSTR อยู่ที่ offset 8 ซึ่งครอบคลุมด้วยสองช่องท้าย
        _fields_ = [("vt", ctypes.c_ushort), ("pad", ctypes.c_ushort * 3),
                    ("value", c_void_p), ("value2", c_void_p)]

    def call(ptr, slot, argtypes, *args) -> int:
        """เรียกเมธอด COM ผ่าน vtable — ctypes ล้วน ไม่ต้องพึ่ง comtypes/pywin32"""
        vtable = ctypes.cast(ptr, POINTER(POINTER(c_void_p))).contents
        fn = ctypes.WINFUNCTYPE(ctypes.c_long, c_void_p, *argtypes)(vtable[slot])
        return fn(ptr, *args)

    def release(ptr) -> None:
        if ptr:
            call(ptr, _SLOT_RELEASE, ())

    # S_OK หรือ S_FALSE (เคยเรียกไปแล้ว) ถือว่าใช้ได้ · RPC_E_CHANGED_MODE แปลว่า
    # thread นี้ init ไว้คนละโหมด ซึ่งยังเรียก COM ได้ตามปกติ จึงไม่ถือเป็นข้อผิดพลาด
    ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED

    devices: list[tuple[int, str]] = []
    dev_enum = c_void_p()
    class_enum = c_void_p()
    try:
        if ole32.CoCreateInstance(byref(GUID(_CLSID_SYSTEM_DEVICE_ENUM)), None, 1,
                                  byref(GUID(_IID_ICREATE_DEV_ENUM)),
                                  byref(dev_enum)) != 0:
            return devices
        # คืน S_FALSE เมื่อไม่มีกล้องสักตัว — ตอนนั้น class_enum เป็น NULL
        hr = call(dev_enum, _SLOT_CREATE_CLASS_ENUM,
                  (POINTER(GUID), POINTER(c_void_p), ctypes.c_ulong),
                  byref(GUID(_CLSID_VIDEO_INPUT_CATEGORY)), byref(class_enum), 0)
        if hr != 0 or not class_enum:
            return devices

        while True:
            moniker = c_void_p()
            fetched = ctypes.c_ulong()
            hr = call(class_enum, _SLOT_ENUM_NEXT,
                      (ctypes.c_ulong, POINTER(c_void_p), POINTER(ctypes.c_ulong)),
                      1, byref(moniker), byref(fetched))
            if hr != 0 or not fetched.value:
                break

            index = len(devices)
            name = f"USB camera {index}"
            bag = c_void_p()
            try:
                hr = call(moniker, _SLOT_BIND_TO_STORAGE,
                          (c_void_p, c_void_p, POINTER(GUID), POINTER(c_void_p)),
                          None, None, byref(GUID(_IID_IPROPERTY_BAG)), byref(bag))
                if hr == 0 and bag:
                    var = VARIANT()
                    oleaut32.VariantInit(byref(var))
                    try:
                        hr = call(bag, _SLOT_BAG_READ,
                                  (c_wchar_p, POINTER(VARIANT), c_void_p),
                                  "FriendlyName", byref(var), None)
                        if hr == 0 and var.value:
                            name = ctypes.cast(var.value, c_wchar_p).value or name
                    finally:
                        oleaut32.VariantClear(byref(var))
            finally:
                release(bag)
                release(moniker)
            devices.append((index, name))
    finally:
        release(class_enum)
        release(dev_enum)
    return devices


def _dshow_modes(index: int) -> list[tuple[int, int, float, str]]:
    """คืน [(กว้าง, สูง, fps สูงสุด, รหัสภาพ)] ที่กล้องตัวนี้ **รองรับจริง**

    ถามไดรเวอร์ตรง ๆ ผ่าน IAMStreamConfig::GetStreamCaps — ไม่เปิดสตรีม ไม่เดา
    ใช้เวลาราว 0.2 วินาทีสำหรับ 72 โหมด

    ⚠️ ทำไมไม่ลองตั้งขนาดแล้วอ่านกลับ: `cap.set()` แล้ว `cap.get()` **ตอบตามที่ขอเสมอ**
    ไม่ว่ากล้องจะทำได้จริงหรือไม่ (วัดแล้ว: ขอ 864x480 กับ 1920x1080 ตอบกลับตรงทั้งคู่
    ทั้งที่ความเร็วจริงต่างกันหกเท่า) การอ่านกลับจึงบอกอะไรไม่ได้เลย ต้องดึงเฟรมจริง
    มาดูขนาด ซึ่งกินเวลาราวหนึ่งวินาทีต่อโหมด — แพงเกินกว่าจะทำตอนเปิดโปรแกรม
    """
    import ctypes
    from ctypes import POINTER, byref, c_long, c_ulong, c_void_p, c_wchar_p

    ole32 = ctypes.windll.ole32
    ole32.CoTaskMemFree.argtypes = [c_void_p]
    ole32.CoTaskMemFree.restype = None

    class GUID(ctypes.Structure):
        _fields_ = [("d1", c_ulong), ("d2", ctypes.c_ushort),
                    ("d3", ctypes.c_ushort), ("d4", ctypes.c_ubyte * 8)]

        def __init__(self, text: str):
            super().__init__()
            if ole32.CLSIDFromString(c_wchar_p(text), byref(self)) != 0:
                raise OSError(f"GUID ไม่ถูกต้อง: {text}")

    class AM_MEDIA_TYPE(ctypes.Structure):
        _fields_ = [("majortype", GUID), ("subtype", GUID),
                    ("bFixedSizeSamples", ctypes.c_int),
                    ("bTemporalCompression", ctypes.c_int),
                    ("lSampleSize", c_ulong), ("formattype", GUID),
                    ("pUnk", c_void_p), ("cbFormat", c_ulong), ("pbFormat", c_void_p)]

    class RECT(ctypes.Structure):
        _fields_ = [("left", c_long), ("top", c_long),
                    ("right", c_long), ("bottom", c_long)]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", c_ulong), ("biWidth", c_long), ("biHeight", c_long),
                    ("biPlanes", ctypes.c_ushort), ("biBitCount", ctypes.c_ushort),
                    ("biCompression", c_ulong), ("biSizeImage", c_ulong),
                    ("biXPelsPerMeter", c_long), ("biYPelsPerMeter", c_long),
                    ("biClrUsed", c_ulong), ("biClrImportant", c_ulong)]

    class VIDEOINFOHEADER(ctypes.Structure):
        _fields_ = [("rcSource", RECT), ("rcTarget", RECT),
                    ("dwBitRate", c_ulong), ("dwBitErrorRate", c_ulong),
                    ("AvgTimePerFrame", ctypes.c_longlong),
                    ("bmiHeader", BITMAPINFOHEADER)]

    def call(ptr, slot, argtypes, *args) -> int:
        vtable = ctypes.cast(ptr, POINTER(POINTER(c_void_p))).contents
        fn = ctypes.WINFUNCTYPE(c_long, c_void_p, *argtypes)(vtable[slot])
        return fn(ptr, *args)

    def release(ptr) -> None:
        if ptr:
            call(ptr, _SLOT_RELEASE, ())

    def read_caps(cfg) -> list[tuple[int, int, float, str]]:
        found: list[tuple[int, int, float, str]] = []
        count, size = ctypes.c_int(), ctypes.c_int()
        if call(cfg, _SLOT_GET_NUM_CAPS,
                (POINTER(ctypes.c_int), POINTER(ctypes.c_int)),
                byref(count), byref(size)) != 0:
            return found
        scc = (ctypes.c_byte * max(size.value, 1))()
        for i in range(count.value):
            pmt = POINTER(AM_MEDIA_TYPE)()
            if call(cfg, _SLOT_GET_STREAM_CAPS,
                    (ctypes.c_int, POINTER(POINTER(AM_MEDIA_TYPE)), c_void_p),
                    i, byref(pmt), scc) != 0 or not pmt:
                continue
            mt = pmt.contents
            if mt.pbFormat and mt.cbFormat >= ctypes.sizeof(VIDEOINFOHEADER):
                vih = ctypes.cast(mt.pbFormat, POINTER(VIDEOINFOHEADER)).contents
                bmi = vih.bmiHeader
                w, h = int(bmi.biWidth), abs(int(bmi.biHeight))
                fps = 1e7 / vih.AvgTimePerFrame if vih.AvgTimePerFrame > 0 else 0.0
                cc = int(bmi.biCompression)
                tag = ("".join(chr((cc >> 8 * k) & 0xFF) for k in range(4))
                       if cc > 0xFFFF else str(cc))
                # รายการมีของแปลกปนมาด้วย (ขนาด 0 หรือเล็กจนใช้ไม่ได้) — คัดทิ้ง
                if w >= 160 and h >= 90 and fps > 0:
                    found.append((w, h, round(fps, 1), tag))
            ole32.CoTaskMemFree(mt.pbFormat)
            ole32.CoTaskMemFree(ctypes.cast(pmt, c_void_p))
        return found

    ole32.CoInitializeEx(None, 0x2)
    modes: list[tuple[int, int, float, str]] = []
    dev_enum, class_enum = c_void_p(), c_void_p()
    try:
        if ole32.CoCreateInstance(byref(GUID(_CLSID_SYSTEM_DEVICE_ENUM)), None, 1,
                                  byref(GUID(_IID_ICREATE_DEV_ENUM)),
                                  byref(dev_enum)) != 0:
            return modes
        if call(dev_enum, _SLOT_CREATE_CLASS_ENUM,
                (POINTER(GUID), POINTER(c_void_p), c_ulong),
                byref(GUID(_CLSID_VIDEO_INPUT_CATEGORY)),
                byref(class_enum), 0) != 0 or not class_enum:
            return modes

        at = -1
        while True:
            moniker, fetched = c_void_p(), c_ulong()
            if call(class_enum, _SLOT_ENUM_NEXT,
                    (c_ulong, POINTER(c_void_p), POINTER(c_ulong)),
                    1, byref(moniker), byref(fetched)) != 0 or not fetched.value:
                break
            at += 1
            if at != index:
                release(moniker)
                continue

            filt = c_void_p()
            hr = call(moniker, _SLOT_BIND_TO_OBJECT,
                      (c_void_p, c_void_p, POINTER(GUID), POINTER(c_void_p)),
                      None, None, byref(GUID(_IID_IBASE_FILTER)), byref(filt))
            release(moniker)
            if hr != 0 or not filt:
                break
            pins = c_void_p()
            if call(filt, _SLOT_ENUM_PINS, (POINTER(c_void_p),), byref(pins)) == 0 and pins:
                while True:
                    pin, pin_got = c_void_p(), c_ulong()
                    if call(pins, _SLOT_PIN_NEXT,
                            (c_ulong, POINTER(c_void_p), POINTER(c_ulong)),
                            1, byref(pin), byref(pin_got)) != 0 or not pin_got.value:
                        break
                    direction = ctypes.c_int(-1)
                    call(pin, _SLOT_QUERY_DIRECTION,
                         (POINTER(ctypes.c_int),), byref(direction))
                    cfg = c_void_p()
                    if direction.value == _PINDIR_OUTPUT and call(
                            pin, _SLOT_QUERY_INTERFACE,
                            (POINTER(GUID), POINTER(c_void_p)),
                            byref(GUID(_IID_IAM_STREAM_CONFIG)), byref(cfg)) == 0 and cfg:
                        modes.extend(read_caps(cfg))
                    release(cfg)
                    release(pin)
            release(pins)
            release(filt)
            break
    finally:
        release(class_enum)
        release(dev_enum)
    return modes


def capture_modes(index) -> list[tuple[int, int, float, str]]:
    """โหมดที่กล้องรองรับจริง — ลิสต์ว่าง = ถามไม่ได้บนระบบนี้ (ผู้เรียกต้องมีทางถอย)"""
    try:
        if sys.platform == "win32" and str(index).isdigit():
            return _dshow_modes(int(index))
    except Exception:
        return []
    return []


# รหัสภาพบีบอัดที่ OpenCV **ไม่ได้**ขอให้กล้องส่งมาให้ (ลองสั่งแล้วไดรเวอร์ไม่เปลี่ยนตาม)
# จึงต้องคิดความเร็วจากโหมดไม่บีบอัดเท่านั้น ไม่งั้นจะเลือกโหมดที่บนกระดาษได้ 30fps
# แต่ของจริงได้ 10fps — วัดแล้วที่ 1280x720: กระดาษบอก MJPG 30 · ที่ได้จริงคือ 10
_COMPRESSED = ("MJPG", "H264", "HEVC")

# กล้องหลายตัวมีโหมด 16:9 กับ 4:3 ปนกัน และ 4:3 มักเป็นภาพ 16:9 ที่ถูกตัดข้างทิ้ง
# (วัดกับ C922: 640x480 คือส่วนกลางของ 1280x720 — มุมนอนหายไป 25%)
# ต่างกันไม่เกินเท่านี้ถือว่าเป็นสัดส่วนเดียวกัน — 864x480 ได้ 1.80 ส่วน 1280x720 ได้ 1.78
_ASPECT_TOLERANCE = 0.05

# ค่าที่ OpenCV ใช้แทน "ตั้งเวลาเปิดชัตเตอร์เอง" (0.75 = ให้กล้องปรับเอง)
MANUAL_EXPOSURE = 0.25


def best_mode(modes, min_fps: float, max_width: int) -> tuple[int, int] | None:
    """เลือกโหมดที่ดีที่สุดจากรายการที่กล้องรองรับ — คืน (กว้าง, สูง) หรือ None

    ลำดับการตัดสิน
      1. **สัดส่วนกว้างที่สุดที่กล้องมี** มาก่อนความละเอียด · โหมด 4:3 บนเซนเซอร์ 16:9
         คือการตัดขอบซ้าย-ขวาทิ้ง ยอมเสียพิกเซลดีกว่ายอมเสียมุมมอง เพราะพิกเซลที่
         หายไปแลกมาด้วยความละเอียดต่อองศาที่ยัง**ดีขึ้น**ด้วยซ้ำ (864 บน 70° = 12.3
         px/องศา เทียบกับ 640 บน 56° = 11.4)
      2. ต้องส่งภาพได้ไม่ต่ำกว่า min_fps **ในโหมดไม่บีบอัด** (ดู _COMPRESSED)
      3. เลือกอันที่พิกเซลเยอะสุดที่เหลืออยู่ · เท่ากันให้เอา fps สูงกว่า
    """
    usable = [(w, h, fps) for w, h, fps, tag in modes
              if tag.upper() not in _COMPRESSED and w <= max_width and fps >= min_fps]
    if not usable:
        return None
    widest = max(w / h for w, h, _ in usable)
    wide = [m for m in usable if widest - m[0] / m[1] <= _ASPECT_TOLERANCE]
    best = max(wide, key=lambda m: (m[0] * m[1], m[2]))
    return best[0], best[1]


def capture_devices() -> list[tuple[int, str]]:
    """คืน [(index, ชื่อ)] ของกล้องที่จับภาพได้ **โดยไม่เปิดอุปกรณ์เลย**

    ระบบที่ไม่รู้จัก (เช่น macOS) คืนลิสต์ว่าง — ผู้เรียกต้องถอยไป probe เอง
    """
    try:
        if sys.platform == "win32":
            return _dshow_devices()
        if sys.platform.startswith("linux"):
            return _v4l2_capture_devices()
    except Exception:
        return []  # การสำรวจล้มไม่ควรทำให้เปิดกล้องไม่ได้ — ผู้เรียกถอยไป index ตรง ๆ
    return []


def find_by_name(want: str) -> tuple[int, str] | None:
    """หากล้องที่ชื่อ**มีคำนี้อยู่** (ไม่สนตัวพิมพ์) — คืน (index, ชื่อเต็ม) หรือ None

    ให้ตั้ง CAMERA_USB_NAME=c922 แล้วเสียบกล้องช่องไหนก็ได้ · index ของ USB
    สลับกันเองเมื่อถอด-เสียบหรือรีบูต ชื่อรุ่นไม่สลับ
    """
    needle = (want or "").strip().lower()
    if not needle:
        return None
    for index, name in capture_devices():
        if needle in name.lower():
            return index, name
    return None


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

    # Linux ถามผ่าน v4l2 · Windows ถามผ่าน DirectShow — ทั้งคู่ได้ชื่อรุ่นมาด้วย
    # และไม่เปิดอุปกรณ์เลย จึงเร็วพอที่จะเรียกได้ทุกครั้งที่ผู้ใช้เปิดเมนู
    known = capture_devices()
    if known:
        for idx, card in known:
            cams.append({"source": "usb", "index": idx, "label": card or f"USB camera {idx}"})
    else:
        # ระบบที่ถามตรง ๆ ไม่ได้ (เช่น macOS) — ถอยไป probe ด้วย OpenCV ตามเดิม
        # กล้องที่ใช้อยู่ถูกจับไว้ เปิดซ้ำไม่ได้ จึงใส่เองโดยไม่ต้อง probe
        _, api = resolve_api(cam_cfg.get("api", "auto"))
        active_usb = str(active[1]) if active and active[0] == "usb" else None
        for idx in range(max_probe):
            if str(idx) == active_usb:
                cams.append({"source": "usb", "index": idx, "label": f"USB camera {idx}"})
                continue
            cap = cv2.VideoCapture(idx, api)
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
        prev_name = self.cfg.get("usb_name", "")

        self.close()
        self.cfg["source"] = source
        if usb_index is not None:
            self.cfg["usb_index"] = str(usb_index)
            # ผู้ใช้เพิ่งชี้กล้องด้วยมือ — ชื่อที่ปักไว้ใน .env ต้องไม่มาลากกลับไปตัวเดิม
            self.cfg["usb_name"] = ""
        try:
            return self.open()
        except CameraError:
            # ถอยกลับไปกล้องเดิม — ตัวเดิมเพิ่งเปิดได้อยู่ ปกติจะเปิดกลับได้
            self.cfg["source"] = prev_source
            self.cfg["usb_index"] = prev_index
            self.cfg["usb_name"] = prev_name
            self.open()
            raise

    @property
    def label(self) -> str:
        """ชื่อรุ่นของกล้องที่เปิดอยู่ — ว่างถ้ายังไม่เปิดหรือถามชื่อไม่ได้"""
        return getattr(self.backend, "label", "") if self.backend else ""

    @property
    def actual(self) -> tuple[int, int] | None:
        """ขนาดภาพที่ได้จริง (อาจไม่เท่าที่ขอ) — None ถ้ายังไม่เปิด"""
        return getattr(self.backend, "actual", None) if self.backend else None

    @property
    def mode_note(self) -> str:
        """ขนาดภาพนี้มาจากไหน — ไว้บอกผู้ใช้ว่าเลือกเองหรือใช้ค่าที่ตั้งไว้"""
        return getattr(self.backend, "mode_note", "") if self.backend else ""

    def sizes(self) -> list[tuple[int, int, float]]:
        """ขนาดภาพที่กล้องที่เปิดอยู่รองรับ — [(กว้าง, สูง, fps)] ใหญ่ไปเล็ก ไม่ซ้ำขนาด

        ยุบรายการดิบให้เหลือขนาดละแถว โดยเอา fps ที่ดีที่สุด**ของโหมดไม่บีบอัด**
        ซึ่งเป็นตัวเลขที่ตรงกับของจริงที่ OpenCV จะได้ (ดู _COMPRESSED)
        ลิสต์ว่าง = ถามไม่ได้บนระบบนี้ หรือยังไม่ได้เปิดกล้อง
        """
        device = getattr(self.backend, "device", None) if self.backend else None
        if device is None:
            return []
        best: dict[tuple[int, int], float] = {}
        for w, h, fps, tag in capture_modes(device):
            if tag.upper() in _COMPRESSED:
                continue
            key = (w, h)
            if fps > best.get(key, 0.0):
                best[key] = fps
        return sorted(((w, h, fps) for (w, h), fps in best.items()),
                      key=lambda m: -m[0] * m[1])

    def resize(self, width: int, height: int) -> tuple[int, int]:
        """เปลี่ยนความละเอียดขณะรัน — คืนขนาดที่ได้จริง

        ต้องปิดแล้วเปิดใหม่ เพราะการ set ขนาดกับ handle ที่กำลังสตรีมอยู่ไม่แน่นอน
        ระหว่างไดรเวอร์แต่ละตัว · เปิดใหม่ไม่ได้จะถอยกลับไปขนาดเดิมแล้วค่อยโยน error
        """
        prev = (self.cfg["width"], self.cfg["height"], self.cfg.get("auto_size", False))
        self.close()
        self.cfg["width"], self.cfg["height"] = int(width), int(height)
        # ผู้ใช้เลือกขนาดเองแล้ว = เลิกให้ระบบเลือกให้ ไม่งั้น _size() จะลากกลับไป
        # โหมดที่มันคิดว่าดีที่สุดทันทีที่เปิดใหม่ แล้วปุ่มนี้จะดูเหมือนกดไม่ติด
        self.cfg["auto_size"] = False
        try:
            self.open()
            return self.actual or (int(width), int(height))
        except CameraError:
            self.cfg["width"], self.cfg["height"], self.cfg["auto_size"] = prev
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
