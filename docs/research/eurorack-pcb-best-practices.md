# Eurorack PCB Design: Best Practices & Common Pitfalls

**Date:** 2026-03-05

Research compiled from community experience, manufacturer guidelines, and professional PCB design resources. Each section includes an assessment of our Requencer design.

---

## 1. Power Supply Design

### Best Practices

- **Reverse polarity protection is mandatory.** Plugging a ribbon cable backwards is the #1 eurorack failure mode. Schottky diodes (BAT54S, 1N5817) in series on ±12V rails are standard — ~0.4V drop leaves 11.6V, plenty of headroom.
- **Use a shrouded/keyed 2×5 header.** Even with keying, the connector can be wired backwards in the schematic. Verify pinout against Doepfer standard: -12V at pin 1 (red stripe side), GND in middle, +12V at pin 9-10.
- **The 16-pin connector has a dangerous design flaw:** if inserted backwards, ground pins short +12V to the +5V rail, potentially destroying every module on the bus that uses +5V. If using 16-pin, reverse polarity protection on +5V is critical.
- **Bulk caps on raw rails:** 10µF minimum at power entry, before regulators. Doepfer uses 10µF + 100nF.
- **Per-regulator filtering:** 100nF ceramic input + 10µF + 100nF output on each voltage regulator.

### Our Design (power.ato)
- **Schottky diodes on ±12V** — BAT54S in series on both rails
- **10µF bulk caps** on raw ±12V after diodes
- **AZ1117-5.0 and AMS1117-3.3** with proper input/output bypass (100nF + 10µF)
- **Schottky on Pico VSYS** for USB co-power
- **10-pin header** (avoids the dangerous 16-pin +5V rail issue)
- **Status: Good.** All standard protections in place.

---

## 2. Decoupling & Bypass Capacitors

### Best Practices

- **100nF ceramic on every IC power pin**, placed as close to the pin as physically possible. Route power through the cap first ("Via → Cap → Pin" order).
- **Bypass from each rail to ground**, not across rails. A cap from +12V to -12V doesn't properly bypass an op-amp.
- **10µF bulk cap per cluster** of ICs sharing a power rail, in addition to per-IC 100nF caps.
- **Use X7R or C0G ceramic** for bypass. X7R for general (100nF), C0G/NP0 for precision analog (DAC references).
- **Small series resistors** (10-47Ω) between supply rail and IC power pins can damp LC ringing — especially useful for op-amps.

### Our Design
- **100nF on all op-amp V+ and V-** (8 caps for 4× OPA4172)
- **100nF on DAC AVDD** (2 caps for 2× DAC8568)
- **1µF on DAC reference pins** (VREFIN/VREFOUT)
- **Potential improvement:** Add 10µF bulk cap near the op-amp cluster on both ±12V. Four quad op-amps can draw significant transient current; the 10µF bulk caps at power entry may be too far away on the PCB.
- **Potential improvement:** Consider 10µF on DAC AVDD for settling transients.
- **Status: Good fundamentals.** Needs bulk caps near analog cluster added during layout.

---

## 3. Ground Plane Strategy

### Best Practices

- **Use a single, continuous ground plane. Do NOT split it.** This is the modern consensus from Analog Devices, Henry Ott, and experienced PCB designers. A split ground forces return currents through longer paths, creating larger loop areas and more noise.
- **Never route traces over ground plane gaps.** Even "slow" digital signals (SPI at 10MHz) have fast edge rates (~10ns) that radiate EMI if they cross a gap.
- **Logically partition the board** into analog and digital zones through component placement — not by cutting the ground plane.
- **DACs sit at the analog/digital boundary.** Place them between the digital zone (MCU, shift registers) and analog zone (op-amps, output jacks).
- **Ground pour on both sides** of a 2-layer board, stitched with vias. This provides low-impedance return paths.
- **Guard traces around sensitive analog lines** if they must run near digital signals.

### Our Design (place_components.py)
- Placement script defines analog zone (right side, near output jacks) and digital zone (left side, near buttons/MCU)
- DACs positioned between digital and analog zones
- **Potential improvement:** Ensure the autorouter doesn't create ground plane splits. May need manual review of ground pour connectivity after Freerouting.
- **Status: Good layout strategy.** Verify after routing.

