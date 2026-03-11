# Faceplate Connectors Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move display, USB-C, and SD card from main board to control board with faceplate-accessible connectors, routing all signals through the existing board-to-board connector spare pins.

**Architecture:** Three new component parts (FPC ZIF connector, vertical USB-C, vertical MicroSD) get added to the control board. The main board loses its on-board display header, USB-C receptacle, and SD card slot — those signals now cross through Header A spare pins (9-16, 17, 20, 21) to the control board. The faceplate gets updated cutout dimensions.

**Tech Stack:** Atopile 0.14 (.ato schematics), KiCad (footprints/symbols), TypeScript (web preview rendering)

**Reference Docs:**
- `docs/research/faceplate-connectors.md` — USB-C and SD card part research
- `docs/research/component-mounting-depths.md` — Display decision (JC3248A035N-1)
- `hardware/boards/component-map.json` — Panel dimensions and component metadata

---

## File Structure

### New files to create

| File | Purpose |
|------|---------|
| `hardware/boards/parts/FPC_18P_05MM/FPC_18P_05MM.ato` | 18-pin 0.5mm FPC ZIF connector part |
| `hardware/boards/parts/FPC_18P_05MM/FPC_18P_05MM.kicad_sym` | KiCad symbol |
| `hardware/boards/parts/FPC_18P_05MM/FPC_18P_05MM.kicad_mod` | KiCad footprint |
| `hardware/boards/parts/PJS008U/PJS008U.ato` | Yamaichi PJS008U-3000-0 vertical MicroSD part |
| `hardware/boards/parts/PJS008U/PJS008U.kicad_sym` | KiCad symbol |
| `hardware/boards/parts/PJS008U/PJS008U.kicad_mod` | KiCad footprint |
| `hardware/boards/parts/USB_C_Vertical/USB_C_Vertical.ato` | Vertical THT USB-C receptacle part |
| `hardware/boards/parts/USB_C_Vertical/USB_C_Vertical.kicad_sym` | KiCad symbol |
| `hardware/boards/parts/USB_C_Vertical/USB_C_Vertical.kicad_mod` | KiCad footprint |

### Files to modify

| File | Change |
|------|--------|
| `hardware/boards/elec/src/board-connector.ato` | Add 10 new signals to Header A spare pins |
| `hardware/boards/elec/src/control.ato` | Add display FPC, USB-C, SD card instances and wiring |
| `hardware/boards/elec/src/main.ato` | Remove on-board USB-C/SD/display, route through connector |
| `hardware/boards/elec/src/display.ato` | Replace PinHeader1x9 with FPC connector, update backlight |
| `hardware/boards/elec/src/mcu.ato` | Update comments (GPIO assignments stay the same) |
| `hardware/boards/component-map.json` | Add connector positions and footprint data |
| `web/src/panel-layout.json` | Add USB-C and SD card positions in `connectors` section |

### Files with no code changes needed

| File | Why |
|------|-----|
| `web/src/ui/panel/faceplate.ts` | Already renders `connectors.usb_c` and `connectors.sd_card` |
| `web/src/ui/panel/footprint-overlay.ts` | Already renders connector footprint rects |
| `hardware/boards/scripts/gen_validation.py` | Auto-generates system.ato from connector signals |

---

## Chunk 1: New Parts (KiCad footprints + atopile components)

### Task 1: Create FPC 18-pin 0.5mm ZIF connector part

**Files:**
- Create: `hardware/boards/parts/FPC_18P_05MM/FPC_18P_05MM.ato`
- Create: `hardware/boards/parts/FPC_18P_05MM/FPC_18P_05MM.kicad_sym`
- Create: `hardware/boards/parts/FPC_18P_05MM/FPC_18P_05MM.kicad_mod`

This is the connector that mates with the JC3248A035N-1 display FPC ribbon. 18-pin, 0.5mm pitch, bottom-contact ZIF. LCSC part: Cankemeng or BOOMELE 18-pos 0.5mm FPC connector.

- [ ] **Step 1: Create the KiCad symbol**

Create `FPC_18P_05MM.kicad_sym` with 18 pins. Follow the pattern from `PinHeader1x9.kicad_sym` but with 18 pins. Pin names: `1` through `18`.

- [ ] **Step 2: Create the KiCad footprint**

