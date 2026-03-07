//! Requencer firmware — RP2350 (PGA2350) embedded target.
//!
//! Embassy async runtime driving all hardware peripherals.
//! Generic drivers come from the lib; this file wires them to
//! concrete embassy-rp types and defines async tasks.

#![no_std]
#![no_main]

extern crate alloc;

use embedded_alloc::LlffHeap as Heap;

#[global_allocator]
static HEAP: Heap = Heap::empty();

// Hardware-only modules (not in lib — depend on embassy/mipidsi)
mod display;
mod midi;
mod cv_input;

// Re-export lib modules for local use
use requencer_firmware::{buttons, clock_io, dac, encoders, leds, pins, tick};

use defmt::*;
use embassy_executor::Spawner;
use embassy_rp::gpio::{Input, Level, Output, Pull};
use embassy_rp::spi::{self, Spi};
use embassy_rp::uart;
use embassy_rp::{bind_interrupts, peripherals};
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::channel::Channel;
use embassy_sync::mutex::Mutex;
use embassy_time::{Delay, Duration, Timer};
use requencer_engine::input::ControlEvent;
use requencer_engine::sequencer::tick as engine_tick;
use requencer_engine::types::SequencerState;
use requencer_renderer::types::UiState;
use static_cell::StaticCell;

use {defmt_rtt as _, panic_probe as _};

bind_interrupts!(struct Irqs {
    UART1_IRQ => uart::InterruptHandler<peripherals::UART1>;
});

/// Shared state between tasks (engine + UI).
pub struct SharedState {
    pub sequencer: SequencerState,
    pub ui: UiState,
    pub system_tick: u32,
}

// ── Type aliases for concrete driver instances ─────────────────────

type DacDriver = dac::Dac<
    Spi<'static, peripherals::SPI1, embassy_rp::spi::Blocking>,
    Output<'static>,
    Output<'static>,
>;

type ButtonScannerDriver = buttons::ButtonScanner<
    Output<'static>,
    Output<'static>,
    Input<'static>,
>;

type LedDriverType = leds::LedDriver<
    Output<'static>,
    Output<'static>,
    Output<'static>,
    Output<'static>,
>;

type ClockOutputDriver = clock_io::ClockOutput<Output<'static>, Output<'static>>;

// ── Static allocations ──────────────────────────────────────────────

static STATE: StaticCell<Mutex<CriticalSectionRawMutex, SharedState>> = StaticCell::new();
static EVENT_CHANNEL: StaticCell<Channel<CriticalSectionRawMutex, ControlEvent, 16>> =
    StaticCell::new();
static MIDI_CHANNEL: StaticCell<Channel<CriticalSectionRawMutex, midi::MidiInput, 8>> =
    StaticCell::new();
static DAC: StaticCell<Mutex<CriticalSectionRawMutex, DacDriver>> = StaticCell::new();
static CLOCK_OUT: StaticCell<Mutex<CriticalSectionRawMutex, ClockOutputDriver>> =
    StaticCell::new();
static LED_DRIVER: StaticCell<Mutex<CriticalSectionRawMutex, LedDriverType>> = StaticCell::new();

// ── Embassy async tasks ─────────────────────────────────────────────

#[embassy_executor::task]
async fn button_task(
    mut scanner: ButtonScannerDriver,
    event_tx: &'static Channel<CriticalSectionRawMutex, ControlEvent, 16>,
) {
    loop {
        let events = scanner.scan();
        for ev in events {
            event_tx.send(ev).await;
        }
        Timer::after(Duration::from_micros(pins::BUTTON_SCAN_US)).await;
    }
}

#[embassy_executor::task]
async fn encoder_task(
    enc_a_phase_a: Input<'static>,
    enc_a_phase_b: Input<'static>,
    enc_a_sw: Input<'static>,
    enc_b_phase_a: Input<'static>,
    enc_b_phase_b: Input<'static>,
    enc_b_sw: Input<'static>,
    event_tx: &'static Channel<CriticalSectionRawMutex, ControlEvent, 16>,
) {
    let mut dec_a = encoders::QuadratureDecoder::new();
    let mut dec_b = encoders::QuadratureDecoder::new();
    let mut sw_a_prev = false;
    let mut sw_b_prev = false;

    loop {
        let delta_a = dec_a.update(enc_a_phase_a.is_high(), enc_a_phase_b.is_high());
        let delta_b = dec_b.update(enc_b_phase_a.is_high(), enc_b_phase_b.is_high());

        if delta_a != 0 {
            event_tx
                .send(ControlEvent::EncoderATurn { delta: delta_a })
                .await;
        }
        let sw_a = enc_a_sw.is_low(); // active low
        if sw_a && !sw_a_prev {
            event_tx.send(ControlEvent::EncoderAPush).await;
        }
        sw_a_prev = sw_a;

        if delta_b != 0 {
            event_tx
                .send(ControlEvent::EncoderBTurn { delta: delta_b })
                .await;
        }
        let sw_b = enc_b_sw.is_low();
        if sw_b && !sw_b_prev {
            event_tx.send(ControlEvent::EncoderBPush).await;
        }
        sw_b_prev = sw_b;

        Timer::after(Duration::from_micros(pins::ENCODER_POLL_US)).await;
    }
}

