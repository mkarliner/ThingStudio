# DSP signal chains — scoping

Status: scoping, 2026-11-15. Nothing decided; no code. Every interface change named below needs Mike's explicit
permission and a spec first (`AGENTS.md`, "Architecture first at subsystem interfaces").

Scope: flow nodes that sample a signal continuously (DMA, I2S, a sensor FIFO) and process it in blocks — filtering,
FFT, feature extraction, classification — before handing a low-rate result to ordinary nodes. Triggered by Mike
asking how three libraries might combine with "a DMA node" into signal processing chains:

- `emlearn/emlearn-micropython` — https://github.com/emlearn/emlearn-micropython
- `peterhinch/micropython-filters` — https://github.com/peterhinch/micropython-filters
- `peterhinch/micropython-fourier` — https://github.com/peterhinch/micropython-fourier

## The libraries

**emlearn-micropython (MIT).** ML and DSP on MicroPython, built on the emlearn C99 library. Covers IIR filters
and FFT for preprocessing or general DSP; random forest, decision tree, kNN, K-means, linear regression, PLSR and a
small CNN (via TinyMaix); `emlearn_arrayutils` for scaling and type conversion. Works on `array.array`. Shipped as
native `.mpy` modules per architecture (install at runtime, no reflash) or as an external C module compiled into a
custom build. Primarily tested on x64 Unix and xtensawin (ESP32, ESP32-S3); getting-started guides for ESP32, RP2
and STM32. The project calls itself "minimally useful". Examples include `soundlevel_iir` (sound level meter with
IIR filters) and `har_trees` (activity recognition from an accelerometer).

**micropython-filters (Hinch, v0.92, Dec 2021).** Fast integer FIR filters (moving average, low/high/band-pass,
band-stop). No IIR, no floating point: 32-bit signed integers with a per-product right shift.
- `fir`: ARM Thumb V6 inline assembler — Pyboard and RP2 (Pico) only.
- `fir_py`: Viper emitter, portable to any port with a native emitter, about a third of the assembler's speed.
- Non-realtime module (decimation, convolution, correlation over buffers): ARMv7 assembler, Pyboard-class only.
- Filter calls are safe from hard ISRs, so it works per sample, not just per block.
- Coefficients come from the TFilter web app (integer output) plus a conversion script.

**micropython-fourier (Hinch, v0.52, Oct 2019).** Single-precision in-place Cooley-Tukey FFT, power-of-2 lengths,
optional window function, assembler cartesian-to-polar and dB conversion. No heap allocation, ISR-callable. Needs
ARM Thumb V7 with an FPU: Pyboard 1.x, Pyboard D, Pico 2. 1024 points: 12.9 ms (Pyboard 1.x), 3.6 ms (Pyboard D),
6.97 ms (Pico 2). Its ADC path (`pyb` `read_timed`) is Pyboard-only.

### What that means for Thingstudio

Most Thingstudio boards are ESP32 family (classic, S2, S3 are Xtensa; C3 and C5 are RISC-V), where Hinch's
assembler cannot run. So:

- **emlearn** is the main engine: IIR, FFT and classifiers on every board.
- **Hinch `fir_py`** is the FIR that runs everywhere.
- **Hinch assembler** (`fir`, the FFT) becomes a faster backend for the *same* nodes on RP2 and Pyboard, chosen at
  compile time from the board's processor. Users never pick a library.

## The "DMA node" is a block-source node

MicroPython has no portable DMA API, so define the node by its output — fixed-size sample buffers at a known rate —
and let the hardware path vary by chip:

| Chip | Continuous-sampling path | Notes |
|---|---|---|
| RP2040 / RP2350 | `rp2.DMA` paced by the ADC FIFO's data request (or PIO) | True DMA ring buffer. Needs register access: `machine.ADC` does not expose the FIFO. |
| ESP32 family | `machine.I2S`, DMA-backed, asyncio-capable | Good fit for I2S MEMS mics (INMP441, ICS-43434). Continuous ADC sampling (the IDF `adc_continuous` driver) is, as far as known, not exposed in MicroPython — would need a C module in the custom firmware. **Check against v1.29.** |
| Pyboard | `ADC.read_timed` | Blocks for the whole capture; Hinch uses it up to about 750 kHz. |
| Any | Timer-interrupt sampler into a ring buffer | Low rates only; this is where Hinch's ISR-safe FIR helps. |