Create `FPC_18P_05MM.kicad_mod` for a 0.5mm pitch, 18-pad SMD FPC connector. Pad dimensions: 0.3mm × 1.0mm, pitch 0.5mm. Two mounting/anchor pads at the sides. Total component width: ~11.5mm ((18-1)×0.5 + pad margins). Use the Molex 5051101891 or Cankemeng equivalent as reference.

- [ ] **Step 3: Create the atopile component**

```
# FPC_18P_05MM — 18-pin 0.5mm FPC ZIF connector, bottom contact
# Mates with JC3248A035N-1 display FPC ribbon

#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked

component FPC_18P_05MM:
    trait is_atomic_part<manufacturer="Cankemeng", partnumber="FPC-0.5mm-18P-Bottom", footprint="FPC_18P_05MM.kicad_mod", symbol="FPC_18P_05MM.kicad_sym">
    trait has_designator_prefix<prefix="J">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C262657", manufacturer="Cankemeng", partno="FPC-0.5mm-18P-Bottom">

    signal PIN1 ~ pin 1
    signal PIN2 ~ pin 2
    signal PIN3 ~ pin 3
    signal PIN4 ~ pin 4
    signal PIN5 ~ pin 5
    signal PIN6 ~ pin 6
    signal PIN7 ~ pin 7
    signal PIN8 ~ pin 8
    signal PIN9 ~ pin 9
    signal PIN10 ~ pin 10
    signal PIN11 ~ pin 11
    signal PIN12 ~ pin 12
    signal PIN13 ~ pin 13
    signal PIN14 ~ pin 14
    signal PIN15 ~ pin 15
    signal PIN16 ~ pin 16
    signal PIN17 ~ pin 17
    signal PIN18 ~ pin 18
```

- [ ] **Step 4: Verify LCSC part number**

Check that LCSC C262657 (or equivalent) is a valid 18-pin 0.5mm bottom-contact FPC connector. If not, search LCSC for "FPC 0.5mm 18P" and update the supplier_partno.

---

### Task 2: Create Yamaichi PJS008U vertical MicroSD part

**Files:**
- Create: `hardware/boards/parts/PJS008U/PJS008U.ato`
- Create: `hardware/boards/parts/PJS008U/PJS008U.kicad_sym`
- Create: `hardware/boards/parts/PJS008U/PJS008U.kicad_mod`

Vertical THT MicroSD connector. 14.18mm tall above PCB. Push-in/pull-out (no spring). 8 positions + shield.

- [ ] **Step 1: Create KiCad symbol**

8 signal pins matching SPI mode: CS (pin 1), MOSI (pin 2), VSS/GND (pin 3), VDD (pin 4), SCK (pin 5), VSS2/GND (pin 6), MISO (pin 7), CD (pin 8), plus SHIELD. Follow the Yamaichi PJS008U-3000-0 datasheet pinout.

Note: The PJS008U pin numbering maps to MicroSD SPI mode as:
- Pin 1: DAT2/NC (not used in SPI)
- Pin 2: CD/CS (chip select)
- Pin 3: CMD/MOSI (data in)
- Pin 4: VDD (3.3V)
- Pin 5: CLK/SCK
- Pin 6: VSS (GND)
- Pin 7: DAT0/MISO (data out)
- Pin 8: DAT1/NC (not used in SPI)
- CD: Card detect (mechanical switch)
- Shield: connector shell

- [ ] **Step 2: Create KiCad footprint**

THT footprint from PJS008U-3000-0 datasheet. Pin pitch: 1.1mm. Two rows offset by 2.2mm. Available from SnapEDA or Ultra Librarian. If creating manually: 8 THT pads (0.7mm drill) plus 2 mounting tabs and card detect switch pads.

- [ ] **Step 3: Create atopile component**

```
# PJS008U — Yamaichi PJS008U-3000-0 Vertical MicroSD Connector
# Through-hole, 14.18mm above PCB, push-in / pull-out
# Standard vertical SD slot for eurorack faceplate mounting

#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked

component PJS008U:
    trait is_atomic_part<manufacturer="Yamaichi", partnumber="PJS008U-3000-0", footprint="PJS008U.kicad_mod", symbol="PJS008U.kicad_sym">
    trait has_designator_prefix<prefix="J">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C3177022", manufacturer="Yamaichi", partno="PJS008U-3000-0">

    # SPI mode signals
    signal cs ~ pin 2       # CD/CS - chip select
    signal mosi ~ pin 3     # CMD/MOSI - data in
    signal vcc ~ pin 4      # VDD - 3.3V
    signal sck ~ pin 5      # CLK/SCK
    signal gnd ~ pin 6      # VSS - ground
    signal miso ~ pin 7     # DAT0/MISO - data out
    signal cd ~ pin 9       # Card detect (mechanical switch)
    signal shield ~ pin 10  # Connector shell/shield
```

