# Reddit post draft — hardware review request

Target subs (tailor the ask per sub, don't blanket-crosspost the same day):

- **r/synthdiy** — primary; full post below.
- **r/modular** — shorter version, lead with the live demo.
- **r/AskElectronics** — narrow it to one or two specific circuits (they
  dislike "review my whole board" posts).

Personalize before posting: the backstory paragraph and the "what I'm unsure
about" list should be in your own words — reviewers respond to specifics.

---

## Title options

1. Built a 4-track polymetric eurorack sequencer (RP2350 + DAC8568) — all my
   tests pass, but I'm a software dev, not an EE. Design review before I
   order boards?
2. Open-source eurorack sequencer about to go to fab — would love
   experienced eyes on the schematics (KiCad + PDFs + live browser demo)
3. My first eurorack module: 4-track randomizing sequencer. Free/open
   design — what did I get wrong before I ship it to manufacturing?

## Body

Hi all — I've spent the last months building **Requencer**, a 4-track
eurorack step sequencer designed around polymetric randomization: every
track has independent gate/pitch/velocity/mod subtracks with their own
lengths and clock dividers, plus scale-aware randomization of any track or
any single layer.

**You can play the whole thing in the browser** (it's the real faceplate
layout, mouse/touch): https://devboy.github.io/requencer/

The catch: I'm a software developer. The firmware and engine are solid and
tested, the PCB pipeline (atopile → KiCad → autorouting → DRC) passes all
its local checks — but *"my tests pass" is not the same as "this circuit is
right"*, and I don't have the hardware background to know what I don't
know. Before I send this to manufacturing, I'd be very grateful for a
design review.

**The hardware** — a three-board stack behind a 3U eurorack faceplate:

- **Control board:** buttons, encoders, jacks, LED drivers, shift
  registers, USB-C, SD card, MIDI in
- **Main board:** RP2350 (PGA2350 module), DAC8568 → op-amp output stages
  for CV (1V/oct), eurorack power entry + regulators
- Board-to-board: 2×16 shrouded headers

**Review materials** (everything is open source, MIT + CERN-OHL-S):

- Schematic review PDFs (one page per subcircuit):
  https://github.com/devboy/requencer/releases — the release zip also has
  the full KiCad projects, gerbers, and STEP files
- Repo: https://github.com/devboy/requencer

**What I'm most unsure about:**

- Eurorack power entry & regulation (reverse polarity, filtering, rail
  budget)
- The DAC8568 output stage — 1V/oct scaling and offset accuracy over 4
  octaves+
- Board-to-board connector pinout (55 signals over 64 pins — anything
  fragile about the assignment?)
- USB-C, SD card, and MIDI input circuits (opto, termination)
- Anything a checklist can't catch — layout smells, footprint mistakes,
  "you'll regret this in rev 2" stuff

Happy to answer anything about the sequencer side in return — the
randomizer algorithms (euclidean, Markov-chain clusters), the polymetric
engine, or the atopile → KiCad pipeline. Thanks!
