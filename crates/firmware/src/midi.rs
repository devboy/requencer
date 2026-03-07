//! UART MIDI in/out at 31250 baud.
//!
//! TX: Convert NoteEvent to MIDI note-on/note-off messages.
//! RX: Parse incoming MIDI bytes, extract clock/start/stop for external sync.
//! Uses UART1 on GP20(TX)/GP21(RX).

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

/// MIDI CC numbers.
mod cc {
    /// Modulation wheel (CC 1) — used for mod output.
    pub const MODULATION: u8 = 1;
}

/// MIDI transmitter.
pub struct MidiTx<'d> {
    uart: UartTx<'d, embassy_rp::uart::Async>,
    /// Track which notes are currently on per output (for note-off).
    active_notes: [Option<u8>; 4],
}

impl<'d> MidiTx<'d> {
    pub fn new(uart: UartTx<'d, embassy_rp::uart::Async>) -> Self {
        Self {
            uart,
            active_notes: [None; 4],
        }
    }

    /// Send MIDI messages for engine events.
    ///
    /// Each output maps to a MIDI channel (1-4).
    pub async fn send_events(
        &mut self,
        events: &[Option<NoteEvent>; 4],
        channels: &[u8; 4],
    ) {
        for (i, event) in events.iter().enumerate() {
            let ch = (channels[i] - 1) & 0x0F; // MIDI channel 0-indexed

            if let Some(e) = event {
                // Send note-off for previous note if different
                if let Some(prev_note) = self.active_notes[i] {
                    if prev_note != e.pitch || !e.gate {
                        let msg = [status::NOTE_OFF | ch, prev_note, 0];
                        let _ = self.uart.write(&msg).await;
                        self.active_notes[i] = None;
                    }
                }

                if e.gate {
                    // Note on (velocity is already 0-127)
                    let msg = [status::NOTE_ON | ch, e.pitch.min(127), e.velocity.min(127)];
                    let _ = self.uart.write(&msg).await;
                    self.active_notes[i] = Some(e.pitch);

                    // Modulation CC (modulation is already 0-127)
                    if e.modulation > 0 {
                        let cc_msg = [status::CONTROL_CHANGE | ch, cc::MODULATION, e.modulation.min(127)];
                        let _ = self.uart.write(&cc_msg).await;
                    }
                }
            }
        }
    }

    /// Send MIDI clock byte.
    pub async fn send_clock(&mut self) {
        let _ = self.uart.write(&[status::CLOCK]).await;
    }

    /// Send MIDI start.
    pub async fn send_start(&mut self) {
        let _ = self.uart.write(&[status::START]).await;
    }

    /// Send MIDI stop.
    pub async fn send_stop(&mut self) {
        let _ = self.uart.write(&[status::STOP]).await;
    }
}

/// Parsed MIDI input event.
#[derive(Clone, Copy, Debug)]
pub enum MidiInput {
    Clock,
    Start,
    Stop,
    Continue,
}

/// MIDI receiver — parses incoming bytes for clock/transport.
pub struct MidiRx<'d> {
    uart: UartRx<'d, embassy_rp::uart::Async>,
}

impl<'d> MidiRx<'d> {
    pub fn new(uart: UartRx<'d, embassy_rp::uart::Async>) -> Self {
        Self { uart }
    }

    /// Read and parse one MIDI byte. Returns Some(MidiInput) for clock/transport.
    pub async fn read_event(&mut self) -> Option<MidiInput> {
        let mut buf = [0u8; 1];
        match self.uart.read(&mut buf).await {
            Ok(()) => match buf[0] {
                status::CLOCK => Some(MidiInput::Clock),
                status::START => Some(MidiInput::Start),
                status::STOP => Some(MidiInput::Stop),
                status::CONTINUE => Some(MidiInput::Continue),
                _ => None,
            },
            Err(_) => None,
        }
    }
}

/// Embassy task: read MIDI input and forward clock/transport events.
#[embassy_executor::task]
pub async fn midi_rx_task(
    mut rx: MidiRx<'static>,
    midi_tx: &'static embassy_sync::channel::Channel<
        embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex,
        MidiInput,
        8,
    >,
) {
    loop {
        if let Some(event) = rx.read_event().await {
            midi_tx.send(event).await;
        }
    }
}