Pin numbers 9/10 for CD/shield may differ — verify against datasheet.

---

### Task 3: Create vertical USB-C receptacle part

**Files:**
- Create: `hardware/boards/parts/USB_C_Vertical/USB_C_Vertical.ato`
- Create: `hardware/boards/parts/USB_C_Vertical/USB_C_Vertical.kicad_sym`
- Create: `hardware/boards/parts/USB_C_Vertical/USB_C_Vertical.kicad_mod`

Vertical THT USB-C connector, 17.5mm above PCB. USB 2.0 only (16-pin). Witarea W0026-16-VM2-S3 or equivalent.

- [ ] **Step 1: Create KiCad symbol**

Same signal interface as existing `USB_C_Receptacle` (7 logical signals: VBUS, GND, DP, DM, CC1, CC2, SHIELD). Reuse the existing symbol if pin numbering is compatible, or create new one matching the vertical part's datasheet.

- [ ] **Step 2: Create KiCad footprint**

THT vertical footprint. If the Witarea part is unavailable, consider alternative vertical USB-C connectors available on LCSC with >12mm height and THT mounting. The footprint needs through-hole pins and mounting tabs for mechanical strength.

- [ ] **Step 3: Create atopile component**

```
# USB_C_Vertical — Vertical Through-Hole USB-C Receptacle
# 17.5mm above PCB, USB 2.0 device mode (16-pin)
# Protrudes through faceplate (~5.9mm above panel surface)

#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked

component USB_C_Vertical:
    trait is_atomic_part<manufacturer="Witarea", partnumber="W0026-16-VM2-S3", footprint="USB_C_Vertical.kicad_mod", symbol="USB_C_Vertical.kicad_sym">
    trait has_designator_prefix<prefix="J">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="TBD", manufacturer="Witarea", partno="W0026-16-VM2-S3">

    signal VBUS ~ pin 1
    signal GND ~ pin 2
    signal DP ~ pin 3
    signal DM ~ pin 4
    signal CC1 ~ pin 5
    signal CC2 ~ pin 6
    signal SHIELD ~ pin 7
```

Note: LCSC part number TBD — Witarea availability on LCSC needs verification. If unavailable, pivot to the daughterboard approach (Option B in research doc) or source an alternative vertical USB-C from LCSC.

---

## Chunk 2: Board Connector Signal Expansion

### Task 4: Add 10 new signals to board-to-board connector

**Files:**
- Modify: `hardware/boards/elec/src/board-connector.ato`

Wire the 10 new signals into Header A's spare pins (9-16, 17, 20, 21).

- [ ] **Step 1: Add signal declarations to BoardConnectorInterface**

Add these signals after the existing encoder signals block:

```
    # === Display SPI (shared bus with SD card) ===
    signal spi0_mosi    # GP3 — SPI0 TX (shared: display + SD)
    signal spi0_sck     # GP2 — SPI0 SCK (shared: display + SD)
    signal spi0_miso    # GP0 — SPI0 RX (SD card only)
    signal lcd_cs       # GP1 — display chip select
    signal lcd_dc       # GP7 — display data/command
    signal lcd_bl       # GP5 — display backlight PWM

    # === SD Card (directly on control board) ===
    signal sd_cs        # GP24 — SD chip select
    signal sd_cd        # GP25 — SD card detect

    # === USB (raw D+/D- from MCU, protection on main board) ===
    signal usb_dp       # USB D+
    signal usb_dm       # USB D-
```

- [ ] **Step 2: Wire signals to Header A spare pins**

Replace the spare pin comments in Header A with actual wiring:

