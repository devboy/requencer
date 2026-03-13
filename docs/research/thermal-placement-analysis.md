# Thermal Considerations for Requencer PCB: Regulator Heat vs. Precision DAC

## 1. Power Dissipation Estimates

### 1.1 Estimating Current Draw

The Requencer main board runs a digital sequencer: PGA2350 MCU, DAC8568, and supporting logic. Estimated current budget on the 3.3V rail:

| Component | Typical Current |
|---|---|
| PGA2350 (RP2350 MCU, active) | 50-100 mA |
| DAC8568 (8-ch DAC, active) | ~1 mA (2.9 mW at 3V) |
| SPI peripherals, pull-ups, misc | 10-20 mA |
| **Total 3.3V rail** | **~60-120 mA** |

On the 5V rail (fed to 3.3V regulator plus any 5V peripherals on the control board like LED drivers, shift registers):

| Component | Typical Current |
|---|---|
| 3.3V regulator load (pass-through) | 60-120 mA |
| LED drivers (e.g. TLC5940 or similar) | 20-60 mA (quiescent, LEDs driven via current sinking) |
| Shift registers, misc logic | 10-20 mA |
| **Total 5V rail** | **~90-200 mA** |

### 1.2 AZ1117IH-5.0 (12V to 5V) Power Dissipation

```
P = (Vin - Vout) x Iout = (12V - 5V) x I_5V
```

| Load Current | Power Dissipated | Notes |
|---|---|---|
| 100 mA | 0.70 W | Light load |
| 150 mA | 1.05 W | Moderate load |
| 200 mA | 1.40 W | Heavy load, approaching SOT-223 limit |

The AZ1117I datasheet specifies:
- theta_JA (SOT-223): ~90°C/W (on JEDEC minimum footprint)
- theta_JC: ~15°C/W
- Maximum junction temperature: 125°C

With adequate copper pour, theta_JA can drop to 50-60°C/W (per Richtek AN044 data: increasing pad copper to ~1 sq inch reduces theta_JA from 135 to ~40°C/W).

**This is the primary heat source on the board.** At 1W dissipation with theta_JA of 60°C/W, junction temperature rises 60°C above ambient. At 40°C ambient inside a eurorack case, that puts the junction at 100°C — workable but warm. The PCB surface near the regulator will be notably warmer than the rest of the board.

### 1.3 AMS1117-3.3 (5V to 3.3V) Power Dissipation

```
P = (5V - 3.3V) x Iout = 1.7V x I_3V3
```

| Load Current | Power Dissipated |
|---|---|
| 60 mA | 0.10 W |
| 100 mA | 0.17 W |
| 120 mA | 0.20 W |

**This regulator is not a significant heat source.** At 0.2W and theta_JA of 60°C/W, junction rise is only 12°C. PCB surface temperature rise near the AMS1117 will be negligible (~2-5°C locally).

### 1.4 Summary: Heat Sources

| Regulator | Worst-Case Dissipation | Junction Rise (60°C/W) | Concern Level |
|---|---|---|---|
| AZ1117IH-5.0 (12V→5V) | 1.0-1.4 W | 60-84°C | **Moderate to High** |
| AMS1117-3.3 (5V→3.3V) | 0.10-0.20 W | 6-12°C | **Low** |

## 2. Temperature Gradients on a 4-Layer PCB

### 2.1 Thermal Conductivity of Copper vs FR-4

- Copper: 385 W/(m·K)
- FR-4 laminate: 0.25-0.7 W/(m·K) (roughly 500-1500x worse than copper)

On a 4-layer board with ground pours on inner and outer layers, heat spreads very efficiently laterally through the copper planes.

### 2.2 Expected Temperature Gradients

**Practical estimate for the AZ1117IH-5.0 dissipating 1W on this board:**

| Distance from Regulator | Estimated PCB Surface Temp Rise Above Ambient |
|---|---|
| 0-5 mm (directly adjacent) | 15-25°C |
| 10 mm | 5-10°C |
| 20 mm | 2-5°C |
| 40 mm (opposite side of 103mm board) | 1-2°C |

These are rough estimates based on published SOT-223 thermal characterization data. Actual values depend heavily on copper pour continuity, via stitching, and airflow.

### 2.3 Eurorack Enclosure Considerations

Eurorack cases have limited airflow. Ambient temperature inside a populated eurorack case can reach 35-45°C, especially in a dense system. This shifts all absolute temperatures upward, but the relative gradients across the board remain the same.

## 3. DAC8568 Thermal Sensitivity Analysis

### 3.1 DAC8568 Temperature Coefficients (from TI Datasheet)

| Parameter | Typical | Maximum | Units |
|---|---|---|---|
| Internal reference TC | 2 | 5 | ppm/°C |
| Gain temperature coefficient | 1 | — | ppm of FSR/°C |
| Offset error drift | 0.5 | — | µV/°C |
| Zero-code error drift | 2 | — | µV/°C |

The internal reference is the dominant drift source at 2-5 ppm/°C.

### 3.2 Musical Relevance: 1V/oct CV Accuracy

In a 1V/oct system:
- 1 semitone = 83.33 mV
- 1 cent = 0.833 mV

Using the internal 2.5V reference with 2x gain (5V full-scale output):

**Reference drift (dominant source):**
```
Drift per °C = 5V × 2 ppm/°C = 10 µV/°C (typical)
Drift per °C = 5V × 5 ppm/°C = 25 µV/°C (maximum)
```

