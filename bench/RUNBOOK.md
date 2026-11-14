# Runbook: first hardware session

For the VM on the Mac with USB passthrough. The scripts live in this repo;
the Pico LA lives in its own repo (`~/pico-la`) and is optional for the
first pass — a scope works for the IRQ latency number.

## Before anything

- Flash stock MicroPython for the board (the version the bench records is
  what gets published; don't mix firmware across a comparison).
- Close Thonny, the ThingStudio backend, and any serial monitor. Only one
  process can hold the port.
- On the VM, pass the board's USB device through, not just the hub. Confirm:

  ```sh
  mpremote connect list
  ```

  macOS host paths look like `/dev/tty.usbmodem*` or `/dev/tty.usbserial-*`;
  inside a Linux VM they usually appear as `/dev/ttyACM*` or `/dev/ttyUSB*`.
- Install the host tools once:

  ```sh
  python3 -m pip install mpremote pyserial
  ```

- If `mpremote` cannot open the port, check the `dialout`/`uucp` group and
  that the device did not re-enumerate after flashing.

## Board order

Start with the ESP32-S3 (best case), then the Pico W (PIO, dual-core, no FPU),
then the C3 (the low-end floor). Do the no-wiring tests on all three before
wiring anything: that is most of the data and none of the bench time.

## Suggested pins

Verify against the board's own definition before trusting these; they avoid
the display, USB and strapping pins as far as the schematics in
`editor/src/definitions/boards/` allow.

| Board | IRQ in | Marker out | ADC | Notes |
|---|---|---|---|---|
| ESP32-S3 Freenove 4" | GPIO4 | GPIO5 | GPIO6 | Display uses 10/11/12/45/46; touch 15–18. Avoid USB 19/20. |
| Pico W | GP2 | GP3 | GP26 | GP23/24/25/29 belong to the WiFi chip. |
| ESP32-C3 LuatOS | GPIO1 | GPIO2 | GPIO4 | Avoid 18/19 (native USB), 20/21 (bridge), 9 (BOOT), 11 (flash). |

A second marker (for a chain or a second IRQ) can go on the next free pin:
S3 GPIO7, Pico GP4, C3 GPIO3.

## Run order

### 1. No wiring

```sh
# Interpreter, GC, asyncio, timer, ADC (RP2040 defaults to GP26), threads.
python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3

# Viper/native comparison.
python3 bench/host/run_bench.py --port /dev/ttyACM0 --suite viper --label esp32s3
```

On ESP32, always pass the ADC pin explicitly:

```sh
python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3 --adc-pins 6
```

### 2. Timer at the interesting rates

The default suite already runs 100/1k/5k/10k/20k. If the 20 kHz case wedges
the board, reset it and run with a lower cap to see where it stops:

```sh
python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3 \
  --tests timer --timer-freqs 1000,5000,10000
```

Record whether `hard` came back null/true/false in the result. That, plus the
port docs, is what makes the 20 kHz claim honest.

### 3. IRQ and latency (wiring)

Wire the signal generator to the IRQ pin and the marker to the LA/scope.
If using the Pico LA, follow `~/pico-la/docs/recipes.md`; otherwise set the
scope to trigger on the input edge and measure input→marker.

```sh
python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3 \
  --tests irq --irq-pin 4 --irq-out-pin 5 --irq-hz 1000 --duration-ms 500
```

The bench's `irq` count is rough; the scope/LA capture is the latency result.
Save the LA capture next to the JSON and name both with the same label/date.

### 4. ThingStudio flows

Deploy the flows in `bench/flows/` with `test-flows/device_cli.py`, capturing
marker pins. Do this after the baseline: if the flow path is close to the
baseline, the story is simple; if not, the slope across chain lengths says
where the time goes.

### 5. Copy the results back

Results are written under `bench/results/` on whichever machine ran the
command. Copy the JSON (and LA CSV) into the repo before analysing; do not
transcribe numbers by hand.

## If something goes wrong

- **`no JSON block`**: the board did not run `main()`, or the port was busy.
  Run `mpremote connect <port> run bench/device/bench.py` to see the console.
- **`mpremote` copies but import fails**: the board's filesystem may be full;
  remove old flows/libraries or reflash.
- **Timer test wedges**: reset the board, lower `--timer-freqs`, and keep the
  failed run as a note ("20 kHz callback starved the loop") rather than
  deleting the evidence.
- **ADC test skips**: pass `--adc-pins`; the default only exists for RP2040.
- **Thread test skips**: the port has no `_thread`; that is itself the answer.
- **Numbers move between runs**: check that WiFi/BLE is off, the display is
  not updating, and the host is not compiling in the background. Repeat the
  run; do not average a clean run with a loaded one.