```
    # Pins 9-10: SPI0_MOSI / SPI0_SCK (display + SD shared bus)
    header_a.PIN9 ~ spi0_mosi
    header_a.PIN10 ~ spi0_sck
    # Pins 11-12: SPI0_MISO / LCD_CS
    header_a.PIN11 ~ spi0_miso
    header_a.PIN12 ~ lcd_cs
    # Pins 13-14: LCD_DC / LCD_BL
    header_a.PIN13 ~ lcd_dc
    header_a.PIN14 ~ lcd_bl
    # Pins 15-16: SD_CS / SD_CD
    header_a.PIN15 ~ sd_cs
    header_a.PIN16 ~ sd_cd
    # Pin 17: USB_DP
    header_a.PIN17 ~ usb_dp
    # Pin 20: USB_DM
    header_a.PIN20 ~ usb_dm
    # Pin 21: spare (1 remaining)
```

- [ ] **Step 3: Mirror the same changes in BoardConnectorSocket**

Add the same 10 signal declarations and pin wiring to `BoardConnectorSocket` (the female socket used on the control board). Must be identical signal names and pin assignments.

- [ ] **Step 4: Regenerate system.ato**

Run: `python hardware/boards/scripts/gen_validation.py`

This will pick up the new signals and wire them in the validation build. Verify the output includes `control.connector.spi0_mosi ~ main.connector.spi0_mosi` etc.

---

## Chunk 3: Main Board — Remove On-Board Connectors, Route Through Connector

### Task 5: Rewire main board to route display/USB/SD through connector

**Files:**
- Modify: `hardware/boards/elec/src/main.ato`
- Modify: `hardware/boards/elec/src/display.ato`

The main board keeps: MCU, USB series resistors + ESD + CC pull-downs, SD detect pull-up, display backlight MOSFET + RC reset circuit. It loses: the physical USB-C receptacle, MicroSD slot, and display pin header. All those signals now route through the board connector.

- [ ] **Step 1: Update display.ato — Replace PinHeader1x9 with signal interface**

The display module on the main board no longer has a physical connector. It becomes a pure signal-conditioning module (backlight MOSFET, RC reset, bypass cap) that exposes signals for the connector.

Remove the `header = new PinHeader1x9` and all `header.PINx` wiring. Replace with exposed signals:

```
    # --- Signals exposed to board connector (physical FPC on control board) ---
    signal mosi        # SPI MOSI
    signal sck         # SPI SCK
    signal cs          # Chip select
    signal dc          # Data/Command
    signal bl_ctrl     # Backlight PWM from MCU
    signal vcc         # +3.3V
    signal gnd

    # Expose miso for potential future use
    signal miso
```

Keep the backlight MOSFET circuit (`q_bl`, `r_gate`, `r_pulldown`), RC reset circuit (`r_lcd_rst`, `c_lcd_rst`), and bypass cap. These stay on the main board near the MCU.

Add a new exposed signal for the conditioned reset:
```
    signal rst         # Conditioned reset output (RC circuit)
```

Wire `rst_internal ~ rst` so the control board can connect it to the FPC.

Note: The backlight MOSFET drain signal and reset signal need to cross to the control board. We have two options:
- **Option A:** Keep MOSFET + RC reset on main board, add 2 more connector pins (BL_DRAIN, LCD_RST). But we only have 1 spare pin left.
- **Option B (recommended):** Move backlight MOSFET and RC reset to the control board (near the FPC connector). This means `bl_ctrl` (raw GPIO PWM) crosses the connector, and the MOSFET/RC circuit lives on the control board. No extra pins needed.

Go with **Option B**: remove backlight MOSFET and RC reset from display.ato entirely. The control board will have these circuits.

Updated `display.ato` becomes a minimal signal pass-through — it can be removed entirely and the signals wired directly in `main.ato`. But keeping it as a documentation module is fine.

- [ ] **Step 2: Update main.ato — Remove USB-C, SD card, display header**

Remove these instance declarations and all their wiring:
- `usb = new USB_C_Receptacle` and all USB wiring (lines 245-278)
- `sd_slot = new MicroSD_Slot` and all SD wiring (lines 281-296)
- `display = new DisplayConnector` (if simplified to signal pass-through)

Remove the imports:
- `from "../../parts/USB_C_Receptacle/USB_C_Receptacle.ato" import USB_C_Receptacle`
- `from "../../parts/MicroSD_Slot/MicroSD_Slot.ato" import MicroSD_Slot`

Keep on main board (near MCU):
- USB: `r_usb_dp`, `r_usb_dm` (27Ω series), `esd` (PRTR5V0U2X), `r_cc1`, `r_cc2` (5.1kΩ)
- SD: `r_sd_cd` (10kΩ card detect pull-up)

