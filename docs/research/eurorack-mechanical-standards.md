# Eurorack Mechanical Standards: Faceplate & PCB Sizing

## Reference Standards

Eurorack mechanical specs derive from the Doepfer A-100 construction details and the broader 3U/19" rack format (derived from DIN 41494 / IEC 60297).

---

## 1. Faceplate (Front Panel) Dimensions

### Width
- **1 HP = 5.08 mm** (0.2 inches)
- Nominal: **36 HP = 182.88 mm**
- Tolerance: +0/-0.3 mm (panels should be slightly undersize, never oversize)
- Best practice: reduce width by ~0.5 mm per side for easy insertion next to other modules
- **Our target: 181.88 mm** (0.5 mm clearance per side)

### Height
- **Standard 3U panel height: 128.5 mm**
- Best practice: reduce by ~1 mm for easy insertion into rails
- **Our target: 127.5 mm** (0.5 mm clearance top and bottom)

### Current vs Target Faceplate Dimensions

| Dimension | Current | Target | Change |
|-----------|---------|--------|--------|
| Width | 182.88 mm | 181.88 mm | -1.0 mm (0.5 mm/side) |
| Height | 128.5 mm | 127.5 mm | -1.0 mm (0.5 mm/side) |

### Status: **Needs update** — reduce both width and height by 1 mm total for easy insertion

---

## 2. Faceplate Mounting Holes

### Doepfer Standard Positions
For panels wider than 10 HP, mounting holes are placed as follows:
- **Horizontal**: 7.5 mm from each panel edge (center of hole)
- **Vertical**: 3.0 mm from top and bottom panel edges (center of hole)
- **Hole shape**: Either round 3.2 mm or oval/slot for alignment tolerance

### Intellijel/Eurorack Slot Convention
Many modern modules use **oval slots** instead of round holes to allow horizontal adjustment:
- Slot size: ~3.5 mm × 7.0 mm (M3 screw with horizontal play)

### Our Current Mounting Holes (on 182.88 × 128.5 mm panel)
| Position | X (mm) | Y (mm) | Expected X | Expected Y |
|----------|--------|--------|------------|------------|
| Top-Left | 7.2 | 3.4 | 7.5 | 3.0 |
| Top-Right | 175.68 | 3.4 | 175.38 | 3.0 |
| Bottom-Left | 7.2 | 125.1 | 7.5 | 125.5 |
| Bottom-Right | 175.68 | 125.1 | 175.38 | 125.5 |

### Updated Mounting Holes (for 181.88 × 127.5 mm panel)
With the reduced panel size, mounting hole positions need recalculating. The standard places holes at 7.5 mm from each edge:

| Position | X (mm) | Y (mm) |
|----------|--------|--------|
| Top-Left | 7.5 | 3.0 |
| Top-Right | 174.38 | 3.0 |
| Bottom-Left | 7.5 | 124.5 |
| Bottom-Right | 174.38 | 124.5 |

### Analysis
- **Oval slot size (7.0 × 3.5 mm)**: Good — provides horizontal adjustment for M3 screws
- With the undersized panel, recalculating hole positions to standard 7.5 mm from edges is recommended
- The slots provide enough tolerance that minor deviations are absorbed
- **Right-side X**: 181.88 - 7.5 = 174.38 mm

**Verdict: Recalculate hole positions for new panel size, using standard 7.5 mm from-edge spec.**

---

## 3. PCB vs Faceplate Sizing — The Critical Issue

### Current State: PROBLEM
- **Faceplate (current)**: 182.88 mm × 128.5 mm — needs to shrink to 181.88 × 127.5 mm
- **Main PCB**: 182.88 mm × 128.5 mm — same as faceplate, way too large
- **Both are identical size** — the PCB will physically interfere with rack rails and neighboring modules.

### Eurorack PCB Best Practices

#### Height (vertical clearance from rails)
The rack rails cover approximately the **top and bottom 8-10 mm** of the panel. The PCB must stay entirely within the clear zone:

- Faceplate height: 127.5 mm (undersized)
- Rail coverage: ~10 mm top + ~10 mm bottom
- **Maximum safe PCB height: ~108 mm** (leaving 10 mm clearance each side)
- Common practice: **104-108 mm PCB height**
- Conservative: **100-104 mm** for easy installation

