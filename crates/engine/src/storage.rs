//! Serialization for persistence — state and library (patterns + presets).

extern crate alloc;
use alloc::vec::Vec;

use crate::types::{SavedPattern, SequencerState, UserPreset, MAX_SAVED};

/// Serialize full sequencer state to bytes.
pub fn serialize_state(state: &SequencerState) -> Result<Vec<u8>, postcard::Error> {
    postcard::to_allocvec(state)
}

/// Deserialize sequencer state from bytes.
pub fn deserialize_state(data: &[u8]) -> Result<SequencerState, postcard::Error> {
    postcard::from_bytes(data)
}

/// Library container for patterns + presets.
#[derive(serde::Serialize, serde::Deserialize)]
struct Library {
    patterns: heapless::Vec<SavedPattern, MAX_SAVED>,
    presets: heapless::Vec<UserPreset, MAX_SAVED>,
}

/// Serialize saved patterns and user presets to bytes.
pub fn serialize_library(
    patterns: &heapless::Vec<SavedPattern, MAX_SAVED>,
    presets: &heapless::Vec<UserPreset, MAX_SAVED>,
) -> Result<Vec<u8>, postcard::Error> {
    let lib = Library {
        patterns: patterns.clone(),
        presets: presets.clone(),
    };
    postcard::to_allocvec(&lib)
}

/// Deserialize patterns and presets from bytes.
pub fn deserialize_library(
    data: &[u8],
) -> Result<
    (
        heapless::Vec<SavedPattern, MAX_SAVED>,
        heapless::Vec<UserPreset, MAX_SAVED>,
    ),
    postcard::Error,
> {
    let lib: Library = postcard::from_bytes(data)?;
    Ok((lib.patterns, lib.presets))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::boxed::Box;

    /// SequencerState is large — run closures on a thread with enough stack.
    fn with_big_stack<F: FnOnce() + Send + 'static>(f: F) {
        let builder = std::thread::Builder::new().stack_size(16 * 1024 * 1024);
        let handle = builder.spawn(f).expect("thread spawn failed");
        handle.join().expect("thread panicked");
    }

    #[test]
    fn state_round_trip() {
        with_big_stack(|| {
            let state = Box::new(SequencerState::new());
            let bytes = serialize_state(&state).unwrap();
            let restored = Box::new(deserialize_state(&bytes).unwrap());
            assert_eq!(*state, *restored);
        });
    }

    #[test]
    fn library_round_trip_empty() {
        with_big_stack(|| {
            let patterns = heapless::Vec::new();
            let presets = heapless::Vec::new();
            let bytes = serialize_library(&patterns, &presets).unwrap();
            let (p, u) = deserialize_library(&bytes).unwrap();
            assert!(p.is_empty());
            assert!(u.is_empty());
        });
    }

    #[test]
    fn library_round_trip_with_data() {
        with_big_stack(|| {
            let mut patterns: heapless::Vec<SavedPattern, MAX_SAVED> = heapless::Vec::new();
            let state = Box::new(SequencerState::new());
            let pattern = crate::patterns::create_saved_pattern(&state, 0, "Test");
            let _ = patterns.push(pattern);

            let mut presets: heapless::Vec<UserPreset, MAX_SAVED> = heapless::Vec::new();
            let _ = presets.push(UserPreset {
                name: {
                    let mut n = heapless::String::new();
                    let _ = core::fmt::Write::write_str(&mut n, "My Preset");
                    n
                },
                config: crate::types::RandomConfig::default(),
            });

            let bytes = serialize_library(&patterns, &presets).unwrap();
            let (p, u) = deserialize_library(&bytes).unwrap();
            assert_eq!(p.len(), 1);
            assert_eq!(u.len(), 1);
            assert_eq!(p[0].name.as_str(), "Test");
            assert_eq!(u[0].name.as_str(), "My Preset");
        });
    }

    #[test]
    fn deserialize_invalid_data_returns_error() {
        with_big_stack(|| {
            let result = deserialize_state(&[0xFF, 0xFF, 0xFF]);
            assert!(result.is_err());
        });
    }
}
