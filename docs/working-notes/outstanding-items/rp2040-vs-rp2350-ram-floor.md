# §3's RP2040-vs-RP2350 RAM floor — still not formally closed
> **2026-10-30 sweep:** Update: "RP2350 bring-up hasn't happened" is false — flash, deploy and boot-to-HELLO were
  confirmed 2026-09-06 (`rp2350-bringup.md`). What remains open is exactly the headline: no
  RAM/memcheck floor numbers.


RP2040 data is in hand and comfortable (~209KB free of 264KB, no drift under real interrupt traffic) but is one flow on one board, not proof against every v1 flow shape. RP2350 bring-up hasn't happened. Whether that's enough to close §3's provisional language is Mike's call.
