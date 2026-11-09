// Plain syntax on purpose: this runs before anything else, so it must parse on old Node too.
export function checkNode(version, min) {
  if (min === undefined) min = 22;
  var major = parseInt(String(version).replace(/^v/, '').split('.')[0], 10);
  if (major >= min) return null;
  return 'anysite-mcp needs Node ' + min + ' or newer; you have v' + String(version).replace(/^v/, '') +
    '. Update Node: https://nodejs.org';
}
