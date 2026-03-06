// ── no_std-safe f32 math wrappers (via libm) ──────────────────────

/// Floor of f32.
#[inline]
pub fn floorf(x: f32) -> f32 {
    libm::floorf(x)
}

/// Round f32 to nearest integer.
#[inline]
pub fn roundf(x: f32) -> f32 {
    libm::roundf(x)
}

/// Sine of f32.
#[inline]
pub fn sinf(x: f32) -> f32 {
    libm::sinf(x)
}

/// Absolute value of f32.
#[inline]
pub fn fabsf(x: f32) -> f32 {
    libm::fabsf(x)
}

/// Clamp a value to the range [min, max].
pub fn clamp(value: f32, min: f32, max: f32) -> f32 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_within_range() {
        assert_eq!(clamp(0.5, 0.0, 1.0), 0.5);
    }

    #[test]
    fn clamp_below_min() {
        assert_eq!(clamp(-0.5, 0.0, 1.0), 0.0);
    }

    #[test]
    fn clamp_above_max() {
        assert_eq!(clamp(1.5, 0.0, 1.0), 1.0);
    }
}