An IMU's hardware FIFO read over I2C is also a block source: vibration and activity recognition without fast ADC
sampling.

## Design points

1. **Blocks between nodes, never single samples.** An asyncio hop costs something like hundreds of microseconds on
   an ESP32, so per-sample messaging fails at a few hundred Hz. A block carries the buffer, sample rate, data type,
   channel count and a sequence number (so a dropped block is detectable).
2. **Allocate at deploy, never per block.** A GC pause during DMA means overruns. Double buffers, in-place
   transforms (emlearn and Hinch already work in place on `array`). Report overruns with `runtime.report_status` —
   no new mechanism.
3. **Fuse adjacent DSP nodes in codegen.** The editor shows `sampler → iir → fft → features → classify`; the
   compiler emits one loop with no queues between stages. A compiled flow can do this; Node-RED can't.
4. **The chain exists to cut the data rate.** kHz samples in, a few messages per second out (RMS, band energies, a
   class label) into ordinary `mqtt`/`display`/`gpio` nodes. Make the boundary visible with a distinct `signal`
   port type, so raw blocks can't be wired into a `debug` node and flood the board link. Fits the existing wire-type
   system (`archive/wire-type-system-scoping.md`) as a new payload type.
5. **Live scope/spectrum view in the editor.** The board sends one cut-down block a couple of times a second.
   Likely the feature people remember. Touches the wire protocol.
6. **Filter design in the editor.** The standard biquad formulas (low/high/band-pass) are short in TypeScript and
   would produce coefficients for an emlearn IIR node, so nobody pastes output from an external design tool.
   Hinch's FIR needs integer coefficients from TFilter, which is clumsier.

Memory sanity check: classic ESP32 without PSRAM has roughly 100 kB free heap. Two 1024-sample int16 buffers are
4 kB; a 1024-point float32 FFT (real + imaginary) is 8 kB. Fine, if allocated once.

## Packaging

The dependency catalog (`interfaces/runtime-api/SPEC.md` §3) takes `.py` files only, and a native `.mpy` must match
both the chip architecture and MicroPython's native-module ABI version. Two routes for emlearn:

- **Extend the catalog to carry per-architecture `.mpy` files.** A runtime-API interface change: needs Mike's
  permission and a spec.
- **Build emlearn into the custom firmware images as a C module** (`firmware/`, `firmware-pipeline-scoping.md`).
  Leaning this way: the pipeline exists (classic ESP32, C3, C5), and the capability check can mark DSP nodes as
  needing a Thingstudio image. Cost: boards on stock MicroPython don't get these nodes.

Hinch's `fir_py` is plain Python (Viper) and fits the current catalog unchanged.

## Interface changes this would need

- Block message shape (buffer, metadata, ownership, overrun reporting) — new contract.
- `signal` port payload type — node-descriptor interface.
- Scope/spectrum snapshot message — wire protocol (`interfaces/protocol/`).
- Possibly `.mpy` dependencies — runtime-API interface (only if the catalog route is chosen).

## Suggested order

1. **Two measurement spikes, no new nodes:**
   - ESP32-S3 + I2S mic: emlearn IIR then RMS inside a `function` node at 16 kHz. Measure CPU headroom and memory.
   - Pico 2: `rp2.DMA` + ADC FIFO feeding Hinch's FFT.
2. **Spec the block contract.**
3. **Nodes:** `sampler` (I2S and rp2-DMA backends first), `iir`, `fft`, `features`, `classify` (loads an emlearn
   model file). Fuse in codegen.
4. **Scope view**, with permission for the protocol change.

Good first demos: sound-level meter (emlearn's `soundlevel_iir` is close to ready-made), motor vibration bands over
MQTT, CT-clamp current measurement, knock or clap detection.

## Open questions for Mike

- Which spike first: ESP32-S3 + I2S mic, or Pico 2 + DMA ADC?
- emlearn in the firmware images, or extend the catalog for `.mpy`?
- Is the scope view wanted early (it shapes the block contract), or later?

## To verify before vendoring

- Which architectures emlearn's prebuilt modules actually cover, especially RISC-V (C3, C5) and the RP2350.
- The Hinch repos' licences, for `third-party-licenses.md`.
- Whether MicroPython v1.29 exposes continuous ADC sampling on any ESP32 variant.