**To drift 1 cent (0.833 mV):**
```
Typical: 0.833 mV / 0.010 mV/°C = 83°C change needed
Maximum: 0.833 mV / 0.025 mV/°C = 33°C change needed
```

### 3.3 Practical Drift Assessment

| Scenario | DAC Temp Rise | Typical Drift | Musical Impact |
|---|---|---|---|
| DAC 40mm from regulator (1-2°C rise) | 1-2°C | 10-20 µV | **Inaudible** (<0.03 cents) |
| DAC 20mm from regulator (2-5°C rise) | 2-5°C | 20-50 µV | **Inaudible** (<0.06 cents) |
| DAC 10mm from regulator (5-10°C rise) | 5-10°C | 50-100 µV | **Inaudible** (<0.12 cents) |
| DAC directly adjacent to 12V reg (15-25°C) | 15-25°C | 150-250 µV | **Inaudible** (0.18-0.30 cents) |
| Worst case: max spec, adjacent | 25°C | 625 µV | **Barely perceptible** (0.75 cents) |

**Even in the worst-case scenario (DAC right next to the hottest regulator, maximum temperature coefficient), the drift is under 1 cent.** Trained musicians can typically perceive pitch differences of 5-10 cents; synthesizer users generally tolerate 2-5 cents of drift.

### 3.4 The Real Concern: Thermal Transients, Not Steady State

The numbers above are for steady-state operation. Thermal transients (power-on, load changes) cause temporary gradients that settle over seconds to minutes. However:

- The DAC8568's thermal time constant is fast (TSSOP package equilibrates in seconds)
- The board's thermal mass provides damping
- Power-on drift is expected and accepted in analog synths (users typically let modules "warm up")

## 4. Industry Guidelines and Best Practices

### 4.1 IPC-2221 Guidelines

- Place heat-generating components near board edges to facilitate convection
- Maintain at least 2-3 mm clearance between heat sources for airflow
- Keep heat-sensitive components (precision analog) away from high-dissipation parts

### 4.2 TI Application Notes

**SBOA569 (Thermally Enhanced Packages):** At 0.9W dissipation, thermally-enhanced packages showed 52 µV lower offset than standard packages.

**SNVA419C (Board Layout for Thermal Resistance):** With natural convection, a 2-layer board needs ~15 cm² of copper to dissipate 1W with 40°C rise. A 4-layer board performs significantly better due to inner-layer spreading.

### 4.3 Practical Mitigation Strategies (Ranked by Effectiveness)

1. **Physical distance** — Place the 12V-to-5V regulator far from the DAC. Even 30-40mm is likely sufficient on this board.
2. **Thermal vias under regulators** — Grid of vias (0.3mm drill, 1mm pitch) under the SOT-223 tab pad, connecting to inner ground planes.
3. **Copper pour continuity** — Generous copper pour connected to ground planes for heat sinking.
4. **Board edge placement for regulators** — Near board edge where convective airflow is better.
5. **Thermal relief on DAC ground connections** — Spoked connections to partially decouple from ground plane temperature variations.
6. **Slot/moat in ground plane** — Not recommended: compromises ground plane integrity and EMI. Unnecessary for this application.

## 5. Recommendation

### 5.1 Is This a Real Problem for the Requencer?

**No.** The quantitative analysis shows:

- The AMS1117-3.3 (5V→3.3V) dissipates ~0.2W — not a thermal concern.
- The AZ1117IH-5.0 (12V→5V) is the only meaningful heat source at 0.7-1.4W.
- Even placing the DAC8568 directly adjacent to the 12V regulator produces drift well under 1 cent — inaudible.
- The DAC8568 has excellent temperature coefficients (2 ppm/°C typical on the reference).

### 5.2 Practical Placement Guidance

Basic thermal hygiene costs nothing:

1. **Place the AZ1117IH-5.0 at least 15-20 mm from the DAC8568.** This brings the DAC's temperature rise to under 5°C, making drift negligible.
2. **Place the AZ1117IH-5.0 near a board edge**, not in the center.
3. **Add 4-6 thermal vias** (0.3mm drill) under the SOT-223 tab pad of each regulator.
4. **Ensure continuous ground pour** under and around both regulators.
5. **Do NOT add ground plane slots or thermal barriers** — they hurt EMI performance and are unnecessary.

### 5.3 Should This Be Automated in Placement Scripts?

**No.** The margins are enormous (33-83°C of headroom before 1-cent drift), there are only two regulators and one DAC, and thermal placement interacts with routing/mechanical constraints in ways hard to capture in simple distance rules. A manual review takes seconds and is more reliable than coded heuristics.

### 5.4 When Would This Become a Real Problem?

- Total 5V current exceeding ~400 mA (switch to DC-DC converter)
- Voltage reference with >10 ppm/°C drift
- Absolute CV accuracy better than ~1 cent without calibration
- Eurorack case with zero airflow and ambient >50°C

None of these apply to the Requencer prototype.

## Sources

- AMS1117 Datasheet (Advanced Monolithic)
- AZ1117I Datasheet (Diodes Inc.)
- DAC8568 Datasheet (Texas Instruments)
- Richtek AN044: Understanding Thermal Characteristic of SOT-223 Package
- TI SBOA569: Thermally-Enhanced Packages Improve Precision
- TI SNVA419C: Board Layout for Best Thermal Resistance
- ADI AN-892: Temperature Measurement Theory and Practical Techniques
- IPC-2221 Standards in PCB Design
