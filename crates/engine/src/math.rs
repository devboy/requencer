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
