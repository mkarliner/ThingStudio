# Event-driven programming

An event-driven program waits for things to happen, and runs a short piece of code for each one. A button press,
a timer tick and an incoming network message are all events. The code that handles one is often called a
handler.

## The loop you may know

Most microcontroller programs start as a loop:

```python
while True:
    if button.value() == 0:
        led.on()
    temperature = sensor.read()
    time.sleep(0.1)
```

Every job lives inside the loop, and each one waits for the others. A slow sensor read delays the button check.
A `sleep` long enough to pace one job stalls all of them. Adding a job means reworking the timing of the rest.

## The same program, as events

Written as events, each job stands on its own:

- when the button pin falls, turn the LED on
- every 10 seconds, read the sensor

Nothing is checked in a loop. The board sleeps until an event arrives, runs its handler, and waits again. Jobs
with different timing don't get in each other's way.

## How Thingstudio does it

In Thingstudio, each chain of nodes that starts at a source (a `timer`, an `interrupt`, an `mqtt subscribe`) is
one handler. The flow is turned into MicroPython code that uses `asyncio`, MicroPython's built-in event loop. Each
source becomes a task. While one task waits, for a timer or the network, the others run.

## The one rule: don't block

Everything shares one event loop. A handler that stops and waits without handing control back stops every other
handler too. In a function node, that means no `time.sleep()` and no long loops.

To wait, use a node built for it: [`delay`](../nodes/delay.md) waits, [`timer`](../nodes/timer.md) repeats. They
hand control back while they wait.

## More

- [MicroPython's asyncio](https://docs.micropython.org/en/latest/library/asyncio.html)
- [Peter Hinch's asyncio tutorial for MicroPython](https://github.com/peterhinch/micropython-async/blob/master/v3/docs/TUTORIAL.md),
  the most thorough guide there is