#### Width (horizontal clearance from neighbors)
Adjacent modules sit flush against each other. If the PCB is as wide as the faceplate, it could:
- Block insertion of neighboring modules
- Short against neighboring module PCBs
- Make installation/removal difficult

**Width clearance recommendations:**
- **Minimum: 1 mm per side** (total 2 mm narrower than panel)
- **Recommended: 1.5-2 mm per side** (total 3-4 mm narrower)
- **Conservative: 2-3 mm per side** for comfortable assembly
- **Our recommended PCB width: 181.88 - 4 = ~177.88 mm** (2 mm per side relative to faceplate)

#### Summary of Recommended Dimensions

| Dimension | Faceplate | PCB | Clearance (panel-to-PCB) |
|-----------|-----------|-----|--------------------------|
| Width | 181.88 mm | ~177.88 mm | 2.0 mm per side |
| Height | 127.5 mm | ~106.0 mm | ~10.75 mm top/bottom |

### Depth Considerations
- Eurorack depth varies by case: shallow = 25 mm, standard = 40-50 mm, deep = 65+ mm
- PCB depth behind panel should be specified for target case compatibility
- Power connector header adds depth — account for ribbon cable bend radius

---

## 4. PCB Mounting to Faceplate

### Common Approaches
1. **Directly mounted via panel components**: Jacks, pots, encoders, and switches that are panel-mounted mechanically connect the PCB to the faceplate. This is the most common eurorack approach — no separate standoffs needed.
2. **Standoffs/spacers**: Used when PCB doesn't have enough panel-mounted components for mechanical stability, or for multi-board stacks.
3. **Combination**: Panel components provide primary mounting; standoffs add rigidity.

### Our Design
Our PCB has 30 jacks, 30 buttons, and 2 encoders panel-mounted. This provides extensive mechanical coupling between faceplate and PCB. **No additional standoffs are likely needed**, but the PCB outline must be smaller than the faceplate to avoid rail interference.

### PCB Mounting Holes
The main PCB should **NOT** have the same mounting holes as the faceplate. The M3 rack mounting screws go through the faceplate only, attaching it to the rack rails. The PCB sits behind the faceplate, held in place by the panel-mounted components (jacks, switches, encoders).

---

## 5. Action Items

### Must Fix
1. **Reduce faceplate dimensions** — from 182.88 × 128.5 mm to **181.88 × 127.5 mm** for easy insertion
2. **Reduce main PCB dimensions** — from 182.88 × 128.5 mm to **~177.88 × ~106 mm** to clear rails and neighbors
3. **Recalculate faceplate mounting holes** — update positions for new panel size, use standard 7.5 mm from-edge spec

### Verify
4. **Component placement on PCB** — ensure all components on the main PCB fit within the reduced outline. Components that interface with the faceplate (jacks, buttons, encoders) must align with faceplate holes while the PCB edge stays clear of rails.
5. **Power header position** — must be accessible and within the reduced PCB outline.
6. **Component positions in panel-layout.json** — coordinates may need shifting if faceplate origin changes due to the 0.5 mm inset on each side.

---

## 6. Reference Dimensions Summary

```
Nominal panel width:   182.88 mm (36 HP × 5.08 mm)
Nominal panel height:  128.5 mm (3U standard)

Panel (faceplate):     181.88 mm × 127.5 mm  (undersized by 1 mm each axis)
PCB (recommended):     ~177.88 mm × ~106 mm
Rail coverage zone:    ~10 mm top, ~10 mm bottom
Panel side clearance:  0.5 mm per side (vs nominal HP width)
PCB side clearance:    2.0 mm per side (vs faceplate)
Mounting screw:        M3 (3.0 mm)
Mounting slot:         7.0 × 3.5 mm (horizontal play)
Hole center from edge: 7.5 mm horizontal, 3.0 mm vertical (Doepfer standard)
```

## 7. References

- Doepfer A-100 Construction Details: http://www.doepfer.de/a100_man/a100m_e.htm
- DIN 41494 / IEC 60297 (rack standard)
- Intellijel module design guidelines
- Typical eurorack PCB sizing from open-source module projects (Mutable Instruments, etc.)
