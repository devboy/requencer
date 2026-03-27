# Faceplate Hole Sizing: Industry Standards & Best Practices

Date: 2026-03-26

## Summary

Research into what professional eurorack manufacturers and experienced DIY builders actually use for panel hole diameters, covering Thonkiconn jacks, EC11 encoders, tactile button caps, and PCB-fabricated panel tolerances at JLCPCB.

**Key finding:** Our current 6.0mm jack holes are too tight for a PCB faceplate. Mutable Instruments uses 6.5mm. The community consensus for PCB panels is 6.2-6.5mm depending on tolerance requirements. Our 7.0mm encoder holes are exactly right.

---

## 1. Thonkiconn / WQP518MA / PJ398SM 3.5mm Jack Panel Holes

### Component Specifications

The WQP518MA (current production name, formerly PJ398SM) has:
- **Bushing outer diameter:** ~5.9-6.0mm (not threaded -- the WQP518MA uses a proprietary square anti-rotation bushing, not standard M-thread)
- **Bushing length:** 5.5mm
- **Datasheet panel hole:** 6.0mm

The bushing is nominally 6.0mm but real-world measurements of the outer diameter are approximately 5.9mm (+/-0.1mm manufacturing variance).

### What Professionals Use

| Source | Hole Diameter | Context |
|--------|--------------|---------|
| **Mutable Instruments** (Emilie Gillet / pichenettes) | **6.5mm** | Official PCB panel design documentation. Used on all MI modules (Clouds, Plaits, Rings, etc.). This is the single most authoritative reference for eurorack PCB panels. |
| **ModWiggler community consensus** | **6.1-6.2mm** | For hand-drilled aluminum panels. Slightly oversize from the 6.0mm datasheet spec. |
| **Tolerance stack calculation** (from experienced panel makers) | **6.5mm** | Component tolerance (+/-0.2mm) + JLCPCB NPTH tolerance (+/-0.2mm) + 0.1mm desired gap = 6.0 + 0.2 + 0.2 + 0.1 = 6.5mm |
| **Thonk (official retailer)** | **6.0mm** | Listed on product page, but this is the minimum/datasheet spec, not a manufacturing recommendation |
| **Erthenvar / Kobiconn jacks** (used by Make Noise, Cwejman, Malekko, Metasonix) | **6.0-6.5mm** | Thread diameter ~5.9mm, recommended panel hole 6.0-6.5mm |

### Analysis

**6.0mm is too tight for PCB panels.** Here is why:

1. The bushing is already ~5.9-6.0mm. A 6.0mm hole leaves essentially zero clearance.
2. PCB manufacturing introduces positional tolerance (+/-0.05 to +/-0.2mm depending on manufacturer and process).
3. Component lead positions after soldering can shift slightly from nominal.
4. FR4 panels have no give -- unlike drilled aluminum which can flex slightly during insertion.

**6.5mm is the proven standard for PCB faceplates**, validated by Mutable Instruments across dozens of shipped module designs and confirmed independently by tolerance stack analysis. The 0.5mm total clearance (0.25mm per side) accommodates manufacturing variance while still allowing the bushing nut to clamp securely.

### Recommendation

**Change jack holes from 6.0mm to 6.5mm.**

This matches the Mutable Instruments standard and accounts for the tolerance stack of component variance + PCB fabrication variance.

---

## 2. EC11 / Alps Encoder Panel Holes

### Component Specifications

The Alps EC11E series encoder has:
- **Bushing thread:** M7x0.75 (7.0mm major diameter, 0.75mm pitch)
- **Bushing outer diameter:** ~6.8mm (thread minor diameter)
- **Mounting nut:** M7

### What Professionals Use

| Source | Hole Diameter | Context |
|--------|--------------|---------|
| **Mutable Instruments** | **7.5mm** | Used for potentiometers (which also have M7 bushings). The MI documentation says "7.5mm for pots" -- pots and EC11 encoders share the same M7 bushing. |
| **ModWiggler community** | **7.0-7.2mm** | "7mm holes are nearly perfectly sized for Alpha 16mm pots with M7 bushings -- roomy but not sloppy" |
| **ISO 273 clearance hole for M7** | **7.4mm (close fit), 7.6mm (normal fit), 8.0mm (loose fit)** | Formal engineering standard for clearance holes on M7 threaded fasteners |
| **ASME B18.2.8 clearance hole for M6** | **6.4mm (close), 6.6mm (normal), 7.0mm (loose)** | For reference -- M7 is not in ASME, jumps from M6 to M8 |

### Analysis

