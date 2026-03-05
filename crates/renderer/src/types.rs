/// Screen modes matching the hardware UI navigation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScreenMode {
    Home,
    GateEdit,
    PitchEdit,
    VelEdit,
    ModEdit,
    MuteEdit,
    Route,
    Rand,
    MutateEdit,
    TransposeEdit,
    VariationEdit,
    Settings,
    Pattern,
    PatternLoad,
    NameEntry,
}

/// Subtrack identifier for UI navigation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UiSubtrack {
    Gate,
    Pitch,
    Velocity,
    Mod,
}

/// Feature screen identifier.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feature {
    Mute,
    Route,
    Rand,
    Mutate,
    Transpose,
    Variation,
}

/// UI state that the renderer reads to draw screens.
#[derive(Clone, Debug)]
pub struct UiState {
    pub mode: ScreenMode,
    pub selected_track: u8,     // 0-3
    pub selected_step: u8,      // 0-15
    pub current_page: u8,       // 0-based page for >16 step sequences
    pub rand_param: u8,         // selected row in RAND screen
    pub xpose_param: u8,        // selected row in XPOSE screen
    pub mutate_param: u8,       // selected row in DRIFT screen
    pub route_param: u8,        // selected row in ROUTE screen
    pub settings_param: u8,     // selected row in SETTINGS screen
    pub var_param: u8,          // variation catalog index
    pub var_selected_bar: i8,   // -1 = none, 0-15 = selected bar
    pub var_cursor: u8,         // transform stack cursor
    pub mod_lfo_view: bool,     // false = MOD, true = LFO
    pub mod_lfo_param: u8,      // 0-6: LFO param row
    pub flash_message: Option<&'static str>,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            mode: ScreenMode::Home,
            selected_track: 0,
            selected_step: 0,
            current_page: 0,
            rand_param: 0,
            xpose_param: 0,
            mutate_param: 0,
            route_param: 0,
            settings_param: 0,
            var_param: 0,
            var_selected_bar: -1,
            var_cursor: 0,
            mod_lfo_view: false,
            mod_lfo_param: 0,
            flash_message: None,
        }
    }
}

/// LED state for hardware buttons.
#[derive(Clone, Debug)]
pub struct LedState {
    pub steps: [LedMode; 16],
    pub tracks: [bool; 4],
    pub play: LedMode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LedMode {
    Off,
    On,
    Dim,
    Flash,
}

impl Default for LedState {
    fn default() -> Self {
        Self {
            steps: [LedMode::Off; 16],
            tracks: [false; 4],
            play: LedMode::Off,
        }
    }
}