- [ ] **Step 3: Wire MCU signals to connector in main.ato**

Add new wiring blocks:

```
    # === DISPLAY SPI → CONNECTOR (physical FPC on control board) ===
    mcu.spi0_mosi ~ connector.spi0_mosi
    mcu.spi0_sck ~ connector.spi0_sck
    mcu.lcd_cs ~ connector.lcd_cs
    mcu.lcd_dc ~ connector.lcd_dc
    mcu.lcd_bl ~ connector.lcd_bl    # Raw PWM, MOSFET on control board

    # === SD CARD → CONNECTOR (physical slot on control board) ===
    mcu.spi0_mosi ~ connector.spi0_mosi  # Already wired above (shared bus)
    mcu.spi0_sck ~ connector.spi0_sck    # Already wired above (shared bus)
    mcu.spi0_miso ~ connector.spi0_miso
    mcu.sd_cs ~ connector.sd_cs
    mcu.sd_detect ~ connector.sd_cd

    # === USB → CONNECTOR (physical USB-C on control board) ===
    # 27Ω series resistors stay near MCU, then cross connector
    r_usb_dp.unnamed[1] ~ connector.usb_dp
    r_usb_dm.unnamed[1] ~ connector.usb_dm
```

Note: For USB, the series resistors connect MCU → 27Ω → connector pin. The ESD protection (PRTR5V0U2X) connects at the connector-side of the resistors. The CC pull-downs connect on the control board side (near the physical USB-C receptacle). Actually — CC pull-downs need to be near the connector. Move `r_cc1` and `r_cc2` to the control board, or wire CC1/CC2 through the connector too. But we're out of spare pins.

**Decision:** The CC pull-downs can stay on the main board if CC1/CC2 are wired locally to GND through 5.1kΩ. The USB-C spec requires these at the receptacle, but for a data-only device-mode connection with a known cable, having them on the main board is acceptable. The vertical USB-C connector's CC pins would be wired to the receptacle's CC pads and need pull-downs — but those are internal to the connector already? No — they're separate pins.

**Revised approach:** Wire CC1 and CC2 to GND through 5.1kΩ on the control board (near the physical receptacle). This means the control board needs the CC pull-down resistors. No extra connector pins needed — just local to the control board.

- [ ] **Step 4: Clean up main.ato — Remove unused USB/SD physical parts**

Remove:
```
    usb = new USB_C_Receptacle
    sd_slot = new MicroSD_Slot
```

And all `usb.*` and `sd_slot.*` wiring. Keep the series resistors, ESD, and SD decoupling cap.

Move `c_sd` (SD decoupling cap) to control board since the physical slot is there now.

- [ ] **Step 5: Update mcu.ato comments**

Update the file header comment to reflect that display/USB/SD signals now route through the board connector to the control board (instead of being on the main board directly).

---

## Chunk 3: Control Board — Add Physical Connectors

### Task 6: Add display FPC connector to control board

**Files:**
- Modify: `hardware/boards/elec/src/control.ato`
- Modify: `hardware/boards/elec/src/display.ato` (or inline in control.ato)

- [ ] **Step 1: Import and instantiate FPC connector**

In `control.ato`, add:

```
from "../../parts/FPC_18P_05MM/FPC_18P_05MM.ato" import FPC_18P_05MM
from "../../parts/2N7002/2N7002.ato" import _2N7002
```

- [ ] **Step 2: Add display section with FPC connector + backlight circuit**