#[embassy_executor::task]
async fn led_task(
    led_driver: &'static Mutex<CriticalSectionRawMutex, LedDriverType>,
    state_mutex: &'static Mutex<CriticalSectionRawMutex, SharedState>,
) {
    let mut flash_counter: u8 = 0;
    loop {
        let led_state;
        let selected_track;
        {
            let shared = state_mutex.lock().await;
            led_state =
                requencer_engine::mode_machine::get_led_state(&shared.ui, &shared.sequencer);
            selected_track = shared.ui.selected_track;
        }
        {
            let mut driver = led_driver.lock().await;
            flash_counter += 1;
            if flash_counter >= 8 {
                flash_counter = 0;
                driver.toggle_flash();
            }
            driver.apply_state(&led_state, selected_track);
            driver.flush();
        }
        Timer::after(Duration::from_millis(pins::LED_UPDATE_MS)).await;
    }
}

#[embassy_executor::task]
async fn tick_task(
    state_mutex: &'static Mutex<CriticalSectionRawMutex, SharedState>,
    dac_mutex: &'static Mutex<CriticalSectionRawMutex, DacDriver>,
    clock_out_mutex: &'static Mutex<CriticalSectionRawMutex, ClockOutputDriver>,
) {
    let mut clock_toggle = false;
    loop {
        let (events, bpm, playing);
        {
            let mut shared = state_mutex.lock().await;
            if shared.sequencer.transport.playing {
                events = engine_tick(&mut shared.sequencer);
                bpm = shared.sequencer.transport.bpm;
                playing = true;
            } else {
                events = [None, None, None, None];
                bpm = shared.sequencer.transport.bpm;
                playing = false;
            }
        }
        {
            let mut dac = dac_mutex.lock().await;
            dac.output_events(&events);
        }
        if playing {
            let mut clk = clock_out_mutex.lock().await;
            if clock_toggle {
                clk.pulse_clock();
            } else {
                clk.release_clock();
            }
            clock_toggle = !clock_toggle;
        }
        let period = tick::tick_period_us(bpm);
        Timer::after(Duration::from_micros(period)).await;
    }
}

// ── Entry point ─────────────────────────────────────────────────────

