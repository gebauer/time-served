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

_To be filled in by J5/J9._

## J4 — NFC (real device)

Needs: a dev build (`pnpm expo run:android`) on an NFC-capable phone, two NTAG215 tags,
one foreign NDEF tag (e.g. a tag holding an `https://` URI written by another app).
Record device model + Android version + result per item.

Design note — dedupe: both tags of a box carry the identical payload, so dropping the
phone in can graze both within a second or two. `AndroidTagReader` therefore suppresses a
repeat read of the SAME box uuid within **3 s** of the last emitted read
(`TAG_READ_DEDUPE_WINDOW_MS` in `src/platform/android/nfc/dedupe.ts`; the window does not
slide on suppressed reads, and a different uuid always emits immediately).

### Read path (§9.2 — always interaction-free)

- [ ] **Locked phone, screen off → nothing.** Hold a registered box tag against the locked
      phone: no dispatch, no sound, no app launch (hard platform fact, CLAUDE.md §4 —
      Android does not dispatch tags while locked). This is expected, not a bug.
- [ ] **Unlocked, app closed → app foregrounds.** Scan the same tag with the phone unlocked
      on the home screen: the NDEF intent filter (`timeserved://box`, `plugins/nfc`) opens
      /foregrounds Time Served.
- [ ] **App in foreground → TAG_READ.** With the app open (reader mode active), scan the
      tag: the read is handled in-app (payload emitted) without any prompt or chooser.
- [ ] **Foreign NDEF tag → ignored silently.** Scan the foreign tag with the app in
      foreground: nothing visible happens in the app — no toast, no dialog, no error
      (stage-1 scope check).
- [ ] **Unknown-but-valid tag.** Scan a Time Served tag written by ANOTHER device (valid
      uuid + label, not in the local `boxes` table): the reader emits the payload; the J9
      wiring auto-creates a `origin=foreign` box and counting works. No dialog.
- [ ] **Unsupported version dropped.** Write a test tag with `?v=2` (e.g. via NFC Tools):
      scanning it does nothing user-visible; a debug log notes the dropped version.
- [ ] **Both tags, same box → single TAG_READ.** Place the phone so it grazes both tags of
      one box within ~3 s: exactly ONE read is emitted (dedupe window above). Wait >3 s,
      scan again: a new read is emitted.
- [ ] **NFC off → isAvailable false.** Disable NFC in system settings: `isAvailable()`
      reports false and `start()` rejects; the UI surfaces it (no crash).

### Write path (§9.3 wizard / §9.4 locking)

- [ ] **Blank tag write.** Run the registration wizard with a factory-blank NTAG215: state
      reported as `blank`, write succeeds, read-back verify passes, box counts on scan.
      Also try a factory tag without an NDEF container (NdefFormatable): it is formatted
      and written.
- [ ] **Foreign tag overwrite warning.** Present the foreign NDEF tag in the wizard: state
      `foreign` with a readable summary (the wizard must warn before overwriting); after
      confirming, write + verify succeed.
- [ ] **Our tag re-detected.** Present an already-written Time Served tag: state `ours`
      with its payload (wizard offers re-link/relabel, §9.3).
- [ ] **Read-back verify.** Pull the tag away immediately after tapping write: the step
      fails with `write-failed`/`verify-failed`/`tag-lost` — never a false success.
- [ ] **Lock-bit flow — explicit only.** Complete a write WITHOUT confirming locking: the
      tag stays rewritable (rewrite it to prove it). Complete another write and explicitly
      confirm locking (`lock: true`): `locked: true` is reported and a subsequent wizard
      write on that tag fails; scanning it still reads fine.
- [ ] **Locked foreign tag.** Present a read-only tag with foreign content: state
      `locked-foreign`; the wizard offers no overwrite.
- [ ] **Second tag, same box.** Write a second tag for the same box in the wizard loop:
      identical payload; scanning either tag yields the same box (and dedupe above).

### Emulator (no NFC hardware)

- [ ] Dev harness drives `FakeTagReader.simulateTag/simulateRawScan` and `FakeTagWriter`
      (`src/platform/fakes/`) — the full arm→charge→close loop works without NFC.
