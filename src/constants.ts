// ============================================================
// protocol & hardware constants
// ============================================================
//
// everything in here is an empirically gathered fact about the
// Adafruit-style mini thermal printer (384-dot head) this driver was
// developed against. they are exported so applications can reason
// about print geometry and timing without hardcoding magic numbers.

/** ESC — escape byte introducing most text commands */
export const ESC = 0x1b;
/** GS — group separator byte introducing layout commands */
export const GS = 0x1d;
/** DC2 — device control 2, prefix of the Adafruit bitmap & density commands */
export const DC2 = 0x12;

/** full physical print head width in dots (384 dots = 48 bytes per row) */
export const PRINT_HEAD_WIDTH = 384;
/** bytes per printed row across the full physical width */
export const PRINT_HEAD_BYTES = PRINT_HEAD_WIDTH / 8; // 48
/** printable characters per line in the standard (S) font */
export const LINE_WIDTH_CHARS = 32;

/**
 * default width images are scaled to when printing (256 px = 32 bytes).
 * narrower than the physical 384 px on purpose: fewer bytes per row =
 * faster printing at the same baud rate. must be a multiple of 8.
 */
export const DEFAULT_IMAGE_PRINT_WIDTH = 256;
/** default cap on image height — keeps prints quick and avoids paper waste */
export const DEFAULT_IMAGE_MAX_HEIGHT = 300;

/** baud rate this printer reliably accepts (the classic firmware default) */
export const DEFAULT_BAUD_RATE = 9600;

// ============================================================
// pacing profile (RX-buffer protection)
// ============================================================
//
// the printer has a tiny RX buffer (64–256 bytes, firmware dependent)
// and NO hardware flow control: pushing bytes faster than the print
// head can consume them drops bytes and corrupts commands. the fix is
// time-based pacing — after every write, wait for the simulated
// transmit time plus per-command penalties measured on real hardware:

export interface PacingProfile {
  /** flat safety margin added to every write */
  baseMs: number;
  /** per 0x0a newline byte — the printer feeds & prints a line */
  newlineMs: number;
  /** per line of an ESC d (cmdFeed) command — pure line feeds are slow */
  feedMs: number;
  /** added once when an ESC @ (cmdInit) reset is detected in the buffer */
  initMs: number;
}

/** measured on hardware (see README “pacing” section) */
export const DEFAULT_PACING: PacingProfile = {
  baseMs: 10,
  newlineMs: 60,
  feedMs: 80,
  initMs: 150,
};

/** per-bitmap-row delay after sending a DC2 * row — thermal head firing time */
export const DEFAULT_DOT_PRINT_MS = 20;
/** how long to wait after a job before closing the port (mechanics settle) */
export const DEFAULT_SETTLE_MS = 2000;
/** default cooldown between jobs (used by tryAcquire/getState) */
export const DEFAULT_COOLDOWN_MS = 10_000;
/** default timeout for opening the serial port */
export const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

/**
 * print density presets for `cmdPrintDensity`.
 *
 * the DC2 # n byte packs two nibbles: upper = “heat dots” (dots firing
 * simultaneously: 0–3 → 20/40/60/80 dots), lower = “heat time”
 * (heating pulse duration, 0–15). higher = darker.
 */
export const DENSITY = {
  /** lightest — printer factory default, often too faint */
  LIGHT: 0x00,
  /** max heat time, minimum dots — good everyday default */
  DEFAULT: 0x0f,
  /** max heat time, second dot level */
  DARK: 0x2f,
  /** maximum darkness — caution: may overheat or smear */
  MAX: 0x3f,
} as const;