---

## 4. Analog Output Quality

### Best Practices

- **1V/octave pitch requires 0.1% resistors** in the DAC→op-amp path. A 1% resistor gives ±12 cents error — audible. 0.1% gives ±1.2 cents — acceptable.
- **Output protection resistors** (100Ω–1kΩ) protect op-amps from shorted outputs and cable capacitance oscillation.
- **Keep analog traces short and direct.** DAC → op-amp → jack should be the shortest path on the board.
- **Avoid routing analog signals near SPI bus, LED drivers, or shift register clock lines.** Digital switching noise couples into audio.
- **Use a dedicated voltage reference** for DC offsets rather than deriving from raw ±12V, which has poor PSRR.

### Our Design (dac-output.ato)
- **0.1% resistors on pitch channel** (inverting summing amp input/feedback)
- **1kΩ output protection** on all 16 outputs
- **Voltage reference dividers** for pitch (+2V) and mod (+1.667V) offsets — derived from +3.3V regulated supply, not raw ±12V
- **1µF filter caps on reference dividers**
- **Potential concern:** 1kΩ output + typical 100kΩ input impedance = 1% signal loss (acceptable). But combined with cable capacitance (~100pF), the -3dB point is ~160kHz — well above audio range.
- **Status: Very good.** Precision resistors where needed, proper protection, clean references.

---

## 5. Physical Dimensions & Mechanical Fit

### Best Practices

- **Maximum PCB height: ~108mm** to fit within 3U (128.5mm) cases with rack rails. PCB must be vertically centered.
- **Panel thickness: 1.6mm** is standard for FR4 faceplate PCBs. 2mm is the Doepfer spec for aluminum panels, but 1.6mm FR4 is widely accepted.
- **PCB-to-panel gap: 9-12mm** depending on component mounting style (vertical vs right-angle).
- **Through-hole components (jacks, buttons, encoders) set the minimum panel-to-PCB distance.** PJ398SM jacks need ~11mm clearance.
- **Component active zone: 10mm–118.5mm** from top edge. Top and bottom 10mm are covered by rack rails — silkscreen only, no components.
- **HP width tolerance:** Rails have some play. ±0.1mm on panel width is fine.

### Our Design (panel-layout.json)
- Panel: 128.5mm × 182.88mm (36HP)
- Rail zones: 10mm top and bottom (mounting slots at 3.4mm and 125.1mm)
- All buttons/jacks/encoders within 12.5mm–106.6mm vertical range
- **Status: Good.** All components within active zone.

---

## 6. Trace Width & Routing

### ~~Old Recommendations (overly conservative)~~

The original version of this section recommended 0.5mm signal traces and 0.9mm power traces, based on general eurorack community advice from DIY forums (ModWiggler, North Coast Synthesis). Those recommendations were designed for **2-layer boards with large through-hole components** and assume older PCB manufacturing with wider tolerances. They are not appropriate for dense SMD designs manufactured at modern fabs like JLCPCB.

### Updated Best Practices (fact-checked, 2026-03-14)

**The key insight: trace width matters for current capacity and manufacturing yield — not for EMI or signal integrity at eurorack frequencies.** All eurorack signals (CV, gate, audio, SPI) are low-frequency relative to PCB trace effects:

| Signal type | Frequency range | Impedance/EMI concerns? |
|-------------|----------------|------------------------|
| Pitch CV | DC (static voltage) | No — trace is just a wire |
| Gate CV | DC (0V or 5V) | No |
| Audio/mod CV | DC–20kHz | No — wavelength is km, trace is mm |
| SPI clock | 1–10 MHz | Minimal — edge rates ~10ns, trace lengths <50mm |
| LED PWM | ~4 kHz | No |

**Trace width only matters for:**

1. **Current carrying capacity.** A 0.15mm trace on 1oz copper carries ~0.5A safely. Eurorack signal currents are <20mA. Even power traces rarely exceed 400mA total per rail for a single module.

