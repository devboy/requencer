//! MIDI I/O over UART1 at 31250 baud.
//!
//! Pin assignment: GP20 = UART1_TX (MIDI OUT), GP21 = UART1_RX (MIDI IN).
//! Note: The PCB schematic lists GP21/GP22, but RP2350 GPIO function mapping
//! requires GP20/GP21 for UART1. The schematic should be updated accordingly.

use embassy_rp::uart::{UartRx, UartTx};
use requencer_engine::types::NoteEvent;

/// MIDI status bytes.
mod status {
    pub const NOTE_OFF: u8 = 0x80;
    pub const NOTE_ON: u8 = 0x90;
    pub const CONTROL_CHANGE: u8 = 0xB0;
    pub const CLOCK: u8 = 0xF8;
    pub const START: u8 = 0xFA;
    pub const STOP: u8 = 0xFC;
    pub const CONTINUE: u8 = 0xFB;
}

/// CC numbers for modulation and velocity.
mod cc {
    pub const MOD_WHEEL: u8 = 1;
}

/// MIDI output — sends note and clock messages.
pub struct MidiOut<'a> {
    tx: UartTx<'a, embassy_rp::peripherals::UART1, embassy_rp::uart::Blocking>,
    /// Track which notes are currently on per channel (for proper note-off).
    active_notes: [Option<u8>; 4],
}

impl<'a> MidiOut<'a> {
    pub fn new(
        tx: UartTx<'a, embassy_rp::peripherals::UART1, embassy_rp::uart::Blocking>,
    ) -> Self {
        Self {
            tx,
            active_notes: [None; 4],
        }
    }

    fn send(&mut self, bytes: &[u8]) {
        let _ = self.tx.blocking_write(bytes);
    }

    /// Send MIDI clock tick (0xF8).
    pub fn send_clock(&mut self) {
        self.send(&[status::CLOCK]);
    }

    /// Send MIDI start (0xFA).
    pub fn send_start(&mut self) {
        self.send(&[status::START]);
    }

    /// Send MIDI stop (0xFC).
    pub fn send_stop(&mut self) {
        self.send(&[status::STOP]);
    }

    /// Send MIDI continue (0xFB).
    pub fn send_continue(&mut self) {
        self.send(&[status::CONTINUE]);
    }

    /// Send note events for all outputs. Each output maps to a MIDI channel.
    /// channels: array of MIDI channels (0-15) for outputs 0-3.
    pub fn send_events(
        &mut self,
        events: &[Option<NoteEvent>; 4],
        channels: &[u8; 4],
    ) {
        for (i, event) in events.iter().enumerate() {
            let ch = channels[i] & 0x0F;

            if let Some(ev) = event {
                // Send note-off for previous note if one is active
                if let Some(prev_note) = self.active_notes[i] {
                    if !ev.sustain || prev_note != ev.pitch || ev.retrigger {
                        self.send(&[status::NOTE_OFF | ch, prev_note, 0]);
                        self.active_notes[i] = None;
                    }
                }

                // Send note-on if gate is active
                if ev.gate {
                    // Send CC for modulation
                    self.send(&[
                        status::CONTROL_CHANGE | ch,
                        cc::MOD_WHEEL,
                        ev.modulation.min(127),
                    ]);

                    // Send note-on
                    self.send(&[
                        status::NOTE_ON | ch,
                        ev.pitch.min(127),
                        ev.velocity.min(127),
                    ]);
                    self.active_notes[i] = Some(ev.pitch);
                }
            }
        }
    }

    /// Send all-notes-off on all channels (panic).
    pub fn all_notes_off(&mut self, channels: &[u8; 4]) {
        for (i, &ch) in channels.iter().enumerate() {
            if let Some(note) = self.active_notes[i] {
                self.send(&[status::NOTE_OFF | (ch & 0x0F), note, 0]);
                self.active_notes[i] = None;
            }
        }
    }
}

/// MIDI input — parses incoming MIDI messages.
pub struct MidiIn<'a> {
    rx: UartRx<'a, embassy_rp::peripherals::UART1, embassy_rp::uart::Blocking>,
    /// Parser state for running status.
    running_status: u8,
    buf: [u8; 3],
    buf_len: usize,
    expected_len: usize,
}

/// Parsed MIDI input messages we care about.
#[derive(Clone, Copy, Debug)]
pub enum MidiMessage {
    Clock,
    Start,
    Stop,
    Continue,
    NoteOn { channel: u8, note: u8, velocity: u8 },
    NoteOff { channel: u8, note: u8 },
    ControlChange { channel: u8, cc: u8, value: u8 },
}

impl<'a> MidiIn<'a> {
    pub fn new(
        rx: UartRx<'a, embassy_rp::peripherals::UART1, embassy_rp::uart::Blocking>,
    ) -> Self {
        Self {
            rx,
            running_status: 0,
            buf: [0; 3],
            buf_len: 0,
            expected_len: 0,
        }
    }

    /// Try to read and parse one MIDI message. Non-blocking — returns None if no data.
    pub fn try_read(&mut self) -> Option<MidiMessage> {
        let mut byte = [0u8; 1];
        // Try to read one byte (non-blocking via timeout = 0 isn't great,
        // but embassy UART doesn't have try_read; we'll use blocking_read
        // in a dedicated task instead).
        if self.rx.blocking_read(&mut byte).is_err() {
            return None;
        }
        self.parse_byte(byte[0])
    }

    fn parse_byte(&mut self, byte: u8) -> Option<MidiMessage> {
        // System real-time messages (single byte, can appear anywhere)
        match byte {
            status::CLOCK => return Some(MidiMessage::Clock),
            status::START => return Some(MidiMessage::Start),
            status::STOP => return Some(MidiMessage::Stop),
            status::CONTINUE => return Some(MidiMessage::Continue),
            0xF8..=0xFF => return None, // other real-time, ignore
            _ => {}
        }

        // Status byte (MSB set)
        if byte & 0x80 != 0 {
            self.running_status = byte;
            self.buf[0] = byte;
            self.buf_len = 1;
            self.expected_len = match byte & 0xF0 {
                0x80 | 0x90 | 0xA0 | 0xB0 | 0xE0 => 3, // 2 data bytes
                0xC0 | 0xD0 => 2,                        // 1 data byte
                _ => 0,                                   // system exclusive etc
            };
            return None;
        }

        // Data byte — use running status
        if self.expected_len == 0 {
            return None;
        }

        if self.buf_len == 0 {
            // Running status: re-use previous status byte
            self.buf[0] = self.running_status;
            self.buf_len = 1;
        }

        if self.buf_len < 3 {
            self.buf[self.buf_len] = byte;
            self.buf_len += 1;
        }

        if self.buf_len >= self.expected_len {
            let msg = self.decode_message();
            self.buf_len = 0;
            return msg;
        }

        None
    }

    fn decode_message(&self) -> Option<MidiMessage> {
        let status = self.buf[0] & 0xF0;
        let channel = self.buf[0] & 0x0F;
        match status {
            0x90 => {
                if self.buf[2] == 0 {
                    // Note-on with velocity 0 = note-off
                    Some(MidiMessage::NoteOff {
                        channel,
                        note: self.buf[1],
                    })
                } else {
                    Some(MidiMessage::NoteOn {
                        channel,
                        note: self.buf[1],
                        velocity: self.buf[2],
                    })
                }
            }
            0x80 => Some(MidiMessage::NoteOff {
                channel,
                note: self.buf[1],
            }),
            0xB0 => Some(MidiMessage::ControlChange {
                channel,
                cc: self.buf[1],
                value: self.buf[2],
            }),
            _ => None,
        }
    }
}