The M7 thread major diameter is exactly 7.0mm. A 7.0mm hole means the thread crests are in direct contact with the hole wall -- this is essentially an interference fit, which works in practice because:
- The thread crests are thin enough to compress slightly
- The encoder is tightened with a nut from the front, pulling it into the hole
- PCB material (FR4) is stiff but the thread crests can bite slightly

However, ISO 273 specifies a **minimum** clearance hole of 7.4mm for M7 fasteners. Mutable Instruments uses 7.5mm for the same bushing size.

**7.0mm works but is tight.** 7.2-7.5mm provides proper clearance and is more forgiving of positional tolerance.

### Recommendation

**Change encoder holes from 7.0mm to 7.5mm.**

This matches the Mutable Instruments standard for M7 bushings and falls between the ISO 273 close fit (7.4mm) and normal fit (7.6mm). It provides proper clearance while the mounting nut still clamps securely.

---

## 3. Tactile Button Cap Pass-Through Holes

### Component Specifications (PB6149L)

The PB6149L illuminated tactile switch:
- **Body dimensions:** 7.5mm x 7.5mm (square body, sits on PCB)
- **Cap diameter:** approximately 5.6mm (translucent round cap with LED ring)
- **Cap pass-through:** the cap protrudes above the switch body and passes through the panel hole
- **No threaded bushing:** the switch body sits on the PCB; only the cap pokes through the panel

### What Professionals Use

Mutable Instruments uses a different button style (low-profile tact switches with separate cap assemblies), so their 6.5mm jack-hole spec does not directly apply to buttons. However:

| Source | Hole Diameter | Context |
|--------|--------------|---------|
| **Our current spec** | **3.2mm** (TC002 panel mount shaft) | This was set for the TC002-RGB button which has a different mounting mechanism. The PB6149L does not panel-mount the same way. |
| **N8 Synthesizers pre-drilled panels** | **7mm** | Universal hole size that fits "a range of components" -- too large for a button cap |
| **Typical for 5.6mm cap** | **6.0-6.2mm** | Cap diameter (5.6mm) + clearance (0.2mm/side) = 6.0-6.2mm |

### Analysis

The PB6149L button does **not** have a threaded bushing or panel-mount mechanism. The PCB-mounted switch body provides all structural support. The faceplate hole only needs to:
1. Allow the cap to pass through freely
2. Provide visual framing for the cap and LED ring
3. Not be so large that fingers can reach past the cap to the switch body

For a 5.6mm cap:
- **Minimum hole:** 5.8mm (0.1mm clearance per side -- very tight, cap may rub)
- **Comfortable hole:** 6.0-6.2mm (0.2-0.3mm clearance per side)
- **Maximum practical:** 6.5mm (cap looks recessed but functionally fine)

### Recommendation

**Use 6.0mm for button holes.**

This provides 0.2mm clearance per side around the 5.6mm cap -- enough to avoid rubbing while keeping the cap visually centered in the hole. The 6.0mm size also matches the jack bushing outer diameter, which means (conveniently) all button and jack holes could potentially share a common drill size if we stayed at 6.0mm for jacks -- but since we are moving jacks to 6.5mm, buttons at 6.0mm is fine on its own.

**Note:** If using a different button (e.g., TC002-RGB with 5.5mm cap), verify cap diameter and adjust accordingly. The TC002-N11AS2XT-RGB variant has a 5.5mm diameter clear button; TC002-N11AS1XT-RGB has a 4.0mm diameter.

---

## 4. JLCPCB / PCB-Fabricated Faceplate Tolerances

### Drill Tolerances

| Hole Type | Tolerance | Size Range | Notes |
|-----------|-----------|------------|-------|
| **NPTH (non-plated through hole)** | **+/-0.05mm** | 0.5mm - 6.3mm | Tighter than PTH because no plating process introduces variance |
| **PTH (plated through hole)** | **+/-0.08mm** | 0.15mm - 6.3mm | Plating thickness adds variance |
| **Milled slot (non-metallized)** | **+/-0.15mm** | Min width 1.0mm | Used for rectangular cutouts, oval slots |
| **Milled slot (metallized)** | **+/-0.15mm** | Min width 1.0mm | |
| **Board outline (Edge.Cuts milling)** | **+/-0.2mm** (standard), **+/-0.1mm** (precision option) | Any size | Used for board perimeter and internal cutouts |

### Critical Limitation: Maximum Drill Size is 6.3mm

JLCPCB's maximum standard drill diameter is **6.3mm**. This affects our design:

