"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Audio device selection for the manual cockpit (E3).
//
// Wraps the Twilio Voice SDK's `device.audio` helper: enumerate input/output
// devices, follow the `deviceChange` event (headset plugged/unplugged mid-
// shift), apply the rep's persisted per-user choice, and expose setters the
// menu calls. The Device itself is owned by use-dialer.ts — this hook only
// READS it via the engine's getDevice() accessor and never touches lifecycle.
//
// Output selection is feature-detected: it rides HTMLAudioElement.setSinkId,
// which Safari doesn't ship. When unsupported the menu renders the output list
// disabled with a plain-language reason — never a picker that silently does
// nothing. Demo mode / no Twilio ⇒ `ready` is false and the whole menu is
// disabled with its own reason.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import type { Device } from "@twilio/voice-sdk";
import type { DialerMode } from "@/lib/use-dialer";

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface DialerDevices {
  /** A live Device with audio APIs exists — the menu can actually do things. */
  ready: boolean;
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
  inputId: string | null;
  outputId: string | null;
  /** setSinkId support — false disables the output picker with a reason. */
  outputSelectionSupported: boolean;
  setInput: (deviceId: string) => void;
  setOutput: (deviceId: string) => void;
}

// Minimal structural view of Twilio's AudioHelper — only what we call. Typed
// here (instead of importing SDK internals) so tsc stays happy across SDK
// minor versions that reshuffle their type exports.
interface AudioHelperLike {
  availableInputDevices: Map<string, MediaDeviceInfo>;
  availableOutputDevices: Map<string, MediaDeviceInfo>;
  isOutputSelectionSupported: boolean;
  inputDevice: MediaDeviceInfo | null;
  setInputDevice(deviceId: string): Promise<void>;
  speakerDevices: { set(deviceId: string | string[]): Promise<void> };
  on(event: string, handler: () => void): unknown;
  off?(event: string, handler: () => void): unknown;
  removeListener?(event: string, handler: () => void): unknown;
}

const STORE_PREFIX = "aj:audioDevices:";

interface StoredChoice {
  inputId?: string | null;
  outputId?: string | null;
}

function storageKey(userId?: string): string {
  return `${STORE_PREFIX}${userId || "anon"}`;
}

function readChoice(userId?: string): StoredChoice {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as StoredChoice) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeChoice(userId: string | undefined, patch: StoredChoice): void {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readChoice(userId), ...patch };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* storage full / disabled — the choice just won't persist */
  }
}

function toOptions(map: Map<string, MediaDeviceInfo>, fallback: string): AudioDeviceOption[] {
  const out: AudioDeviceOption[] = [];
  let i = 0;
  for (const [deviceId, info] of map) {
    i += 1;
    out.push({ deviceId, label: info.label || `${fallback} ${i}` });
  }
  return out;
}

export function useDialerDevices(
  getDevice: () => Device | null,
  deviceMode: DialerMode,
  userId?: string,
): DialerDevices {
  const [inputs, setInputs] = useState<AudioDeviceOption[]>([]);
  const [outputs, setOutputs] = useState<AudioDeviceOption[]>([]);
  const [inputId, setInputId] = useState<string | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [outputSupported, setOutputSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const audioOf = useCallback((): AudioHelperLike | null => {
    const device = getDevice();
    const audio = (device as { audio?: unknown } | null)?.audio;
    return audio ? (audio as AudioHelperLike) : null;
  }, [getDevice]);

  // Wire up whenever the device reaches "live" (a rebuild after reconnect is a
  // NEW Device, and this effect re-runs on the connecting→live flip it causes).
  useEffect(() => {
    if (deviceMode !== "live") {
      setReady(false);
      return;
    }
    const audio = audioOf();
    if (!audio) {
      setReady(false);
      return;
    }
    setReady(true);
    setOutputSupported(Boolean(audio.isOutputSelectionSupported));

    const refresh = () => {
      try {
        setInputs(toOptions(audio.availableInputDevices, "Microphone"));
        setOutputs(toOptions(audio.availableOutputDevices, "Speaker"));
        setInputId(audio.inputDevice?.deviceId ?? null);
      } catch {
        /* the device is mid-teardown — the next live flip re-wires */
      }
    };
    refresh();

    // Re-apply the rep's persisted choice — only when the device still exists
    // (a saved id for an unplugged headset must not error the whole menu).
    const saved = readChoice(userIdRef.current);
    if (saved.inputId && audio.availableInputDevices.has(saved.inputId)) {
      audio
        .setInputDevice(saved.inputId)
        .then(() => setInputId(saved.inputId ?? null))
        .catch(() => {});
    }
    if (
      saved.outputId &&
      audio.isOutputSelectionSupported &&
      audio.availableOutputDevices.has(saved.outputId)
    ) {
      audio
        .speakerDevices.set(saved.outputId)
        .then(() => setOutputId(saved.outputId ?? null))
        .catch(() => {});
    }

    try {
      audio.on("deviceChange", refresh);
    } catch {
      /* no event support — the initial snapshot still stands */
    }
    return () => {
      try {
        (audio.off ?? audio.removeListener)?.call(audio, "deviceChange", refresh);
      } catch {
        /* torn down already */
      }
    };
  }, [audioOf, deviceMode]);

  const setInput = useCallback(
    (deviceId: string) => {
      const audio = audioOf();
      if (!audio) return;
      audio
        .setInputDevice(deviceId)
        .then(() => {
          setInputId(deviceId);
          writeChoice(userIdRef.current, { inputId: deviceId });
        })
        .catch(() => {
          /* device vanished between render and click — deviceChange refreshes */
        });
    },
    [audioOf],
  );

  const setOutput = useCallback(
    (deviceId: string) => {
      const audio = audioOf();
      if (!audio || !audio.isOutputSelectionSupported) return;
      audio.speakerDevices
        .set(deviceId)
        .then(() => {
          setOutputId(deviceId);
          writeChoice(userIdRef.current, { outputId: deviceId });
        })
        .catch(() => {});
    },
    [audioOf],
  );

  return {
    ready,
    inputs,
    outputs,
    inputId,
    outputId,
    outputSelectionSupported: outputSupported,
    setInput,
    setOutput,
  };
}
