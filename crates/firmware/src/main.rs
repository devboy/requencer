//! Requencer firmware — RP2350B (PGA2350) embedded target.
//!
//! 4-track eurorack sequencer. Uses embassy async runtime for cooperative
//! multitasking across display, input scanning, and audio output.
//!
//! ## Architecture
//!
//! **Priority 0 (highest):** Hardware timer ISR → engine tick → DAC write (SPI1)
//! **Priority 1:** External clock input ISR → sync tick counter
//! **Priority 2:** Button scan (200 Hz), encoder poll (1 kHz)
//! **Priority 3:** Display render (~30 fps, SPI0), LED update, MIDI TX
//!
//! SPI0 = display + SD card (shared, firmware-arbitrated).
//! SPI1 = DACs (dedicated bus, via 74HCT125 level shifter, zero contention).

#![no_std]
#![no_main]

#[allow(dead_code)]
mod buttons;
mod clock_io;
#[allow(dead_code)]
mod dac;
mod display;
mod encoders;
mod leds;
#[allow(dead_code)]
mod midi;
#[allow(dead_code)]
mod pins;
#[allow(dead_code)]
mod storage;

use defmt::*;
use defmt_rtt as _;
use embassy_executor::Spawner;
use embassy_rp::gpio::{Input, Level, Output, Pull};
use embassy_rp::spi::{self, Spi};
use embassy_rp::uart;
use embassy_rp::watchdog::Watchdog;
use embassy_time::{Duration, Instant};
use panic_probe as _;

use requencer_engine::clock_divider::TICKS_PER_STEP;
use requencer_engine::input::ControlEvent;
use requencer_engine::mode_machine;
use requencer_engine::sequencer;
use requencer_engine::types::{ClockSource, SequencerState};
use requencer_engine::ui_types::UiState;

// ── Main entry point ───────────────────────────────────────────────