2. **Manufacturing yield.** JLCPCB standard capability for 4-layer boards is 0.1mm (4 mil) trace/space. Their recommended minimum is 0.15mm (6 mil) for best yield. Going wider than needed wastes routing capacity without improving yield.

3. **IR drop on power distribution.** Wider power traces reduce voltage drop across long shared rails. This is the one place where 0.3mm+ traces have a real benefit — not for signal integrity, but for keeping the voltage at the IC pin close to the regulator output.

**What actually prevents interference:**

- **Ground planes** (4-layer board with continuous ground on layer 2) — provides low-impedance return paths and shielding between signal layers. This is the single biggest factor for noise rejection.
- **Trace spacing** — crosstalk drops with the square of distance. The "3× rule" (3× trace width center-to-center spacing) eliminates ~70% of capacitive coupling. At 0.15mm traces, that's 0.45mm — easily achieved by any autorouter.
- **Component placement** — keeping fast digital (SPI) physically separated from precision analog (pitch CV). This is a layout topology concern, not a trace width concern.

**What does NOT matter at eurorack frequencies:**

- **Trace width for EMI** — only relevant above ~50 MHz. Our fastest signal (SPI clock) is 1–10 MHz.
- **Impedance matching** — matters for signals with rise times <1ns and trace lengths approaching λ/10. Our traces are <50mm; at 10 MHz, λ/10 = 3 meters.
- **Via inductance in analog paths** — each via adds ~0.5nH. At DC (pitch CV), inductance = 0Ω. At 20kHz (audio), 0.5nH = 0.00006Ω. Negligible.
- **Wider traces = less inductance** — true, but inductance only matters at high frequency. At DC, it's zero.

### Recommended Netclasses (Requencer)

Based on actual signal requirements and JLCPCB 4-layer capabilities:

| Netclass | Track width | Clearance | Via dia/drill | Rationale |
|----------|------------|-----------|---------------|-----------|
| Default (digital) | 0.15mm | 0.127mm | 0.6/0.3mm | SPI, GPIO, shift register — all <5mA, low frequency |
| Power | 0.3mm | 0.15mm | 0.8/0.4mm | Shared rails (±12V, 5V, 3.3V) — IR drop matters here |
| Analog | 0.15mm | 0.15mm | 0.6/0.3mm | DAC outputs, op-amp I/O, CV paths — DC signals, µA-level currents. Wider clearance for routing separation from digital, not for the trace width itself |
| LED | 0.15mm | 0.127mm | 0.45/0.2mm | TLC5947 outputs, <20mA constant current sinks. Minimum size to ease routing from dense VQFN-32 package |

Previous values (0.2mm default, 0.3mm analog, 0.3mm power) were ~2× what's needed, wasting routing capacity on dense boards with VQFN/WQFN packages. The revised values stay well above JLCPCB minimums (0.1mm) while maximizing routing flexibility.

### Routing Guidelines (unchanged)

- **45° routing angles only.** Avoid arbitrary angles — they make spacing harder and complicate DRC.
- **Avoid running analog traces parallel to SPI clock or LED data lines.** Use ground plane shielding between layers, or route on different layers with orthogonal orientation.
- **Ground pour on both copper layers**, stitched with vias every ~5mm. Check for isolated copper islands after routing.

### Our Design (design-rules.json)
- Netclasses defined in `design-rules.json`, applied automatically by `common/design_rules.py` before DSN export.
- Net-to-netclass assignments use regex patterns for automatic matching.
- **Status: Updated.** Netclasses revised to match actual signal requirements.

### Sources

