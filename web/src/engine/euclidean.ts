/**
 * Generate a euclidean rhythm using Bjorklund's algorithm.
 * Distributes `hits` as evenly as possible across `length` steps.
 */
export function euclidean(hits: number, length: number): boolean[] {
  if (length === 0) return []
  if (hits === 0) return Array(length).fill(false)
  if (hits >= length) return Array(length).fill(true)

  // Bjorklund's algorithm: build groups and recursively distribute remainders
  let groups: boolean[][] = []

  for (let i = 0; i < hits; i++) {
    groups.push([true])
  }
  for (let i = 0; i < length - hits; i++) {
    groups.push([false])
  }

  while (true) {
    const numFull = hits
    const numRemainder = groups.length - numFull

    if (numRemainder <= 1) break

    const mergeCount = Math.min(numFull, numRemainder)

    const merged: boolean[][] = []
    for (let i = 0; i < mergeCount; i++) {
      merged.push([...groups[i], ...groups[groups.length - 1 - i]])
    }

    // Keep any unmerged groups from the middle
    const unmerged = groups.slice(mergeCount, groups.length - mergeCount)
    groups = [...merged, ...unmerged]
    hits = mergeCount
  }

  return groups.flat()
}
