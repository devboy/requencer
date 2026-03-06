use heapless::Vec;

use crate::MAX_STEPS;

/// Generate a Euclidean rhythm using Bjorklund's algorithm.
///
/// Distributes `hits` evenly across `length` steps.
/// E.g., euclidean(3, 8) = [true, false, false, true, false, false, true, false]
pub fn euclidean(hits: usize, length: usize) -> Vec<bool, MAX_STEPS> {
    let mut result = Vec::new();

    if length == 0 {
        return result;
    }

    if hits == 0 {
        for _ in 0..length {
            let _ = result.push(false);
        }
        return result;
    }

    if hits >= length {
        for _ in 0..length {
            let _ = result.push(true);
        }
        return result;
    }

    // Bjorklund's algorithm using a flat buffer + length tracking.
    // Each "group" is a contiguous slice. We track group boundaries.
    // Max total elements = MAX_STEPS, max groups = MAX_STEPS.
    let mut buf: Vec<bool, MAX_STEPS> = Vec::new();
    let mut group_lens: Vec<u8, MAX_STEPS> = Vec::new();

    // Initial groups: `hits` groups of [true], then `length - hits` groups of [false]
    for _ in 0..hits {
        let _ = buf.push(true);
        let _ = group_lens.push(1);
    }
    for _ in 0..(length - hits) {
        let _ = buf.push(false);
        let _ = group_lens.push(1);
    }

    let mut num_full = hits;

    loop {
        let num_groups = group_lens.len();
        let num_remainder = num_groups - num_full;

        if num_remainder <= 1 {
            break;
        }

        let merge_count = num_full.min(num_remainder);

        // Build merged result: merge group[i] with group[num_groups - 1 - i]
        let mut new_buf: Vec<bool, MAX_STEPS> = Vec::new();
        let mut new_lens: Vec<u8, MAX_STEPS> = Vec::new();

        // Compute group start offsets
        let mut starts: Vec<usize, MAX_STEPS> = Vec::new();
        let mut offset = 0usize;
        for &gl in group_lens.iter() {
            let _ = starts.push(offset);
            offset += gl as usize;
        }

        // Merged groups
        for i in 0..merge_count {
            let a_start = starts[i];
            let a_len = group_lens[i] as usize;
            let b_idx = num_groups - 1 - i;
            let b_start = starts[b_idx];
            let b_len = group_lens[b_idx] as usize;

            for j in 0..a_len {
                let _ = new_buf.push(buf[a_start + j]);
            }
            for j in 0..b_len {
                let _ = new_buf.push(buf[b_start + j]);
            }
            let _ = new_lens.push((a_len + b_len) as u8);
        }

        // Unmerged middle groups
        for i in merge_count..(num_groups - merge_count) {
            let s = starts[i];
            let l = group_lens[i] as usize;
            for j in 0..l {
                let _ = new_buf.push(buf[s + j]);
            }
            let _ = new_lens.push(l as u8);
        }

        buf = new_buf;
        group_lens = new_lens;
        num_full = merge_count;
    }

    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_vec(v: &Vec<bool, MAX_STEPS>) -> alloc::vec::Vec<bool> {
        v.iter().copied().collect()
    }

    extern crate alloc;

    #[test]
    fn e_3_8() {
        let result = euclidean(3, 8);
        assert_eq!(
            to_vec(&result),
            vec![true, false, false, true, false, false, true, false]
        );
    }

    #[test]
    fn e_5_13() {
        let result = euclidean(5, 13);
        assert_eq!(
            to_vec(&result),
            vec![
                true, false, false, true, false, true, false, false, true, false, true, false,
                false
            ]
        );
    }

    #[test]
    fn e_0_4() {
        let result = euclidean(0, 4);
        assert_eq!(to_vec(&result), vec![false, false, false, false]);
    }

    #[test]
    fn e_4_4() {
        let result = euclidean(4, 4);
        assert_eq!(to_vec(&result), vec![true, true, true, true]);
    }

    #[test]
    fn e_0_0() {
        let result = euclidean(0, 0);
        assert!(result.is_empty());
    }

    #[test]
    fn e_1_4() {
        let result = euclidean(1, 4);
        assert_eq!(to_vec(&result), vec![true, false, false, false]);
    }

    #[test]
    fn correct_hit_count() {
        for hits in 0..=16 {
            for length in hits..=16 {
                let result = euclidean(hits, length);
                let count = result.iter().filter(|&&b| b).count();
                assert_eq!(count, hits, "E({hits},{length}) has {count} hits, expected {hits}");
            }
        }
    }
}
