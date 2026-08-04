"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/** EAN-13-shaped random barcode with a valid check digit. */
export function generateBarcode(): string {
  let digits = "";
  for (let i = 0; i < 12; i++) digits += Math.floor(Math.random() * 10);

  const checksum = digits
    .split("")
    .reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  const checkDigit = (10 - (checksum % 10)) % 10;

  return digits + checkDigit;
}

interface BarcodeGeneratorProps {
  value: string;
  onChange: (value: string) => void;
}

export function BarcodeGenerator({ value, onChange }: BarcodeGeneratorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <Input
          label="الباركود"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="flex-1 font-mono"
          required
        />
        <Button type="button" variant="secondary" onClick={() => onChange(generateBarcode())}>
          توليد
        </Button>
      </div>
      {value ? (
        <div className="flex items-end gap-[2px] rounded bg-white p-2">
          {value.split("").map((digit, index) => (
            <span
              key={index}
              className="w-[2px] bg-black"
              style={{ height: 12 + (Number(digit) % 5) * 4 }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
