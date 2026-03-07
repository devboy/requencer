# Flux.ai Prompts — Requencer Eurorack Module (v2)

Structured for Flux's block-by-block workflow. Don't paste everything at once — follow the steps in order, waiting for Flux to respond and propose architecture at each stage before moving on.

**Setup:** Start a new Flux project with the JLCPCB 2-layer constraints template.

---

## Step 1: Project Brief

Paste this first. Let Flux generate an architecture plan and ask clarifying questions before proceeding.

```
Design a 4-track step sequencer eurorack synthesizer module.

Target user: Eurorack musician
Operating environment: Eurorack case with ±12V power supply
Form factor: 3U height (128.5mm), approximately 55-60 HP wide
Fabrication: JLCPCB 2-layer, 1.6mm FR4, HASL lead-free, black soldermask

Core functions:
- 16-step sequencer with 4 independent tracks
- Each track outputs gate, pitch CV, velocity CV, and modulation CV (16 analog outputs total)
- 16-bit DAC precision for pitch CV (1V/oct accuracy matters)
- 3.5" color LCD display for sequence editing UI
- 32 illuminated RGB buttons for step/track/function selection
- 2 rotary encoders with push switches for value editing
- MIDI in/out over TRS Type A jacks
- Clock and reset input/output jacks
- 4 spare CV input jacks for future expansion

Controller: Raspberry Pi Pico (RP2040), soldered via castellated pads

Power budget:
- +12V rail: op-amp positive supply, regulated down to +5V and +3.3V
- -12V rail: op-amp negative supply only
- +5V (~200mA): LED drivers, DAC analog supply
- +3.3V (~85mA): Pico, LCD logic, shift registers, DAC digital supply

Output voltage ranges:
- Gate outputs: 0-5V (standard eurorack gate)
- Pitch CV outputs: -2V to +8V (10 octaves, 1V/oct)
- Velocity outputs: 0-8V
- Mod outputs: -5V to +5V (bipolar)

Physical constraints:
- All jacks, buttons, and encoders are through-hole, mounted on the front side, protruding through a front panel
- LCD mounts behind the panel, visible through a cutout
- All ICs, regulators, passives, and the Pico mount on the back side (SMD)
- Separate analog section (DACs, op-amps) from digital section (shift registers, LED drivers) on the PCB
- Continuous ground plane, no splits

Out of scope for this revision: firmware, front panel mechanical design, enclosure
```

---

## Step 2: Power Supply Block

After Flux proposes its plan, build the power section first.

```
Let's start with the power supply block.

Inputs:
- Eurorack ±12V via standard shrouded 2x5 pin header (2.54mm pitch, keyed)
- Standard eurorack pinout: pins 1-2 = -12V, pins 3-8 = GND, pins 9-10 = +12V

Requirements:
- Reverse polarity protection on both +12V and -12V rails (Schottky diodes)
- +5V linear regulator from +12V, minimum 300mA capacity (load ~200mA)
- +3.3V linear regulator from +12V, minimum 150mA capacity (load ~85mA)
- ±12V passed through (after protection) for op-amp supply rails
- The Pico's VSYS pin should be powered from the 3.3V regulator output via a Schottky diode, so USB power and eurorack power don't conflict

Protection:
- Reverse polarity on both supply rails
- Adequate bypass capacitors on all regulator inputs and outputs (10uF + 100nF)
- Bulk capacitance near the first op-amp for ±12V rails

Design goal: Reliable, low-noise power for mixed analog/digital circuit
```

---

## Step 3: Microcontroller Block

```
Now let's add the Raspberry Pi Pico (RP2040) microcontroller.

Use the castellated pad module footprint — it solders flush to the back of the PCB.

Interfaces needed (accent on what connects where, not specific pin numbers — assign pins logically):
- SPI bus (shared): connects to LCD display, and two DAC chips (3 CS lines needed)
- Bit-banged serial chain: connects to 4 daisy-chained shift register inputs (CLK, latch, data lines)
- Bit-banged serial chain: connects to 4 daisy-chained LED driver outputs (data, clock, latch, blank lines)
- 2 rotary encoders: each needs 2 quadrature channels + 1 push switch (6 GPIO total), with pull-ups and debounce caps
- UART: TX and RX for MIDI
- 2 digital inputs: clock in and reset in (from eurorack levels, need protection/level shifting to 3.3V)
- 1 digital output: clock/reset out (needs to drive eurorack gate level ~5V)

Power: VSYS from 3.3V regulator via Schottky diode (as designed in power block)

Design goal: Clean pin assignment that keeps SPI signals short and groups related functions
```

---

## Step 4: DAC and Analog Output Block

```
Now let's design the DAC and analog output stage. This is the precision analog section.

Requirements:
- 16 channels of analog output, from two 8-channel 16-bit DACs
- DACs connect to the shared SPI bus with individual CS lines
- DAC native output range: 0-5V (internal 2.5V reference, gain of 2)
- DAC analog supply: +5V

Each DAC output feeds an op-amp buffer/amplifier to reach the target voltage range:
- 4 gate channels: unity buffer, 0-5V pass-through
- 4 pitch CV channels: scaled and offset to -2V to +8V (gain of 2, with DC offset)
- 4 velocity channels: scaled to 0-8V (gain of ~1.6)
- 4 mod channels: scaled and offset to -5V to +5V (bipolar, using DAC midpoint as zero)

Use quad rail-to-rail output op-amps powered from ±12V eurorack rails. 4 quad op-amps = 16 channels.

Each output needs a 1kohm series protection resistor before the output jack.

Use 0.1% tolerance resistors in the pitch CV gain/offset network for tuning accuracy.

Design goal: Low-noise, precision analog outputs suitable for 1V/oct pitch CV
```

