//! MIDI I/O over UART1 at 31250 baud.
//!
//! Pin assignment: GP20 = UART1_TX (MIDI OUT), GP21 = UART1_RX (MIDI IN).
//! Note: The PCB schematic lists GP21/GP22, but RP2350 GPIO function mapping
//! requires GP20/GP21 for UART1. The schematic should be updated accordingly.

#[cfg(target_os = "none")]
use embassy_rp::uart::{UartRx, UartTx};
#[cfg(target_os = "none")]
use requencer_engine::types::NoteEvent;

/// MIDI status bytes.
pub mod status {
    pub const NOTE_OFF: u8 = 0x80;
    pub const NOTE_ON: u8 = 0x90;
    pub const CONTROL_CHANGE: u8 = 0xB0;
    pub const CLOCK: u8 = 0xF8;
    pub const START: u8 = 0xFA;
    pub const STOP: u8 = 0xFC;
    pub const CONTINUE: u8 = 0xFB;
}

/// CC numbers for modulation and velocity.
pub mod cc {
    pub const MOD_WHEEL: u8 = 1;
}

/// Parsed MIDI input messages we care about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MidiMessage {
    Clock,
    Start,
    Stop,
    Continue,
    NoteOn { channel: u8, note: u8, velocity: u8 },
    NoteOff { channel: u8, note: u8 },
    ControlChange { channel: u8, cc: u8, value: u8 },
}

/// Pure MIDI parser state machine — no hardware dependencies.
/// Handles running status, system real-time interleaving, and message decoding.
pub struct MidiParser {
    running_status: u8,
    buf: [u8; 3],
    buf_len: usize,
    expected_len: usize,
}

impl MidiParser {
    pub const fn new() -> Self {
        Self {
            running_status: 0,
            buf: [0; 3],
            buf_len: 0,
            expected_len: 0,
        }
    }

