# DEVICE_TESTS.md — real-device test checklist

Populated by J4 (NFC), J5 (FGS/power), J9 (end-to-end). The emulator cannot do NFC; power
events can be simulated (see below). Everything here must be executed on at least one real
device before release; record device model + Android version + result per run.

## Power simulation on emulator (J5)

```bash
adb shell dumpsys battery unplug     # simulate unplug
adb shell dumpsys battery set ac 1   # simulate AC charger connected
adb shell dumpsys battery reset      # return control to the emulated battery
```

## Checklists

_To be filled in by J4/J5/J9._
