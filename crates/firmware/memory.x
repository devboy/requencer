/* Memory layout for PGA2350 (RP2350B) */
/* 16 MB flash, 520 KB SRAM, 8 MB PSRAM */

MEMORY {
    BOOT2 : ORIGIN = 0x10000000, LENGTH = 0x100
    FLASH  : ORIGIN = 0x10000100, LENGTH = 16384K - 0x100
    RAM    : ORIGIN = 0x20000000, LENGTH = 520K
    /* PSRAM is available at 0x11000000, 8MB — accessed via XIP */
}

SECTIONS {
    /* Boot2 bootloader (256 bytes, provided by embassy-rp) */
    .boot2 ORIGIN(BOOT2) : {
        KEEP(*(.boot2));
    } > BOOT2
} INSERT BEFORE .text;
