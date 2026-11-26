// Tiny repeatable-safe argv parser shared by the MuMu CLI and self-test.
// Kept separate so importing the parser can never execute the CLI entry point.

export function parseArgv(argv) {
  const [command, ...rest] = argv;
  const options = { _: [] };
  const assign = (key, value) => {
    if (!(key in options)) {
      options[key] = value;
      return;
    }
    if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = [options[key], value];
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--') {
      options._.push(...rest.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      if (equals > 0) {
        assign(arg.slice(2, equals), arg.slice(equals + 1));
        continue;
      }
      const key = arg.slice(2);
      const next = rest[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        assign(key, next);
        index += 1;
      } else {
        assign(key, true);
      }
    } else {
      options._.push(arg);
    }
  }
  return { command, options };
}
