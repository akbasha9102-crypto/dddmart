"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface CameraBarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}

/**
 * Camera-based optical barcode scanning, as an alternative to the HID
 * scanner / manual typing already handled by BarcodeScanner. Uses
 * @zxing/browser's continuous decode loop against a live video stream.
 * Requests the rear ("environment") camera explicitly since a cashier holds
 * the product up to the phone, not themselves.
 */
export function CameraBarcodeScanner({ open, onClose, onDetected }: CameraBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCameraError(null);
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current!,
        (result, error, controls) => {
          controlsRef.current = controls;
          if (result) {
            onDetected(result.getText());
            return;
          }
          // NotFoundException fires on every frame where no barcode is
          // found yet — expected noise, not a real error. Anything else
          // (e.g. a decode failure) is ignored too since the loop retries
          // automatically; only getUserMedia failures below are fatal.
          if (error && !(error instanceof NotFoundException)) {
            // no-op: keep scanning, only surface fatal camera errors
          }
        },
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      })
      .catch((err: unknown) => {
        setCameraError(
          err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
            ? "تم رفض إذن الوصول إلى الكاميرا. الرجاء السماح بالوصول من إعدادات المتصفح."
            : err instanceof DOMException && err.name === "NotFoundError"
              ? "لم يتم العثور على كاميرا على هذا الجهاز."
              : "تعذر تشغيل الكاميرا. حاول مرة أخرى.",
        );
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onDetected]);

  return (
    <Modal open={open} onClose={onClose} title="مسح الباركود بالكاميرا" className="max-w-sm">
      <div className="flex flex-col gap-4">
        {cameraError ? (
          <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{cameraError}</p>
        ) : (
          <video ref={videoRef} className="w-full rounded-lg bg-black" muted playsInline />
        )}
        <Button variant="secondary" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </Modal>
  );
}