#[embassy_executor::main]
async fn main(_spawner: Spawner) {
    info!("Requencer firmware starting");

    let p = embassy_rp::init(Default::default());

    // ── Watchdog (8 second timeout) ─────────────────────────────────
    // Resets the processor if the main loop stalls for > 8 seconds.
    // Fed at the end of each main loop iteration.
    let mut watchdog = Watchdog::new(p.WATCHDOG);
    watchdog.pause_on_debug(true); // Don't reset while debugging
    watchdog.start(Duration::from_secs(8));
    info!("Watchdog started (8s timeout)");

    // ── SPI0: Display + SD card (shared bus) ───────────────────────

    let mut spi0_config = spi::Config::default();
    spi0_config.frequency = 62_500_000; // ST7796 max write speed

    // RP2350 SPI0 function assignments: GP2=CLK, GP3=MOSI, GP0=MISO
    // Note: PCB schematic says GP0=MOSI, GP3=DC but RP2350 GPIO function
    // select requires GP3=MOSI. Schematic needs updating before manufacture.
    let mut spi0 = Spi::new_blocking(
        p.SPI0,
        p.PIN_2,  // SCK
        p.PIN_3,  // MOSI (TX to LCD + SD)
        p.PIN_0,  // MISO (RX from SD)
        spi0_config,
    );

    let lcd_cs = Output::new(p.PIN_1, Level::High);
    let lcd_dc = Output::new(p.PIN_7, Level::Low);
    let lcd_backlight = Output::new(p.PIN_5, Level::Low);

    let mut display_hw = display::Display::new(lcd_cs, lcd_dc, lcd_backlight);
    display_hw.init(&mut spi0).await;

    // SD card pins
    let sd_cs = Output::new(p.PIN_24, Level::High);
    let sd_detect = Input::new(p.PIN_25, Pull::Up);
    let mut sd_storage = storage::SdStorage::new(sd_cs, sd_detect);

    // ── SPI1: DACs (dedicated bus, via 74HCT125) ───────────────────

    let mut spi1_config = spi::Config::default();
    spi1_config.frequency = 50_000_000; // DAC8568 max

    // RP2350 SPI1 function assignments: GP30=CLK, GP31=MOSI
    let spi1 = Spi::new_blocking_txonly(
        p.SPI1,
        p.PIN_30, // SCK
        p.PIN_31, // MOSI (TX to DACs via 74HCT125)
        spi1_config,
    );

    let dac1_cs = Output::new(p.PIN_32, Level::High);
    let dac2_cs = Output::new(p.PIN_33, Level::High);

    let mut dac = dac::DacOutput::new(spi1, dac1_cs, dac2_cs);
    dac.init();
    info!("DACs initialized");

    // ── Button shift registers ─────────────────────────────────────

    let btn_clk = Output::new(p.PIN_8, Level::Low);
    let btn_latch = Output::new(p.PIN_9, Level::High);
    let btn_data = Input::new(p.PIN_10, Pull::Down);
    let mut button_scanner = buttons::ButtonScanner::new(btn_clk, btn_latch, btn_data);

    // ── LED drivers ────────────────────────────────────────────────

    let led_sin = Output::new(p.PIN_11, Level::Low);
    let led_sclk = Output::new(p.PIN_12, Level::Low);
    let led_xlat = Output::new(p.PIN_13, Level::Low);
    let led_blank = Output::new(p.PIN_14, Level::High); // Start with outputs disabled
    let mut led_driver = leds::LedDriver::new(led_sin, led_sclk, led_xlat, led_blank);
    led_driver.init();
    info!("LED drivers initialized");

    // ── Encoders ───────────────────────────────────────────────────

    let enc_a_a = Input::new(p.PIN_15, Pull::Up);
    let enc_a_b = Input::new(p.PIN_16, Pull::Up);
    let enc_a_push = Input::new(p.PIN_17, Pull::Up);
    let enc_b_a = Input::new(p.PIN_18, Pull::Up);
    let enc_b_b = Input::new(p.PIN_19, Pull::Up);
    // GP20 is reassigned to UART1_TX (MIDI), so encoder B push moves to GP6 (spare)
    let enc_b_push = Input::new(p.PIN_6, Pull::Up);
    let mut encoder_pair = encoders::EncoderPair::new(
        enc_a_a, enc_a_b, enc_a_push, enc_b_a, enc_b_b, enc_b_push,
    );

    // ── MIDI UART ──────────────────────────────────────────────────

    let mut uart_config = uart::Config::default();
    uart_config.baudrate = 31250;

    // UART1: GP20=TX, GP21=RX (RP2350 function select for UART1)
    let uart = uart::Uart::new_blocking(
        p.UART1,
        p.PIN_20, // TX (MIDI OUT via 220Ω)
        p.PIN_21, // RX (MIDI IN via 6N138 optocoupler)
        uart_config,
    );
    let (uart_tx, uart_rx) = uart.split();
    let mut midi_out = midi::MidiOut::new(uart_tx);
    let mut midi_in = midi::MidiIn::new(uart_rx);
    info!("MIDI UART initialized at 31250 baud");

    // ── Clock/Reset I/O ────────────────────────────────────────────

    let clock_in = Input::new(p.PIN_26, Pull::Down);
    let reset_in = Input::new(p.PIN_27, Pull::Down);
    let clock_out = Output::new(p.PIN_28, Level::High); // Inverted: high GPIO = low output
    let reset_out = Output::new(p.PIN_4, Level::High);
    let mut clock_io = clock_io::ClockIo::new(clock_in, reset_in, clock_out, reset_out);

    // ── Engine state ───────────────────────────────────────────────

    let mut state = SequencerState::new();
    state.apply_default_presets();

    // Try to load saved state from SD card
    if sd_storage.is_card_present() {
        info!("SD card detected, attempting state restore");
        let mut buf = [0u8; storage::STATE_BUF_SIZE];
        if let Some(len) = sd_storage.load_state(&mut spi0, &mut buf) {
            match requencer_engine::storage::deserialize_state(&buf[..len]) {
                Ok(restored) => {
                    state = restored;
                    info!("State restored from SD card ({} bytes)", len);
                }
                Err(_) => {
                    warn!("SD state file corrupt, using defaults");
                }
            }
        }
    }

    let mut ui = UiState::default();
    let mut framebuffer = display::Framebuffer::new();
    let mut gate_state = [false; 4];

    // MIDI channel assignment: outputs 0-3 → MIDI channels 1-4
    let midi_channels: [u8; 4] = [0, 1, 2, 3];

    info!("Engine state initialized, entering main loop");

    // ── Timing ─────────────────────────────────────────────────────

    let mut system_tick: u32 = 0;
    let mut last_frame = Instant::now();
    let mut last_scan = Instant::now();
    let mut last_enc = Instant::now();
    let mut last_save = Instant::now();
    let mut state_dirty = false; // Track if state changed since last save

    // Drift-compensating tick scheduler: tracks when the next tick *should* fire.
    // Unlike `last_tick + interval`, this accumulates the exact interval so late
    // ticks don't push subsequent ticks later (eliminates cumulative drift).
    let mut next_tick_at = Instant::now();
    let mut was_playing = false;

    // Clock output pulse: set high on step boundary, clear after 5ms
    let mut clock_pulse_end: Option<Instant> = None;

    // ── Main loop ──────────────────────────────────────────────────

    loop {
        let now = Instant::now();

        // ── 1. Engine tick (BPM-driven, external clock, or MIDI clock) ──

        // Reset tick scheduler on play start to avoid burst of catch-up ticks
        if state.transport.playing && !was_playing {
            next_tick_at = now;
        }
        was_playing = state.transport.playing;

        let tick_interval_us = if state.transport.clock_source == ClockSource::Internal {
            60_000_000u64 / (state.transport.bpm as u64 * TICKS_PER_STEP as u64)
        } else {
            0 // External/MIDI clock drives ticks
        };

        let should_tick = if state.transport.playing {
            match state.transport.clock_source {
                ClockSource::Internal => now >= next_tick_at,
                ClockSource::External => clock_io.clock_pulse(),
                ClockSource::Midi => false, // MIDI clock handled in MIDI parse section
            }
        } else {
            false
        };

        if should_tick {
            // Advance by exact interval (drift-compensating)
            next_tick_at += Duration::from_micros(tick_interval_us);
            // If we fell behind by >100ms (e.g. SD card save stall), reset to now
            if now.duration_since(next_tick_at).as_millis() > 100 {
                next_tick_at = now;
            }
            process_tick(
                &mut state, &mut dac, &mut midi_out, &mut clock_io,
                &mut gate_state, &midi_channels, &mut clock_pulse_end, now,
            );
            system_tick = system_tick.wrapping_add(1);
        }

        // ── 2. Clock output pulse end ───────────────────────────────

        if let Some(end_time) = clock_pulse_end {
            if now >= end_time {
                clock_io.set_clock_out(false);
                clock_pulse_end = None;
            }
        }

        // ── 3. Check external reset ────────────────────────────────

        if clock_io.reset_pulse() {
            state.reset_playheads();
            clock_io.pulse_reset_out();
        }

        // ── 4. Scan buttons (every 5ms = 200 Hz) ──────────────────

        if now.duration_since(last_scan).as_millis() >= 5 {
            last_scan = now;
            let mut btn_events = heapless::Vec::<ControlEvent, 8>::new();
            button_scanner.scan(&mut btn_events);
            for ev in btn_events {
                let was_playing = state.transport.playing;
                mode_machine::dispatch(&mut ui, &mut state, ev, system_tick);
                state_dirty = true;

                // Send MIDI transport messages when play state changes
                if state.transport.playing != was_playing {
                    if state.transport.playing {
                        if state.transport.master_tick == 0 {
                            midi_out.send_start();
                        } else {
                            midi_out.send_continue();
                        }
                    } else {
                        midi_out.send_stop();
                        midi_out.all_notes_off(&midi_channels);
                        for i in 0..4 {
                            dac.set_dac1_channel(i, 0);
                            gate_state[i as usize] = false;
                        }
                    }
                }
            }
        }

        // ── 5. Poll encoders (every 1ms = 1 kHz) ──────────────────

        if now.duration_since(last_enc).as_millis() >= 1 {
            last_enc = now;
            let mut enc_events = heapless::Vec::<ControlEvent, 8>::new();
            encoder_pair.poll(&mut enc_events);
            for ev in enc_events {
                let was_playing = state.transport.playing;
                mode_machine::dispatch(&mut ui, &mut state, ev, system_tick);
                state_dirty = true;

                if state.transport.playing != was_playing {
                    if state.transport.playing {
                        if state.transport.master_tick == 0 {
                            midi_out.send_start();
                        } else {
                            midi_out.send_continue();
                        }
                    } else {
                        midi_out.send_stop();
                        midi_out.all_notes_off(&midi_channels);
                        for i in 0..4 {
                            dac.set_dac1_channel(i, 0);
                            gate_state[i as usize] = false;
                        }
                    }
                }
            }
        }

        // ── 6. Parse incoming MIDI ─────────────────────────────────

        while let Some(msg) = midi_in.try_read() {
            match msg {
                midi::MidiMessage::Clock => {
                    if state.transport.clock_source == ClockSource::Midi
                        && state.transport.playing
                    {
                        // MIDI clock → engine tick
                        process_tick(
                            &mut state, &mut dac, &mut midi_out, &mut clock_io,
                            &mut gate_state, &midi_channels, &mut clock_pulse_end, now,
                        );
                        system_tick = system_tick.wrapping_add(1);
                    }
                }
                midi::MidiMessage::Start => {
                    state.transport.playing = true;
                    state.reset_playheads();
                    info!("MIDI Start received");
                }
                midi::MidiMessage::Stop => {
                    state.transport.playing = false;
                    midi_out.all_notes_off(&midi_channels);
                    for i in 0..4 {
                        dac.set_dac1_channel(i, 0);
                        gate_state[i as usize] = false;
                    }
                    info!("MIDI Stop received");
                }
                midi::MidiMessage::Continue => {
                    state.transport.playing = true;
                    info!("MIDI Continue received");
                }
                midi::MidiMessage::NoteOn { channel, note, velocity } => {
                    // MIDI note input: could be used for live transpose or step recording
                    // Currently logged — engine ControlEvent doesn't have MIDI note variants yet
                    debug!("MIDI NoteOn ch={} note={} vel={}", channel, note, velocity);
                }
                midi::MidiMessage::NoteOff { channel, note } => {
                    debug!("MIDI NoteOff ch={} note={}", channel, note);
                }
                midi::MidiMessage::ControlChange { channel, cc, value } => {
                    debug!("MIDI CC ch={} cc={} val={}", channel, cc, value);
                }
            }
        }

        // ── 7. Render display (~30 fps) ────────────────────────────

        if now.duration_since(last_frame).as_millis() >= 33 {
            last_frame = now;

            requencer_renderer::render(&mut framebuffer, &state, &ui);
            display_hw.flush(&mut spi0, &framebuffer);

            let led_state = mode_machine::get_led_state(&ui, &state);
            led_driver.update(&led_state, ui.selected_track);
        }

        // ── 8. Periodic state save (every 30s if changed) ────────

        if state_dirty && now.duration_since(last_save).as_secs() >= 30 {
            last_save = now;
            state_dirty = false;

            if sd_storage.is_card_present() && !state.transport.playing {
                // Only save when stopped to avoid timing disruption
                let mut buf = [0u8; storage::STATE_BUF_SIZE];
                if let Ok(bytes) = requencer_engine::storage::serialize_state(&state, &mut buf) {
                    let len = bytes.len();
                    if sd_storage.save_state(&mut spi0, &buf[..len]) {
                        info!("State auto-saved to SD card");
                    }
                }
            }
        }

        // ── 9. Feed watchdog ───────────────────────────────────────

        watchdog.feed();

        // ── 10. Yield to embassy executor ──────────────────────────

        embassy_futures::yield_now().await;
    }
}

/// Process a single engine tick: run sequencer, update DACs, send MIDI, pulse clock.
fn process_tick(
    state: &mut SequencerState,
    dac: &mut dac::DacOutput<'_>,
    midi_out: &mut midi::MidiOut<'_>,
    clock_io: &mut clock_io::ClockIo<'_>,
    gate_state: &mut [bool; 4],
    midi_channels: &[u8; 4],
    clock_pulse_end: &mut Option<Instant>,
    now: Instant,
) {
    let events = sequencer::tick(state);

    // Output to DACs
    dac.update_from_events(&events, gate_state);

    // Output MIDI
    if state.midi_clock_out {
        midi_out.send_clock();
    }
    midi_out.send_events(&events, midi_channels);

    // Clock output: 5ms pulse on step boundaries
    if state.transport.master_tick % (TICKS_PER_STEP as u64) == 0 {
        clock_io.set_clock_out(true);
        *clock_pulse_end = Some(now + Duration::from_millis(5));
    }
}