- [JLCPCB Manufacturing Capabilities (2025)](https://jlcpcb.com/capabilities/pcb-capabilities) — 4-layer: 0.1mm min trace/space standard
- [JLCPCB Design Rules Specification Guide (2025)](https://www.schemalyzer.com/en/blog/manufacturing/jlcpcb/jlcpcb-design-rules) — recommended 0.15mm for yield
- [Cadence: How to Reduce Crosstalk in PCB Layout](https://resources.pcb.cadence.com/blog/2019-how-to-reduce-crosstalk-in-your-pcb-layout) — spacing > width for crosstalk
- [Altium: Crosstalk in Mixed-Signal PCB Traces and Ground Planes](https://resources.altium.com/p/crosstalk-in-mixed-signal-pcb-traces-and-ground-planes) — ground planes are the primary defense
- [TI Precision Labs: Crosstalk on PCB Layouts (ADC application)](https://www.ti.com/content/dam/videos/external-videos/ja-jp/9/3816841626001/6307563213112.mp4/subassets/crosstalk-on-pcb-layouts-presentation-quiz.pdf) — spacing and ground planes, not trace width
- [Proto-Electronics: Best Crosstalk Reduction Techniques](https://www.proto-electronics.com/blog/best-crosstalk-reduction-techniques) — 3× rule for spacing
- [Sierra Circuits: 7 PCB Design Tips for EMI/EMC](https://www.protoexpress.com/blog/7-pcb-design-tips-solve-emi-emc-issues/) — ground planes and return paths
- [ModWiggler: Eurorack Trace Widths Discussion](https://modwiggler.com/forum/viewtopic.php?t=193128) — community consensus: 15 thou signal, 30 thou power (conservative, aimed at 2-layer DIY boards)

---

## 7. 2-Layer vs 4-Layer Decision

### Best Practices

- **2-layer is fine for simple analog modules.** Most DIY eurorack modules are 2-layer.
- **4-layer recommended when:** mixed analog + digital, dense routing, MCU + audio on same board.
- **Cost difference at JLCPCB:** ~$2 for 2-layer vs ~$5 for 4-layer (5 pcs, small board). At eurorack PCB sizes (~100×180mm), the difference is larger but still modest.
- **4-layer stackup:** Top (signal) → Layer 2 (GND plane) → Layer 3 (power) → Bottom (signal). This gives every signal trace an adjacent ground reference.

### Our Design
- Currently targeting **2-layer** for cost.
- With Pico MCU, 2× DAC8568 (SPI), 4× 74HC165 (SPI), 4× TLC5947 (SPI), 4× OPA4172 (analog), 32 LEDs, 26 jacks — this is a dense mixed-signal board.
- **Recommendation: Consider 4-layer.** The cost increase is modest, and the dedicated ground plane will significantly improve analog noise performance and routing flexibility. If budget is tight, stay 2-layer but be very careful with ground pour integrity.

---

## 8. Common Manufacturing Mistakes

### Pitfalls

- **BOM errors:** Wrong LCSC part number, wrong footprint, wrong quantity. Triple-check before ordering.
- **Footprint mismatch:** The #1 cause of DOA boards. Verify every IC footprint against the actual purchased part's datasheet.
- **Silkscreen over pads:** Some fabs don't clip silkscreen automatically. Ensure no silk overlaps copper pads.
- **Missing solder mask openings:** Especially on through-hole pads and test points.
- **Wrong drill sizes:** PJ398SM needs 6mm, EC11E needs 7mm. Verify against manufacturer's panel cutout spec, not pin diameter.
- **Solder paste on through-hole pads:** If mixing SMD assembly with through-hole, ensure TH pads are excluded from the CPL/paste layer.

### Our Design
- LCSC part numbers embedded in atopile component definitions — extracted automatically to BOM.
- Footprints generated from datasheet dimensions via KicadModTree script.
- **Action item:** Verify generated footprints against datasheets before first order. Print 1:1 on paper and physically check component fit.

---

## 9. Schematic Copying Errors

### Pitfalls

- **Flipped op-amp after copy-paste:** Inverting/non-inverting inputs swapped. Module may appear to work but with wrong gain/phase.
- **Mirrored component orientation:** LEDs, diodes, electrolytics — polarity matters.
- **Shared net names after copy:** Two independent circuits accidentally connected via a copy-pasted net label.

### Our Design
- Atopile's module system helps here — each circuit is a self-contained module instantiated with explicit wiring. No copy-paste of raw schematics.
- **Status: Low risk** due to atopile's modular structure.

---

## 10. Testing & Bring-Up Checklist

Before powering up the first board:

1. **Visual inspection:** Check for solder bridges, missing components, orientation marks
2. **Continuity check:** Verify ±12V, GND, +5V, +3.3V are not shorted to each other
3. **Power-on test:** Connect to bench supply (not eurorack!) with current limiting at 100mA. Measure all rails before connecting anything
4. **Regulator verification:** +5V should read 4.95-5.05V, +3.3V should read 3.25-3.35V
5. **Pico check:** Connect USB, verify it enumerates and runs firmware
6. **Output voltage check:** Set DAC to known values, measure at jack tips with multimeter
7. **Pitch calibration:** Play C1-C5 (5 octaves), measure at pitch output — should be exactly 1V per octave within ±5mV
8. **Clock/reset test:** Send 1Hz clock, verify module advances steps
9. **Full integration:** Install in eurorack case, verify no noise/hum from shared power bus

---

## Summary: Issues to Address in Our Design

| Priority | Issue | Action |
|----------|-------|--------|
| Medium | Missing bulk caps near op-amp cluster | Add 10µF on ±12V near OPA4172 group |
| Medium | Missing bulk cap on DAC AVDD | Add 10µF on AVDD |
| Medium | 2-layer vs 4-layer decision | Consider 4-layer given mixed-signal density |
| Low | Input divider tolerance (5%) | Upgrade to 1% resistors (10k/22k) |
| Low | Clock output inverts GPIO | Document in firmware; or swap to emitter-follower |
| Done | Trace widths revised | Netclasses in design-rules.json updated 2026-03-14 |
| Verify | Ground plane continuity after routing | Manual review of ground pour |
| Verify | Footprint dimensions vs datasheets | Print 1:1 and check physical fit |

---

## Sources

- [Tom Aisthorpe — How I Learned PCB Design for Eurorack](https://tomaisthorpe.com/blog/how-i-learned-pcb-design-for-eurorack/)
- [North Coast Synthesis — PCB Design Mistakes](https://northcoastsynthesis.com/news/pcb-design-mistakes/)
- [Synth DIY Wiki — Eurorack Panel Components](https://sdiy.info/wiki/Eurorack_panel_components)
- [Cadence — Common PCB Design Mistakes (2025)](https://resources.pcb.cadence.com/blog/2025-common-pcb-design-mistakes)
- [Cadence — Should You Ever Separate Analog and Digital Ground Planes](https://resources.pcb.cadence.com/blog/2021-should-you-ever-separate-analog-and-digital-ground-planes)
- [Cadence — Op-Amp Layout Guidelines for Mixed Signal Designs](https://resources.pcb.cadence.com/blog/2024-op-amp-layout-guidelines-for-mixed-signal-designs)
- [JLCPCB — Understanding Analog and Digital Ground in PCB Design](https://jlcpcb.com/blog/understanding-analog-and-digital-ground-in-pcb-design)
- [Analog Devices — Basic Guidelines for Mixed-Signal PCB Layout](https://www.analog.com/en/resources/analog-dialogue/articles/what-are-the-basic-guidelines-for-layout-design-of-mixed-signal-pcbs.html)
- [Mod Wiggler — Decoupling Caps on Eurorack Rails](https://modwiggler.com/forum/viewtopic.php?t=200737)
- [Mod Wiggler — Module Power Entry Filtering](https://modwiggler.com/forum/viewtopic.php?t=220000)
- [Mod Wiggler — Euro Module Power Protection](https://www.modwiggler.com/forum/viewtopic.php?t=113628)
- [Division 6 — Eurorack Power](https://division-6.com/learn/eurorack-power/)
- [Perfect Circuit — Eurorack Modular Power Basics](https://www.perfectcircuit.com/signal/eurorack-modular-power-basics)
- [Sparkos Labs — Power Supply Decoupling Capacitors](https://sparkoslabs.com/power-supply-decoupling-capacitors/)
- [JLCPCB — 4 Layer vs 6 Layer vs 8 Layer PCB Stackup](https://jlcpcb.com/blog/multilayer-pcb-stackup)
