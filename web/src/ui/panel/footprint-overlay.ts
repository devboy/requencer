/**
 * Footprint debug overlay — SVG layer showing component drill holes,
 * body outlines, rail zones, and panel bounds as dotted lines.
 * Toggle via debug menu. Hidden by default.
 */

import panelLayout from '../../../../panel-layout.json'

const SCALE = 4.5 // px per mm
const C = panelLayout.constants

// Hardware drill sizes (from generate_faceplate.py)
const JACK_DRILL_MM = 6.0
const BUTTON_DRILL_MM = 3.2
const ENCODER_DRILL_MM = 7.0

const W = panelLayout.panel.width_mm * SCALE
const H = panelLayout.panel.height_mm * SCALE

function svgCircle(cx: number, cy: number, r: number, color: string, dash = '3,3'): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${color}" stroke-dasharray="${dash}" fill="none" stroke-width="1" opacity="0.6"/>`
}

function svgRect(x: number, y: number, w: number, h: number, color: string, dash = '3,3'): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${color}" stroke-dasharray="${dash}" fill="none" stroke-width="1" opacity="0.6"/>`
}

function svgLine(x1: number, y1: number, x2: number, y2: number, color: string, dash = '5,3'): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-dasharray="${dash}" stroke-width="1" opacity="0.5"/>`
}

function svgOval(cx: number, cy: number, rx: number, ry: number, color: string, dash = '3,3'): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-dasharray="${dash}" fill="none" stroke-width="1" opacity="0.6"/>`
}

function mm(v: number): number {
  return v * SCALE
}

/** Create the footprint SVG overlay inside #module-panel */
export function createFootprintOverlay(): void {
  const panel = document.getElementById('module-panel')
  if (!panel) return

  const parts: string[] = []

  // Panel outline
  parts.push(svgRect(0, 0, W, H, '#00cccc', '6,3'))

  // Rail zone lines
  const railTop = mm(C.rail_zone_mm)
  const railBot = mm(panelLayout.panel.height_mm - C.rail_zone_mm)
  parts.push(svgLine(0, railTop, W, railTop, '#cccc00', '5,3'))
  parts.push(svgLine(0, railBot, W, railBot, '#cccc00', '5,3'))

  // LCD cutout
  const lcd = panelLayout.lcd_cutout
  const lcdX = mm(lcd.center_x_mm - lcd.width_mm / 2)
  const lcdY = mm(lcd.center_y_mm - lcd.height_mm / 2)
  parts.push(svgRect(lcdX, lcdY, mm(lcd.width_mm), mm(lcd.height_mm), '#ff6600', '4,3'))

  // Mounting slots
  for (const slot of panelLayout.mounting_slots) {
    const rx = mm(C.mount_slot_w_mm / 2)
    const ry = mm(C.mount_slot_h_mm / 2)
    parts.push(svgOval(mm(slot.x_mm), mm(slot.y_mm), rx, ry, '#00cccc'))
  }

  // Buttons — drill holes (inner) + body outlines (outer)
  function addButtonFootprints(buttons: Array<{ x_mm: number; y_mm: number }>, bodyDiameterMM: number): void {
    for (const b of buttons) {
      const cx = mm(b.x_mm)
      const cy = mm(b.y_mm)
      // Drill hole
      parts.push(svgCircle(cx, cy, mm(BUTTON_DRILL_MM / 2), '#ff4444'))
      // Body outline
      parts.push(svgCircle(cx, cy, mm(bodyDiameterMM / 2), '#44ff44'))
    }
  }

  addButtonFootprints(panelLayout.buttons.track, C.btn_diameter_mm)
  addButtonFootprints([panelLayout.buttons.tbd], C.btn_diameter_mm)
  addButtonFootprints(panelLayout.buttons.subtrack, C.btn_diameter_mm)
  addButtonFootprints([panelLayout.buttons.pat], C.btn_diameter_mm)
  addButtonFootprints(panelLayout.buttons.feature, C.btn_diameter_mm)
  addButtonFootprints(panelLayout.buttons.step, C.step_btn_diameter_mm)

  // Control strip buttons — rectangular, show as rect outlines
  for (const b of panelLayout.buttons.control_strip) {
    if (b.x_mm !== undefined && b.y_mm !== undefined) {
      const cx = mm(b.x_mm)
      const cy = mm(b.y_mm)
      const bw = b.id === 'rand' ? mm(26.0 / 2) : mm(20.0 / 2)
      const bh = mm(C.rect_btn_height_mm / 2)
      parts.push(svgRect(cx - bw, cy - bh, bw * 2, bh * 2, '#44ff44'))
    }
  }

  // Transport buttons — rectangular
  for (const b of panelLayout.buttons.transport) {
    const cx = mm(b.x_mm)
    const cy = mm(b.y_mm)
    const bw = mm(10.0 / 2)
    const bh = mm(C.rect_btn_height_mm / 2)
    parts.push(svgRect(cx - bw, cy - bh, bw * 2, bh * 2, '#44ff44'))
  }

  // Encoders — drill holes + body outlines
  for (const enc of panelLayout.encoders) {
    const cx = mm(enc.x_mm)
    const cy = mm(enc.y_mm)
    parts.push(svgCircle(cx, cy, mm(ENCODER_DRILL_MM / 2), '#ff4444'))
    parts.push(svgCircle(cx, cy, mm(C.encoder_diameter_mm / 2), '#44ff44'))
  }

  // Jacks — drill holes + hex nut body outlines
  function addJackFootprints(jacks: Array<{ x_mm: number; y_mm: number }>): void {
    for (const j of jacks) {
      const cx = mm(j.x_mm)
      const cy = mm(j.y_mm)
      // Drill hole
      parts.push(svgCircle(cx, cy, mm(JACK_DRILL_MM / 2), '#ff4444'))
      // Hex nut body
      parts.push(svgCircle(cx, cy, mm(C.jack_diameter_mm / 2), '#44ff44'))
    }
  }

  addJackFootprints(panelLayout.jacks.utility)
  addJackFootprints(panelLayout.jacks.output)
  addJackFootprints(panelLayout.jacks.cv_input)

  // Connectors
  const usb = panelLayout.connectors.usb_c
  parts.push(
    svgRect(
      mm(usb.x_mm) - mm(usb.width_mm / 2),
      mm(usb.y_mm) - mm(usb.height_mm / 2),
      mm(usb.width_mm),
      mm(usb.height_mm),
      '#ff6600',
    ),
  )

  const sd = panelLayout.connectors.sd_card
  parts.push(
    svgRect(
      mm(sd.x_mm) - mm(sd.width_mm / 2),
      mm(sd.y_mm) - mm(sd.height_mm / 2),
      mm(sd.width_mm),
      mm(sd.height_mm),
      '#ff6600',
    ),
  )

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
