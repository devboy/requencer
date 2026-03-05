/// LCD display dimensions.
pub const LCD_W: u32 = 480;
pub const LCD_H: u32 = 320;

/// Status bar height.
pub const STATUS_H: u32 = 24;

/// Content area.
pub const CONTENT_Y: u32 = STATUS_H;
pub const CONTENT_H: u32 = LCD_H - STATUS_H;

/// Row height for parameter lists.
pub const ROW_H: u32 = 24;

/// Standard padding.
pub const PAD: u32 = 8;

/// Font dimensions (6x10 bitmap font).
pub const CHAR_W: u32 = 6;
pub const CHAR_H: u32 = 10;

/// Large font dimensions (10x20 bitmap font).
pub const CHAR_W_LG: u32 = 10;
pub const CHAR_H_LG: u32 = 20;

/// Home screen: track band height (4 tracks in 296px).
pub const HOME_BAND_H: u32 = CONTENT_H / 4; // 74px per track

/// Home screen: sub-rows within each track band.
pub const HOME_GATE_H: u32 = 24;
pub const HOME_PITCH_H: u32 = 26;
pub const HOME_VEL_H: u32 = 18;

/// Edit screen: 2x8 step grid layout.
pub const EDIT_COLS: u32 = 8;
pub const EDIT_ROWS: u32 = 2;
pub const EDIT_HEADER_H: u32 = 28;
pub const EDIT_FOOTER_H: u32 = 22;

/// Edit screen step cell size (computed from available space).
pub fn edit_step_size() -> (u32, u32) {
    let avail_h = CONTENT_H - EDIT_HEADER_H - EDIT_FOOTER_H;
    let cell_w = (LCD_W - PAD * 2) / EDIT_COLS;
    let cell_h = avail_h / EDIT_ROWS;
    (cell_w, cell_h)
}

/// Number of visible steps per page.
pub const STEPS_PER_PAGE: usize = 16;
