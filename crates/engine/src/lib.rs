#![cfg_attr(not(feature = "std"), no_std)]

//! Requencer engine — pure sequencer logic.
//!
//! Zero dependencies on DOM, audio, or any platform-specific APIs.
//! All functions are pure: receive state, return new state.
