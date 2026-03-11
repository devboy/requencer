/**
 * Footprint debug overlay — SVG layer showing actual PCB component
 * footprints (body silkscreen + courtyard rectangles), rail zones,
 * and panel bounds as dotted lines.
 *
 * All footprint rectangles match the KiCad fp_rect coordinates from
 * hardware/pcb/scripts/generate_footprints.py, expressed as offsets from
 * the component center (pin 1 / origin).
 *
 * Toggle via debug menu. Hidden by default.
 */

import panelLayout from '../../panel-layout.json'

const SCALE = 4.5 // px per mm
const C = panelLayout.constants
const FP = panelLayout.footprints

const W = panelLayout.panel.width_mm * SCALE
const H = panelLayout.panel.height_mm * SCALE

function svgRect(x: number, y: number, w: number, h: number, color: string, dash = '3,3'): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${color}" stroke-dasharray="${dash}" fill="none" stroke-width="1" opacity="0.6"/>`
}

function svgOval(cx: number, cy: number, rx: number, ry: number, color: string, dash = '3,3'): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-dasharray="${dash}" fill="none" stroke-width="1" opacity="0.6"/>`
}

function mm(v: number): number {
  return v * SCALE
}

/** Draw an offset rect: component at (cx_mm, cy_mm) + footprint bounds */
function offsetRect(
  cx_mm: number,
  cy_mm: number,
  bounds: { x1: number; y1: number; x2: number; y2: number },
  color: string,
  dash = '3,3',
): string {
  const x = mm(cx_mm + bounds.x1)
  const y = mm(cy_mm + bounds.y1)
  const w = mm(bounds.x2 - bounds.x1)
  const h = mm(bounds.y2 - bounds.y1)
  return svgRect(x, y, w, h, color, dash)
}

/** Create the footprint SVG overlay inside #module-panel */
export function createFootprintOverlay(): void {
  const panel = document.getElementById('module-panel')
  if (!panel) return

  const parts: string[] = []

  // Panel outline
  parts.push(svgRect(0, 0, W, H, '#00cccc', '6,3'))

  // PCB outline (board between rails, smaller than faceplate)
  const pcb = (panelLayout as Record<string, unknown>).pcb as
    | { origin_x_mm: number; origin_y_mm: number; width_mm: number; height_mm: number }
    | undefined
  if (pcb) {
    parts.push(svgRect(mm(pcb.origin_x_mm), mm(pcb.origin_y_mm), mm(pcb.width_mm), mm(pcb.height_mm), '#cccc00', '5,3'))
  }

  // LCD cutout
  const lcd = panelLayout.lcd_cutout
  parts.push(
    svgRect(
      mm(lcd.center_x_mm - lcd.width_mm / 2),
      mm(lcd.center_y_mm - lcd.height_mm / 2),
      mm(lcd.width_mm),
      mm(lcd.height_mm),
      '#ff6600',
      '4,3',
    ),
  )

  // Mounting slots
  for (const slot of panelLayout.mounting_slots) {
    parts.push(svgOval(mm(slot.x_mm), mm(slot.y_mm), mm(C.mount_slot_w_mm / 2), mm(C.mount_slot_h_mm / 2), '#00cccc'))
  }

  // Buttons — body rect (green) + courtyard rect (yellow)
  function addButtonFootprints(buttons: Array<{ x_mm: number; y_mm: number }>): void {
    for (const b of buttons) {
      parts.push(offsetRect(b.x_mm, b.y_mm, FP.tc002_rgb.body, '#44ff44'))
      parts.push(offsetRect(b.x_mm, b.y_mm, FP.tc002_rgb.courtyard, '#cccc00', '2,2'))
    }
  }

  addButtonFootprints(panelLayout.buttons.track)
  addButtonFootprints(panelLayout.buttons.subtrack)
  addButtonFootprints([panelLayout.buttons.pat])
  addButtonFootprints(panelLayout.buttons.feature)
  addButtonFootprints(panelLayout.buttons.step)

  // Control strip buttons — rectangular (no PCB footprint data, show visual rect)
  for (const b of panelLayout.buttons.control_strip) {
    if (b.x_mm !== undefined && b.y_mm !== undefined) {
      const bw = b.id === 'rand' ? 26.0 : 20.0
      const bh = C.rect_btn_height_mm
      parts.push(svgRect(mm(b.x_mm - bw / 2), mm(b.y_mm - bh / 2), mm(bw), mm(bh), '#44ff44'))
    }
  }

  // Transport buttons — rectangular
  for (const b of panelLayout.buttons.transport) {
    const bw = 10.0
    const bh = C.rect_btn_height_mm
    parts.push(svgRect(mm(b.x_mm - bw / 2), mm(b.y_mm - bh / 2), mm(bw), mm(bh), '#44ff44'))
  }

  // Encoders — body rect (green) + courtyard rect (yellow)
  for (const enc of panelLayout.encoders) {
    parts.push(offsetRect(enc.x_mm, enc.y_mm, FP.ec11e.body, '#44ff44'))
    parts.push(offsetRect(enc.x_mm, enc.y_mm, FP.ec11e.courtyard, '#cccc00', '2,2'))
  }

  // Jacks — asymmetric courtyard rect (green)
  function addJackFootprints(jacks: Array<{ x_mm: number; y_mm: number }>): void {
    for (const j of jacks) {
      parts.push(offsetRect(j.x_mm, j.y_mm, FP.pj398sm.body, '#44ff44'))
    }
  }

  addJackFootprints(panelLayout.jacks.utility)
  addJackFootprints(panelLayout.jacks.output)
  addJackFootprints(panelLayout.jacks.cv_input)

  // Connectors — rect from JSON dimensions (optional, may be on faceplate board)
  const fpConnectors = panelLayout.connectors as Record<string, Record<string, number | string>> | undefined
  const usb = fpConnectors?.usb_c
  if (usb) {
    parts.push(
      svgRect(
        mm(usb.x_mm - usb.width_mm / 2),
        mm(usb.y_mm - usb.height_mm / 2),
        mm(usb.width_mm),
        mm(usb.height_mm),
        '#ff6600',
      ),
    )
  }

  const sd = fpConnectors?.sd_card
  if (sd) {
    parts.push(
      svgRect(
        mm(sd.x_mm - sd.width_mm / 2),
        mm(sd.y_mm - sd.height_mm / 2),
        mm(sd.width_mm),
        mm(sd.height_mm),
        '#ff6600',
      ),
    )
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.id = 'footprint-overlay'
  svg.setAttribute('width', String(W))
  svg.setAttribute('height', String(H))
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.style.cssText = `
    position: absolute; top: 0; left: 0;
    width: ${W}px; height: ${H}px;
    pointer-events: none; z-index: 20;
    display: none;
  `
  svg.innerHTML = parts.join('\n')
  panel.appendChild(svg)
}