```
    # ==========================================================================
    # DISPLAY — JC3248A035N-1 bare panel, 18-pin FPC
    # Glass sits in faceplate cutout, FPC ribbon connects here
    # ==========================================================================
    lcd_fpc = new FPC_18P_05MM

    # FPC pinout: 1=GND, 2=RST, 3=SCK, 4=DC, 5=CS, 6=MOSI,
    #             7=MISO, 8=GND, 9=VCC, 10=LEDA, 11-14=K1-K4, 15-18=NC
    lcd_fpc.PIN1 ~ gnd
    lcd_fpc.PIN3 ~ connector.spi0_sck
    lcd_fpc.PIN4 ~ connector.lcd_dc
    lcd_fpc.PIN5 ~ connector.lcd_cs
    lcd_fpc.PIN6 ~ connector.spi0_mosi
    lcd_fpc.PIN7 ~ connector.spi0_miso    # MISO (unused by display, available for SD)
    lcd_fpc.PIN8 ~ gnd
    lcd_fpc.PIN9 ~ connector.v3v3

    # Backlight: LEDA to 3.3V, K1-K4 switched to GND via MOSFET
    lcd_fpc.PIN10 ~ connector.v3v3         # LEDA (backlight anode)

    # Backlight MOSFET — N-channel switches cathodes to GND
    q_lcd_bl = new _2N7002
    r_lcd_gate = new Resistor
    r_lcd_gate.resistance = 100ohm +/- 5%
    r_lcd_pulldown = new Resistor
    r_lcd_pulldown.resistance = 100kohm +/- 5%

    connector.lcd_bl ~ r_lcd_gate.unnamed[0]
    r_lcd_gate.unnamed[1] ~ q_lcd_bl.gate
    r_lcd_pulldown.unnamed[0] ~ q_lcd_bl.gate
    r_lcd_pulldown.unnamed[1] ~ gnd
    q_lcd_bl.source ~ gnd

    # All 4 cathodes switched together
    lcd_fpc.PIN11 ~ q_lcd_bl.drain
    lcd_fpc.PIN12 ~ q_lcd_bl.drain
    lcd_fpc.PIN13 ~ q_lcd_bl.drain
    lcd_fpc.PIN14 ~ q_lcd_bl.drain

    # RC power-on reset for LCD
    r_lcd_rst = new Resistor
    r_lcd_rst.resistance = 10kohm +/- 5%
    c_lcd_rst = new Capacitor
    c_lcd_rst.capacitance = 100nF +/- 20%
    signal lcd_rst_internal
    r_lcd_rst.unnamed[0] ~ connector.v3v3
    r_lcd_rst.unnamed[1] ~ lcd_rst_internal
    c_lcd_rst.unnamed[0] ~ lcd_rst_internal
    c_lcd_rst.unnamed[1] ~ gnd
    lcd_fpc.PIN2 ~ lcd_rst_internal

    # LCD bypass cap
    c_lcd = new Capacitor
    c_lcd.capacitance = 100nF +/- 20%
    c_lcd.unnamed[0] ~ connector.v3v3
    c_lcd.unnamed[1] ~ gnd
```

---

### Task 7: Add vertical MicroSD connector to control board

**Files:**
- Modify: `hardware/boards/elec/src/control.ato`

- [ ] **Step 1: Import and instantiate**

```
from "../../parts/PJS008U/PJS008U.ato" import PJS008U
```

- [ ] **Step 2: Wire SD card connector**

```
    # ==========================================================================
    # SD CARD — Yamaichi PJS008U-3000-0 vertical MicroSD
    # Protrudes through faceplate (~2.6mm above panel surface)
    # ==========================================================================
    sd = new PJS008U

    sd.mosi ~ connector.spi0_mosi
    sd.miso ~ connector.spi0_miso
    sd.sck ~ connector.spi0_sck
    sd.cs ~ connector.sd_cs
    sd.cd ~ connector.sd_cd
    sd.vcc ~ connector.v3v3
    sd.gnd ~ gnd
    sd.shield ~ gnd

    # SD decoupling cap (near connector)
    c_sd = new Capacitor
    c_sd.capacitance = 100nF +/- 20%
    c_sd.unnamed[0] ~ connector.v3v3
    c_sd.unnamed[1] ~ gnd
```

---

### Task 8: Add vertical USB-C connector to control board

**Files:**
- Modify: `hardware/boards/elec/src/control.ato`

- [ ] **Step 1: Import and instantiate**

```
from "../../parts/USB_C_Vertical/USB_C_Vertical.ato" import USB_C_Vertical
```

- [ ] **Step 2: Wire USB-C connector**

```
    # ==========================================================================
    # USB-C — Vertical THT receptacle for firmware programming
    # Protrudes through faceplate (~5.9mm above panel surface)
    # Data only (no VBUS power), USB 2.0 Full Speed
    # Series resistors + ESD protection on main board near MCU
    # ==========================================================================
    usb = new USB_C_Vertical

    usb.DP ~ connector.usb_dp
    usb.DM ~ connector.usb_dm
    usb.GND ~ gnd
    usb.SHIELD ~ gnd
    usb.VBUS ~ gnd    # Not used — tie to GND or leave floating? GND is safer.

    # CC pull-downs (must be at receptacle per USB-C spec)
    r_cc1 = new Resistor
    r_cc1.resistance = 5.1kohm +/- 1%
    r_cc1.unnamed[0] ~ usb.CC1
    r_cc1.unnamed[1] ~ gnd

    r_cc2 = new Resistor
    r_cc2.resistance = 5.1kohm +/- 1%
    r_cc2.unnamed[0] ~ usb.CC2
    r_cc2.unnamed[1] ~ gnd
```

