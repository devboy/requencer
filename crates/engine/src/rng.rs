/// Deterministic PRNG (splitmix variant).
///
/// Must produce identical output to the TypeScript implementation:
/// ```js
/// let t = seed | 0;
/// t = (t + 0x6d2b79f5) | 0;
/// let r = Math.imul(t ^ (t >>> 15), 1 | t);
/// r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
/// return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
/// ```
#[derive(Clone, Debug)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// Returns a value in [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let t = self.state;
        let mut r = (t ^ (t >> 15)).wrapping_mul(1 | t);
        r = (r.wrapping_add((r ^ (r >> 7)).wrapping_mul(61 | r))) ^ r;
        let result = r ^ (r >> 14);
        result as f32 / 4294967296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_with_same_seed() {
        let mut rng1 = Rng::new(42);
        let mut rng2 = Rng::new(42);
        for _ in 0..100 {
            assert_eq!(rng1.next_f32(), rng2.next_f32());
        }
    }

    #[test]
    fn different_seeds_differ() {
        let mut rng1 = Rng::new(42);
        let mut rng2 = Rng::new(99);
        assert_ne!(rng1.next_f32(), rng2.next_f32());
    }

    #[test]
    fn matches_typescript_output() {
        // Test vectors extracted from TS: createRng(42) first 10 values
        let expected: [f32; 10] = [
            0.6011037519201636,
            0.44829055899754167,
            0.8524657934904099,
            0.6697340414393693,
            0.17481389874592423,
            0.5265925421845168,
            0.2732279943302274,
            0.6247446539346129,
            0.8654746483080089,
            0.4723170551005751,
        ];
        let mut rng = Rng::new(42);
        for (i, &exp) in expected.iter().enumerate() {
            let got = rng.next_f32();
            assert!(
                (got - exp).abs() < 1e-7,
                "value {i}: got {got}, expected {exp}"
            );
        }
    }

    #[test]
    fn values_in_range() {
        let mut rng = Rng::new(12345);
        for _ in 0..1000 {
            let v = rng.next_f32();
            assert!(v >= 0.0 && v < 1.0, "value {v} out of range [0, 1)");
        }
    }
}
