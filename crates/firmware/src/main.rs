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

extern crate alloc;

use embedded_alloc::LlffHeap as Heap;

#[global_allocator]
static HEAP: Heap = Heap::empty();

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
use embassy_time::Instant;
use panic_probe as _;

use requencer_engine::clock_divider::TICKS_PER_STEP;
use requencer_engine::input::ControlEvent;
use requencer_engine::mode_machine;
use requencer_engine::sequencer;
use requencer_engine::types::{ClockSource, SequencerState};
use requencer_engine::ui_types::UiState;

use static_cell::StaticCell;

// ── Shared state via static cells ──────────────────────────────────

/// Event queue: input tasks push events, main loop consumes them.
static EVENT_CHANNEL: StaticCell<embassy_sync::channel::Channel<
    embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex,
    ControlEvent,
    32,
>> = StaticCell::new();

// ── Main entry point ───────────────────────────────────────────────

#[embassy_executor::main]
async fn main(_spawner: Spawner) {
    // Initialize heap allocator (16 KB — used by postcard alloc for serialization)
    {
        use core::mem::MaybeUninit;
        const HEAP_SIZE: usize = 16 * 1024;
        static mut HEAP_MEM: [MaybeUninit<u8>; HEAP_SIZE] = [MaybeUninit::uninit(); HEAP_SIZE];
        #[allow(static_mut_refs)]
        unsafe { HEAP.init(HEAP_MEM.as_ptr() as usize, HEAP_SIZE) }
    }

    info!("Requencer firmware starting");

    let p = embassy_rp::init(Default::default());

    // ── SPI0: Display + SD card (shared bus) ───────────────────────

    let mut spi0_config = spi::Config::default();
    spi0_config.frequency = 62_500_000; // ST7796 max write speed

    // RP2350 SPI0 function assignments: GP2=CLK, GP3=MOSI, GP0=MISO
    // Note: PCB schematic says GP0=MOSI, GP3=DC but RP2350 GPIO function
    // select requires GP3=MOSI. Schematic needs updating before manufacture.
    // Using correct RP2350 pin functions here:
    //   GP2 = SPI0_SCK, GP3 = SPI0_MOSI (TX), GP0 = SPI0_MISO (RX)
    //   GP1 = LCD CS (GPIO), GP7 = LCD DC (GPIO, moved from GP3), GP5 = backlight
    let spi0 = Spi::new_blocking(
        p.SPI0,
        p.PIN_2,  // SCK
        p.PIN_3,  // MOSI (TX to LCD + SD)
        p.PIN_0,  // MISO (RX from SD)
        spi0_config,
    );

    let lcd_cs = Output::new(p.PIN_1, Level::High);
    let lcd_dc = Output::new(p.PIN_7, Level::Low); // Moved to GP7 (spare) since GP3 is SPI0_MOSI
    let lcd_backlight = Output::new(p.PIN_5, Level::Low);

    let mut display_hw = display::Display::new(spi0, lcd_cs, lcd_dc, lcd_backlight);
    display_hw.init().await;

    // SD card pins (storage module)
    let sd_cs = Output::new(p.PIN_24, Level::High);
    let sd_detect = Input::new(p.PIN_25, Pull::Up);
    let _sd_storage = storage::SdStorage::new(sd_cs, sd_detect);

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
    // Note: PCB schematic says GP21/GP22 but RP2350 requires GP20/GP21 for UART1.
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

    // ── Event channel ──────────────────────────────────────────────

    let _event_channel = EVENT_CHANNEL.init(embassy_sync::channel::Channel::new());

    // ── Spawn input tasks ──────────────────────────────────────────

    // We pass the hardware into static cells so spawned tasks can own them.
    // For simplicity in this initial implementation, we run everything
    // in the main loop rather than spawning separate tasks. This avoids
    // the complexity of static lifetime requirements for spawned tasks.
    // The main loop runs fast enough for all timing requirements.

    // ── Engine state ───────────────────────────────────────────────

    let mut state = SequencerState::new();
    state.apply_default_presets();
    let mut ui = UiState::default();
    let mut framebuffer = display::Framebuffer::new();
    let mut gate_state = [false; 4];

    // MIDI channel assignment: outputs 0-3 → MIDI channels 1-4
    let midi_channels: [u8; 4] = [0, 1, 2, 3];

    info!("Engine state initialized, entering main loop");

    // ── Timing ─────────────────────────────────────────────────────

    let mut system_tick: u32 = 0;
    let mut last_frame = Instant::now();
    let mut last_tick = Instant::now();
    let mut last_scan = Instant::now();
    let mut last_enc = Instant::now();

    // ── Main loop ──────────────────────────────────────────────────

    loop {
        let now = Instant::now();

        // ── 1. Engine tick (BPM-driven or external clock) ──────────

        let tick_interval_us = if state.transport.clock_source == ClockSource::Internal {
            // period_µs = 60_000_000 / (BPM × TICKS_PER_STEP)
            // At 120 BPM, 6 TPQS: 60M / (120*6) = 83333 µs per tick
            60_000_000u64 / (state.transport.bpm as u64 * TICKS_PER_STEP as u64)
        } else {
            0 // External clock drives ticks
        };

        let should_tick = if state.transport.playing {
            if state.transport.clock_source == ClockSource::Internal {
                now.duration_since(last_tick).as_micros() >= tick_interval_us
            } else {
                clock_io.clock_pulse()
            }
        } else {
            false
        };

        if should_tick {
            last_tick = now;
            let events = sequencer::tick(&mut state);

            // Output to DACs (SPI1 — dedicated bus, no contention)
            dac.update_from_events(&events, &mut gate_state);

            // Output MIDI
            if state.midi_clock_out {
                midi_out.send_clock();
            }
            midi_out.send_events(&events, &midi_channels);

            // Clock output pulse
            // Toggle on every tick for a square wave clock output
            let clock_high = state.transport.master_tick % (TICKS_PER_STEP as u64) == 0;
            clock_io.set_clock_out(clock_high);

            system_tick = system_tick.wrapping_add(1);
        }

        // ── 2. Check external reset ────────────────────────────────

        if clock_io.reset_pulse() {
            state.reset_playheads();
            clock_io.pulse_reset_out();
        }

        // ── 3. Scan buttons (every 5ms = 200 Hz) ──────────────────

        if now.duration_since(last_scan).as_millis() >= 5 {
            last_scan = now;
            let mut btn_events = heapless::Vec::<ControlEvent, 8>::new();
            button_scanner.scan(&mut btn_events);
            for ev in btn_events {
                mode_machine::dispatch(&mut ui, &mut state, ev, system_tick);
            }
        }

        // ── 4. Poll encoders (every 1ms = 1 kHz) ──────────────────

        if now.duration_since(last_enc).as_millis() >= 1 {
            last_enc = now;
            let mut enc_events = heapless::Vec::<ControlEvent, 8>::new();
            encoder_pair.poll(&mut enc_events);
            for ev in enc_events {
                mode_machine::dispatch(&mut ui, &mut state, ev, system_tick);
            }
        }

        // ── 5. Parse incoming MIDI ─────────────────────────────────

        while let Some(msg) = midi_in.try_read() {
            match msg {
                midi::MidiMessage::Clock => {
                    if state.transport.clock_source == ClockSource::External {
                        // External clock drives tick — handled above via clock_pulse
                    }
                }
                midi::MidiMessage::Start => {
                    state.transport.playing = true;
                    state.reset_playheads();
                }
                midi::MidiMessage::Stop => {
                    state.transport.playing = false;
                    midi_out.all_notes_off(&midi_channels);
                    // Turn off all gates
                    for i in 0..4 {
                        dac.set_dac1_channel(i, 0);
                        gate_state[i as usize] = false;
                    }
                }
                midi::MidiMessage::Continue => {
                    state.transport.playing = true;
                }
                _ => {}
            }
        }

        // ── 6. Render display (~30 fps) ────────────────────────────

        if now.duration_since(last_frame).as_millis() >= 33 {
            last_frame = now;

            // Render to framebuffer using the renderer crate
            requencer_renderer::render(&mut framebuffer, &state, &ui);

            // Flush framebuffer to display via SPI0
            display_hw.flush(&framebuffer);

            // Update LEDs
            let led_state = mode_machine::get_led_state(&ui, &state);
            led_driver.update(&led_state, ui.selected_track);
        }

        // ── 7. Yield to embassy executor ───────────────────────────

        // Short yield to allow other tasks and interrupts to run.
        // In practice this loop runs at ~1kHz (limited by encoder polling).
        embassy_futures::yield_now().await;
    }
}