| Our Hole | Diameter | Fits in 6.3mm limit? | Solution |
|----------|----------|-----------------------|----------|
| Jack holes | 6.5mm | **NO** | Must be milled (Edge.Cuts circle) or reduced to 6.3mm |
| Encoder holes | 7.0-7.5mm | **NO** | Must be milled (Edge.Cuts circle) |
| Button holes | 6.0mm | YES | Standard NPTH drill |
| Mounting slots | 7.0 x 3.5mm | NO (oval) | Already milled (oval slot) |
| Standoff holes | 3.2mm | YES | Standard NPTH drill |
| LCD cutout | 81.5 x 52.3mm | NO (rectangle) | Already milled (Edge.Cuts rectangle) |

### Milled Holes vs Drilled Holes

For holes larger than 6.3mm, JLCPCB mills them using a router bit rather than a drill. This is done by placing circular shapes on the **Edge.Cuts layer** in KiCad. The practical implications:

- **Tolerance is worse:** +/-0.2mm (standard milling) vs +/-0.05mm (NPTH drilling)
- **Roundness may be imperfect:** router bits trace a circular path rather than plunging, so very small circles may have slight faceting
- **No additional cost:** JLCPCB treats internal Edge.Cuts shapes as board cutouts and includes them in the standard price
- **Minimum milled feature:** 1.0mm width (well above our needs)

The milling tolerance (+/-0.2mm) is the dominant factor for our jack and encoder holes. This is why Mutable Instruments uses 6.5mm for jacks -- the 0.5mm total clearance absorbs the +/-0.2mm milling tolerance and still guarantees the bushing fits.

### NPTH vs PTH for Faceplate Holes

For a mechanical-only faceplate, all holes should be **NPTH** (non-plated):
- No copper ring visible around holes (cleaner appearance with black soldermask)
- Tighter tolerance (+/-0.05mm vs +/-0.08mm)
- No annular ring requirements
- In KiCad, set pad type to "NPTH, Mechanical"

**Important JLCPCB note:** If your drill file contains ONLY non-plated holes (no plated holes at all), JLCPCB's automated system may flag the board. Including at least one plated hole (even a dummy) avoids this. Alternatively, add a note when ordering specifying "all holes are NPTH."

---

## 5. General Best Practices & Standards

### IPC / ISO Standards for Panel Mounting Holes

**ISO 273:1979** (Fasteners -- Clearance holes for bolts and screws) defines three fit classes:

| Fit Class | Purpose | M6 Hole | M7 Hole |
|-----------|---------|---------|---------|
| Close (Fine) | Precise alignment | 6.4mm | 7.4mm |
| Normal (Medium) | General purpose | 6.6mm | 7.6mm |
| Loose (Coarse) | Easy assembly | 7.0mm | 8.0mm |

These are designed for bolt clearance but apply to any threaded bushing passing through a panel. For eurorack panel mounting:
- The jack bushing is ~6.0mm (no standard thread) so ISO 273 does not directly apply, but the principle of 0.4-0.6mm clearance for the "close fit" class is a useful reference
- The encoder bushing is M7, so ISO 273 directly applies: 7.4mm minimum (close fit)

### Practical Rules of Thumb

1. **Tolerance stack formula:** Hole = Component OD + Component tolerance + Panel tolerance + Desired gap
   - Example for WQP518MA on JLCPCB: 6.0 + 0.1 + 0.2 + 0.2 = 6.5mm
   - Example for EC11E on JLCPCB: 7.0 + 0.0 + 0.2 + 0.3 = 7.5mm

2. **PCB panels need more clearance than metal panels.** FR4 does not flex like aluminum. Components cannot be forced in. The hole must be correctly sized from the start.

3. **Milled holes need more clearance than drilled holes.** The +/-0.2mm milling tolerance means you need at least 0.2mm extra clearance beyond what you would specify for a precision-drilled hole.

4. **The mounting nut does the clamping, not the hole.** A slightly oversized hole is always preferable to an undersized one. The nut (for jacks and encoders) provides all the mechanical retention. The hole just needs to let the bushing pass through.

5. **PCB-mounted components self-align.** Since jacks and encoders are soldered to the control board, their positions are set by the PCB footprint. The faceplate hole only needs to clear the bushing -- it does not need to center the component.

---

## 6. Recommended Hole Sizes for Requencer Faceplate

