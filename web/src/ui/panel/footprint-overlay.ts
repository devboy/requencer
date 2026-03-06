/**
 * Footprint debug overlay — SVG layer showing PCB component footprints,
 * body outlines, courtyards, rail zones, and panel bounds as dotted lines.
 * Toggle via debug menu. Hidden by default.
 *
 * Footprint dimensions from hardware/scripts/generate_footprints.py:
 *   PJ398SM jack:  body courtyard 11×10mm, silkscreen 6mm circle
 *   TC002 button:  body 7×7mm rect, courtyard 9×9mm
 *   EC11E encoder: body 13×13mm rect, courtyard 16×18mm
 */

import panelLayout from '../../../../panel-layout.json'

const SCALE = 4.5 // px per mm
const C = panelLayout.constants

// PCB footprint dimensions (from generate_footprints.py)
// Jack (PJ398SM): courtyard rect from (-4,-7) to (7,3) = 11×10mm centered ~(1.5, -2)
const JACK_COURTYARD_W = 11.0
const JACK_COURTYARD_H = 10.0
// Button (TC002-RGB): body rect 7×7mm, courtyard 9×9mm
const BTN_BODY_MM = 7.0
const BTN_COURTYARD_MM = 9.0
// Encoder (EC11E): body rect 13×13mm, courtyard 16×18mm
const ENC_BODY_W = 13.0
const ENC_BODY_H = 13.0
const ENC_COURTYARD_W = 16.0
const ENC_COURTYARD_H = 18.0

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

/** Centered rect helper: draw a rect centered at (cx,cy) with given width/height in mm */
function centeredRect(cx_mm: number, cy_mm: number, w_mm: number, h_mm: number, color: string, dash = '3,3'): string {
  return svgRect(mm(cx_mm - w_mm / 2), mm(cy_mm - h_mm / 2), mm(w_mm), mm(h_mm), color, dash)
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
  parts.push(centeredRect(lcd.center_x_mm, lcd.center_y_mm, lcd.width_mm, lcd.height_mm, '#ff6600', '4,3'))

  // Mounting slots
  for (const slot of panelLayout.mounting_slots) {
    const rx = mm(C.mount_slot_w_mm / 2)
    const ry = mm(C.mount_slot_h_mm / 2)
    parts.push(svgOval(mm(slot.x_mm), mm(slot.y_mm), rx, ry, '#00cccc'))
  }

  // Buttons — PCB body (green) + courtyard (yellow)
  function addButtonFootprints(buttons: Array<{ x_mm: number; y_mm: number }>): void {
    for (const b of buttons) {
      // Body outline (7×7mm silkscreen rect)
      parts.push(centeredRect(b.x_mm, b.y_mm, BTN_BODY_MM, BTN_BODY_MM, '#44ff44'))
      // Courtyard (9×9mm)
      parts.push(centeredRect(b.x_mm, b.y_mm, BTN_COURTYARD_MM, BTN_COURTYARD_MM, '#cccc00', '2,2'))
    }
  }

  addButtonFootprints(panelLayout.buttons.track)
  addButtonFootprints([panelLayout.buttons.tbd])
  addButtonFootprints(panelLayout.buttons.subtrack)
  addButtonFootprints([panelLayout.buttons.pat])
  addButtonFootprints(panelLayout.buttons.feature)
  addButtonFootprints(panelLayout.buttons.step)

  // Control strip buttons — rectangular, show visual rect
  for (const b of panelLayout.buttons.control_strip) {
    if (b.x_mm !== undefined && b.y_mm !== undefined) {
      const bw = b.id === 'rand' ? 26.0 : 20.0
      parts.push(centeredRect(b.x_mm, b.y_mm, bw, C.rect_btn_height_mm, '#44ff44'))
    }
  }

  // Transport buttons — rectangular
  for (const b of panelLayout.buttons.transport) {
    parts.push(centeredRect(b.x_mm, b.y_mm, 10.0, C.rect_btn_height_mm, '#44ff44'))
  }

  // Encoders — PCB body (green) + courtyard (yellow)
  for (const enc of panelLayout.encoders) {
    // Body outline (13×13mm)
    parts.push(centeredRect(enc.x_mm, enc.y_mm, ENC_BODY_W, ENC_BODY_H, '#44ff44'))
    // Courtyard (16×18mm)
    parts.push(centeredRect(enc.x_mm, enc.y_mm, ENC_COURTYARD_W, ENC_COURTYARD_H, '#cccc00', '2,2'))
  }

  // Jacks — PCB courtyard rect (green) + hex nut circle (dimmer)
  function addJackFootprints(jacks: Array<{ x_mm: number; y_mm: number }>): void {
    for (const j of jacks) {
      // Courtyard rect (11×10mm)
      parts.push(centeredRect(j.x_mm, j.y_mm, JACK_COURTYARD_W, JACK_COURTYARD_H, '#44ff44'))
      // Hex nut on panel side (10mm circle, dimmer)
      parts.push(svgCircle(mm(j.x_mm), mm(j.y_mm), mm(C.jack_diameter_mm / 2), '#44ff44', '2,4'))
    }
  }

  addJackFootprints(panelLayout.jacks.utility)
  addJackFootprints(panelLayout.jacks.output)
  addJackFootprints(panelLayout.jacks.cv_input)

  // Connectors
  const usb = panelLayout.connectors.usb_c
  parts.push(centeredRect(usb.x_mm, usb.y_mm, usb.width_mm, usb.height_mm, '#ff6600'))

  const sd = panelLayout.connectors.sd_card
  parts.push(centeredRect(sd.x_mm, sd.y_mm, sd.width_mm, sd.height_mm, '#ff6600'))

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