#[embassy_executor::main]
async fn main(spawner: Spawner) {
    info!("Requencer firmware starting...");

    // Initialize heap allocator (16 KB)
    {
        use core::mem::MaybeUninit;
        const HEAP_SIZE: usize = 16 * 1024;
        static mut HEAP_MEM: [MaybeUninit<u8>; HEAP_SIZE] = [MaybeUninit::uninit(); HEAP_SIZE];
        #[allow(static_mut_refs)]
        unsafe {
            HEAP.init(HEAP_MEM.as_ptr() as usize, HEAP_SIZE);
        }
    }

    let p = embassy_rp::init(Default::default());

    // ── SPI0: Display ────────────────────────────────────────────────
    let mut spi0_config = spi::Config::default();
    spi0_config.frequency = 62_500_000;
    let spi0 = Spi::new_blocking(
        p.SPI0,
        p.PIN_2,  // SCK
        p.PIN_23, // MOSI (RP2350 SPI0 TX)
        p.PIN_0,  // MISO (RP2350 SPI0 RX)
        spi0_config,
    );
    let lcd_cs = Output::new(p.PIN_1, Level::High);
    let lcd_dc = Output::new(p.PIN_3, Level::Low);
    let mut disp = display::init(spi0, lcd_dc, lcd_cs, Delay);
    info!("Display initialized");

    let bl_config = embassy_rp::pwm::Config::default();
    let mut bl_pwm = embassy_rp::pwm::Pwm::new_output_b(p.PWM_SLICE2, p.PIN_5, bl_config.clone());
    display::set_backlight(&mut bl_pwm, 80);

    // ── SPI1: DACs ───────────────────────────────────────────────────
    let mut spi1_config = spi::Config::default();
    spi1_config.frequency = 50_000_000;
    let spi1 = Spi::new_blocking_txonly(p.SPI1, p.PIN_30, p.PIN_31, spi1_config);
    let dac1_cs = Output::new(p.PIN_32, Level::High);
    let dac2_cs = Output::new(p.PIN_33, Level::High);
    let mut dac_driver = dac::Dac::new(spi1, dac1_cs, dac2_cs);
    dac_driver.init();
    info!("DAC initialized");

    // ── Button scanning (74HC165) ────────────────────────────────────
    let btn_clk = Output::new(p.PIN_8, Level::Low);
    let btn_latch = Output::new(p.PIN_9, Level::High);
    let btn_data = Input::new(p.PIN_10, Pull::None);
    let scanner = buttons::ButtonScanner::new(btn_clk, btn_latch, btn_data);

    // ── Encoders ─────────────────────────────────────────────────────
    let enc_a_a = Input::new(p.PIN_15, Pull::Up);
    let enc_a_b = Input::new(p.PIN_16, Pull::Up);
    let enc_a_sw = Input::new(p.PIN_17, Pull::Up);
    let enc_b_a = Input::new(p.PIN_18, Pull::Up);
    let enc_b_b = Input::new(p.PIN_19, Pull::Up);
    let enc_b_sw = Input::new(p.PIN_22, Pull::Up);

    // ── LEDs (TLC5947) ───────────────────────────────────────────────
    let led_sin = Output::new(p.PIN_11, Level::Low);
    let led_sclk = Output::new(p.PIN_12, Level::Low);
    let led_xlat = Output::new(p.PIN_13, Level::Low);
    let led_blank = Output::new(p.PIN_14, Level::High);
    let led_driver = leds::LedDriver::new(led_sin, led_sclk, led_xlat, led_blank);

    // ── MIDI (UART1) ─────────────────────────────────────────────────
    let mut uart_config = uart::Config::default();
    uart_config.baudrate = pins::MIDI_BAUD;
    let uart1 = uart::Uart::new(
        p.UART1,
        p.PIN_20,
        p.PIN_21,
        Irqs,
        p.DMA_CH2,
        p.DMA_CH3,
        uart_config,
    );
    let (midi_uart_tx, midi_uart_rx) = uart1.split();
    let midi_tx = midi::MidiTx::new(midi_uart_tx);
    let midi_rx = midi::MidiRx::new(midi_uart_rx);

    // ── Clock/Reset I/O ──────────────────────────────────────────────
    let clk_in = Input::new(p.PIN_26, Pull::Down);
    let rst_in = Input::new(p.PIN_27, Pull::Down);
    let clk_out = Output::new(p.PIN_28, Level::High);
    let rst_out = Output::new(p.PIN_4, Level::High);
    let _clock_input = clock_io::ClockInput::new(clk_in, rst_in);
    let clock_output = clock_io::ClockOutput::new(clk_out, rst_out);

    // ── Shared state ─────────────────────────────────────────────────
    let mut seq_state = SequencerState::new();
    seq_state.apply_default_presets();

    let state = STATE.init(Mutex::new(SharedState {
        sequencer: seq_state,
        ui: UiState::default(),
        system_tick: 0,
    }));
    let event_channel = EVENT_CHANNEL.init(Channel::new());
    let midi_channel = MIDI_CHANNEL.init(Channel::new());
    let dac_ref = DAC.init(Mutex::new(dac_driver));
    let clock_out_ref = CLOCK_OUT.init(Mutex::new(clock_output));
    let led_ref = LED_DRIVER.init(Mutex::new(led_driver));

    info!("All peripherals initialized");

    // ── Spawn tasks ──────────────────────────────────────────────────
    spawner.spawn(button_task(scanner, event_channel)).unwrap();
    spawner
        .spawn(encoder_task(
            enc_a_a, enc_a_b, enc_a_sw, enc_b_a, enc_b_b, enc_b_sw, event_channel,
        ))
        .unwrap();
    spawner.spawn(led_task(led_ref, state)).unwrap();
    spawner
        .spawn(tick_task(state, dac_ref, clock_out_ref))
        .unwrap();
    spawner
        .spawn(midi::midi_rx_task(midi_rx, midi_channel))
        .unwrap();

    info!("Tasks spawned, entering main loop");

    // ── Main loop: event dispatch + display ──────────────────────────
    let mut system_tick: u32 = 0;
    let mut _midi_tx = midi_tx;

    loop {
        while let Ok(event) = event_channel.try_receive() {
            let mut shared = state.lock().await;
            shared.system_tick = system_tick;
            let SharedState {
                ref mut ui,
                ref mut sequencer,
                ..
            } = *shared;
            requencer_engine::mode_machine::dispatch(ui, sequencer, event, system_tick);
        }

        while let Ok(midi_event) = midi_channel.try_receive() {
            let mut shared = state.lock().await;
            match midi_event {
                midi::MidiInput::Clock => {
                    if matches!(
                        shared.sequencer.transport.clock_source,
                        requencer_engine::types::ClockSource::Midi
                    ) {
                        let events = engine_tick(&mut shared.sequencer);
                        let mut dac = dac_ref.lock().await;
                        dac.output_events(&events);
                    }
                }
                midi::MidiInput::Start => {
                    shared.sequencer.transport.playing = true;
                    shared.sequencer.reset_playheads();
                }
                midi::MidiInput::Stop => {
                    shared.sequencer.transport.playing = false;
                }
                midi::MidiInput::Continue => {
                    shared.sequencer.transport.playing = true;
                }
            }
        }

        {
            let mut shared = state.lock().await;
            requencer_engine::mode_machine::check_clr_timeout(&mut shared.ui, system_tick);
        }

        {
            let shared = state.lock().await;
            requencer_renderer::render(&mut disp, &shared.sequencer, &shared.ui);
        }

        system_tick += 1;
        Timer::after(Duration::from_millis(pins::DISPLAY_REFRESH_MS)).await;
    }
}