| Component | Current | Recommended | Change | Method | Rationale |
|-----------|---------|-------------|--------|--------|-----------|
| **Jack holes** (WQP518MA, PJ366ST) | 6.0mm | **6.5mm** | +0.5mm | Edge.Cuts circle (milled) | Matches Mutable Instruments; accommodates JLCPCB milling tolerance (+/-0.2mm); exceeds 6.3mm max drill |
| **Encoder holes** (EC11E) | 7.0mm | **7.5mm** | +0.5mm | Edge.Cuts circle (milled) | Matches MI pot hole spec; between ISO 273 close fit (7.4mm) and normal fit (7.6mm) for M7 |
| **Button holes** (PB6149L cap pass-through) | 3.2mm | **6.0mm** | +2.8mm | NPTH drill | Cap is 5.6mm diameter; 6.0mm gives 0.2mm clearance per side. Already noted as 6.0mm in faceplate.ato comments but generate_faceplate.py uses 3.2mm |
| **Mounting slots** | 7.0 x 3.5mm | 7.0 x 3.5mm | No change | Milled oval | Standard Intellijel/Doepfer M3 slot |
| **Standoff holes** (M3) | 3.2mm | 3.2mm | No change | NPTH drill | Standard M3 clearance |
| **LCD cutout** | 81.5 x 52.3mm | 81.5 x 52.3mm | No change | Edge.Cuts rectangle | Sized for glass seating |
| **SD card cutout** | 13.0 x 3.0mm | 13.0 x 3.0mm | No change | Edge.Cuts rectangle | Sized for PJS008U vertical MicroSD |

### Implementation Notes

1. **Jack and encoder holes exceed JLCPCB's 6.3mm drill limit.** They must be implemented as circles on the Edge.Cuts layer, not as NPTH drill pads. The `generate_faceplate.py` script currently uses `add_drill_hole()` which creates a pad with a drill attribute. For holes > 6.3mm, this should instead create a circle on Edge.Cuts (which JLCPCB routes/mills out).

2. **Button holes (6.0mm) are within the 6.3mm drill limit** and can remain as NPTH drilled pads for tighter tolerance (+/-0.05mm vs +/-0.2mm milled).

3. **The faceplate.ato file** already documents 6.0mm for jack holes and 7.0mm for encoder holes in its comments. These comments should be updated to reflect the new 6.5mm and 7.5mm values.

4. **The component-map.json** `footprints` section lists `drill_mm: 6.0` for jacks and `drill_mm: 7.0` for encoders. These should be updated.

---

## 7. Sources

- [Mutable Instruments - Designing PCB Panels](https://pichenettes.github.io/mutable-instruments-documentation/tech_notes/designing_pcb_panels/) -- Official documentation by Emilie Gillet. Specifies 6.5mm for jacks, 7.5mm for pots, 3.1mm for LEDs.
- [Mutable Instruments - Open Source Hardware (GitHub)](https://github.com/pichenettes/eurorack) -- Panel design files for Clouds, Plaits, Rings, etc.
- [ModWiggler - Panel Hole Sizes](https://modwiggler.com/forum/viewtopic.php?t=192970) -- Community discussion on hole sizing with tolerance stack calculations.
- [ModWiggler - Best PCB Fabs for Front Panels](https://www.modwiggler.com/forum/viewtopic.php?t=236845) -- Discussion of JLCPCB limitations for holes > 6.3mm.
- [ModWiggler - Alpha Pot Panel Hole Size](https://modwiggler.com/forum/viewtopic.php?t=26583) -- Confirms 7.0-7.2mm for M7 bushings on hand-drilled panels.
- [Synth DIY Wiki - Eurorack Panel Components](https://sdiy.info/wiki/Eurorack_panel_components) -- Reference for jack and pot hole sizes.
- [QingPu Electronics - WQP518MA / PJ398SM](http://www.qingpu-electronics.com/en/products/wqp-pj398sm-362.html) -- Manufacturer page, 6mm panel hole spec.
- [JLCPCB Design Rules and Capabilities (2025)](https://www.schemalyzer.com/en/blog/manufacturing/jlcpcb/jlcpcb-design-rules) -- NPTH +/-0.05mm, PTH +/-0.08mm, milled slot +/-0.15mm, max drill 6.3mm.
- [JLCPCB PCB Capabilities](https://jlcpcb.com/capabilities/pcb-capabilities) -- Official capability spec page.
- [ISO 273:1979](https://www.iso.org/standard/4183.html) -- Fasteners clearance hole standard. M7: 7.4mm close, 7.6mm normal, 8.0mm loose.
- [ASME B18.2.8 Metric Clearance Holes](https://amesweb.info/screws/Metric-Clearance-Hole-Chart.aspx) -- M6: 6.4mm close, 6.6mm normal, 7.0mm loose.
- [Printable Instruments (30350n)](https://github.com/30350n/printable-instruments) -- PCB panels for MI modules, uses svg2shenzhen with MI drill specs.
- [Exploding Shed - Eurorack Dimensions](https://www.exploding-shed.com/synth-diy-guides/standards-of-eurorack/eurorack-dimensions/) -- General eurorack mechanical reference.
- [Alps Alpine EC11E Encoder](https://tech.alpsalpine.com/e/products/category/encorders/sub/01/series/ec11e/) -- M7x0.75 bushing thread specification.