Note: VBUS is not connected to power — this is data-only USB. Tying VBUS to GND through a 100kΩ resistor is safer than floating. Or just leave it NC if the part supports it.

---

## Chunk 4: Panel Positions and Web Preview

### Task 9: Choose panel positions for USB-C and SD card

**Files:**
- Modify: `hardware/boards/component-map.json`
- Modify: `web/src/panel-layout.json`

The USB-C and SD card go right of the step buttons (x ≈ 93–125mm, y ≈ 98–108mm).

**Clearance analysis:**

```
Step button 8 (rightmost top row):  x=90.47, y=98.19  (courtyard: ±4.5mm → right edge 94.97)
Step button 16 (rightmost bottom):  x=90.47, y=108.39 (courtyard: right edge 94.97)
Encoder B:                          x=107.3, y=83.36  (courtyard: 99.3-115.3, 74.4-92.4)
Subtrack MOD (bottommost):          x=101.72, y=51.6  (courtyard: bottom 56.1)
PAT button:                         x=101.72, y=62.3  (courtyard: bottom 66.8)
CV A (leftmost CV jack):            x=130.48, y=108.0 (courtyard: left edge ~125.5)
MOD1 (bottom-left output jack):     x=130.48, y=94.0  (courtyard: left edge ~126.5)
```

Proposed positions (faceplate coordinates, mm):

**SD card** (13mm × 3mm faceplate cutout):
- x = 105.0, y = 103.0 (between the two step rows, right of steps)
- Clears step 8 courtyard (95.0) by 3.5mm at x=105-6.5=98.5
- Clears encoder B courtyard bottom (92.4) by 10.6mm
- Clears CV A courtyard left (125.5) by 14mm

**USB-C** (9.5mm × 3.5mm faceplate cutout):
- x = 118.0, y = 103.0 (to the right of SD card)
- Clears SD card by ~6.5mm gap
- Clears CV A courtyard (125.5) by 3mm
- Clears MOD1 courtyard (126.5) by 4mm

Both sit at y=103 — vertically centered between the two step button rows (98.19 and 108.39).

- [ ] **Step 1: Add connector positions to panel-layout.json**

Update the `connectors` section:

```json
  "connectors": {
    "_note": "USB-C and SD card on control board, protrude through faceplate",
    "sd_card": {
      "id": "sd_card",
      "x_mm": 105.0,
      "y_mm": 103.0,
      "width_mm": 13.0,
      "height_mm": 3.0,
      "label": "SD"
    },
    "usb_c": {
      "id": "usb_c",
      "x_mm": 118.0,
      "y_mm": 103.0,
      "width_mm": 9.5,
      "height_mm": 3.5,
      "label": "USB"
    }
  },
```

- [ ] **Step 2: Update component-map.json connectors section**

```json
  "connectors": {
    "_note": "USB-C and SD card on control board, protrude through faceplate cutouts",
    "usb_c": {
      "part": "USB_C_Vertical (Witarea W0026-16-VM2-S3 or equiv)",
      "height_above_pcb_mm": 17.5,
      "protrusion_above_panel_mm": 5.9,
      "faceplate_cutout_mm": "9.5 x 3.5"
    },
    "sd_card": {
      "part": "PJS008U-3000-0 (Yamaichi vertical MicroSD)",
      "height_above_pcb_mm": 14.18,
      "protrusion_above_panel_mm": 2.6,
      "faceplate_cutout_mm": "13 x 3"
    }
  },
```

- [ ] **Step 3: Add FPC connector footprint data to component-map.json**

In the `footprints` section, add:

```json
    "fpc_18p_05mm": {
      "description": "18-pin 0.5mm FPC ZIF connector for display",
      "body": { "x1": -5.75, "y1": -2.5, "x2": 5.75, "y2": 2.5 },
      "courtyard": { "x1": -6.5, "y1": -3.5, "x2": 6.5, "y2": 3.5 }
    },
    "pjs008u": {
      "description": "Yamaichi PJS008U-3000-0 vertical MicroSD",
      "body": { "x1": -7.0, "y1": -6.5, "x2": 7.0, "y2": 6.5 },
      "courtyard": { "x1": -8.0, "y1": -7.5, "x2": 8.0, "y2": 7.5 }
    },
    "usb_c_vertical": {
      "description": "Vertical THT USB-C receptacle",
      "body": { "x1": -4.75, "y1": -4.5, "x2": 4.75, "y2": 4.5 },
      "courtyard": { "x1": -5.5, "y1": -5.0, "x2": 5.5, "y2": 5.0 }
    }
```

Note: Body/courtyard dimensions are estimates — update from actual KiCad footprints when created.

- [ ] **Step 4: Verify web preview renders connectors**

Run: `cd web && npm run dev`

The existing code in `faceplate.ts` and `footprint-overlay.ts` already reads `panelLayout.connectors.usb_c` and `panelLayout.connectors.sd_card` and renders them. Adding the position data to `panel-layout.json` should make them appear automatically.

Check:
1. SD card rectangle appears at (105, 103) with "SD" label
2. USB-C rectangle appears at (118, 103) with "USB" label
3. Footprint overlay shows orange rects for both connectors
4. No overlap with step buttons or encoder courtyards

---

### Task 10: Update faceplate.ato with new cutouts

**Files:**
- Modify: `hardware/faceplate/elec/src/faceplate.ato`

- [ ] **Step 1: Update the comment block**

The faceplate needs three rectangular cutouts total:
- LCD: 82.5 × 52.0mm (already updated)
- USB-C: 9.5 × 3.5mm at (118.0, 103.0)
- SD card: 13.0 × 3.0mm at (105.0, 103.0)

These are documented in the header comment block. The actual cutouts are placed in the KiCad PCB layout (not in .ato code). Update the comments to include positions.

---

## Chunk 5: Build Verification

### Task 11: Verify atopile builds succeed

- [ ] **Step 1: Build control board**

Run: `cd hardware/boards && ato build --build control`

Expected: Compiles without errors. New components (FPC, PJS008U, USB_C_Vertical) are resolved.

- [ ] **Step 2: Build main board**

Run: `cd hardware/boards && ato build --build main`

Expected: Compiles without errors. Old USB-C, SD slot, and display header are gone. Signals route through connector.

- [ ] **Step 3: Regenerate and build system validation**

Run: `python hardware/boards/scripts/gen_validation.py && cd hardware/boards && ato build --build system`

Expected: All 10 new connector signals appear in system.ato. Cross-board wiring validates.

- [ ] **Step 4: Run full make target**

Run: `make hw-build`

Expected: All three builds pass.

---

## Summary of Signal Flow (After Changes)

```
MCU (main board)                    Board Connector              Control Board
─────────────────                   ──────────────────           ─────────────────
GP3 (SPI0_TX)  ──────────────────── Pin A9  ─────────────────── FPC PIN6 (MOSI) + SD MOSI
GP2 (SPI0_SCK) ──────────────────── Pin A10 ─────────────────── FPC PIN3 (SCK) + SD SCK
GP0 (SPI0_RX)  ──────────────────── Pin A11 ─────────────────── SD MISO
GP1 (LCD_CS)   ──────────────────── Pin A12 ─────────────────── FPC PIN5 (CS)
GP7 (LCD_DC)   ──────────────────── Pin A13 ─────────────────── FPC PIN4 (DC)
GP5 (LCD_BL)   ──────────────────── Pin A14 ─────────────────── MOSFET gate → FPC K1-K4
GP24 (SD_CS)   ──────────────────── Pin A15 ─────────────────── SD CS
GP25 (SD_CD)   ──────────────────── Pin A16 ─────────────────── SD CD
USB_DP → 27Ω   ──────────────────── Pin A17 ─────────────────── USB-C DP
USB_DM → 27Ω   ──────────────────── Pin A20 ─────────────────── USB-C DM
```

**Main board keeps:** Series resistors (27Ω USB), ESD protection (PRTR5V0U2X), SD detect pull-up (10kΩ)
**Control board gets:** Physical connectors + CC pull-downs (5.1kΩ) + backlight MOSFET + RC reset + decoupling caps
