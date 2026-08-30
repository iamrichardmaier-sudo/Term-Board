const START = Date.now();

function stamp() {
  const s = ((Date.now() - START) / 1000).toFixed(1).padStart(6);
  return `[${s}s]`;
}

export const log = {
  info: (...a) => console.log(stamp(), ...a),
  step: (...a) => console.log(stamp(), "·", ...a),
  warn: (...a) => console.warn(stamp(), "warn:", ...a),
  error: (...a) => console.error(stamp(), "ERROR:", ...a),
  /** Something the run survived but Richard should know about. */
  flag: (...a) => console.log(stamp(), "⚑", ...a),
};