    /// Feed a byte to the parser. Returns a message if one is complete.
    pub fn parse_byte(&mut self, byte: u8) -> Option<MidiMessage> {
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
        let status_nibble = self.buf[0] & 0xF0;
        let channel = self.buf[0] & 0x0F;
        match status_nibble {
            0x90 => {
                if self.buf[2] == 0 {
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

/// MIDI output — sends note and clock messages.
#[cfg(target_os = "none")]
pub struct MidiOut<'a> {
    tx: UartTx<'a, embassy_rp::peripherals::UART1, embassy_rp::uart::Blocking>,
    active_notes: [Option<u8>; 4],
}

#[cfg(target_os = "none")]
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

    pub fn send_clock(&mut self) {
        self.send(&[status::CLOCK]);
    }

    pub fn send_start(&mut self) {
        self.send(&[status::START]);
    }

    pub fn send_stop(&mut self) {
        self.send(&[status::STOP]);
    }

    pub fn send_continue(&mut self) {
        self.send(&[status::CONTINUE]);
    }

    pub fn send_events(
        &mut self,
        events: &[Option<NoteEvent>; 4],
        channels: &[u8; 4],
    ) {
        for (i, event) in events.iter().enumerate() {
            let ch = channels[i] & 0x0F;

            if let Some(ev) = event {
                if let Some(prev_note) = self.active_notes[i] {
                    if !ev.sustain || prev_note != ev.pitch || ev.retrigger {
                        self.send(&[status::NOTE_OFF | ch, prev_note, 0]);
                        self.active_notes[i] = None;
                    }
                }

                if ev.gate {
                    self.send(&[
                        status::CONTROL_CHANGE | ch,
                        cc::MOD_WHEEL,
                        ev.modulation.min(127),
                    ]);
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

    pub fn all_notes_off(&mut self, channels: &[u8; 4]) {
        for (i, &ch) in channels.iter().enumerate() {
            if let Some(note) = self.active_notes[i] {
                self.send(&[status::NOTE_OFF | (ch & 0x0F), note, 0]);
                self.active_notes[i] = None;
            }
        }
    }
}

/// MIDI input — wraps parser with UART hardware.
#[cfg(target_os = "none")]
pub struct MidiIn<'a> {
    rx: UartRx<'a, embassy_rp::peripherals::UART1, embassy_rp::uart::Blocking>,
    parser: MidiParser,
}

#[cfg(target_os = "none")]
impl<'a> MidiIn<'a> {
    pub fn new(
        rx: UartRx<'a, embassy_rp::peripherals::UART1, embassy_rp::uart::Blocking>,
    ) -> Self {
        Self {
            rx,
            parser: MidiParser::new(),
        }
    }

    pub fn try_read(&mut self) -> Option<MidiMessage> {
        let mut byte = [0u8; 1];
        if self.rx.blocking_read(&mut byte).is_err() {
            return None;
        }
        self.parser.parse_byte(byte[0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── System real-time messages ─────────────────────────────────────

    #[test]
    fn parse_clock() {
        let mut p = MidiParser::new();
        assert_eq!(p.parse_byte(0xF8), Some(MidiMessage::Clock));
    }

    #[test]
    fn parse_start() {
        let mut p = MidiParser::new();
        assert_eq!(p.parse_byte(0xFA), Some(MidiMessage::Start));
    }

    #[test]
    fn parse_stop() {
        let mut p = MidiParser::new();
        assert_eq!(p.parse_byte(0xFC), Some(MidiMessage::Stop));
    }

    #[test]
    fn parse_continue() {
        let mut p = MidiParser::new();
        assert_eq!(p.parse_byte(0xFB), Some(MidiMessage::Continue));
    }

    #[test]
    fn parse_other_realtime_ignored() {
        let mut p = MidiParser::new();
        // Active Sensing (0xFE) and others should be None
        assert_eq!(p.parse_byte(0xFE), None);
        assert_eq!(p.parse_byte(0xFF), None);
        assert_eq!(p.parse_byte(0xF9), None);
    }

    // ── Note On/Off messages ──────────────────────────────────────────

    #[test]
    fn parse_note_on() {
        let mut p = MidiParser::new();
        assert_eq!(p.parse_byte(0x90), None); // Note On, channel 0
        assert_eq!(p.parse_byte(60), None);   // Note C4
        assert_eq!(
            p.parse_byte(100),               // Velocity 100
            Some(MidiMessage::NoteOn { channel: 0, note: 60, velocity: 100 })
        );
    }

    #[test]
    fn parse_note_on_channel_15() {
        let mut p = MidiParser::new();
        p.parse_byte(0x9F); // Note On, channel 15
        p.parse_byte(64);
        assert_eq!(
            p.parse_byte(127),
            Some(MidiMessage::NoteOn { channel: 15, note: 64, velocity: 127 })
        );
    }

    #[test]
    fn parse_note_off() {
        let mut p = MidiParser::new();
        p.parse_byte(0x80); // Note Off, channel 0
        p.parse_byte(60);
        assert_eq!(
            p.parse_byte(0),
            Some(MidiMessage::NoteOff { channel: 0, note: 60 })
        );
    }

    #[test]
    fn parse_note_on_velocity_zero_is_note_off() {
        let mut p = MidiParser::new();
        p.parse_byte(0x90); // Note On, channel 0
        p.parse_byte(60);
        assert_eq!(
            p.parse_byte(0),   // Velocity 0 → note off
            Some(MidiMessage::NoteOff { channel: 0, note: 60 })
        );
    }

    // ── Control Change ────────────────────────────────────────────────

    #[test]
    fn parse_cc() {
        let mut p = MidiParser::new();
        p.parse_byte(0xB0); // CC, channel 0
        p.parse_byte(1);    // CC#1 (mod wheel)
        assert_eq!(
            p.parse_byte(64),
            Some(MidiMessage::ControlChange { channel: 0, cc: 1, value: 64 })
        );
    }

    // ── Running status ────────────────────────────────────────────────

    #[test]
    fn running_status_note_on() {
        let mut p = MidiParser::new();
        // First note with status
        p.parse_byte(0x90);
        p.parse_byte(60);
        assert_eq!(
            p.parse_byte(100),
            Some(MidiMessage::NoteOn { channel: 0, note: 60, velocity: 100 })
        );

        // Second note uses running status (no status byte)
        p.parse_byte(64);
        assert_eq!(
            p.parse_byte(80),
            Some(MidiMessage::NoteOn { channel: 0, note: 64, velocity: 80 })
        );
    }

    #[test]
    fn running_status_cc() {
        let mut p = MidiParser::new();
        p.parse_byte(0xB3); // CC, channel 3
        p.parse_byte(7);    // CC#7 (volume)
        assert_eq!(
            p.parse_byte(100),
            Some(MidiMessage::ControlChange { channel: 3, cc: 7, value: 100 })
        );

        // Running status
        p.parse_byte(1);  // CC#1 (mod wheel)
        assert_eq!(
            p.parse_byte(50),
            Some(MidiMessage::ControlChange { channel: 3, cc: 1, value: 50 })
        );
    }

    // ── Real-time interleaving ────────────────────────────────────────

    #[test]
    fn realtime_during_message() {
        let mut p = MidiParser::new();
        p.parse_byte(0x90); // Note On start
        p.parse_byte(60);   // Note number

        // Clock arrives mid-message
        assert_eq!(p.parse_byte(0xF8), Some(MidiMessage::Clock));

        // Complete the note-on (should still work)
        assert_eq!(
            p.parse_byte(100),
            Some(MidiMessage::NoteOn { channel: 0, note: 60, velocity: 100 })
        );
    }

    #[test]
    fn multiple_realtime_during_message() {
        let mut p = MidiParser::new();
        p.parse_byte(0x90);
        assert_eq!(p.parse_byte(0xF8), Some(MidiMessage::Clock));
        p.parse_byte(60);
        assert_eq!(p.parse_byte(0xF8), Some(MidiMessage::Clock));
        assert_eq!(
            p.parse_byte(100),
            Some(MidiMessage::NoteOn { channel: 0, note: 60, velocity: 100 })
        );
    }

    // ── Status change mid-stream ──────────────────────────────────────

    #[test]
    fn status_change_aborts_previous() {
        let mut p = MidiParser::new();
        p.parse_byte(0x90); // Note On
        p.parse_byte(60);   // Note (waiting for velocity)

        // New status byte interrupts
        p.parse_byte(0xB0); // CC
        p.parse_byte(1);    // CC#1
        assert_eq!(
            p.parse_byte(64),
            Some(MidiMessage::ControlChange { channel: 0, cc: 1, value: 64 })
        );
    }

    // ── Data without status ───────────────────────────────────────────

    #[test]
    fn data_without_prior_status_ignored() {
        let mut p = MidiParser::new();
        // Data bytes without any prior status should be ignored
        assert_eq!(p.parse_byte(60), None);
        assert_eq!(p.parse_byte(100), None);
    }

    // ── Program Change (1 data byte) ─────────────────────────────────

    #[test]
    fn program_change_expected_length() {
        let mut p = MidiParser::new();
        p.parse_byte(0xC0); // Program Change, channel 0
        // Should complete after 1 data byte (but we don't decode it)
        // decode_message returns None for unhandled types
        assert_eq!(p.parse_byte(42), None);
    }

    // ── Edge cases ────────────────────────────────────────────────────

    #[test]
    fn all_channels_parsed_correctly() {
        for ch in 0..16u8 {
            let mut p = MidiParser::new();
            p.parse_byte(0x90 | ch);
            p.parse_byte(60);
            let msg = p.parse_byte(100).unwrap();
            match msg {
                MidiMessage::NoteOn { channel, .. } => assert_eq!(channel, ch),
                _ => panic!("expected NoteOn"),
            }
        }
    }

    #[test]
    fn note_off_all_channels() {
        for ch in 0..16u8 {
            let mut p = MidiParser::new();
            p.parse_byte(0x80 | ch);
            p.parse_byte(60);
            let msg = p.parse_byte(64).unwrap();
            match msg {
                MidiMessage::NoteOff { channel, note } => {
                    assert_eq!(channel, ch);
                    assert_eq!(note, 60);
                }
                _ => panic!("expected NoteOff"),
            }
        }
    }

    #[test]
    fn rapid_note_sequence() {
        let mut p = MidiParser::new();
        p.parse_byte(0x90); // Note On ch0

        // Play 5 notes in sequence using running status
        for note in [60, 62, 64, 65, 67] {
            p.parse_byte(note);
            let msg = p.parse_byte(100).unwrap();
            assert_eq!(
                msg,
                MidiMessage::NoteOn { channel: 0, note, velocity: 100 }
            );
        }
    }
}