---

## Step 5: Button Scanning Block

```
Now let's add the button input scanning circuit.

Requirements:
- 32 tactile buttons, active low (button press connects to GND)
- Read via 4 daisy-chained 8-bit parallel-in serial-out shift registers
- Each button input needs a pull-up resistor (10kohm to 3.3V)
- Shift registers powered from 3.3V
- 3 control lines from the Pico: clock, parallel load/latch, serial data out

The buttons are physical through-hole illuminated tactile switches mounted on the front panel side.

Design goal: Reliable scanning with clean signal integrity, minimal GPIO usage
```

---

## Step 6: LED Driver Block

```
Now let's add the RGB LED driver circuit.

Requirements:
- 32 RGB LEDs (one per button), common anode, 96 LED channels total
- Driven by 4 daisy-chained 24-channel constant-current sink LED drivers
- Each driver has an external resistor to set maximum current (~20mA per channel)
- 12-bit PWM brightness control per channel (handled by the driver IC)
- LED anodes connect to +5V; cathodes to driver sink outputs
- Drivers powered from +5V
- 4 control lines from the Pico: serial data in, clock, latch, blanking/output enable

Design goal: Smooth RGB color mixing with consistent brightness across all 32 buttons
```

---

## Step 7: Display Connector

```
Now let's add the LCD display connector.

Requirements:
- Pin header or FPC connector for a 3.5" ILI9488 SPI TFT display module (480x320)
- Connector provides: VCC (3.3V), GND, CS, DC, RST, MOSI, SCK (from shared SPI bus)
- Backlight control via N-channel MOSFET switched by a Pico GPIO (backlight draws ~40mA)
- Write-only (no MISO connection needed)

The display module mounts behind the front panel, visible through a rectangular cutout. The connector should be positioned to allow a short ribbon or direct header connection.

Design goal: Simple, reliable display connection with software-controlled backlight
```

---

## Step 8: I/O Jacks Block

```
Now let's add all the I/O jacks. All jacks are 3.5mm mono (Thonkiconn style), through-hole.

26 jacks total:
- 16 analog output jacks: connect from the op-amp output stage (after 1kohm protection resistor). Tip = signal, sleeve = GND.
- 2 clock/reset input jacks: eurorack signals (up to ±12V) need protection and level shifting to 3.3V for the Pico. Use a voltage divider, noise filter cap, and Schottky clamp diode to 3.3V and GND.
- 1 clock/reset output jack: Pico GPIO drives a transistor buffer to output ~5V gate level.
- 4 CV input jacks (spare, for future use): same protection circuit as clock/reset inputs. Not connected to anything in firmware yet, but wired to Pico ADC-capable pins.
- 2 MIDI jacks: TRS Type A standard. MIDI out uses UART TX through a current-limiting resistor. MIDI in uses an optocoupler for electrical isolation per MIDI spec.
- 1 USB jack position: the Pico's onboard USB micro port should be accessible from the front panel or via a panel-mount USB breakout header.

Design goal: Properly protected I/O that handles eurorack voltage levels safely
```

---

## Step 9: Review and Iterate

After all blocks are placed, ask Flux to review:

```
Please perform a full schematic review:
- Check all power connections and bypass capacitors
- Verify all nets are connected (no floating pins)
- Check that analog and digital grounds are properly connected
- Verify SPI bus CS lines don't conflict
- Check protection circuits on all inputs
- Verify op-amp supply rails are correct (±12V)
- List any missing components or connections
```

---

## Notes

- **Don't specify pin numbers** in the early blocks — let Flux assign them, then verify they make sense for routing
- **Don't paste circuit diagrams** — describe the function and let Flux propose the topology
- **Wait for Flux to respond** at each step before pasting the next block
- **Use Flux's review features** (right-click context menu) to check decoupling caps, explain circuits, etc.
- **Correct errors immediately** — if Flux gets something wrong in one block, fix it before building the next block on top of it
- The original detailed prompt is preserved in `flux-ai-prompt.md` as a reference for verifying Flux's choices

---

## Copilot Knowledge Base

If your Flux account supports it, add these to your project-level Copilot Knowledge:

```
This is a eurorack synthesizer module. Key conventions:
- Power comes from ±12V eurorack bus via 2x5 shrouded header
- All audio/CV signals use 3.5mm mono jacks (Thonkiconn PJ398SM)
- Gate signals are 0-5V digital
- Pitch CV follows 1V/octave standard, typically -2V to +8V range
- All through-hole components (jacks, buttons, encoders) mount on the front side
- All SMD components mount on the back side
- JLCPCB fabrication: 2-layer, FR4, 1.6mm, black soldermask
- Prefer LCSC-stocked components for JLCPCB assembly
```
